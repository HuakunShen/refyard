//! Execution targets: where a session's Git runs, and what a rebuilt one means.
//!
//! A target is not a session and not a repository. It is the *place*: this machine, or one
//! host the user picked out of their own SSH configuration. The service creates one local
//! target at construction and zero or more SSH targets from `createTarget`; a repository is
//! then opened **on** a target and is read through that target's executor for the rest of
//! its life.
//!
//! This module exists because the identity of a target has to be computed the same way
//! every time. `targetId` is a pure function of the configuration source and the alias, and
//! `generation` is a pure function of the source revision, the alias and what the probe
//! answered — so a process restart does not change what a client is told, while a
//! re-read configuration or an alias that now resolves to a different host does. A rebuilt
//! target keeps its id (it is the same choice) and changes its generation (it is a
//! different build), which is exactly what invalidates the snapshots, cursors and path ids
//! minted against the previous build.
//!
//! Nothing here connects, probes or spawns. Building an executor and probing it is the
//! service's job: this module records what was decided.

use std::sync::Mutex;

use refyard_contract::host::{ExecutionTargetKind, ExecutionTargetState, ExecutionTargetSummary};
use refyard_contract::problem::{Problem, ProblemCode};
use sha2::{Digest, Sha256};

use crate::providers::GitExecutor;

/// What the contract calls a `CreateTargetRequest`, projected for this host.
///
/// Only the two variants this host can honour: the machine itself, and one candidate the
/// configuration catalogue listed. The contract's manual-alias variant is absent on
/// purpose — an alias this host cannot find in the source it read is an alias it will not
/// hand to `ssh` on a caller's word.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CreateTargetRequest {
    Local,
    SshConfig { host_id: String },
}

/// The SSH facts a target was built from, kept so a rebuild can be recognised as one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTargetFacts {
    pub source_id: String,
    pub source_revision: String,
    pub alias: String,
}

/// One target this session owns.
#[derive(Debug, Clone)]
pub struct TargetRecord {
    pub target_id: String,
    pub kind: ExecutionTargetKind,
    pub label: String,
    pub state: ExecutionTargetState,
    pub remote_path_browse: bool,
    pub generation: String,
    /// Where this target's Git runs, when this service has an executor for it. `None` for
    /// an SSH target that could not even be built (no `ssh` program on this machine):
    /// reporting the local executor there would be a lie about where Git runs.
    pub executor: Option<GitExecutor>,
    /// Why this target is not ready. `Some` exactly when `state` is `Unavailable`, so a
    /// client can be told what failed without the target being an error a session cannot
    /// hold.
    pub unavailable: Option<Problem>,
    /// Present on an SSH target, absent on the local one.
    pub ssh: Option<SshTargetFacts>,
}

impl TargetRecord {
    /// The row a client is answered with.
    pub fn summary(&self) -> ExecutionTargetSummary {
        ExecutionTargetSummary {
            target_id: self.target_id.clone(),
            kind: self.kind,
            label: self.label.clone(),
            state: self.state,
            remote_path_browse: self.remote_path_browse,
            generation: self.generation.clone(),
        }
    }

    /// Whether a read may run through this target.
    pub fn is_ready(&self) -> bool {
        self.state == ExecutionTargetState::Ready
    }

    /// The executor a read runs through, or the typed reason there is none.
    pub fn executor(&self) -> Result<&GitExecutor, Problem> {
        self.executor.as_ref().ok_or_else(|| {
            Problem::new(
                ProblemCode::Unavailable,
                format!(
                    "target {} has no SSH provider on this machine; it was created without one",
                    self.target_id
                ),
            )
        })
    }
}

/// The targets one service owns, in creation order.
///
/// A rebuild replaces the record for the same `targetId`: there is one target per choice,
/// not a history of them, and the replacement is what carries the new generation to every
/// later read. The registry is a clonable handle, so a host that already knows its targets
/// can install them and keep naming the same set.
#[derive(Debug, Clone)]
pub struct TargetRegistry {
    inner: std::sync::Arc<Mutex<Vec<TargetRecord>>>,
}

impl TargetRegistry {
    /// A registry holding the local target, which every service has exactly one of.
    pub fn new(local: TargetRecord) -> Self {
        Self {
            inner: std::sync::Arc::new(Mutex::new(vec![local])),
        }
    }

