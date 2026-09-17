//! Running one command under a deadline, with bounded output.
//!
//! The shape of the implementation is the requirement: the two output streams are
//! read by concurrent tasks that keep draining (and discarding) past their limit, the
//! child is awaited independently, and a deadline or cancellation kills and reaps it.
//! Anything simpler deadlocks or leaks, and both of those failures look like "the app
//! hung" to the person using it.

use std::process::Stdio;
use std::time::Duration;

use refyard_core::outcome::{ExecutionState, RunOutcome, TerminationReason};
use refyard_core::plan::ProcessSpec;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::process::cleanup::{terminate, CancelSignal};

/// How long to wait for the output streams to reach EOF after the child exited.
///
/// A `git` that spawned a helper which inherited the pipe can hold it open past its
/// own exit. Waiting forever would hang the session; giving up is only safe because we
/// then report the output as incomplete rather than pretending we read all of it.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Runs one command to completion, a deadline, or cancellation.
pub async fn run(spec: ProcessSpec, cancel: Option<CancelSignal>) -> RunOutcome {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // A dropped future must not leave the child behind.
        .kill_on_drop(true);
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    // Cleared first: an inherited GIT_DIR or GIT_EXTERNAL_DIFF would redirect this
    // command at another repository or another program.
    command.env_clear();
    for (name, value) in &spec.env {
        command.env(name, value);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return RunOutcome::not_started(format!(
                "could not start {}: {error}",
                spec.program.display()
            ))
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    let stdout_limit = spec.stdout_limit;
    let stderr_limit = spec.stderr_limit;
    let stdout_task = tokio::spawn(async move {
        match stdout {
            Some(stream) => drain_bounded(stream, stdout_limit).await,
            None => (Vec::new(), true),
        }
    });
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(stream) => drain_bounded(stream, stderr_limit).await,
            None => (Vec::new(), true),
        }
    });
    let stdin_bytes = spec.stdin;
    let stdin_task = tokio::spawn(async move {
        if let Some(mut handle) = stdin {
            if !stdin_bytes.is_empty() {
                // A failed write means the child stopped reading — normal when the
                // command exits early, and not a reason to fail the run.
                let _ = handle.write_all(&stdin_bytes).await;
            }
            // Closing the write end is what turns "read until EOF" into progress: a
            // `--pathspec-from-file=-` or `commit -F -` waits for exactly this.
            let _ = handle.shutdown().await;
        }
    });

    let deadline = tokio::time::sleep(spec.deadline);
    tokio::pin!(deadline);

    let (termination, status) = match cancel {
        Some(signal) => {
            tokio::select! {
                status = child.wait() => (None, Some(status)),
                () = &mut deadline => {
                    terminate(&mut child).await;
                    (Some(TerminationReason::Timeout), None)
                }
                () = signal.cancelled() => {
                    terminate(&mut child).await;
                    (Some(TerminationReason::Cancelled), None)
                }
            }
        }
        None => {
            tokio::select! {
                status = child.wait() => (None, Some(status)),
                () = &mut deadline => {
                    terminate(&mut child).await;
                    (Some(TerminationReason::Timeout), None)
                }
            }
        }
    };

    let (stdout_bytes, stdout_complete) = join_reader(stdout_task).await;
    let (stderr_bytes, stderr_complete) = join_reader(stderr_task).await;
    // The stdin task only ends when the pipe is closed or the write failed, so it can
    // be awaited without a grace period: dropping the handle is part of its job.
    let _ = stdin_task.await;

    let output_complete = stdout_complete && stderr_complete;

    match termination {
        Some(reason) => RunOutcome {
            state: ExecutionState::Interrupted,
            exit_code: None,
            stdout: stdout_bytes,
            stderr: stderr_bytes,
            output_complete,
            termination: Some(reason),
        },
        None => {
            let status = status.and_then(Result::ok);
            match status {
                Some(status) => {
                    let exit_code = status.code();
                    let signalled = !status.success() && exit_code.is_none();
                    let state = if signalled {
                        // A signal we did not send: something else ended this process,
                        // and whether its side effects happened is not knowable here.
                        ExecutionState::Unknown
                    } else {
                        ExecutionState::Completed
                    };
                    RunOutcome {
                        state,
                        exit_code,
                        stdout: stdout_bytes,
                        stderr: stderr_bytes,
                        output_complete,
                        termination: if signalled {
                            Some(TerminationReason::Signalled(signal_of(&status)))
                        } else {
                            None
                        },
                    }
                }
                // `wait` itself failed: the child's fate is unknown, and saying
                // "completed" would be a guess.
                None => RunOutcome {
                    state: ExecutionState::Unknown,
                    exit_code: None,
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                    output_complete,
                    termination: None,
                },
            }
        }
    }
}

/// Reads a stream to EOF, keeping at most `limit` bytes and draining the rest.
///
/// Returning `false` for completeness is the point: the caller has to be able to tell
/// a short answer from a truncated one.
async fn drain_bounded(mut stream: impl AsyncReadExt + Unpin, limit: usize) -> (Vec<u8>, bool) {
    let mut kept: Vec<u8> = Vec::with_capacity(limit.min(64 * 1024));
    let mut chunk = vec![0u8; 16 * 1024];
    let mut complete = true;
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => {
                let room = limit.saturating_sub(kept.len());
                if read > room {
                    complete = false;
                }
                let take = read.min(room);
                kept.extend_from_slice(&chunk[..take]);
                // Past the limit the stream is still drained, or the child would
                // block writing to a full pipe and never reach its exit.
            }
            Err(_) => {
                // An unreadable stream cannot be reported as a complete read.
                complete = false;
                break;
            }
        }
    }
    (kept, complete)
}

async fn join_reader(task: tokio::task::JoinHandle<(Vec<u8>, bool)>) -> (Vec<u8>, bool) {
    match tokio::time::timeout(DRAIN_GRACE, task).await {
        Ok(Ok(result)) => result,
        // The reader panicked or the grace period expired: whatever was printed after
        // that point is not something this run can claim to have seen.
        Ok(Err(_)) | Err(_) => (Vec::new(), false),
    }
}

#[cfg(unix)]
fn signal_of(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status.signal().unwrap_or(0)
}

#[cfg(not(unix))]
fn signal_of(_status: &std::process::ExitStatus) -> i32 {
    0
}
