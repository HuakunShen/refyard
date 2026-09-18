//! The desktop shell: a window around the Rust application service.
//!
//! This crate is a host, not a second implementation. Every command it exposes turns a closed
//! request into a call on `refyard_host::service::ApplicationService`, and the only things it
//! adds are what a windowed process has to add: which window owns a session, where a
//! subscription's frames are delivered, and where the process's one execution target lives.
//!
//! Three properties are load-bearing, and each is structural rather than a promise:
//!
//! - **no JavaScript runtime and no local listener.** The frontend is embedded in the binary
//!   as assets and reached over Tauri's IPC; nothing in this dependency tree contains a JS
//!   engine, an HTTP server or a sidecar.
//! - **no general-purpose plugin.** There is no shell, filesystem, dialog, http or opener
//!   plugin in `Cargo.toml`, so there is no command from one to be granted. The window's only
//!   Tauri capability is `core:event:default`, which is exactly listen and unlisten.
//! - **the WebView is untrusted about scope.** It names a session and a repository id; it
//!   cannot name a path, a program or an argument. Git runs only where the service's planners
//!   put it, against repositories the host approved.
//!
//! The bundle identifier is a placeholder: `refyard` is a working name and no domain is owned,
//! so this file claims none.
//!
//! The modules are public so the integration tests can drive the production dispatcher and the
//! real ownership gate instead of a test double.

pub mod commands;
pub mod dispatch;
pub mod events;
pub mod session;

use std::path::PathBuf;
use std::sync::Arc;

use refyard_host::providers::local::LocalGit;
use refyard_host::reads::filesystem;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};

use crate::events::EventRegistry;
use crate::session::SessionRegistry;

/// Everything a command handler receives.
pub struct AppState {
    /// The target this process serves. One for now: the machine it runs on. A second target
    /// arrives with the SSH provider, and a session will then name the one it talks to.
    pub service: Arc<ApplicationService>,
    pub sessions: SessionRegistry,
    pub events: EventRegistry,
}

impl AppState {
    /// Builds the state a desktop process serves: the local target, discovered once.
    ///
    /// Discovery happens before the window opens, so a machine without `git` fails to start
    /// with that sentence on stderr instead of opening a workbench whose every panel reports
    /// an error.
    pub fn for_this_machine() -> Result<Self, String> {
        Ok(Self::with_git(LocalGit::discover()?))
    }

    /// The same state around an already-resolved Git, so a test can point the whole shell at
    /// a fixture repository without a window.
    pub fn with_git(git: LocalGit) -> Self {
        let ssh_config = ssh_config_from(&std::env::vars().collect::<Vec<_>>());
        Self::with_ssh_config(git, ssh_config)
    }

    /// The same, with the SSH configuration source stated rather than read from the process.
    ///
    /// A named file is both the file this host enumerates hosts from and the file `ssh` is
    /// given with `-F`, so the hosts a person picks are the hosts `ssh` will actually use.
    /// That matters because OpenSSH resolves `~/.ssh/config` from the passwd entry and not
    /// from `HOME`: a process whose `HOME` was set for it would otherwise list one file and
    /// execute another, and neither the fixture nor a person would be told.
    pub fn with_ssh_config(git: LocalGit, ssh_config: Option<PathBuf>) -> Self {
        let started = millis_since_epoch();
        // The home a person browses from is the home this host runs Git with, so a fixture
        // and the product cannot disagree about which `~` is meant.
        let home = filesystem::home_from(git.environment()).unwrap_or_else(|| PathBuf::from("/"));
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
        Self {
            service: Arc::new(service),
            sessions: SessionRegistry::default(),
            events: EventRegistry::default(),
        }
    }
}

/// The variable that names the SSH configuration file this host should use.
///
/// Unset is the product default and means what it says: this machine's own OpenSSH rules,
/// with the system file included and `~` resolved by OpenSSH itself. It exists because
/// reaching a host whose configuration is not the passwd home's — a fixture, or a person
/// running two profiles — otherwise requires editing files this product must not touch.
pub const SSH_CONFIG_VARIABLE: &str = "REFYARD_SSH_CONFIG";

/// The configuration file named by the environment, if it names one that can be used.
///
/// A value that is empty or not absolute is not a file `-F` can be given: OpenSSH would
/// refuse an empty path and resolve a relative one against its own working directory. Both
/// are reported and ignored, so the host falls back to the rule that needs no configuration
/// rather than failing to start over an environment variable.
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
            "refyard: {SSH_CONFIG_VARIABLE} is not an absolute path ({value}); this host will \
             use this machine's own SSH configuration instead"
        );
        return None;
    }
    Some(path)
}

/// A service instance id that is unique per process start without a random source: two hosts
/// on one machine differ by pid, two starts differ by time.
fn instance_id(pid: u32, started: u128) -> String {
    format!("srvc_{pid:x}{started:x}")
}

fn millis_since_epoch() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

/// Opens the window and serves commands until it closes.
pub fn run() {
    let state = match AppState::for_this_machine() {
        Ok(state) => state,
        Err(message) => {
            eprintln!("refyard: {message}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::refyard_connect,
            commands::refyard_disconnect,
            commands::refyard_git_read,
            commands::refyard_host_request,
            commands::refyard_events_subscribe,
            commands::refyard_events_unsubscribe,
            commands::refyard_mutation_submit,
            commands::refyard_operation_get,
            commands::refyard_operation_list,
            commands::refyard_operation_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("the desktop window failed to start");
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
        // An empty value would become `-F ""`, which OpenSSH refuses; a relative one would
        // be resolved against whatever directory the process happens to be in.
        assert_eq!(ssh_config_from(&environment("")), None);
        assert_eq!(ssh_config_from(&environment("ssh/config")), None);
        // Another variable's presence is not this variable's value.
        assert_eq!(
            ssh_config_from(&[("HOME".to_string(), "/home/someone".to_string())]),
            None
        );
    }
}
