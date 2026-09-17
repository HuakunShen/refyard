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
//! `/bin/sh` is used here as the *subject* of the test, never by the runner: the
//! runner takes a program and an argument vector and has no shell of its own.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use refyard_core::plan::{DeadlineClass, GitPlan, ProcessSpec};
use refyard_host::process::{cancellation, run, ExecutionState, TerminationReason};

fn spec(program: &str, args: &[&str]) -> ProcessSpec {
    ProcessSpec {
        program: PathBuf::from(program),
        argv: args.iter().map(|value| (*value).to_string()).collect(),
        stdin: Vec::new(),
        cwd: None,
        env: vec![
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ("LC_ALL".to_string(), "C".to_string()),
        ],
        deadline: Duration::from_secs(5),
        stdout_limit: 1 << 20,
        stderr_limit: 1 << 16,
    }
}

fn sh(script: &str) -> ProcessSpec {
    spec("/bin/sh", &["-c", script])
}

#[tokio::test]
async fn closes_stdin_so_a_filter_finishes() {
    // A Git command that reads pathspecs or a commit message from stdin blocks until
    // the write end closes. Forgetting to close it turns every such command into a
    // deadline timeout.
    let mut request = spec("/bin/cat", &[]);
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
    // 128 KiB on each stream is far more than a pipe buffer. Reading one stream to
    // completion before the other deadlocks here.
    let mut request = sh(
        "i=0; while [ $i -lt 8192 ]; do printf 'out-%06d\\n' \"$i\"; i=$((i+1)); done; \
         i=0; while [ $i -lt 8192 ]; do printf 'err-%06d\\n' \"$i\" 1>&2; i=$((i+1)); done",
    );
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
    let outcome = run(sh("printf 'a\\0b\\0c'"), None).await;
    assert!(outcome.succeeded());
    assert_eq!(outcome.stdout, b"a\0b\0c");
}

#[tokio::test]
async fn truncates_at_the_limit_and_says_the_output_is_incomplete() {
    let mut request = sh("i=0; while [ $i -lt 1000 ]; do printf '0123456789'; i=$((i+1)); done");
    request.stdout_limit = 1024;
    let outcome = run(request, None).await;
    assert_eq!(outcome.stdout.len(), 1024);
    // A command can exit 0 with its output cut; the caller has to be able to tell.
    assert!(!outcome.output_complete);
    assert!(outcome.succeeded());
}

#[tokio::test]
async fn reports_a_missing_program_as_not_started() {
    let outcome = run(spec("/nonexistent/refyard-git", &["--version"]), None).await;
    assert_eq!(outcome.state, ExecutionState::NotStarted);
    assert_eq!(outcome.exit_code, None);
    assert!(!outcome.succeeded());
}

#[tokio::test]
async fn reports_the_exit_code_of_a_failing_command() {
    let outcome = run(sh("printf 'boom' 1>&2; exit 3"), None).await;
    assert_eq!(outcome.state, ExecutionState::Completed);
    assert_eq!(outcome.exit_code, Some(3));
    assert!(!outcome.succeeded());
    assert_eq!(outcome.stderr, b"boom");
}

#[tokio::test]
async fn kills_a_process_that_exceeds_its_deadline() {
    let mut request = spec("/bin/sleep", &["30"]);
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
    let mut request = spec("/bin/sleep", &["30"]);
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
    let pid_file = tempfile::NamedTempFile::new().expect("temp file");
    let pid_path = pid_file.path().to_string_lossy().to_string();
    drop(pid_file);

    let mut request = sh(&format!("echo $$ > '{pid_path}'; exec sleep 30"));
    request.deadline = Duration::from_millis(400);
    let outcome = run(request, None).await;
    assert_eq!(outcome.state, ExecutionState::Interrupted);

    let pid = std::fs::read_to_string(&pid_path)
        .expect("the child should have written its pid")
        .trim()
        .to_string();
    assert!(!pid.is_empty());

    // `kill -0` succeeding means the process still exists. The child was replaced by
    // `exec`, so the pid the runner killed is this one.
    let status = std::process::Command::new("/bin/kill")
        .args(["-0", &pid])
        .status()
        .expect("kill -0 should run");
    assert!(
        !status.success(),
        "pid {pid} is still alive after the run returned"
    );
    let _ = std::fs::remove_file(&pid_path);
}

#[tokio::test]
async fn a_git_plan_runs_through_the_same_runner() {
    // The planner's output is what the runner consumes: an argument vector, stdin, and
    // a deadline class. This is the seam every Git command in the host goes through.
    let plan = GitPlan::new(vec!["--version".to_string()]);
    assert_eq!(plan.deadline_class, DeadlineClass::Read);
    let mut request = spec(
        "/usr/bin/git",
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
