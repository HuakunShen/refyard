//! The three write effects this build implements: stage, unstage and commit.
//!
//! One workflow per effect, run through whatever executor the repository's target names —
//! the local provider or the SSH provider. There is no second implementation for SSH: the
//! same planner builds the same argument vector and the same stdin bytes, and the provider
//! decides where they run. That is the whole reason the write path lives here rather than
//! in either transport.
//!
//! The order inside every effect is the safety model, and it is the Node reference's
//! order:
//!
//! 1. resolve every named path id to the bytes it was minted for (one unknown or
//!    unrepresentable path refuses the whole batch, before any Git command exists);
//! 2. redeem preview tokens against freshly read content — all-or-nothing, single use;
//! 3. read the state the write is about to change;
//! 4. run the planned command;
//! 5. **read the state back** and report what is actually true. A non-zero exit is not
//!    evidence that nothing happened: the outcome is `failed` only when the read-back
//!    proves HEAD and the index are unchanged, and `unknown` otherwise — never
//!    `succeeded`, and never retried.
//!
//! The read-back is what makes a commit that exists while its command reported failure
//! visible as "the commit exists and Git complained" rather than as a failure, and what
//! stops a dropped connection from being reported as a clean no-op.

pub mod commit;
pub mod stage;

use std::sync::Arc;

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};
use refyard_contract::reads::OperationResult;
use refyard_core::outcome::{ExecutionState, RunOutcome, TerminationReason};
use refyard_core::parse::status::{StatusRecord, StatusRecordKind};
use refyard_core::plan::GitPlan;

use crate::files::preview::{PreviewCheck, PreviewStore};
use crate::jobs::journal::EffectOutcome;
use crate::jobs::{MutationEffect, MutationRequest};
use crate::paths::PathRegistry;
use crate::providers::GitExecutor;
use crate::reads::status::{read_write_facts, WriteFacts};
use crate::registry::{RepositoryRecord, RepositoryRegistry};
use crate::targets::{TargetRecord, TargetRegistry};

/// The most paths one path-scoped write may name, from `LIMITS.pathSelectionMaxEntries`.
pub const PATH_SELECTION_MAX_ENTRIES: usize = 1_000;

/// The host pieces a write needs.
///
/// The same registries and stores the read path uses, handed over as clonable handles so
/// an effect can run detached from the service that accepted it. Nothing here is a second
/// cache: a path id is resolved in the registry a read minted it in, and a preview token
/// is redeemed in the store a preview issued it from.
#[derive(Debug)]
pub struct WriteHost {
    targets: TargetRegistry,
    repositories: Arc<RepositoryRegistry>,
    paths: Arc<PathRegistry>,
    previews: Arc<PreviewStore>,
}

/// One request resolved to the place Git will run.
#[derive(Debug)]
pub struct WriteTarget {
    pub record: RepositoryRecord,
    pub executor: GitExecutor,
    pub worktree_id: String,
}

/// One path id resolved to the bytes it was minted for.
#[derive(Debug)]
pub struct ResolvedPath {
    pub path_id: String,
    pub bytes: Vec<u8>,
}

impl WriteHost {
    pub fn new(
        targets: TargetRegistry,
        repositories: Arc<RepositoryRegistry>,
        paths: Arc<PathRegistry>,
        previews: Arc<PreviewStore>,
    ) -> Self {
        Self {
            targets,
            repositories,
            paths,
            previews,
        }
    }

    /// The three effects this build registers, in the order the contract lists them.
    pub fn effects(host: &Arc<Self>) -> Vec<Box<dyn MutationEffect>> {
        vec![
            Box::new(stage::StageEffect {
                host: Arc::clone(host),
            }),
            Box::new(stage::UnstageEffect {
                host: Arc::clone(host),
            }),
            Box::new(commit::CommitEffect {
                host: Arc::clone(host),
            }),
        ]
    }

