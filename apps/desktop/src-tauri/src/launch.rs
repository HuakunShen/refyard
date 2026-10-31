//! The launch channel: the directories this process was started with.
//!
//! `refyard <dir>` is two processes. The command inside the bundle resolves the directory
//! and starts the app with it as an argument; from then on the app owns the decision. This
//! module is the only place that decision begins, and it is deliberately small:
//!
//! - a **cold** start keeps what it was given in [`LaunchQueue`], and the page asks for it
//!   once with `refyard_take_launch_paths` when it is ready;
//! - a **warm** start arrives through the single-instance plugin's callback, is queued the
//!   same way, and is also emitted on [`LAUNCH_EVENT`] so the page that is already open
//!   reacts without a reload.
//!
//! The trust question is the one §2 of the repository rules asks about every channel: what
//! can arrive here? Only an operand list, and only from a process started by the person at
//! their own terminal — the same class of local channel as the `p` keystroke that mints a
//! pairing ticket. Nothing in the payload is privileged: a directory is *offered* to the
//! page, which registers it through the same `registerRepository` call the folder picker's
//! answer goes through, so the launch channel cannot reach a repository the person did not
//! name, and it cannot make the page run a command.
//!
//! Refusals are part of the answer rather than a silent drop: a directory that does not
//! exist, or an option this build does not have, travels to the page and is shown there.
//! A launcher that quietly opened the wrong thing would be worse than one that opened
//! nothing.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::AppState;

/// The event a running window receives when a second launch names directories.
pub const LAUNCH_EVENT: &str = "refyard://launch";

/// Something the page should open, in the order the process was given it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    /// Absolute directories that exist, resolved against the launch's working directory.
    pub directories: Vec<String>,
    /// Operands that could not be used, each with the reason, for the page to show.
    pub refused: Vec<RefusedDirectory>,
}

impl LaunchRequest {
    /// Whether the page has nothing to do. A launch with no operand — a dock click, or a
    /// second launch of a command with no directory — is not an error and opens nothing.
    pub fn is_empty(&self) -> bool {
        self.directories.is_empty() && self.refused.is_empty()
    }
}

/// One operand this process could not turn into a directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedDirectory {
    /// Exactly what the caller wrote, so the page can quote it back.
    pub named: String,
    pub problem: String,
}

/// What a process has been asked to open and has not handed over yet.
///
/// The queue is drained by the page, not by the window: a page that reloads during startup
/// asks again, and gets the same answer until it has been given once.
#[derive(Default)]
pub struct LaunchQueue {
    pending: Mutex<Vec<LaunchRequest>>,
}

impl LaunchQueue {
    pub fn push(&self, request: LaunchRequest) {
        if request.is_empty() {
            return;
        }
        self.pending
            .lock()
            .expect("the launch queue is not poisoned by its own work")
            .push(request);
    }

    /// Takes everything queued so far. Each request is answered once.
    pub fn take(&self) -> Vec<LaunchRequest> {
        let mut pending = self
            .pending
            .lock()
            .expect("the launch queue is not poisoned by its own work");
        std::mem::take(&mut *pending)
    }
}

/// Turns the arguments a process was started with into a launch request.
///
/// `arguments` is the operand list, without the program name. A relative operand is
/// resolved against `cwd`, which is the directory the person typed the command in — the
/// process itself may have been started anywhere.
pub fn request_from(arguments: &[String], cwd: &Path) -> LaunchRequest {
    let mut request = LaunchRequest::default();
    for argument in arguments {
        match classify(argument) {
            Argument::Ignore => continue,
            Argument::Refused => {
                request.refused.push(RefusedDirectory {
                    named: argument.clone(),
                    problem: "not an option this command has; it takes directories".to_string(),
                });
                continue;
            }
            Argument::Operand => {}
        }
        let named = PathBuf::from(argument);
        let candidate = if named.is_absolute() {
            named
        } else {
            cwd.join(named)
        };
        match std::fs::canonicalize(&candidate) {
            Ok(resolved) if resolved.is_dir() => request
                .directories
                .push(resolved.to_string_lossy().into_owned()),
            Ok(resolved) => request.refused.push(RefusedDirectory {
                named: argument.clone(),
                problem: format!("{} is not a directory", resolved.display()),
            }),
            Err(_) => request.refused.push(RefusedDirectory {
                named: argument.clone(),
                problem: format!("no directory at {}", candidate.display()),
            }),
        }
    }
    request
}

