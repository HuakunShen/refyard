//! Whether this machine's OpenSSH accepts the options the execution policy fixes.
//!
//! The option list in `openssh` is a policy, not a suggestion, so a build that does not
//! understand one of the safety options must be reported as unavailable rather than have
//! the option dropped. `ssh -V` answers which client this is, and one probe per option
//! answers whether this build knows it.
//!
//! The probe target is `127.0.0.1` port 1 — a port nothing listens on — so the probe never
//! reaches a real server. An unknown option is rejected while the command line is parsed,
//! before any connection is attempted, and OpenSSH says so on stderr; that message, naming
//! the option, is the acceptance answer. Anything else (a refused connection, a timeout)
//! means the option parsed and the attempt got as far as the network.
//!
//! The probe deliberately does not pass `-F`. A real connection uses the user's
//! configuration, so an acceptance probe that bypassed it would answer a question about a
//! different invocation. It also means the probe shares the design's trust boundary: the
//! user's own `ProxyCommand`, `Match exec` or `KnownHostsCommand` may run local programs
//! during it, and nothing here claims otherwise.

use std::path::Path;
use std::time::Duration;

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_core::plan::ProcessSpec;

use crate::process::{run, ExecutionState};

use super::openssh::{self, SAFETY_OPTIONS};

/// How long one probe may take. Every probe connects to a refused port, so a probe that
/// reaches this bound is reported rather than waited out. The bound is per probe, so the
/// whole check is bounded by the option count even when a user's configuration makes every
/// attempt hang.
pub const PROBE_DEADLINE: Duration = Duration::from_secs(10);

const PROBE_STDOUT_LIMIT: usize = 64 * 1024;
const PROBE_STDERR_LIMIT: usize = 64 * 1024;

/// The OpenSSH client this machine has, once it has answered for its option set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshPolicy {
    pub executable: String,
    /// The first line of `ssh -V`, which OpenSSH prints on stderr.
    pub version: String,
    /// The safety options that were accepted, in the policy's order.
    pub options: Vec<String>,
}

/// Why the fixed option set cannot be used on this machine.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PolicyUnavailable {
    /// No `ssh` could be started at all.
    #[error("this machine's ssh could not be started: {diagnostic}")]
    ProgramMissing { diagnostic: String },
    /// `ssh` started but would not report a version.
    #[error("this machine's ssh did not report a version: {diagnostic}")]
    VersionUnavailable { diagnostic: String },
    /// This build does not accept one of the safety options.
    #[error("this machine's OpenSSH does not accept {option}")]
    UnsupportedOption { option: String, diagnostic: String },
    /// The probe itself could not answer — a truncated stream or a config this host
    /// cannot read. Reported rather than assumed to mean "supported".
    #[error("the OpenSSH option probe did not answer: {diagnostic}")]
    ProbeFailed { diagnostic: String },
}

impl PolicyUnavailable {
    /// The contract problem a caller shows. Every variant is `Unavailable`: none of them
    /// is a client mistake, and all of them mean "the SSH transport cannot be offered
    /// here right now".
    pub fn to_problem(&self) -> Problem {
        let mut problem = Problem::new(ProblemCode::Unavailable, self.to_string());
        if let PolicyUnavailable::UnsupportedOption { option, diagnostic } = self {
            problem = problem
                .with_detail("option", DetailValue::Text(option.clone()))
                .with_detail("diagnostic", DetailValue::Text(bounded(diagnostic)));
        }
        problem
    }
}