    pub fn get(&self, target_id: &str) -> Option<TargetRecord> {
        let targets = self.inner.lock().expect("target lock");
        targets
            .iter()
            .find(|record| record.target_id == target_id)
            .cloned()
    }

    pub fn list(&self) -> Vec<TargetRecord> {
        self.inner.lock().expect("target lock").clone()
    }

    /// Inserts or replaces a target, returning the record it replaced.
    pub fn insert(&self, record: TargetRecord) -> Option<TargetRecord> {
        let mut targets = self.inner.lock().expect("target lock");
        match targets
            .iter()
            .position(|existing| existing.target_id == record.target_id)
        {
            Some(index) => {
                let replaced = std::mem::replace(&mut targets[index], record);
                Some(replaced)
            }
            None => {
                targets.push(record);
                None
            }
        }
    }

    /// Removes one target, returning the record that was removed.
    pub fn remove(&self, target_id: &str) -> Option<TargetRecord> {
        let mut targets = self.inner.lock().expect("target lock");
        let index = targets
            .iter()
            .position(|record| record.target_id == target_id)?;
        Some(targets.remove(index))
    }
}

/// The id of an SSH target: a pure function of the configuration source and the alias.
///
/// Minted here so a client that saw `tgt_ssh_…` before a restart sees the same id after
/// one, and opaque so an alias that is not URL-safe never has to appear inside an id.
pub fn ssh_target_id(source_id: &str, alias: &str) -> String {
    format!("tgt_ssh_{}", digest(&[source_id, "\u{0}", alias], 32))
}

/// The generation of an SSH target: the source revision, the alias and the probe facts.
///
/// A rebuilt target with any of those changed is a different build, and everything minted
/// against the previous generation is refused for it. Two builds that agree on all three
/// are the same build and keep the same generation, which is what keeps a re-created target
/// from invalidating a client's snapshots for no reason.
pub fn ssh_target_generation(
    source_id: &str,
    source_revision: &str,
    alias: &str,
    probe_facts: &str,
) -> String {
    format!(
        "gen_ssh_{}",
        digest(
            &[
                source_id,
                "\u{0}",
                source_revision,
                "\u{0}",
                alias,
                "\u{0}",
                probe_facts,
            ],
            32
        )
    )
}

/// The probe answer a generation binds, as one string.
///
/// A successful probe contributes the Git version it reported; a failed one contributes the
/// failure's code, so the generation of an unavailable target is still deterministic and
/// still changes when the failure changes.
pub fn probe_facts(git_version: Option<&str>, failure: Option<&str>) -> String {
    match (git_version, failure) {
        (Some(version), _) => format!("shell=ok;git={version}"),
        (None, Some(code)) => format!("probe-failed:{code}"),
        (None, None) => "probe-unknown".to_string(),
    }
}

