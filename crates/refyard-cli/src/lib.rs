//! The native command line, as a library so its parts can be tested without a process.
//!
//! The binary is a thin shell around these modules: `args` decides what was asked for,
//! `doctor` answers what this machine can do, and `main` turns a refusal into an exit code.
//! Nothing here links a WebView, and nothing here opens a socket a caller did not ask for.

pub mod args;
pub mod doctor;

/// What a run produced: the text to write and the status to exit with.
///
/// A command returns this rather than writing to stdout itself, so a test can assert both
/// halves of the answer without capturing a process's streams.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub stdout: String,
    pub exit_code: i32,
}

impl Outcome {
    pub fn ok(stdout: String) -> Self {
        Self {
            stdout,
            exit_code: 0,
        }
    }

    pub fn refused(stdout: String) -> Self {
        Self {
            stdout,
            exit_code: 2,
        }
    }
}
