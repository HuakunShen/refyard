//! What happened to a command, kept separate from what a command printed.
//!
//! The distinction that matters is `Interrupted` versus `Unknown`. Both mean the
//! command did not report a status; only `Unknown` means we cannot tell whether its
//! side effects happened. A caller deciding whether to retry a write must be able to
//! see that difference, so it is a type here rather than a message.

/// The fate of one process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecutionState {
    /// The program could not be started at all. Nothing ran.
    NotStarted,
    /// The process ran to completion and reported an exit status.
    Completed,
    /// We stopped the process ourselves (deadline or cancellation) and know it is gone.
    Interrupted,
    /// We cannot say what happened. Git may have changed state.
    Unknown,
}

/// Why an interrupted process stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminationReason {
    Timeout,
    Cancelled,
    /// Terminated by a signal it did not send itself.
    Signalled(i32),
}

/// The result of one run.
///
/// `output_complete` is separate from `state` on purpose: a command can exit 0 with
/// its stdout cut at the limit, and a caller that checked only the exit code would
/// read a truncated protocol stream as a whole one.
#[derive(Debug, Clone)]
pub struct RunOutcome {
    pub state: ExecutionState,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub output_complete: bool,
    pub termination: Option<TerminationReason>,
}

impl RunOutcome {
    /// A run that never started — a spawn failure or a refused argument.
    pub fn not_started(message: impl Into<String>) -> Self {
        Self {
            state: ExecutionState::NotStarted,
            exit_code: None,
            stdout: Vec::new(),
            stderr: message.into().into_bytes(),
            output_complete: true,
            termination: None,
        }
    }

    /// True only when the command completed and reported success.
    pub fn succeeded(&self) -> bool {
        self.state == ExecutionState::Completed && self.exit_code == Some(0)
    }
}
