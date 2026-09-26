//! Argument vectors for Git, and nothing else.
//!
//! Every production `git` invocation in the native host is built here. No other
//! module constructs argv, which is what makes "the renderer cannot ask for arbitrary
//! execution" checkable: a request maps to a planner, and a planner emits a fixed
//! vector.
//!
//! Conventions that every planner follows:
//!
//! - the executable is not included — the host chooses the `git` binary;
//! - `--no-optional-locks` on status, so a read cannot take the index lock;
//! - `--no-ext-diff` and `--no-textconv` on every diff, so repository configuration
//!   cannot turn a read into running an external program;
//! - `-z`/`--porcelain` wherever Git offers a machine format;
//! - stdin for anything unstructured (tips, pathspecs, messages) instead of
//!   interpolating it into an argument.

pub mod branches;
pub mod commit;
pub mod diff;
pub mod history;
pub mod merge;
pub mod paths;
pub mod refs;
pub mod remotes;
pub mod replay;
pub mod status;
pub mod submodules;
pub mod tags;
pub mod worktrees;

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

    /// A read-only command. Spelled out at call sites because a planner that runs
    /// the user's hooks or touches the network must not be given a read deadline.
    pub fn read(argv: Vec<String>) -> Self {
        Self::new(argv)
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

/// One name per line on stdin, with a trailing newline.
///
/// The `--stdin` readers of `rev-list`, `cat-file` and `check-ignore` all split on
/// newlines, and every name handed to them here is a full object name, so a newline
/// inside one is impossible. Names go through stdin rather than argv so a name can
/// never be read as an option.
pub(crate) fn names_stdin(names: &[&str]) -> Vec<u8> {
    let mut stdin = Vec::new();
    for name in names {
        stdin.extend_from_slice(name.as_bytes());
        stdin.push(b'\n');
    }
    stdin
}
