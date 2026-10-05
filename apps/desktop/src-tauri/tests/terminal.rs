//! The desktop terminal commands, driven through the production bodies.
//!
//! A terminal is the one surface where "the renderer cannot name a path or a
//! program" is the whole safety story, so these tests prove exactly that: an
//! open names a repository id and the shell starts in that repository's approved
//! root, a second window cannot drive a shell it did not open, and bytes typed by
//! the emulator reach a real shell whose output and exit come back as frames.
//! The emit seam is a collector, the same substitution the command wrapper's
//! `emit_to` performs for a real window.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::sync::Arc;

use refyard_contract::problem::ProblemResponse;
use refyard_desktop::commands;
use refyard_desktop::AppState;
use refyard_host::providers::local::LocalGit;
use refyard_pty::PtyEvent;
use serde_json::{json, Value};

const MAIN: &str = "main";
const SECOND: &str = "second";

/// A temporary repository with its own identity, config and no inherited `GIT_*`,
/// identical to the session-owner fixture: the terminal starts where Git does.
struct Fixture {
    _temp: tempfile::TempDir,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&home).expect("create fixture home");
        std::fs::create_dir_all(&repo).expect("create fixture repo");
        std::fs::write(home.join(".gitconfig"), "").expect("empty global config");
        let env = fixture_environment(&home);
        let fixture = Self {
            _temp: temp,
            repo,
            env,
        };
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        fixture.write("README.md", "first\n");
        fixture.git(&["add", "--", "README.md"]);
        fixture.git(&["commit", "--quiet", "-m", "first"]);
        fixture
    }

    fn git(&self, args: &[&str]) {
        let status = Command::new(git_program())
            .args(args)
            .current_dir(&self.repo)
            .env_clear()
            .envs(self.env.clone())
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?} failed in the fixture");
    }

    fn write(&self, name: &str, contents: &str) {
        std::fs::write(self.repo.join(name), contents).expect("write fixture file");
    }

    fn path(&self) -> String {
        self.repo.to_string_lossy().into_owned()
    }

    fn state(&self) -> AppState {
        AppState::with_git(LocalGit::at(git_program(), self.env.clone()))
    }

    async fn open(&self, state: &AppState) -> (String, String) {
        let metadata = commands::connect(state, MAIN).expect("connect");
        let response = commands::git_read(
            state,
            MAIN,
            &metadata.session_id,
            json!({ "method": "registerRepository", "path": self.path() }),
        )
        .await
        .expect("register");
        let repository_id = response["repositories"][0]["repositoryId"]
            .as_str()
            .expect("repositoryId")
            .to_owned();
        (metadata.session_id, repository_id)
    }
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

/// The same isolated environment the session-owner fixture uses: its own HOME,
/// its own config, no inherited `GIT_*`, no prompts.
fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    let home = home.to_str().expect("utf8 home");
    vec![
        ("PATH".to_string(), "/usr/bin:/bin".to_string()),
        ("HOME".to_string(), home.to_string()),
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            format!("{home}/.gitconfig"),
        ),
        ("GIT_CONFIG_SYSTEM".to_string(), "/dev/null".to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("LC_ALL".to_string(), "C".to_string()),
        ("LANG".to_string(), "C".to_string()),
        ("GIT_AUTHOR_NAME".to_string(), "Refyard Fixture".to_string()),
        (
            "GIT_AUTHOR_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
        (
            "GIT_COMMITTER_NAME".to_string(),
            "Refyard Fixture".to_string(),
        ),
        (
            "GIT_COMMITTER_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
    ]
}

fn collector() -> (
    commands::TerminalEmitter,
    mpsc::Receiver<(u32, PtyEvent)>,
) {
    let (sender, receiver) = mpsc::channel();
    let emit: commands::TerminalEmitter = Arc::new(move |id, event| {
        let _ = sender.send((id, event));
    });
    (emit, receiver)
}

/// Waits for the marker in the session's output, naming a real failure if the
/// shell never said it.
fn wait_for_output(
    receiver: &mpsc::Receiver<(u32, PtyEvent)>,
    id: u32,
    marker: &[u8],
) -> String {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut collected = Vec::new();
    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(std::time::Duration::from_millis(250)) {
            Ok((got, PtyEvent::Output(bytes))) => {
                assert_eq!(got, id, "frames name the session they belong to");
                collected.extend_from_slice(&bytes);
                if collected.windows(marker.len()).any(|w| w == marker) {
                    return String::from_utf8_lossy(&collected).into_owned();
                }
            }
            Ok((_, PtyEvent::Exit(_))) => break,
            Err(_) => continue,
        }
    }
    panic!(
        "the shell never produced {marker:?}; it said: {}",
        String::from_utf8_lossy(&collected)
    );
}

fn wait_for_exit(receiver: &mpsc::Receiver<(u32, PtyEvent)>) -> Option<i32> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(std::time::Duration::from_millis(250)) {
            Ok((_, PtyEvent::Exit(code))) => return code,
            Ok((_, PtyEvent::Output(_))) => continue,
            Err(_) => continue,
        }
    }
    panic!("the shell never exited");
}

