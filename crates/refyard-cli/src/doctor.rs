//! `refyard-native doctor` — what this machine can do, without a window.
//!
//! The same report the Node command line prints (`apps/cli/src/doctor.ts`), minus the two
//! things a native process does not have: there is no JavaScript runtime to report, and the
//! machine-format probes that command runs are named as not probed here rather than guessed.
//!
//! Every field comes from something that was actually done: the Git version is the answer
//! `git --version` gave, the SSH client is the path that was resolved, the state directory is
//! the one this process would open, and the read and operation lists are the *service's own*
//! `capabilities`, so this command cannot advertise a read the host would refuse.
//!
//! Exit status: 0 when this machine can serve — Git was found and named a version — and 2
//! otherwise. A machine with no Git still answers for everything else, because the SSH
//! provider does not need local Git to read a remote repository.

use refyard_host::providers::local::LocalGit;
use refyard_host::reads::filesystem;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};
use refyard_host::ssh;
use refyard_host::state_root::default_state_root;
use serde::Serialize;

/// The Git version below which the features this host relies on are not guaranteed.
///
/// The same floor the Node doctor states, and for the same reason: `--pathspec-from-file`,
/// `--porcelain=v2` and the batch protocols it uses all predate it.
const FUNCTIONAL_BASELINE: (u32, u32, u32) = (2, 43, 0);

/// What this machine can do, as printed and as serialized for `--json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub platform: String,
    pub architecture: String,
    /// Constant, and said out loud: this build carries no JavaScript runtime.
    pub runtime: String,
    pub git_path: Option<String>,
    pub git_version: Option<String>,
    pub executable_found: bool,
    pub feature_version_supported: bool,
    pub ssh_client: Option<String>,
    pub state_root: String,
    pub reads_available: Vec<String>,
    pub operations_available: Vec<String>,
    /// What this command did not probe, so a reader does not mistake silence for support.
    pub not_probed: Vec<String>,
    pub reasons: Vec<String>,
}

impl DoctorReport {
    /// The report a human reads, in the order a person asks the questions.
    pub fn render(&self) -> String {
        let mut lines = vec!["refyard-native doctor".to_string()];
        lines.push(format!(
            "  runtime: {} ({} {})",
            self.runtime, self.platform, self.architecture
        ));
        match (&self.git_path, &self.git_version) {
            (Some(path), Some(version)) => {
                lines.push(format!("  git:  {version} at {path}"));
            }
            (Some(path), None) => {
                lines.push(format!(
                    "  git:  found at {path}, but it did not name a version"
                ));
            }
            _ => lines.push("  git:  not usable".to_string()),
        }
        lines.push(format!(
            "  functional baseline: {} ({}.{}.{} or newer)",
            if self.feature_version_supported {
                "met"
            } else {
                "not met"
            },
            FUNCTIONAL_BASELINE.0,
            FUNCTIONAL_BASELINE.1,
            FUNCTIONAL_BASELINE.2
        ));
        match &self.ssh_client {
            Some(program) => lines.push(format!("  ssh:  {program}")),
            None => {
                lines.push("  ssh:  not found; remote repositories are unavailable".to_string())
            }
        }
        lines.push(format!("  state: {}", self.state_root));
        lines.push(format!(
            "  reads available: {}",
            join_or_none(&self.reads_available)
        ));
        lines.push(format!(
            "  operations available: {}",
            join_or_none(&self.operations_available)
        ));
        if !self.not_probed.is_empty() {
            lines.push("  not probed:".to_string());
            for item in &self.not_probed {
                lines.push(format!("    - {item}"));
            }
        }
        if !self.reasons.is_empty() {
            lines.push("  notes:".to_string());
            for reason in &self.reasons {
                lines.push(format!("    - {reason}"));
            }
        }
        lines.join("\n")
    }

    /// True when this machine can serve. A missing Git is the only thing that stops it.
    pub fn can_serve(&self) -> bool {
        self.executable_found && self.feature_version_supported
    }
}

fn join_or_none(items: &[String]) -> String {
    if items.is_empty() {
        "none in this build".to_string()
    } else {
        items.join(", ")
    }
}

/// The leading dotted number of a version string.
///
/// `git --version` answers `2.50.1 (Apple Git-155)` on macOS and `2.45.4` in the fixture's
/// container, so only the first three numbers are read and the rest is left alone.
pub fn parse_version(version: &str) -> Option<(u32, u32, u32)> {
    let mut numbers = [0u32; 3];
    let mut seen = 0usize;
    let head = version.split_whitespace().next()?;
    for part in head.split('.') {
        if seen == numbers.len() {
            break;
        }
        let digits: String = part
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect();
        if digits.is_empty() {
            return None;
        }
        numbers[seen] = digits.parse().ok()?;
        seen += 1;
    }
    if seen == 0 {
        return None;
    }
    Some((numbers[0], numbers[1], numbers[2]))
}

