//! The process runner's failure modes, exercised against real child processes.
//!
//! These are the cases that decide whether a Git command can hang the host or lie
//! about its output:
//!
//! - a child that writes to both streams fills the pipe buffer of whichever stream is
//!   not being read, and the host waits forever for a command that is waiting for us;
//! - output that arrives faster than it is consumed is truncated, and a truncated
//!   protocol stream is not a short answer — it is a wrong one;
//! - a command with no deadline can outlive the operation that started it, and the
//!   child that keeps running knows nothing about the session that gave up on it.
//!
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use refyard_core::plan::{DeadlineClass, GitPlan, ProcessSpec};
use refyard_host::process::{cancellation, run, ExecutionState, TerminationReason};
use refyard_host::providers::local::LocalGit;

#[path = "support/process_fixture.rs"]
mod process_fixture;

fn spec(program: impl Into<PathBuf>, args: &[&str]) -> ProcessSpec {
    let mut env = process_fixture::runtime_environment();
    env.push(("LC_ALL".to_string(), "C".to_string()));
    ProcessSpec {
        program: program.into(),
        argv: args.iter().map(|value| (*value).to_string()).collect(),
        stdin: Vec::new(),
        cwd: None,
        env,
        deadline: Duration::from_secs(5),
        stdout_limit: 1 << 20,
        stderr_limit: 1 << 16,
    }
}

fn fixture_child(case: &str) -> ProcessSpec {
    spec(
        process_fixture::program().to_path_buf(),
        &["--runner", case],
    )
}

#[tokio::test]
async fn closes_stdin_so_a_filter_finishes() {
    // A Git command that reads pathspecs or a commit message from stdin blocks until
    // the write end closes. Forgetting to close it turns every such command into a
    // deadline timeout.
    let mut request = fixture_child("copy-stdin");
    request.stdin = b"a.txt\0b.txt\0".to_vec();
    let outcome = run(request, None).await;
    assert!(
        outcome.succeeded(),
        "stderr: {:?}",
        String::from_utf8_lossy(&outcome.stderr)
    );
    assert_eq!(outcome.stdout, b"a.txt\0b.txt\0");
    assert!(outcome.output_complete);
}

#[tokio::test]
async fn drains_both_streams_concurrently() {
    // More than a pipe buffer on each stream: reading one stream to
    // completion before the other deadlocks here.
    let mut request = fixture_child("both-streams");
    request.stdout_limit = 1 << 20;
    request.stderr_limit = 1 << 20;
    let outcome = run(request, None).await;
    assert!(
        outcome.succeeded(),
        "stderr tail: {:?}",
        String::from_utf8_lossy(&outcome.stderr)
    );
    assert_eq!(outcome.stdout.len(), 8192 * 11);
    assert_eq!(outcome.stderr.len(), 8192 * 11);
    assert!(outcome.output_complete);
}

#[tokio::test]
async fn keeps_nul_bytes_in_output() {
    // The status parser unframes NUL-terminated records. A runner that decoded or
    // normalised the stream would destroy the framing before the parser saw it.
    let outcome = run(fixture_child("nul-bytes"), None).await;
    assert!(outcome.succeeded());
    assert_eq!(outcome.stdout, b"a\0b\0c");
}

#[tokio::test]
async fn truncates_at_the_limit_and_says_the_output_is_incomplete() {
    let mut request = fixture_child("large-output");
    request.stdout_limit = 1024;
    let outcome = run(request, None).await;
    assert_eq!(outcome.stdout.len(), 1024);
    // A command can exit 0 with its output cut; the caller has to be able to tell.
    assert!(!outcome.output_complete);
    assert!(outcome.succeeded());
}

#[tokio::test]
async fn reports_a_missing_program_as_not_started() {
    let temp = tempfile::tempdir().expect("missing program directory");
    let missing_program = temp.path().join("nonexistent-refyard-git");
    let outcome = run(spec(missing_program, &["--version"]), None).await;
    assert_eq!(outcome.state, ExecutionState::NotStarted);
    assert_eq!(outcome.exit_code, None);
    assert!(!outcome.succeeded());
}

#[tokio::test]
async fn reports_the_exit_code_of_a_failing_command() {
    let outcome = run(fixture_child("exit-3"), None).await;
    assert_eq!(outcome.state, ExecutionState::Completed);
    assert_eq!(outcome.exit_code, Some(3));
    assert!(!outcome.succeeded());
    assert_eq!(outcome.stderr, b"boom");
}

#[tokio::test]
async fn kills_a_process_that_exceeds_its_deadline() {
    let mut request = fixture_child("sleep");
    request.deadline = Duration::from_millis(300);
    let started = Instant::now();
    let outcome = run(request, None).await;
    let elapsed = started.elapsed();
    assert_eq!(outcome.state, ExecutionState::Interrupted);
    assert_eq!(outcome.termination, Some(TerminationReason::Timeout));
    // Returning quickly is the point: a deadline that waits for the child to finish
    // is not a deadline.
    assert!(elapsed < Duration::from_secs(5), "took {elapsed:?}");
}