    /// The registered repository, or the same refusal the reads give.
    pub fn require_record(&self, repository_id: &str) -> Result<RepositoryRecord, Problem> {
        self.repositories.get(repository_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!("unknown repository {repository_id}"),
            )
        })
    }

    /// The target a repository's reads run through, refusing one whose target was
    /// disconnected or rebuilt to a new generation.
    pub fn target_for(&self, record: &RepositoryRecord) -> Result<TargetRecord, Problem> {
        let target = self.targets.get(&record.location.target_id).ok_or_else(|| {
            Problem::new(
                ProblemCode::NotFound,
                format!(
                    "repository {} was opened on target {} and that target is no longer connected; open the repository again",
                    record.repository_id, record.location.target_id
                ),
            )
        })?;
        if target.generation != record.location.target_generation {
            return Err(Problem::new(
                ProblemCode::StaleSnapshot,
                format!(
                    "repository {} was opened on an earlier build of target {}; open the repository again",
                    record.repository_id, record.location.target_id
                ),
            )
            .with_detail(
                "targetGeneration",
                DetailValue::Text(target.generation.clone()),
            ));
        }
        Ok(target)
    }

    /// Resolves a request to the repository, target and worktree it addresses.
    pub fn resolve(&self, request: &MutationRequest) -> Result<WriteTarget, Problem> {
        let repository_id = request.repository_id().ok_or_else(|| {
            Problem::new(
                ProblemCode::InvalidRequest,
                "this operation must target a repository or a worktree",
            )
        })?;
        self.resolve_ids(repository_id, request.worktree_id())
    }

    /// The same resolution, for a caller that names the repository and worktree directly
    /// (the preview redemption a client may perform before submitting a stage).
    pub fn resolve_ids(
        &self,
        repository_id: &str,
        worktree_id: Option<&str>,
    ) -> Result<WriteTarget, Problem> {
        let record = self.require_record(repository_id)?;
        if record.layout.is_bare {
            return Err(Problem::new(
                ProblemCode::UnsupportedOperation,
                format!(
                    "{} is a bare repository: it has no working tree, so this build refuses to write to it. Its refs and history can still be read.",
                    record.display_path
                ),
            ));
        }
        let target = self.target_for(&record)?;
        let worktree_id = crate::reads::require_worktree(&record, worktree_id)
            .map_err(|error| error.to_problem())?;
        let executor = target.executor()?.clone();
        Ok(WriteTarget {
            record,
            executor,
            worktree_id,
        })
    }

    /// Resolves every selected path id to the bytes it was minted for.
    ///
    /// All-or-nothing: one id this worktree never minted — or one whose bytes cannot be
    /// executed on this host — refuses the batch, because a partially addressed write
    /// would leave the index holding half of what the user selected.
    pub fn resolve_paths(
        &self,
        target: &WriteTarget,
        path_ids: &[String],
    ) -> Result<Vec<ResolvedPath>, Problem> {
        let mut resolved = Vec::with_capacity(path_ids.len());
        for path_id in path_ids {
            let bytes = self
                .paths
                .resolve_in(
                    &target.worktree_id,
                    &target.record.location.target_generation,
                    path_id,
                )
                .ok_or_else(|| {
                    Problem::new(
                        ProblemCode::NotFound,
                        "a selected path is unknown in this worktree; reload the status and retry",
                    )
                    .with_detail("pathId", DetailValue::Text(path_id.clone()))
                })?;
            if bytes.contains(&0) {
                return Err(Problem::new(
                    ProblemCode::UnsupportedPathEncoding,
                    "a selected path's bytes cannot be represented exactly on this host, so the whole batch is refused",
                )
                .with_detail("pathId", DetailValue::Text(path_id.clone())));
            }
            resolved.push(ResolvedPath {
                path_id: path_id.clone(),
                bytes,
            });
        }
        Ok(resolved)
    }

    /// Re-reads the selected paths and spends the tokens they were given.
    ///
    /// All-or-nothing: one stale entry leaves every token unused, so a refused batch can
    /// be resubmitted after a fresh preview without re-previewing paths that never moved.
    pub async fn redeem_previews(
        &self,
        target: &WriteTarget,
        selected: &[ResolvedPath],
        preview_tokens: &[String],
    ) -> Result<(), Problem> {
        if selected.len() != preview_tokens.len() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                "one preview token is required per selected path",
            ));
        }
        let mut checks = Vec::with_capacity(selected.len());
        for (index, path) in selected.iter().enumerate() {
            let read = crate::files::read_through(
                &target.executor,
                target.record.location.canonical_worktree.as_str(),
                &path.bytes,
            )
            .await;
            checks.push(PreviewCheck {
                preview_token: preview_tokens[index].clone(),
                repository_id: target.record.repository_id.clone(),
                worktree_id: target.worktree_id.clone(),
                target_generation: target.record.location.target_generation.clone(),
                path_id: path.path_id.clone(),
                current_fingerprint_hex: read.fingerprint_hex(),
            });
        }
        self.previews
            .redeem(&checks)
            .map_err(|refusal| refusal.problem(None))
    }

    /// Resolves a batch of path ids and redeems its tokens: the whole pre-write check,
    /// for a caller that holds ids and tokens without having built a mutation request
    /// (the preview redemption a client performs before it submits).
    pub async fn redeem_submission(
        &self,
        repository_id: &str,
        worktree_id: &str,
        path_ids: &[String],
        preview_tokens: &[String],
    ) -> Result<(), Problem> {
        let target = self.resolve_ids(repository_id, Some(worktree_id))?;
        let selected = self.resolve_paths(&target, path_ids)?;
        self.redeem_previews(&target, &selected, preview_tokens)
            .await
    }

    /// The state a write is about to change, read through its own executor.
    pub async fn read_facts(&self, target: &WriteTarget) -> Result<WriteFacts, Problem> {
        read_write_facts(&target.executor, &target.record)
            .await
            .map_err(|error| error.to_problem())
    }
}