/// Runs the doctor against this machine and returns what to print plus the status.
pub async fn run(json: bool) -> (String, i32) {
    let environment: Vec<(String, String)> = std::env::vars().collect();
    let state_root = default_state_root(&environment, std::env::consts::OS);
    let mut reasons = Vec::new();

    let (git_path, git_version, executable_found) = match LocalGit::discover() {
        Ok(git) => {
            let path = git.program().display().to_string();
            match git.version().await {
                Ok(version) => (Some(path), Some(version), true),
                Err(diagnostic) => {
                    reasons.push(format!("git did not answer: {diagnostic}"));
                    (Some(path), None, false)
                }
            }
        }
        Err(diagnostic) => {
            reasons.push(diagnostic);
            (None, None, false)
        }
    };

    let feature_version_supported = git_version
        .as_deref()
        .and_then(parse_version)
        .map(|version| version >= FUNCTIONAL_BASELINE)
        .unwrap_or(false);
    if executable_found && !feature_version_supported {
        reasons.push(format!(
            "this git is older than {}.{}.{}, which is the floor for the machine formats this host uses",
            FUNCTIONAL_BASELINE.0, FUNCTIONAL_BASELINE.1, FUNCTIONAL_BASELINE.2
        ));
    }

    let ssh_client = match ssh::openssh::discover() {
        Ok(program) => Some(program.display().to_string()),
        Err(diagnostic) => {
            reasons.push(format!("{diagnostic}; ssh targets will be refused"));
            None
        }
    };

    let service = LocalGit::discover().ok().map(|git| {
        let home = filesystem::home_from(git.environment())
            .unwrap_or_else(|| std::path::PathBuf::from("/"));
        ApplicationService::new(ApplicationServiceConfig {
            git,
            service_instance_id: format!("srvc_doctor_{}", std::process::id()),
            target_id: "tgt_local".to_owned(),
            target_generation: "gen_doctor".to_owned(),
            home,
        })
        // Writes are registered the way a serving process registers them, so the list below
        // is what a caller would actually be offered rather than what this build could do in
        // principle.
        .with_writes()
    });
    let (reads_available, operations_available) = match service {
        Some(service) => match service.capabilities().await {
            Ok(capabilities) => (
                wire_names(&capabilities.reads),
                // An operation is named together with the targets that can carry it:
                // "commit" alone would hide that a build can commit locally and not over
                // SSH, which is exactly the difference a caller has to see.
                capabilities
                    .operations
                    .iter()
                    .map(|operation| {
                        let targets = wire_names(&operation.targets);
                        if targets.is_empty() {
                            operation_name(operation)
                        } else {
                            format!("{} ({})", operation_name(operation), targets.join(", "))
                        }
                    })
                    .collect(),
            ),
            Err(problem) => {
                reasons.push(format!(
                    "capabilities could not be answered: {}",
                    problem.message
                ));
                (Vec::new(), Vec::new())
            }
        },
        None => (Vec::new(), Vec::new()),
    };

    let report = DoctorReport {
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        runtime: "native, no JavaScript runtime".to_string(),
        git_path,
        git_version,
        executable_found,
        feature_version_supported,
        ssh_client,
        state_root: state_root.display().to_string(),
        reads_available,
        operations_available,
        not_probed: vec![
            "object formats (sha1/sha256): detected per repository, not for the machine"
                .to_string(),
            "machine format probes (porcelain v2, batch protocols): assert by tests, not here"
                .to_string(),
        ],
        reasons,
    };

    let text = if json {
        // A serialization failure here would be a bug in this struct, not a machine's fault;
        // the report is plain data, so the fallback names that rather than printing `null`.
        serde_json::to_string_pretty(&report).unwrap_or_else(|error| {
            format!("{{\"error\":\"the report could not be serialized: {error}\"}}")
        })
    } else {
        report.render()
    };
    let status = if report.can_serve() { 0 } else { 2 };
    (text, status)
}

/// The wire names of a list of capability items, as the contract spells them.
fn wire_names<T: Serialize>(items: &[T]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| serde_json::to_value(item).ok())
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect()
}

/// The name of one operation, without the targets it can run on.
fn operation_name(operation: &refyard_contract::reads::OperationCapability) -> String {
    serde_json::to_value(operation.kind)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_version_string_is_read_as_the_numbers_git_actually_printed() {
        assert_eq!(parse_version("2.50.1 (Apple Git-155)"), Some((2, 50, 1)));
        assert_eq!(parse_version("2.45.4"), Some((2, 45, 4)));
        // Prevents: a build string being read as a version. "unknown" is not 0.0.0, and
        // reporting the baseline as unmet is the honest answer for it.
        assert_eq!(parse_version("unknown"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn the_baseline_is_a_comparison_not_a_string_prefix() {
        let met = |version: &str| parse_version(version).map(|v| v >= FUNCTIONAL_BASELINE);
        assert_eq!(met("2.43.0"), Some(true));
        assert_eq!(met("2.42.9"), Some(false));
        assert_eq!(met("3.0.0"), Some(true));
    }

    // Prevents: a machine with no Git reading as a healthy host. The report is still
    // answered — the SSH provider needs no local Git — but it is not a success.
    #[test]
    fn a_host_without_git_answers_but_does_not_claim_to_be_able_to_serve() {
        let report = DoctorReport {
            platform: "macos".to_string(),
            architecture: "aarch64".to_string(),
            runtime: "native, no JavaScript runtime".to_string(),
            git_path: None,
            git_version: None,
            executable_found: false,
            feature_version_supported: false,
            ssh_client: Some("/usr/bin/ssh".to_string()),
            state_root: "/Users/someone/Library/Application Support/refyard".to_string(),
            reads_available: Vec::new(),
            operations_available: Vec::new(),
            not_probed: Vec::new(),
            reasons: vec!["git was not found on PATH".to_string()],
        };
        assert!(!report.can_serve());
        let rendered = report.render();
        assert!(rendered.contains("git:  not usable"), "{rendered}");
        assert!(
            rendered.contains("reads available: none in this build"),
            "{rendered}"
        );
        assert!(rendered.contains("git was not found on PATH"), "{rendered}");
    }
}