/// Probes `program` in exactly `env`.
pub async fn probe(
    program: &Path,
    env: &[(String, String)],
) -> Result<SshPolicy, PolicyUnavailable> {
    let version = version_of(program, env).await?;
    for (name, value) in SAFETY_OPTIONS {
        let outcome = run(spec(program, env, probe_argv(name, value)), None).await;
        if outcome.state == ExecutionState::NotStarted {
            return Err(PolicyUnavailable::ProgramMissing {
                diagnostic: bounded(&String::from_utf8_lossy(&outcome.stderr)),
            });
        }
        if !outcome.output_complete {
            return Err(PolicyUnavailable::ProbeFailed {
                diagnostic: "the probe's output exceeded the bound this host holds".to_string(),
            });
        }
        let stderr = String::from_utf8_lossy(&outcome.stderr);
        if let Some(named) = bad_configuration_option(&stderr) {
            if named.eq_ignore_ascii_case(name) {
                return Err(PolicyUnavailable::UnsupportedOption {
                    option: format!("{name}={value}"),
                    diagnostic: bounded(&stderr),
                });
            }
            // The refusal names some *other* option, which came from the user's own
            // configuration. Attributing that to the policy option would send the user
            // looking in the wrong place.
            return Err(PolicyUnavailable::ProbeFailed {
                diagnostic: bounded(&stderr),
            });
        }
    }
    Ok(SshPolicy {
        executable: program.display().to_string(),
        version,
        options: SAFETY_OPTIONS
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect(),
    })
}

/// Probes this process's own `ssh` and environment, the way the provider would use them.
pub async fn probe_this_machine() -> Result<SshPolicy, PolicyUnavailable> {
    let program = openssh::discover().map_err(|diagnostic| PolicyUnavailable::ProgramMissing {
        diagnostic: diagnostic.to_string(),
    })?;
    probe(&program, &openssh::ssh_environment()).await
}

/// One probe's argument vector: the option under test, then the fixed conditions that make
/// the answer comparable across options.
fn probe_argv(name: &str, value: &str) -> Vec<String> {
    vec![
        openssh::NO_TTY_FLAG.to_string(),
        "-o".to_string(),
        format!("{name}={value}"),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=2".to_string(),
        // Port 1 on the loopback address: nothing listens, so the connection is refused
        // and no server ever sees this attempt.
        "-p".to_string(),
        "1".to_string(),
        "127.0.0.1".to_string(),
        "true".to_string(),
    ]
}

async fn version_of(program: &Path, env: &[(String, String)]) -> Result<String, PolicyUnavailable> {
    let argv = vec!["-V".to_string()];
    let outcome = run(spec(program, env, argv), None).await;
    if outcome.state == ExecutionState::NotStarted {
        return Err(PolicyUnavailable::ProgramMissing {
            diagnostic: bounded(&String::from_utf8_lossy(&outcome.stderr)),
        });
    }
    let text = String::from_utf8_lossy(&outcome.stderr);
    let line = text.lines().next().unwrap_or("").trim().to_string();
    if !outcome.succeeded() || line.is_empty() {
        return Err(PolicyUnavailable::VersionUnavailable {
            diagnostic: bounded(&text),
        });
    }
    Ok(line)
}

fn spec(program: &Path, env: &[(String, String)], argv: Vec<String>) -> ProcessSpec {
    ProcessSpec {
        program: program.to_path_buf(),
        argv,
        stdin: Vec::new(),
        cwd: None,
        env: env.to_vec(),
        deadline: PROBE_DEADLINE,
        stdout_limit: PROBE_STDOUT_LIMIT,
        stderr_limit: PROBE_STDERR_LIMIT,
    }
}

/// The option name OpenSSH refused, when the failure is a parse-time refusal.
///
/// Two spellings are accepted because the message has changed across releases; the name
/// is what makes this answer attributable to a specific probe rather than to whatever the
/// user's configuration happened to contain.
fn bad_configuration_option(stderr: &str) -> Option<String> {
    let lowered = stderr.to_ascii_lowercase();
    let marker = if lowered.contains("bad configuration option") {
        "bad configuration option:"
    } else if lowered.contains("unsupported option") {
        "unsupported option:"
    } else {
        return None;
    };
    let rest = lowered.split(marker).nth(1)?.trim();
    if rest.is_empty() {
        // A refusal without a name cannot be attributed to one option, so it is reported
        // as an unattributed probe failure instead.
        return Some(String::new());
    }
    Some(rest.split_whitespace().next().unwrap_or("").to_string())
}