/// What a write command's outcome may be judged against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Postcondition {
    /// The index may legitimately be unchanged (staging an already-staged path is a
    /// no-op that Git reports as success).
    IndexMayBeUnchanged,
    /// A commit must move HEAD. Git reporting success without one is a state nobody can
    /// account for, and never a success to report.
    HeadMustMove,
}

/// What one write command's outcome was, after the read-back.
#[derive(Debug)]
pub enum Verdict {
    Succeeded {
        new_head_oid: Option<String>,
    },
    /// The read-back proves nothing moved, and this is why Git refused.
    Failed {
        problem: Problem,
    },
    /// The commit exists and Git complained after writing it.
    NeedsAttention {
        problem: Problem,
    },
    /// The repository may have moved in a way nobody can account for. It is never retried.
    Unknown {
        reason: String,
        problem: Problem,
    },
}

/// Classifies one finished write against the state read before and after it.
///
/// `after` is `None` when the read-back itself failed. That is never "nothing happened":
/// without a read-back there is no evidence either way, and the honest answer is `unknown`
/// (except for a command that provably never started).
pub fn classify_write(
    command: &'static str,
    postcondition: Postcondition,
    outcome: &RunOutcome,
    before: &WriteFacts,
    after: Option<&WriteFacts>,
) -> Verdict {
    if outcome.state == ExecutionState::NotStarted {
        // No process existed, so no state can have changed; the diagnostic is the reason
        // the host could not start it.
        return Verdict::Failed {
            problem: refusal_problem(command, outcome),
        };
    }
    let clean = outcome.state == ExecutionState::Completed
        && outcome.output_complete
        && outcome.exit_code == Some(0);
    let head_moved = after
        .map(|facts| facts.head.oid != before.head.oid)
        .unwrap_or(false);
    let index_moved = after
        .map(|facts| facts.index_key != before.index_key)
        .unwrap_or(false);

    if clean {
        return match postcondition {
            Postcondition::IndexMayBeUnchanged => Verdict::Succeeded {
                new_head_oid: after.and_then(|facts| facts.head.oid.clone()),
            },
            Postcondition::HeadMustMove => {
                if head_moved {
                    Verdict::Succeeded {
                        new_head_oid: after.and_then(|facts| facts.head.oid.clone()),
                    }
                } else {
                    Verdict::Unknown {
                        reason: "git reported success but the head did not move".to_string(),
                        problem: unknown_problem(
                            command,
                            "git reported success but HEAD did not move after the commit; the repository was re-read and the commit cannot be found, so whether anything was written is not known",
                        ),
                    }
                }
            }
        };
    }

    if head_moved {
        return match postcondition {
            // A commit that exists but whose command complained — a post-commit hook that
            // failed, a signer that printed a warning and exited non-zero. The commit is
            // real, so this is not `unknown`; the complaint is kept for the user.
            Postcondition::HeadMustMove => Verdict::NeedsAttention {
                problem: Problem::new(
                    ProblemCode::NeedsAttention,
                    format!(
                        "the commit exists ({}) but git exited with a complaint: {}",
                        after.and_then(|facts| facts.head.oid.clone()).unwrap_or_default(),
                        diagnostic_of(outcome)
                    ),
                ),
            },
            // Staging does not move HEAD. If it did, something else ran, and only
            // `unknown` is honest about whether the index also moved.
            Postcondition::IndexMayBeUnchanged => Verdict::Unknown {
                reason: format!("{command} moved HEAD, which it cannot do"),
                problem: unknown_problem(
                    command,
                    "HEAD moved while a path operation ran; the repository was re-read and whether the index change completed is not known",
                ),
            },
        };
    }

    if after.is_some() && !index_moved {
        // The read-back is the evidence: the index is byte-for-byte what it was, so Git
        // refused without leaving anything behind.
        return Verdict::Failed {
            problem: refusal_problem(command, outcome),
        };
    }

    Verdict::Unknown {
        reason: format!(
            "{} did not report a clean result and the index changed ({})",
            command,
            if after.is_some() {
                "the repository was re-read".to_string()
            } else {
                "and the repository could not be re-read".to_string()
            }
        ),
        problem: unknown_problem(
            command,
            "git did not report a clean result and the index changed; whether the operation completed is not known, and nothing was retried",
        ),
    }
}