/// A hex digest of the inputs, joined by a separator that appears in none of them.
fn digest(parts: &[&str], hex_chars: usize) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
    }
    let bytes = hasher.finalize();
    let mut text = String::with_capacity(hex_chars);
    for byte in bytes {
        if text.len() >= hex_chars {
            break;
        }
        text.push_str(&format!("{byte:02x}"));
    }
    text.truncate(hex_chars);
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::local::LocalGit;

    fn local_target(id: &str, generation: &str) -> TargetRecord {
        TargetRecord {
            target_id: id.to_string(),
            kind: ExecutionTargetKind::Local,
            label: "This machine".to_string(),
            state: ExecutionTargetState::Ready,
            remote_path_browse: false,
            generation: generation.to_string(),
            executor: Some(GitExecutor::Local(LocalGit::at("/usr/bin/git", Vec::new()))),
            unavailable: None,
            ssh: None,
        }
    }

    fn ssh_target(id: &str, generation: &str) -> TargetRecord {
        TargetRecord {
            kind: ExecutionTargetKind::SshConfig,
            label: "prod".to_string(),
            executor: Some(GitExecutor::Ssh(
                crate::providers::ssh::SshGit::at("/usr/bin/ssh", Vec::new(), "prod")
                    .expect("alias"),
            )),
            ssh: Some(SshTargetFacts {
                source_id: "source_1".to_string(),
                source_revision: "sha256-1".to_string(),
                alias: "prod".to_string(),
            }),
            ..local_target(id, generation)
        }
    }

    #[test]
    fn an_ssh_target_id_is_a_pure_function_of_source_and_alias() {
        assert_eq!(
            ssh_target_id("source_1", "prod"),
            ssh_target_id("source_1", "prod")
        );
        assert_ne!(
            ssh_target_id("source_1", "prod"),
            ssh_target_id("source_2", "prod")
        );
        assert_ne!(
            ssh_target_id("source_1", "prod"),
            ssh_target_id("source_1", "staging")
        );
        // ("ab", "c") and ("a", "bc") must not collide.
        assert_ne!(ssh_target_id("ab", "c"), ssh_target_id("a", "bc"));
        let id = ssh_target_id("source_1", "prod");
        assert!(id.starts_with("tgt_ssh_"));
        assert!(id.len() <= 100, "{id}");
        assert!(id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-')));
    }

    #[test]
    fn a_target_generation_binds_revision_alias_and_probe_facts() {
        let base = ssh_target_generation("source_1", "sha256-1", "prod", "shell=ok;git=2.50.0");
        assert_eq!(
            base,
            ssh_target_generation("source_1", "sha256-1", "prod", "shell=ok;git=2.50.0"),
            "the same build keeps the same generation"
        );
        for changed in [
            ssh_target_generation("source_1", "sha256-2", "prod", "shell=ok;git=2.50.0"),
            ssh_target_generation("source_1", "sha256-1", "staging", "shell=ok;git=2.50.0"),
            ssh_target_generation("source_1", "sha256-1", "prod", "shell=ok;git=2.51.0"),
            ssh_target_generation("source_1", "sha256-1", "prod", "probe-failed:Unavailable"),
        ] {
            assert_ne!(base, changed, "a rebuild changed nothing in the generation");
        }
        assert!(base.starts_with("gen_"));
    }

    #[test]
    fn a_failed_probe_still_has_a_deterministic_generation() {
        let first = probe_facts(None, Some("Unavailable"));
        let second = probe_facts(None, Some("Unavailable"));
        assert_eq!(first, second);
        assert_ne!(first, probe_facts(None, Some("Forbidden")));
        assert_eq!(probe_facts(Some("2.50.0"), None), "shell=ok;git=2.50.0");
    }

    #[test]
    fn inserting_a_rebuilt_target_replaces_it_and_keeps_creation_order() {
        let registry = TargetRegistry::new(local_target("tgt_local", "gen_1"));
        registry.insert(ssh_target("tgt_ssh_1", "gen_ssh_1"));
        let rebuilt = ssh_target("tgt_ssh_1", "gen_ssh_2");
        let replaced = registry.insert(rebuilt).expect("replaced the old record");
        assert_eq!(replaced.generation, "gen_ssh_1");
        let ids: Vec<String> = registry.list().into_iter().map(|t| t.target_id).collect();
        assert_eq!(ids, vec!["tgt_local", "tgt_ssh_1"]);
        assert_eq!(
            registry.get("tgt_ssh_1").expect("present").generation,
            "gen_ssh_2"
        );
    }

    #[test]
    fn removing_a_target_leaves_the_others() {
        let registry = TargetRegistry::new(local_target("tgt_local", "gen_1"));
        registry.insert(ssh_target("tgt_ssh_1", "gen_ssh_1"));
        assert!(registry.remove("tgt_ssh_1").is_some());
        assert!(registry.get("tgt_ssh_1").is_none());
        assert!(registry.get("tgt_local").is_some());
        assert!(registry.remove("tgt_ssh_1").is_none());
    }

    #[test]
    fn a_summary_carries_the_contract_fields_and_nothing_extra() {
        let summary = ssh_target("tgt_ssh_1", "gen_ssh_1").summary();
        assert_eq!(summary.kind, ExecutionTargetKind::SshConfig);
        assert_eq!(summary.state, ExecutionTargetState::Ready);
        assert!(
            !summary.remote_path_browse,
            "no remote browsing in this build"
        );
        assert_eq!(summary.generation, "gen_ssh_1");
    }
}
