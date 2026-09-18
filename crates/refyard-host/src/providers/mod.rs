//! Execution providers: where Git actually runs.
//!
//! A provider is the only thing that knows whether a command runs on this machine or
//! on another one. Everything above it — planners, parsers, workflows, the operation
//! queue — is written against the same operations, which is what makes the local and
//! SSH paths one implementation rather than two.
//!
//! [`GitExecutor`] is the one name the layers above use for "where Git runs". It is an
//! enum rather than a trait object because there are exactly two transports and the
//! choice is closed: a match that compiles today breaks loudly when a third one is
//! added, and every future is `Send` because both arms are concrete. The reads take a
//! `&str` directory because a remote repository path is a remote string; the local arm
//! turns it into a `Path` at the process boundary, which is the only place a local path
//! is meaningful. `try_run` returns a typed problem rather than folding a refusal into a
//! `RunOutcome`, so a path this host cannot encode reaches the client as the
//! `ProblemCode` it is instead of a generic command failure.

pub mod local;
pub mod ssh;

use std::path::Path;

use refyard_contract::problem::Problem;
use refyard_core::plan::GitPlan;

use crate::process::{CancelSignal, RunOutcome};

pub use local::LocalGit;
pub use ssh::SshGit;

/// One place Git can be run: this machine, or a remote host reached through this
/// machine's OpenSSH.
#[derive(Debug, Clone)]
pub enum GitExecutor {
    Local(LocalGit),
    Ssh(SshGit),
}

impl GitExecutor {
    /// Runs one planned command in `directory`, with the plan's own deadline class.
    ///
    /// The directory is a string because a remote path never becomes a local `Path`: the
    /// local arm converts it at the process spawn, the SSH arm keeps it inside the quoted
    /// command string.
    pub async fn try_run(
        &self,
        directory: &str,
        plan: &GitPlan,
        cancel: Option<CancelSignal>,
    ) -> Result<RunOutcome, Problem> {
        match self {
            Self::Local(git) => Ok(git.run(Path::new(directory), plan, cancel).await),
            Self::Ssh(git) => git.try_run(directory, plan, cancel).await,
        }
    }

    /// Whether a command from this executor runs on another machine.
    ///
    /// Callers use it to refuse a read that would otherwise consult this machine's
    /// filesystem for a remote path — the one failure that would look like a successful
    /// answer.
    pub fn is_remote(&self) -> bool {
        matches!(self, Self::Ssh(_))
    }
}