#[tokio::test]
async fn an_open_names_a_repository_and_the_shell_starts_in_its_root() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let (emit, _receiver) = collector();
    let answer = commands::terminal_open(
        &state,
        MAIN,
        &session_id,
        json!({ "repositoryId": repository_id, "cols": 80, "rows": 24 }),
        emit,
    )
    .expect("open");
    assert_eq!(
        answer["cwd"].as_str().map(Path::new),
        std::fs::canonicalize(&fixture.repo)
            .ok()
            .as_ref()
            .map(Path::new),
        "the shell starts in the approved root, spelled as the registry records it"
    );
    assert!(answer["sessionId"].as_str().unwrap_or("").starts_with("term_"));
    assert!(!answer["shell"].as_str().unwrap_or("").is_empty());

    // A shell the renderer cannot aim at a path for: an open with a raw path and
    // an unknown repository both refuse.
    let (emit, _) = collector();
    let smuggled = commands::terminal_open(
        &state,
        MAIN,
        &session_id,
        json!({ "repositoryId": repository_id, "cols": 80, "rows": 24, "cwd": "/tmp" }),
        emit,
    );
    assert!(smuggled.is_err(), "unknown fields cannot aim the shell");
    let (emit, _) = collector();
    let unknown = commands::terminal_open(
        &state,
        MAIN,
        &session_id,
        json!({ "repositoryId": "repo_nope", "cols": 80, "rows": 24 }),
        emit,
    );
    assert!(unknown.is_err(), "an unapproved repository is refused");
}

#[tokio::test]
async fn typed_bytes_reach_a_real_shell_and_its_output_and_exit_come_back() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let (emit, receiver) = collector();
    let answer = commands::terminal_open(
        &state,
        MAIN,
        &session_id,
        json!({ "repositoryId": repository_id, "cols": 80, "rows": 24 }),
        emit,
    )
    .expect("open");
    let term = answer["sessionId"].as_str().expect("sessionId").to_owned();
    let id = term.strip_prefix("term_").unwrap().parse::<u32>().unwrap();

    let marker = format!("refyard_term_{}\n", rand_suffix());
    let marker_body = marker.trim().to_owned();
    commands::terminal_write(
        &state,
        MAIN,
        &session_id,
        json!({ "sessionId": term, "data": base64_of(marker.as_bytes()) }),
    )
    .expect("write");
    let output = wait_for_output(&receiver, id, marker_body.as_bytes());
    assert!(output.contains(&marker_body));

    commands::terminal_resize(
        &state,
        MAIN,
        &session_id,
        json!({ "sessionId": term, "cols": 120, "rows": 40 }),
    )
    .expect("resize");

    commands::terminal_write(
        &state,
        MAIN,
        &session_id,
        json!({ "sessionId": term, "data": base64_of(b"exit 7\n") }),
    )
    .expect("write exit");
    assert_eq!(wait_for_exit(&receiver), Some(7), "the shell's own exit code survives the frame");

    // After the shell is gone, a close is still accepted — idempotent, like the
    // adapter promises — and a write to the dead session refuses.
    commands::terminal_close(
        &state,
        MAIN,
        &session_id,
        json!({ "sessionId": term }),
    )
    .expect("close after exit");
    assert!(commands::terminal_write(
        &state,
        MAIN,
        &session_id,
        json!({ "sessionId": term, "data": base64_of(b"echo nope\n") }),
    )
    .is_err());
}

#[tokio::test]
async fn a_second_window_cannot_drive_a_shell_it_did_not_open() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let (emit, _receiver) = collector();
    let answer = commands::terminal_open(
        &state,
        MAIN,
        &session_id,
        json!({ "repositoryId": repository_id, "cols": 80, "rows": 24 }),
        emit,
    )
    .expect("open");
    let term = answer["sessionId"].as_str().expect("sessionId").to_owned();

    // A second window holds a second session: same person, different ownership
    // record, and the terminal answers only to the window that opened it.
    let second_session = commands::connect(&state, SECOND)
        .expect("a second window connects")
        .session_id;
    assert!(commands::terminal_write(
        &state,
        SECOND,
        &second_session,
        json!({ "sessionId": term, "data": base64_of(b"echo stolen\n") }),
    )
    .is_err());
    assert!(commands::terminal_close(
        &state,
        SECOND,
        &second_session,
        json!({ "sessionId": term }),
    )
    .is_err());

    // Cleanup for the temp dir's git state.
    let _ = commands::disconnect(&state, MAIN, &session_id);
    let _ = commands::disconnect(&state, SECOND, &second_session);
}

fn rand_suffix() -> String {
    // Enough uniqueness to defeat a shell prompt repeating an earlier marker in
    // the same test process; no crypto needed for a test echo.
    format!("{:x}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock is set")
        .as_nanos())
}

fn base64_of(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}
