//! The composition root: the one place a GPUI process builds its host.
//!
//! This mirrors `apps/desktop/src-tauri/src/lib.rs::AppState::build` — the Tauri shell's
//! construction, minus the shell. The service is the same `ApplicationService` the
//! Tauri commands and the CLI drive, driven here in-process: no IPC, no HTTP listener,
//! no sidecar. Writes are registered at the root so the service that answers
//! `capabilities` is the one a mutation is submitted to.
//!
//! The private state directory is named outright, like the product processes do: a write
//! whose result is unknown has to block the next one after a restart too, and that is
//! only true if the journal was on disk before the process went away.

use std::path::PathBuf;
use std::sync::Arc;

use refyard_host::providers::local::LocalGit;
use refyard_host::reads::filesystem;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};
use refyard_host::state_root::default_state_root;

use crate::bridge::HostRuntime;

/// The actor every UI submission is made under. The service namespaces its idempotency
/// and queue records per actor; one process, one actor.
#[expect(dead_code, reason = "mutations arrive with the changes view")]
pub const ACTOR: &str = "gpui-main";

/// Everything the UI needs to reach the host.
pub struct Host {
    pub service: Arc<ApplicationService>,
    pub runtime: Arc<HostRuntime>,
    /// The state root the journal lives under; UI preferences are persisted beside it.
    pub state_root: PathBuf,
}

impl Host {
    /// Builds the host a desktop process serves: the local target, discovered once, with
    /// this platform's per-user state directory.
    ///
    /// Discovery happens before the window opens, so a machine without `git` fails to
    /// start with that sentence on stderr instead of opening a workbench whose every
    /// panel reports an error.
    pub fn for_this_machine() -> Result<Self, String> {
        let git = LocalGit::discover()?;
        let environment: Vec<(String, String)> = std::env::vars().collect();
        let ssh_config = ssh_config_from(&environment);
        let root = default_state_root(&environment, std::env::consts::OS);
        Self::build(git, ssh_config, root)
    }

    fn build(
        git: LocalGit,
        ssh_config: Option<PathBuf>,
        state_root: PathBuf,
    ) -> Result<Self, String> {
        let started = millis_since_epoch();
        // The home a person browses from is the home this host runs Git with, so the
        // fixture and the product cannot disagree about which `~` is meant.
        let home =
            filesystem::home_from(git.environment()).unwrap_or_else(|| PathBuf::from("/"));
        let mut service = ApplicationService::new(ApplicationServiceConfig {
            git,
            service_instance_id: instance_id(std::process::id(), started),
            target_id: "tgt_local".to_owned(),
            target_generation: format!("gen_{started}"),
            home,
        });
        if let Some(ssh_config) = ssh_config {
            service = service.with_ssh_config_file(ssh_config);
        }
        let service = service
            .with_state_root(state_root.clone())
            .map_err(|problem| problem.to_string())?;
        Ok(Self {
            service: Arc::new(service.with_writes()),
            runtime: Arc::new(HostRuntime::new()?),
            state_root,
        })
    }
}

/// The variable that names the SSH configuration file this host should use — the same
/// rule the Tauri shell applies, so both shells behave identically on one machine.
pub const SSH_CONFIG_VARIABLE: &str = "REFYARD_SSH_CONFIG";

/// The configuration file named by the environment, if it names one that can be used.
///
/// A value that is empty or not absolute is not a file `-F` can be given: OpenSSH would
/// refuse an empty path and resolve a relative one against its own working directory.
/// Both are reported and ignored rather than failing to start.
fn ssh_config_from(environment: &[(String, String)]) -> Option<PathBuf> {
    let value = environment
        .iter()
        .find(|(name, _)| name == SSH_CONFIG_VARIABLE)
        .map(|(_, value)| value.as_str())?;
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        eprintln!(
            "refyard-gpui: {SSH_CONFIG_VARIABLE} is not an absolute path ({value}); this host \
             will use this machine's own SSH configuration instead"
        );
        return None;
    }
    Some(path)
}

/// A service instance id that is unique per process start without a random source: two
/// hosts on one machine differ by pid, two starts differ by time.
fn instance_id(pid: u32, started: u128) -> String {
    format!("srvc_{pid:x}{started:x}")
}

fn millis_since_epoch() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(value: &str) -> Vec<(String, String)> {
        vec![(SSH_CONFIG_VARIABLE.to_string(), value.to_string())]
    }

    #[test]
    fn an_ssh_config_file_is_taken_only_when_the_environment_names_a_usable_one() {
        assert_eq!(
            ssh_config_from(&environment("/tmp/fixture/.ssh/config")),
            Some(PathBuf::from("/tmp/fixture/.ssh/config"))
        );
        assert_eq!(ssh_config_from(&[]), None);
        // An empty value would become `-F ""`, which OpenSSH refuses; a relative one
        // would be resolved against whatever directory the process happens to be in.
        assert_eq!(ssh_config_from(&environment("")), None);
        assert_eq!(ssh_config_from(&environment("ssh/config")), None);
        // Another variable's presence is not this variable's value.
        assert_eq!(
            ssh_config_from(&[("HOME".to_string(), "/home/someone".to_string())]),
            None
        );
    }

    #[test]
    fn instance_ids_differ_by_pid_and_start_time() {
        assert_ne!(instance_id(1, 1), instance_id(2, 1));
        assert_ne!(instance_id(1, 1), instance_id(1, 2));
    }
}
