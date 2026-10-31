//! The launch channel behind `refyard <dir>`.
//!
//! The launcher's own parsing is tested in `crates/refyard-launcher`; what these cases pin
//! is the host half: the page's single ask drains everything queued, the answer carries the
//! operands that could not be used, and a window that does not own the session cannot drain
//! the queue on somebody else's behalf. A launch that arrived while the window was starting
//! must survive until the page is ready, and must not be handed twice.
//!
//! No Git runs here: the session is opened against a temporary state directory, and every
//! directory in the fixture exists, which is the only thing the channel resolves.

use std::path::{Path, PathBuf};

use refyard_desktop::commands;
use refyard_desktop::launch;
use refyard_desktop::AppState;
use refyard_host::providers::local::LocalGit;
use serde_json::json;

const MAIN: &str = "main";
const SECOND: &str = "second";

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    state: AppState,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("a temporary directory");
        let root = temp.path().to_path_buf();
        for name in ["one", "two"] {
            std::fs::create_dir(root.join(name)).expect("a fixture directory");
        }
        let state = AppState::with_state_root(
            LocalGit::at(git_program(), Vec::new()),
            None,
            root.join("state"),
        )
        .expect("the fixture's state directory is writable");
        Self {
            _temp: temp,
            root,
            state,
        }
    }

    fn queue(&self, operands: &[&str]) -> Vec<String> {
        let arguments: Vec<String> = operands.iter().map(|value| (*value).to_string()).collect();
        self.state
            .launch
            .push(launch::request_from(&arguments, &self.root));
        arguments
    }
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

fn canonical(root: &Path, name: &str) -> String {
    std::fs::canonicalize(root.join(name))
        .expect("canonical fixture path")
        .to_string_lossy()
        .into_owned()
}

// Prevents: the page opening nothing because the launch arrived before it was listening,
// and the same launch being replayed on a reload that opens the tabs a second time.
#[test]
fn the_page_drains_every_queued_launch_exactly_once() {
    let fixture = Fixture::new();
    let metadata = commands::connect(&fixture.state, MAIN).expect("connect");
    fixture.queue(&["one"]);
    fixture.queue(&["two", "missing"]);

    let answer = commands::take_launch_paths(&fixture.state, MAIN, &metadata.session_id)
        .expect("the owner asks");
    assert_eq!(
        answer["directories"],
        json!([
            canonical(&fixture.root, "one"),
            canonical(&fixture.root, "two")
        ])
    );
    // The typo travels with the answer instead of being dropped silently.
    assert_eq!(answer["refused"][0]["named"], json!("missing"));

    let again = commands::take_launch_paths(&fixture.state, MAIN, &metadata.session_id)
        .expect("a second ask is an answer, not an error");
    assert_eq!(again["directories"], json!([]));
    assert_eq!(again["refused"], json!([]));
}

// Prevents: a second window draining the queue the owning window has not asked for yet —
// the launch would be lost, because a queue answers once.
#[test]
fn a_window_that_does_not_own_the_session_cannot_drain_the_queue() {
    let fixture = Fixture::new();
    let metadata = commands::connect(&fixture.state, MAIN).expect("connect");
    fixture.queue(&["one"]);

    assert!(commands::take_launch_paths(&fixture.state, SECOND, &metadata.session_id).is_err());

    let answer = commands::take_launch_paths(&fixture.state, MAIN, &metadata.session_id)
        .expect("the owner still gets its launch");
    assert_eq!(
        answer["directories"],
        json!([canonical(&fixture.root, "one")])
    );
}
