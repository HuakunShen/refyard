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

use std::sync::Arc;

use refyard_host::providers::local::LocalGit;
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
        let started = millis_since_epoch();
        Self {
            service: Arc::new(ApplicationService::new(ApplicationServiceConfig {
                git,
                service_instance_id: instance_id(std::process::id(), started),
                target_id: "tgt_local".to_owned(),
                target_generation: format!("gen_{started}"),
            })),
            sessions: SessionRegistry::default(),
            events: EventRegistry::default(),
        }
    }
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
