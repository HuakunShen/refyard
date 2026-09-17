//! The bounded process runner.
//!
//! Every Git command in the native host goes through this module. It exists because
//! the failure modes of `Command` are the failure modes of the product: a child that
//! blocks on a full pipe while we read the other stream, output that arrives faster
//! than it is consumed, a command that never returns, and a process that outlives the
//! operation that started it.
//!
//! Two rules are structural rather than conventional:
//!
//! - stdout and stderr are drained **concurrently**, so a command that writes a lot
//!   to both cannot deadlock on a pipe buffer.
//! - output is bounded. A truncated stream is reported as truncated, because an
//!   incomplete protocol frame parsed as if it were complete is a wrong answer, not a
//!   partial one.
//!
//! The runner never builds a command line: it takes a program and an argument vector,
//! and it never starts a shell.

use std::path::PathBuf;
use std::time::Duration;

/// How long a command may run, by class of work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeadlineClass {
    /// A read of local state: bounded, no network, no user interaction.
    Read,
    /// A network operation, which may legitimately take minutes.
    Network,
    /// A command that runs the user's hooks, signer or filters.
    Hook,
}

impl DeadlineClass {
    /// The deadline this class is given, in seconds, from the published limits.
    pub fn seconds(self) -> u64 {
        match self {
            DeadlineClass::Read => 15,
            DeadlineClass::Network => 600,
            DeadlineClass::Hook => 120,
        }
    }
}

/// One planned command: the argument vector, the bytes for stdin, and how long it may take.
///
/// Planning lives in `refyard-core` and produces this; the host decides which program
/// to run, in which directory, with which environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitPlan {
    pub argv: Vec<String>,
    pub stdin: Vec<u8>,
    pub deadline_class: DeadlineClass,
}

impl GitPlan {
    pub fn new(argv: Vec<String>) -> Self {
        Self {
            argv,
            stdin: Vec::new(),
            deadline_class: DeadlineClass::Read,
        }
    }
}

/// Everything the runner needs. Built by the host, never by a caller above it.
#[derive(Debug, Clone)]
pub struct ProcessSpec {
    /// Absolute path to the program. Resolved once by the host, not per call.
    pub program: PathBuf,
    pub argv: Vec<String>,
    pub stdin: Vec<u8>,
    pub cwd: Option<PathBuf>,
    /// The complete environment. There is no "inherit and hope" mode: an inherited
    /// variable like `GIT_DIR` or `GIT_EXTERNAL_DIFF` would silently redirect the
    /// command to another repository or another program.
    pub env: Vec<(String, String)>,
    pub deadline: Duration,
    pub stdout_limit: usize,
    pub stderr_limit: usize,
}
