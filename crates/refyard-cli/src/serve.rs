//! `serve` and `open`: the native process that exposes the service over loopback HTTP.
//!
//! This is the composition root for the native command line, and the same one the
//! desktop window uses: the Git the machine has, the private state directory for the
//! journal, the SSH configuration the environment names. On top of that it adds the two
//! decisions a serving process makes before the first request — which repositories were
//! approved, and therefore what a paired session may reach.
//!
//! Foreground is the whole lifecycle: the process runs until Ctrl+C, and a stop refuses
//! new work before it ends. There is no daemon and no installer.

use std::path::PathBuf;
use std::sync::Arc;

use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};
use refyard_host::state_root::default_state_root;
use refyard_http::auth::Grants;

/// Where a serving run writes. Callbacks rather than streams, because the readiness
/// line has to reach the supervisor *while the process runs* — a buffered answer that
/// arrives at exit is indistinguishable from never answering.
#[derive(Clone)]
pub struct ServeOutput {
    pub stdout: Arc<dyn Fn(&str) + Send + Sync>,
    pub stderr: Arc<dyn Fn(&str) + Send + Sync>,
}

/// One serving run's options, already parsed.
pub struct ServeOptions {
    pub port: u16,
    /// Whether `port` was named on the command line: an explicit port is a request for
    /// *that* port, so a busy one is refused rather than silently moved.
    pub port_explicit: bool,
    pub ticket_ttl_seconds: u64,
    /// Machine output: one JSON object on stdout, the pairing URL on stderr.
    pub json: bool,
    /// Bind the pairing ticket to the empty origin: a supervisor spends it over a plain
    /// fetch with no Origin header, and no browser can spend it at all.
    pub machine: bool,
    /// Open the pairing URL in this machine's browser once the listener is up.
    pub open_browser: bool,
    /// The built workbench to serve from `/`; `None` makes this API-only.
    pub web_root: Option<PathBuf>,
    /// Repositories approved before the first request.
    pub paths: Vec<String>,
    pub output: ServeOutput,
}