fn bounded(text: &str) -> String {
    text.trim_end().chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_option_refusal_is_attributed_to_the_option_that_was_named() {
        assert_eq!(
            bad_configuration_option("command-line: line 0: Bad configuration option: stdinnull\n"),
            Some("stdinnull".to_string())
        );
        assert_eq!(
            bad_configuration_option("Unsupported option: SessionType\n"),
            Some("sessiontype".to_string())
        );
        // A connection failure is not an option refusal at all.
        assert_eq!(
            bad_configuration_option("ssh: connect to host 127.0.0.1 port 1: Connection refused\n"),
            None
        );
    }

    #[test]
    fn every_variant_of_unavailability_is_a_typed_unavailable_problem() {
        for failure in [
            PolicyUnavailable::ProgramMissing {
                diagnostic: "not found".to_string(),
            },
            PolicyUnavailable::VersionUnavailable {
                diagnostic: "no output".to_string(),
            },
            PolicyUnavailable::UnsupportedOption {
                option: "StdinNull=no".to_string(),
                diagnostic: "Bad configuration option".to_string(),
            },
            PolicyUnavailable::ProbeFailed {
                diagnostic: "truncated".to_string(),
            },
        ] {
            let problem = failure.to_problem();
            assert_eq!(problem.code, ProblemCode::Unavailable);
            assert!(!problem.retryable, "a capability gap is not retried away");
        }
    }

    /// A stand-in for an OpenSSH that does not know one of the safety options.
    ///
    /// The real check runs against this machine's `ssh`; this fixture is what makes the
    /// *refusal* path testable without an old OpenSSH, and it answers exactly as OpenSSH
    /// does: the version on stderr for `-V`, a parse-time refusal naming the option, and a
    /// refused connection otherwise.
    #[cfg(unix)]
    fn fake_ssh(refuse: Option<&str>) -> (tempfile::TempDir, std::path::PathBuf) {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let path = directory.path().join("ssh");
        let refusal = match refuse {
            Some(name) => format!(
                "for arg in \"$@\"; do case \"$arg\" in {name}=*) echo \"command-line: line 0: Bad configuration option: {lower}\" >&2; exit 255;; esac; done\n",
                lower = name.to_ascii_lowercase()
            ),
            None => String::new(),
        };
        let script = format!(
            "#!/bin/sh\ncase \"$*\" in *-V*) echo \"OpenSSH_9.0p1 FakeSSH\" >&2; exit 0;; esac\n{refusal}echo \"ssh: connect to host 127.0.0.1 port 1: Connection refused\" >&2\nexit 255\n"
        );
        std::fs::write(&path, script).expect("write the fake ssh");
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("make the fake ssh executable");
        (directory, path)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_build_that_rejects_a_safety_option_is_unavailable_rather_than_dropped() {
        let (_home, program) = fake_ssh(Some("StdinNull"));
        let failure = probe(&program, &[]).await.expect_err("refused");
        match &failure {
            PolicyUnavailable::UnsupportedOption { option, .. } => {
                assert_eq!(option, "StdinNull=no");
            }
            other => panic!("expected an unsupported-option answer, got {other:?}"),
        }
        let problem = failure.to_problem();
        assert_eq!(problem.code, ProblemCode::Unavailable);
        assert!(problem
            .details
            .and_then(|details| details.get("option").cloned())
            .is_some());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_build_that_accepts_every_option_reports_the_whole_set() {
        let (_home, program) = fake_ssh(None);
        let policy = probe(&program, &[]).await.expect("accepted");
        assert!(policy.version.starts_with("OpenSSH_"));
        assert_eq!(policy.options.len(), SAFETY_OPTIONS.len());
        assert_eq!(policy.options[0], "BatchMode=yes");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_client_that_cannot_be_started_is_unavailable_with_its_diagnostic() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let missing = directory.path().join("ssh");
        let failure = probe(&missing, &[]).await.expect_err("missing");
        assert!(matches!(failure, PolicyUnavailable::ProgramMissing { .. }));
    }
}