/// What one argument of the operand list is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Argument {
    /// A directory the person named.
    Operand,
    /// Something the platform added, which is not a decision anyone made.
    Ignore,
    /// An option this build does not have.
    Refused,
}

/// Classifies an argument that begins with `-`.
///
/// A windowed app launched the ordinary way may be handed `-psn_0_1234` (process serial
/// number), which is not a person's operand and must not be reported as a mistake. Every
/// other option is refused by name: the desktop binary takes directories and nothing else,
/// so a flag is either a mistake or a launcher this build does not know — and silently
/// reading it as a directory would open the wrong place.
fn classify(argument: &str) -> Argument {
    if !argument.starts_with('-') || argument == "-" {
        return Argument::Operand;
    }
    if argument.starts_with("-psn_") {
        return Argument::Ignore;
    }
    Argument::Refused
}

/// Hands a launch request to the app: queued for the page's next ask, and announced for a
/// page that is already listening.
///
/// The window is shown and focused in both cases. A second `refyard .` while the app is
/// running is a request to look at something, and an app that answered it by opening a tab
/// behind a minimised window would have obeyed the letter and missed the point.
pub fn deliver(app: &tauri::AppHandle, request: LaunchRequest) {
    focus_main_window(app);
    if request.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.launch.push(request.clone());
    }
    // A cold start has no listener yet; the queue is what that page reads. A warm one is
    // told twice on purpose: the event for the live page, the queue so a reload during the
    // same launch still finds it.
    let _ = app.emit(LAUNCH_EVENT, &request);
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn operands(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn scratch() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temporary directory")
    }

    // Prevents: `refyard .` opening nothing, or opening the process's own working
    // directory instead of the one the person typed the command in.
    #[test]
    fn a_relative_operand_resolves_against_the_callers_directory() {
        let root = scratch();
        let repository = root.path().join("repo");
        std::fs::create_dir(&repository).expect("the repository directory");
        let elsewhere = scratch();

        let request = request_from(&operands(&["repo"]), root.path());
        assert_eq!(
            request.directories,
            vec![std::fs::canonicalize(&repository)
                .expect("canonical")
                .to_string_lossy()
                .into_owned()]
        );
        // The process's own directory is not what a relative operand means.
        assert!(
            !request.directories[0].starts_with(&elsewhere.path().to_string_lossy().to_string())
        );
    }

    // Prevents: a typo opening the app on whatever was last open, with no explanation.
    #[test]
    fn a_missing_directory_is_refused_with_the_operand_and_the_reason() {
        let root = scratch();
        let request = request_from(&operands(&["nope"]), root.path());
        assert!(request.directories.is_empty());
        assert_eq!(request.refused.len(), 1);
        assert_eq!(request.refused[0].named, "nope");
        assert!(request.refused[0].problem.contains("no directory at"));
    }

    // Prevents: the app reading `--help` — or a typo like `--depp` — as a directory name.
    #[test]
    fn an_option_is_refused_by_name_rather_than_read_as_a_directory() {
        let root = scratch();
        let request = request_from(&operands(&["--depp", "."]), root.path());
        assert_eq!(request.refused.len(), 1);
        assert_eq!(request.refused[0].named, "--depp");
        assert_eq!(request.directories.len(), 1);
    }

    // Prevents: a process-serial-number argument, which macOS adds when a windowed app is
    // started the ordinary way, being reported to the person as their own mistake.
    #[test]
    fn the_platform_process_serial_number_is_not_an_operand_and_not_a_mistake() {
        let request = request_from(&operands(&["-psn_0_12345"]), Path::new("/"));
        assert!(request.is_empty(), "{request:?}");
    }

    // Prevents: a launch with nothing to open being reported as a refusal, and a queue
    // that hands the same launch to a second ask.
    #[test]
    fn an_empty_launch_is_not_queued_and_each_launch_is_answered_once() {
        let queue = LaunchQueue::default();
        queue.push(LaunchRequest::default());
        assert!(queue.take().is_empty());

        queue.push(LaunchRequest {
            directories: vec!["/srv/repo".to_string()],
            refused: Vec::new(),
        });
        assert_eq!(queue.take().len(), 1);
        assert!(queue.take().is_empty());
    }
}