/// Serves until the process is asked to stop, answering the exit status.
pub async fn run(options: ServeOptions) -> i32 {
    let output = options.output.clone();
    let stdout = move |line: &str| (output.stdout)(line);
    let stderr = move |line: &str| (output.stderr)(line);

    let git = match LocalGit::discover() {
        Ok(git) => git,
        Err(message) => {
            stderr(&format!("refyard: {message}"));
            return 2;
        }
    };
    let environment: Vec<(String, String)> = std::env::vars().collect();
    let ssh_config = ssh_config_from(&environment);
    let state_root = default_state_root(&environment, std::env::consts::OS);
    let home = refyard_host::reads::filesystem::home_from(git.environment())
        .unwrap_or_else(|| PathBuf::from("/"));
    let started = refyard_host::clock::now_millis();
    let service_builder = ApplicationService::new(ApplicationServiceConfig {
        git,
        service_instance_id: format!("srvc_{:x}{:x}", std::process::id(), started),
        target_id: "tgt_local".to_owned(),
        target_generation: format!("gen_{started}"),
        home,
    })
    .with_state_root(state_root);
    let service_builder = match service_builder {
        Ok(service) => service.with_ssh_config_opt(ssh_config),
        Err(problem) => {
            stderr(&format!(
                "refyard: the private state could not be opened: {problem}"
            ));
            return 2;
        }
    };
    let service = Arc::new(service_builder.with_writes());

    // The approved repositories are the grant: what was named on the command line is
    // what a paired session may reach. Repositories registered later through the API
    // extend the registering session's own grants, never everyone's.
    let mut allowed_root_ids = Vec::new();
    let mut repository_ids = Vec::new();
    for path in &options.paths {
        // The service answers with the whole registry, and a person's spelling of the
        // path is not the service's display form of it (a `/tmp` link is `/private/tmp`
        // behind the name), so the newly approved repository is found by difference, not
        // by comparing spellings.
        let before: std::collections::BTreeSet<String> = service
            .repositories()
            .await
            .repositories
            .into_iter()
            .map(|record| record.repository_id)
            .collect();
        match service.register_repository_on(path, None).await {
            Ok(answer) => {
                for record in answer.repositories {
                    if !before.contains(&record.repository_id)
                        && !repository_ids.contains(&record.repository_id)
                    {
                        repository_ids.push(record.repository_id.clone());
                    }
                    if !before.contains(&record.repository_id)
                        && !allowed_root_ids.contains(&record.allowed_root_id)
                    {
                        allowed_root_ids.push(record.allowed_root_id.clone());
                    }
                }
            }
            Err(problem) => {
                stderr(&format!(
                    "refyard: {path} could not be approved: {}",
                    problem.message
                ));
                return 2;
            }
        }
    }

    let host = match refyard_http::start_http_host(refyard_http::HttpHostOptions {
        service: Arc::clone(&service),
        port: options.port,
        web_root: options.web_root.clone(),
        ticket_ttl_seconds: options.ticket_ttl_seconds,
        grants: Grants::for_repositories(allowed_root_ids.clone(), repository_ids.clone()),
    })
    .await
    {
        Ok(host) => host,
        Err(refyard_http::StartError::PortInUse(port)) if !options.port_explicit => {
            // The default port is a courtesy, not a promise. A second service, a dev
            // server or a tunnel may hold it; taking a free port keeps the default
            // usable, and the note names both numbers so nothing moves silently.
            match refyard_http::start_http_host(refyard_http::HttpHostOptions {
                service: Arc::clone(&service),
                port: 0,
                web_root: options.web_root.clone(),
                ticket_ttl_seconds: options.ticket_ttl_seconds,
                grants: Grants::for_repositories(allowed_root_ids.clone(), repository_ids.clone()),
            })
            .await
            {
                Ok(host) => {
                    stderr(&format!(
                        "note: port {port} is in use; listening on port {} instead (pass --port to pin one)",
                        host.port
                    ));
                    host
                }
                Err(error) => {
                    stderr(&format!("refyard: the listener could not start: {error:?}"));
                    return 2;
                }
            }
        }
        Err(refyard_http::StartError::PortInUse(port)) => {
            stderr(&format!(
                "refyard: port {port} is already in use; stop what is using it or pass a different --port"
            ));
            return 2;
        }
        Err(error) => {
            stderr(&format!("refyard: the listener could not start: {error:?}"));
            return 2;
        }
    };

    let origin = host.base_url.clone();
    // A machine run binds its one ticket to the empty origin: the supervisor spending it
    // sends no Origin header at all, and no browser can spend it, ever.
    let minted = if options.machine {
        host.machine_pairing_url()
    } else {
        host.pairing_url(&origin)
    };
    let pairing_url = match minted {
        Ok(url) => url,
        Err(problem) => {
            stderr(&format!(
                "refyard: a pairing URL could not be minted: {}",
                problem.message
            ));
            return 2;
        }
    };

    // The readiness answer goes out now, while the process lives: a supervisor reading
    // stdout is waiting for exactly this line, and an answer that waits for exit is no
    // answer at all.
    if options.json {
        let readiness = serde_json::json!({
            "serviceInstanceId": host.service_instance_id,
            "port": host.port,
            "url": origin,
            "apiMajor": refyard_host::service::API_MAJOR,
            "ticketTtlSeconds": options.ticket_ttl_seconds,
            "ticketSingleUse": true,
            "repositoryIds": repository_ids,
            "allowedRootIds": allowed_root_ids,
            "ui": options.web_root.as_ref().map(|_| origin.clone()),
            "apiOnly": options.web_root.is_none(),
        });
        stdout(&readiness.to_string());
        // The pairing URL is a secret in transit: in machine mode it goes to stderr, so
        // a supervisor can capture it and a log cannot mistake it for data.
        stderr(&format!("pairing URL (single use): {pairing_url}"));
    } else {
        stdout(&format!(
            "refyard-native serve (api {})\n  repositories: {}\n  port:       {}{}\n  ticket ttl: {}s, single use\n  ui:         {}\n\n  open this URL in your browser to pair this session:\n    {pairing_url}\n\n  ready {}\n  press Ctrl+C to stop\n",
            refyard_host::service::API_MAJOR,
            if options.paths.is_empty() { "(none yet; register through the workbench)".to_string() } else { options.paths.join(", ") },
            host.port,
            if options.port == 0 { " (chosen by the OS)" } else { "" },
            options.ticket_ttl_seconds,
            if options.web_root.is_some() { format!("{origin} (local workbench)") } else { "API-only".to_string() },
            serde_json::json!({
                "serviceInstanceId": host.service_instance_id,
                "port": host.port,
                "url": origin,
            }),
        ));
    }

    if options.open_browser {
        match open_in_browser(&pairing_url) {
            Ok(()) => {}
            Err(reason) => stderr(&format!(
                "note: could not open a browser ({reason}); use the printed URL instead"
            )),
        }
    }

    wait_for_stop().await;
    stderr("stopping: no new requests will be accepted");
    host.close().await;
    0
}

/// Blocks until the process is asked to stop: Ctrl+C on every platform, SIGTERM where
/// the platform has it.
async fn wait_for_stop() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate()).expect("SIGTERM handler");
        let mut interrupt = signal(SignalKind::interrupt()).expect("SIGINT handler");
        tokio::select! {
            _ = terminate.recv() => {}
            _ = interrupt.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

/// Opens the pairing URL in this machine's browser: a fixed program per platform, the
/// URL as one argument, no shell anywhere in between.
fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("open").arg(url).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let opened = std::process::Command::new("xdg-open").arg(url).status();
    #[cfg(target_os = "windows")]
    let opened = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status();
    match opened {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("the opener exited with {status}")),
        Err(error) => Err(error.to_string()),
    }
}

/// The variable that names the SSH configuration file this host should use, shared with
/// the desktop shell's rule: absolute or absent, never relative.
fn ssh_config_from(environment: &[(String, String)]) -> Option<PathBuf> {
    let value = environment
        .iter()
        .find(|(name, _)| name == "REFYARD_SSH_CONFIG")
        .map(|(_, value)| value.as_str())?;
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return None;
    }
    Some(path)
}

trait WithSshConfigOpt {
    fn with_ssh_config_opt(self, config: Option<PathBuf>) -> Self;
}

impl WithSshConfigOpt for ApplicationService {
    fn with_ssh_config_opt(self, config: Option<PathBuf>) -> Self {
        match config {
            Some(path) => self.with_ssh_config_file(path),
            None => self,
        }
    }
}