/// The refusal a failed command carries, with the read-back stated as its evidence.
fn refusal_problem(command: &'static str, outcome: &RunOutcome) -> Problem {
    let unchanged = "; the index and HEAD were re-read and are unchanged";
    let (code, message) = match (outcome.state, outcome.termination) {
        (ExecutionState::NotStarted, _) => (
            ProblemCode::Unavailable,
            format!("{command} could not be started"),
        ),
        (ExecutionState::Interrupted, Some(TerminationReason::Timeout)) => (
            ProblemCode::Timeout,
            format!("{command} did not finish within its deadline{unchanged}"),
        ),
        (ExecutionState::Interrupted, _) => (
            ProblemCode::Cancelled,
            format!("{command} was cancelled before it finished{unchanged}"),
        ),
        (ExecutionState::Unknown, _) => (
            ProblemCode::GitCommandFailed,
            format!("{command} ended without a reportable status{unchanged}"),
        ),
        (ExecutionState::Completed, _) if !outcome.output_complete => (
            ProblemCode::LimitExceeded,
            format!("{command} produced more output than the host will hold{unchanged}"),
        ),
        (ExecutionState::Completed, _) => {
            let diagnostic = diagnostic_of(outcome);
            let message = if diagnostic.trim().is_empty() {
                format!(
                    "git refused the operation (exit {}){unchanged}",
                    outcome
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                )
            } else {
                format!("git refused the operation: {diagnostic}{unchanged}")
            };
            (ProblemCode::GitCommandFailed, message)
        }
    };
    let mut problem = Problem::new(code, message);
    let diagnostic = diagnostic_of(outcome);
    if !diagnostic.is_empty() {
        problem = problem.with_detail("diagnostic", DetailValue::Text(diagnostic));
    }
    problem
}

/// The reason an outcome is unknown, in the one vocabulary the journal keeps.
fn unknown_problem(command: &'static str, message: &str) -> Problem {
    Problem::new(
        ProblemCode::UncertainOutcome,
        format!("{command}: {message}"),
    )
}

/// Git's diagnostic text, bounded for the wire.
fn diagnostic_of(outcome: &RunOutcome) -> String {
    String::from_utf8_lossy(&outcome.stderr)
        .trim_end()
        .chars()
        .take(500)
        .collect()
}

/// The result a successful write reports: re-read facts, not Git's stdout text.
pub fn result_of(
    summary: String,
    changed_paths: Option<u64>,
    new_head_oid: Option<String>,
) -> OperationResult {
    OperationResult {
        summary,
        changed_refs: Vec::new(),
        changed_paths,
        snapshot_invalidated: true,
        new_head_oid,
    }
}

/// Turns a verdict into the outcome the journal records.
pub fn effect_outcome(
    verdict: Verdict,
    summary: String,
    changed_paths: Option<u64>,
) -> EffectOutcome {
    match verdict {
        Verdict::Succeeded { new_head_oid } => EffectOutcome::Succeeded {
            result: result_of(summary, changed_paths, new_head_oid),
        },
        Verdict::Failed { problem } => EffectOutcome::Failed { problem },
        Verdict::NeedsAttention { problem } => EffectOutcome::NeedsAttention { problem },
        Verdict::Unknown { reason, problem } => EffectOutcome::Unknown { reason, problem },
    }
}