#[tokio::test]
async fn stops_a_running_process_when_the_session_is_released() {
    let (handle, signal) = cancellation();
    let mut request = fixture_child("sleep");
    request.deadline = Duration::from_secs(30);
    let started = Instant::now();
    let runner = tokio::spawn(async move { run(request, Some(signal)).await });
    tokio::time::sleep(Duration::from_millis(150)).await;
    handle.cancel();
    let outcome = runner.await.expect("the runner task panicked");
    assert_eq!(outcome.state, ExecutionState::Interrupted);
    assert_eq!(outcome.termination, Some(TerminationReason::Cancelled));
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[tokio::test]
async fn leaves_no_child_running_after_a_timeout() {
    // The failure this prevents: the user closes the window, the operation reports a
    // timeout, and a `git` (or `ssh`) process keeps running against the repository.
    let temp = tempfile::tempdir().expect("pid fixture directory");
    let pid_path = temp.path().join("child-pid");
    let mut request = fixture_child("write-pid-and-sleep");
    request.env.push((
        "REFYARD_TEST_PID_PATH".to_string(),
        pid_path.to_string_lossy().into_owned(),
    ));
    request.deadline = Duration::from_millis(800);
    let outcome = run(request, None).await;
    assert_eq!(outcome.state, ExecutionState::Interrupted);

    let pid = std::fs::read_to_string(&pid_path)
        .expect("the child should have written its pid")
        .trim()
        .to_string();
    assert!(!pid.is_empty());

    // The runner must terminate and reap the child before returning.
    let deadline = Instant::now() + Duration::from_secs(2);
    while process_fixture::process_is_running(&pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(25));
    }
    assert!(
        !process_fixture::process_is_running(&pid),
        "pid {pid} is still alive after the run returned"
    );
}

#[tokio::test]
async fn a_git_plan_runs_through_the_same_runner() {
    // The planner's output is what the runner consumes: an argument vector, stdin, and
    // a deadline class. This is the seam every Git command in the host goes through.
    let plan = GitPlan::new(vec!["--version".to_string()]);
    assert_eq!(plan.deadline_class, DeadlineClass::Read);
    let git = LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf();
    let mut request = spec(
        git,
        &plan.argv.iter().map(String::as_str).collect::<Vec<_>>(),
    );
    request.deadline = Duration::from_secs(plan.deadline_class.seconds());
    let outcome = run(request, None).await;
    assert!(
        outcome.succeeded(),
        "stderr: {:?}",
        String::from_utf8_lossy(&outcome.stderr)
    );
    assert!(String::from_utf8_lossy(&outcome.stdout).starts_with("git version"));
}

#[test]
fn native_ssh_fixture_maps_posix_paths_and_preserves_quoted_words() {
    // The Windows transport double must keep the service's remote path POSIX-shaped,
    // then map it to this temporary repository only inside the test process.
    let temp = tempfile::tempdir().expect("fixture directory");
    let repository = temp.path().join("repo");
    std::fs::create_dir_all(&repository).expect("repository directory");
    let git = LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf();
    let initialized = Command::new(&git)
        .args(["init", "--quiet", "--initial-branch=main"])
        .current_dir(&repository)
        .output()
        .expect("initialize the fixture repository");
    assert!(
        initialized.status.success(),
        "git init failed: {}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    let repository = repository
        .canonicalize()
        .expect("canonical fixture repository path");

    let helper = process_fixture::program();
    let quoted_probe = Command::new(helper)
        .args([
            "-o",
            "BatchMode=yes",
            "scripted-host",
            "printf %s 'refyard fixture: a'\"'\"'b c$d'",
        ])
        .output()
        .expect("run the scripted transport double");
    assert!(quoted_probe.status.success());
    assert_eq!(quoted_probe.stdout, b"refyard fixture: a'b c$d");

    let layout = Command::new(helper)
        .args([
            "-o",
            "BatchMode=yes",
            "scripted-host",
            "git -C '/repo' '--no-optional-locks' 'rev-parse' '--path-format=absolute' '--show-toplevel'",
        ])
        .env(
            "REFYARD_FIXTURE_REPO",
            repository.to_string_lossy().as_ref(),
        )
        .env("REFYARD_FIXTURE_GIT", &git)
        .output()
        .expect("run the mapped remote Git command");
    assert!(
        layout.status.success(),
        "transport fixture failed: {}",
        String::from_utf8_lossy(&layout.stderr)
    );
    assert_eq!(layout.stdout, b"/repo\n");
}
