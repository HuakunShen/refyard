//! Running Git on this machine.
//!
//! The provider owns three decisions and no others: which program runs, in which
//! directory, and with which environment. It does not build argument vectors — those
//! come from `refyard-core` planners — and it does not parse output. Keeping those
//! three things apart is what lets the same reads run over SSH later with no change
//! above this layer.

use std::path::{Path, PathBuf};
use std::time::Duration;

use refyard_core::plan::{GitPlan, ProcessSpec};

use crate::process::{git_environment, run, CancelSignal, RunOutcome};

/// `LIMITS.structuredStdoutMaxBytes` from the published contract.
pub const STRUCTURED_STDOUT_MAX_BYTES: usize = 16 * 1024 * 1024;

/// `LIMITS.stderrDiagnosticMaxBytes` from the published contract.
///
/// These are declared here rather than imported so a change to the public limit is a
/// visible edit on both sides, instead of a silent widening of what a read buffers.
pub const STDERR_DIAGNOSTIC_MAX_BYTES: usize = 256 * 1024;

/// Git on this machine.
#[derive(Debug, Clone)]
pub struct LocalGit {
    program: PathBuf,
    env: Vec<(String, String)>,
    stdout_limit: usize,
    stderr_limit: usize,
}

impl LocalGit {
    /// Resolves the `git` executable once, at startup.
    ///
    /// A path is resolved rather than a bare name passed to `Command`, so a later
    /// change to `PATH` (or a malicious directory earlier in it) cannot swap the
    /// program between two commands of one session.
    pub fn discover() -> Result<Self, String> {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let executable = if cfg!(windows) { "git.exe" } else { "git" };
        for directory in std::env::split_paths(&path) {
            if directory.as_os_str().is_empty() {
                continue;
            }
            let candidate = directory.join(executable);
            if candidate.is_file() {
                return Ok(Self {
                    program: candidate,
                    env: git_environment(),
                    stdout_limit: STRUCTURED_STDOUT_MAX_BYTES,
                    stderr_limit: STDERR_DIAGNOSTIC_MAX_BYTES,
                });
            }
        }
        Err("git was not found on PATH".to_string())
    }

    /// A provider for a specific executable, used by tests and by `doctor`.
    pub fn at(program: impl Into<PathBuf>, env: Vec<(String, String)>) -> Self {
        Self {
            program: program.into(),
            env,
            stdout_limit: STRUCTURED_STDOUT_MAX_BYTES,
            stderr_limit: STDERR_DIAGNOSTIC_MAX_BYTES,
        }
    }

    pub fn with_output_limits(mut self, stdout_limit: usize, stderr_limit: usize) -> Self {
        self.stdout_limit = stdout_limit;
        self.stderr_limit = stderr_limit;
        self
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    /// The environment every command from this provider runs with.
    ///
    /// Exposed so the repository-opening read can run under exactly the same environment
    /// as every later command: two environments for one repository is how a fixture's
    /// Git config gets applied to one read and not another.
    pub fn environment(&self) -> &[(String, String)] {
        &self.env
    }

    /// Runs one planned command in `directory`.
    pub async fn run(
        &self,
        directory: &Path,
        plan: &GitPlan,
        cancel: Option<CancelSignal>,
    ) -> RunOutcome {
        self.run_with_limits(directory, plan, cancel, None).await
    }

    /// Runs one planned command with a caller-supplied output bound.
    ///
    /// The bound is per call because a status read and a bounded diff do not buffer
    /// the same amount, and a single global limit would either truncate a diff
    /// silently or let a status read allocate far more than it needs.
    pub async fn run_with_limits(
        &self,
        directory: &Path,
        plan: &GitPlan,
        cancel: Option<CancelSignal>,
        stdout_limit: Option<usize>,
    ) -> RunOutcome {
        let spec = ProcessSpec {
            program: self.program.clone(),
            argv: plan.argv.clone(),
            stdin: plan.stdin.clone(),
            cwd: Some(directory.to_path_buf()),
            env: self.env.clone(),
            deadline: Duration::from_secs(plan.deadline_class.seconds()),
            stdout_limit: stdout_limit.map_or(self.stdout_limit, |requested| {
                requested.min(self.stdout_limit)
            }),
            stderr_limit: self.stderr_limit,
        };
        run(spec, cancel).await
    }

    /// The Git version this machine reports, used by `doctor` and capabilities.
    pub async fn version(&self) -> Result<String, String> {
        let plan = GitPlan::read(vec!["--version".to_string()]);
        let directory = std::env::temp_dir();
        let outcome = self.run(&directory, &plan, None).await;
        if !outcome.succeeded() {
            return Err(String::from_utf8_lossy(&outcome.stderr).into_owned());
        }
        let text = String::from_utf8_lossy(&outcome.stdout).trim().to_string();
        Ok(text
            .strip_prefix("git version ")
            .unwrap_or(&text)
            .to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_core::plan::DeadlineClass;

    #[tokio::test]
    async fn runs_a_planned_command_in_the_given_directory() {
        let git = LocalGit::discover().expect("git is installed on this machine");
        let plan = GitPlan::read(vec!["--version".to_string()]);
        let outcome = git.run(&std::env::temp_dir(), &plan, None).await;
        assert!(
            outcome.succeeded(),
            "stderr: {:?}",
            String::from_utf8_lossy(&outcome.stderr)
        );
        assert!(String::from_utf8_lossy(&outcome.stdout).starts_with("git version"));
    }

    #[tokio::test]
    async fn configured_output_caps_apply_even_when_a_call_requests_more() {
        let helper = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
        let git = LocalGit::at(helper, Vec::new()).with_output_limits(8, 7);
        let plan = if cfg!(windows) {
            GitPlan::read(vec![
                "/C".to_string(),
                "@for /L %i in (1,1,30) do @<nul set /p =x & echo err 1>&2".to_string(),
            ])
        } else {
            GitPlan::read(vec![
                "-c".to_string(),
                "printf 12345678901234567890; printf 12345678901234567890 >&2".to_string(),
            ])
        };
        let outcome = git
            .run_with_limits(&std::env::temp_dir(), &plan, None, Some(1024))
            .await;
        assert!(outcome.stdout.len() <= 8);
        assert!(outcome.stderr.len() <= 7);
        assert!(!outcome.output_complete);
    }

    #[tokio::test]
    async fn reports_a_capability_read_under_the_read_deadline() {
        let git = LocalGit::discover().expect("git");
        let plan = GitPlan::read(vec!["--version".to_string()]);
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
        assert!(!git.version().await.expect("version").is_empty());
    }
}