/// The selected paths, in order and deduplicated.
///
/// Nothing else: an unstage acts on exactly what the caller selected. Git restores each
/// entry from HEAD independently, so adding a rename's origin here would act on a path the
/// user never named.
pub(crate) fn selected_paths(selected: &[ResolvedPath]) -> Vec<Vec<u8>> {
    let mut paths: Vec<Vec<u8>> = Vec::with_capacity(selected.len());
    for path in selected {
        if !paths.contains(&path.bytes) {
            paths.push(path.bytes.clone());
        }
    }
    paths
}

/// The paths a stage plans over: the selected paths plus, when it can be addressed, the
/// origin of every selected rename or copy.
///
/// A rename the index holds is one change, and staging only the destination would leave the
/// index holding the file *and* the old entry — which the next commit records as a copy plus
/// a deletion. The origin comes from the status record the read-back just produced, the same
/// bytes Git reported, and it travels the same way the selected paths do.
///
/// **The origin is included only when Git itself still reports it.** `git add` refuses a
/// pathspec that matches neither the index nor the working tree — for a rename the index has
/// already absorbed, the origin is in neither, and naming it fails the whole batch with
/// `pathspec 'a.txt' did not match any files`. The reference's rule as written does name it
/// there; measured against Git, that turns "stage this file's edit" into a failure for the
/// most ordinary rename state there is (`git mv` then edit), so the port keeps the rule
/// wherever it can act and omits an origin that would only be refused. Nothing is left
/// unstaged by that: an origin with no status record has no change to stage.
pub(crate) fn stage_paths(selected: &[ResolvedPath], records: &[StatusRecord]) -> Vec<Vec<u8>> {
    let mut paths = selected_paths(selected);
    for path in selected {
        let Some(record) = records.iter().find(|record| record.path == path.bytes) else {
            continue;
        };
        if !matches!(
            record.kind,
            StatusRecordKind::Renamed | StatusRecordKind::Copied
        ) {
            continue;
        }
        let Some(original) = &record.original_path else {
            continue;
        };
        let addressable = records.iter().any(|record| record.path == *original);
        if addressable && !paths.contains(original) {
            paths.push(original.clone());
        }
    }
    paths
}

/// The plan an unstage runs, chosen by the HEAD the read-back found.
///
/// An unborn branch has no HEAD to restore the index from, so it removes the entries
/// instead; the two plans are different commands rather than one with a flag, because
/// inferring the difference is how a repository with no commits gets an empty index and a
/// deleted working tree.
pub(crate) fn unstage_plan(head_is_unborn: bool, paths: &[Vec<u8>]) -> GitPlan {
    if head_is_unborn {
        refyard_core::plan::paths::plan_unstage_unborn(paths)
    } else {
        refyard_core::plan::paths::plan_unstage(paths)
    }
}

/// The outcome for a payload the engine should not have dispatched to this effect.
pub(crate) fn wrong_payload(operation_id: &str, kind: &str) -> EffectOutcome {
    EffectOutcome::Failed {
        problem: Problem::new(
            ProblemCode::InvalidOperationPayload,
            format!("the operation dispatched to the {kind} effect was not a {kind} payload"),
        )
        .for_operation(operation_id.to_string()),
    }
}

/// An invalid-payload outcome, with the operation named.
pub(crate) fn invalid_payload(operation_id: &str, message: String) -> EffectOutcome {
    EffectOutcome::Failed {
        problem: Problem::new(ProblemCode::InvalidOperationPayload, message)
            .for_operation(operation_id.to_string()),
    }
}

/// A refusal that happened before anything ran, with the operation named.
pub(crate) fn refused(operation_id: &str, problem: Problem) -> EffectOutcome {
    EffectOutcome::Failed {
        problem: problem.for_operation(operation_id.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::{HeadKind, HeadState};
    use refyard_core::outcome::ExecutionState;

    fn head(oid: Option<&str>) -> HeadState {
        HeadState {
            kind: if oid.is_some() {
                HeadKind::Born
            } else {
                HeadKind::Unborn
            },
            branch_name: Some("main".to_string()),
            oid: oid.map(str::to_string),
            detached: false,
        }
    }

    fn facts(oid: Option<&str>, index_key: &str) -> WriteFacts {
        WriteFacts {
            head: head(oid),
            index_key: index_key.to_string(),
            records: Vec::new(),
        }
    }

    fn completed(exit_code: i32) -> RunOutcome {
        RunOutcome {
            state: ExecutionState::Completed,
            exit_code: Some(exit_code),
            stdout: Vec::new(),
            stderr: b"a diagnostic\n".to_vec(),
            output_complete: true,
            termination: None,
        }
    }

    fn resolved(name: &str, path_id: &str) -> ResolvedPath {
        ResolvedPath {
            path_id: path_id.to_string(),
            bytes: name.as_bytes().to_vec(),
        }
    }

    fn rename_record(from: &str, to: &str) -> StatusRecord {
        StatusRecord {
            kind: StatusRecordKind::Renamed,
            index_status: "R".to_string(),
            worktree_status: ".".to_string(),
            submodule_field: "N...".to_string(),
            mode_head: Some("100644".to_string()),
            mode_index: Some("100644".to_string()),
            mode_worktree: Some("100644".to_string()),
            oid_head: Some("aa".to_string()),
            oid_index: Some("aa".to_string()),
            path: to.as_bytes().to_vec(),
            original_path: Some(from.as_bytes().to_vec()),
            score: Some(100),
            stages: Vec::new(),
            submodule_commit_changed: false,
            submodule_modified: false,
            submodule_untracked: false,
        }
    }

    #[test]
    fn a_stage_names_a_renames_origin_only_when_git_still_reports_that_origin() {
        // Prevents: `git add` being handed a path that matches neither the index nor the
        // working tree, which fails the whole batch — measured against Git for a rename
        // the index already holds (`git mv`, then an edit).
        let selected = vec![resolved("renamed.txt", "path_1")];
        let record = rename_record("a.txt", "renamed.txt");
        assert_eq!(
            stage_paths(&selected, std::slice::from_ref(&record)),
            vec![b"renamed.txt".to_vec()],
            "the absorbed origin is not addressable and must not be named"
        );
        // The same rename while the origin still exists as its own change: the reference's
        // rule applies and both paths travel together.
        let origin = StatusRecord {
            oid_index: None,
            ..record.clone()
        };
        let mut origin = origin;
        origin.path = b"a.txt".to_vec();
        origin.original_path = None;
        origin.worktree_status = "M".to_string();
        assert_eq!(
            stage_paths(&selected, &[record, origin]),
            vec![b"renamed.txt".to_vec(), b"a.txt".to_vec()]
        );
    }

    #[test]
    fn an_unstage_names_exactly_the_selected_paths() {
        // An unstage restores each index entry from HEAD, so naming a rename's origin
        // would act on a path the caller never selected.
        let selected = vec![
            resolved("renamed.txt", "path_1"),
            resolved("b.txt", "path_2"),
        ];
        assert_eq!(
            selected_paths(&selected),
            vec![b"renamed.txt".to_vec(), b"b.txt".to_vec()]
        );
        assert_eq!(
            selected_paths(&selected),
            selected_paths(&selected),
            "the order is the caller's, not a set's"
        );
    }

    #[test]
    fn a_clean_success_is_a_success_for_a_stage_even_when_nothing_moved() {
        // Staging an already-staged path is a no-op Git reports as success.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &completed(0),
            &before,
            Some(&facts(Some("aa"), "key-1")),
        );
        assert!(matches!(verdict, Verdict::Succeeded { .. }), "{verdict:?}");
    }

    #[test]
    fn a_commit_that_reports_success_without_moving_head_is_unknown() {
        // Prevents: a commit reported as succeeded on Git's word alone — the read-back is
        // the evidence, and it found no commit.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git commit",
            Postcondition::HeadMustMove,
            &completed(0),
            &before,
            Some(&facts(Some("aa"), "key-2")),
        );
        match verdict {
            Verdict::Unknown { reason, .. } => assert!(reason.contains("head did not move")),
            other => panic!("expected unknown, got {other:?}"),
        }
    }

    #[test]
    fn a_non_zero_exit_with_an_unchanged_index_is_a_failure_and_never_unknown() {
        // Prevents: a hook refusal reported as "we cannot know what happened" when the
        // read-back proves nothing happened — and the reverse, a failure claimed for a
        // command that did write.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git commit",
            Postcondition::HeadMustMove,
            &completed(1),
            &before,
            Some(&facts(Some("aa"), "key-1")),
        );
        match verdict {
            Verdict::Failed { problem } => {
                assert_eq!(problem.code, ProblemCode::GitCommandFailed);
                assert!(problem.message.contains("a diagnostic"));
                assert!(problem.message.contains("unchanged"));
            }
            other => panic!("expected failed, got {other:?}"),
        }
    }

    #[test]
    fn a_non_zero_exit_after_the_index_moved_is_unknown() {
        // Prevents: "git exited non-zero, so nothing happened" when the index has in fact
        // changed — a hook that staged something and then failed.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &completed(1),
            &before,
            Some(&facts(Some("aa"), "key-2")),
        );
        assert!(matches!(verdict, Verdict::Unknown { .. }), "{verdict:?}");
    }

    #[test]
    fn a_commit_that_landed_while_git_complained_needs_attention() {
        // The read-back found the commit: this is a known outcome with a complaint, not a
        // failure and not an unknown one.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git commit",
            Postcondition::HeadMustMove,
            &completed(1),
            &before,
            Some(&facts(Some("bb"), "key-2")),
        );
        match verdict {
            Verdict::NeedsAttention { problem } => {
                assert_eq!(problem.code, ProblemCode::NeedsAttention);
                assert!(problem.message.contains("bb"), "the commit is named");
            }
            other => panic!("expected needsAttention, got {other:?}"),
        }
    }

    #[test]
    fn a_command_that_never_started_failed_without_a_read_back() {
        let before = facts(Some("aa"), "key-1");
        let outcome = RunOutcome::not_started("ssh could not be started");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &outcome,
            &before,
            None,
        );
        match verdict {
            Verdict::Failed { problem } => assert_eq!(problem.code, ProblemCode::Unavailable),
            other => panic!("expected failed, got {other:?}"),
        }
    }

    #[test]
    fn without_a_read_back_a_non_zero_exit_is_unknown_and_never_failed() {
        // Prevents: claiming "nothing happened" when nothing could be read back.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &completed(1),
            &before,
            None,
        );
        assert!(matches!(verdict, Verdict::Unknown { .. }), "{verdict:?}");
    }

    #[test]
    fn an_interrupted_command_whose_read_back_is_unchanged_is_a_typed_failure() {
        // A timeout with the index byte-for-byte what it was: the evidence says nothing
        // happened, so the caller gets the reason rather than an open-ended "unknown".
        let before = facts(Some("aa"), "key-1");
        let mut outcome = completed(0);
        outcome.state = ExecutionState::Interrupted;
        outcome.exit_code = None;
        outcome.termination = Some(TerminationReason::Timeout);
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &outcome,
            &before,
            Some(&facts(Some("aa"), "key-1")),
        );
        match verdict {
            Verdict::Failed { problem } => assert_eq!(problem.code, ProblemCode::Timeout),
            other => panic!("expected a timeout failure, got {other:?}"),
        }
    }

    #[test]
    fn a_failed_stage_that_moved_head_is_unknown_rather_than_a_failure() {
        // Staging does not move HEAD. If a command that failed did move it — a hook that
        // committed while the index was being written — then whether the staging also
        // completed is not knowable, and `failed` would claim nothing happened.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &completed(1),
            &before,
            Some(&facts(Some("bb"), "key-2")),
        );
        assert!(matches!(verdict, Verdict::Unknown { .. }), "{verdict:?}");
    }

    #[test]
    fn a_clean_stage_records_the_head_the_read_back_found() {
        // A clean exit is Git's own word that the stage happened, and the result names the
        // HEAD that is true now — never a HEAD the command printed or the caller assumed.
        let before = facts(Some("aa"), "key-1");
        let verdict = classify_write(
            "git add",
            Postcondition::IndexMayBeUnchanged,
            &completed(0),
            &before,
            Some(&facts(Some("bb"), "key-2")),
        );
        match verdict {
            Verdict::Succeeded { new_head_oid } => {
                assert_eq!(new_head_oid.as_deref(), Some("bb"))
            }
            other => panic!("expected succeeded, got {other:?}"),
        }
    }
}
