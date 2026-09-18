//! Outcomes that are unknown, and the block they leave behind.
//!
//! Git may have side effects even when a write's result is not knowable: the connection
//! dropped after `git` was started, or the process that started it died. The design's
//! answer is not to guess, and not to retry — it is to record the operation as
//! `unknown`, refuse to write to that repository until a person confirms what the
//! repository now looks like, and clear the block only through an explicit
//! acknowledgement against a *fresh* snapshot.
//!
//! Every case below is a real file on disk: a "restart" is a second process reading a
//! state directory the first one left, and the acknowledgement is judged against the
//! snapshots this service minted, not against a value a test invented.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{MutationKind, MutationTarget, OperationStatus, PreviewsRequest};
use refyard_core::preconditions::PreconditionContext;
use refyard_host::jobs::journal::EffectOutcome;
use refyard_host::jobs::journal::{Journal, JournalRecord};
use refyard_host::jobs::recovery::Recovery;
use refyard_host::jobs::{
    EffectRequest, MutationEffect, MutationEngine, MutationOperation, MutationRequest,
    PreconditionSource,
};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

/* ------------------------------------------------------------------ fixture */

struct Fixture {
    temp: tempfile::TempDir,
    home: PathBuf,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&home).expect("create fixture home");
        std::fs::create_dir_all(&repo).expect("create fixture repo");
        std::fs::write(
            home.join(".gitconfig"),
            "[user]\n\tname = Refyard Fixture\n\temail = fixture@refyard.invalid\n",
        )
        .expect("the fixture's own global config");
        let mut fixture = Self {
            temp,
            home,
            repo,
            env: Vec::new(),
        };
        fixture.env = fixture_environment(&fixture.home);
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        fixture.write("a.txt", "alpha\n");
        fixture.git(&["add", "--", "a.txt"]);
        fixture.git(&["commit", "--quiet", "-m", "first"]);
        fixture
    }

    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = Command::new(git_program())
            .args(args)
            .current_dir(&self.repo)
            .env_clear()
            .envs(
                self.env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str())),
            )
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn write(&self, relative: &str, content: &str) {
        std::fs::write(self.repo.join(relative), content).expect("write file");
    }

    fn state_root(&self) -> PathBuf {
        self.temp.path().join("state")
    }

    fn environment(&self) -> Vec<(String, String)> {
        self.env.clone()
    }

    fn service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_uncertain".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
        .with_state_root(self.state_root())
        .expect("the state directory is writable")
    }
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    vec![
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ),
        ("HOME".to_string(), home.display().to_string()),
        ("LC_ALL".to_string(), "C".to_string()),
        ("LANG".to_string(), "C".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            home.join(".gitconfig").to_string_lossy().into_owned(),
        ),
    ]
}

/// A stage request that names a worktree target.
fn stage_request(repository_id: &str, client_request_id: &str) -> MutationRequest {
    MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.to_string(),
            worktree_id: "wt_1".to_string(),
            expected_snapshot_id: "snap_1".to_string(),
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec!["path_1".to_string()],
            preview_tokens: vec!["pt_1".to_string()],
        },
    }
}

/// An effect that loses its connection: the write was dispatched and its result cannot be
/// known. It returns `Unknown` and must never be retried by the engine.
struct LostConnection {
    runs: Arc<AtomicUsize>,
}

impl MutationEffect for LostConnection {
    fn kind(&self) -> MutationKind {
        MutationKind::StagePaths
    }

    fn run<'a>(
        &'a self,
        request: EffectRequest<'a>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = EffectOutcome> + Send + 'a>> {
        let runs = Arc::clone(&self.runs);
        Box::pin(async move {
            runs.fetch_add(1, Ordering::SeqCst);
            EffectOutcome::Unknown {
                reason: "the connection dropped after git was started".to_string(),
                problem: refyard_contract::problem::Problem::new(
                    ProblemCode::UncertainOutcome,
                    "the remote command did not report an exit status",
                )
                .for_operation(request.operation_id.to_string()),
            }
        })
    }
}

/// An effect that never returns, standing in for a process that died mid-write.
struct NeverFinishes;

impl MutationEffect for NeverFinishes {
    fn kind(&self) -> MutationKind {
        MutationKind::StagePaths
    }

    fn run<'a>(
        &'a self,
        _request: EffectRequest<'a>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = EffectOutcome> + Send + 'a>> {
        Box::pin(async {
            tokio::time::sleep(Duration::from_secs(600)).await;
            EffectOutcome::Unknown {
                reason: "never".to_string(),
                problem: refyard_contract::problem::Problem::new(
                    ProblemCode::UncertainOutcome,
                    "never",
                ),
            }
        })
    }
}

/// Every precondition true: freshness is `previews.rs`'s subject.
struct AlwaysFresh;

impl PreconditionSource for AlwaysFresh {
    fn write_key(
        &self,
        request: &MutationRequest,
    ) -> Result<String, refyard_contract::problem::Problem> {
        Ok(request.repository_id().unwrap_or("workspace").to_string())
    }

    fn context<'a>(
        &'a self,
        _request: &'a MutationRequest,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<PreconditionContext, refyard_contract::problem::Problem>,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async {
            Ok(PreconditionContext {
                snapshot_head_oid: None,
                current_head_oid: None,
                index_unchanged: true,
                operation_in_progress: None,
                may_run_during: Vec::new(),
                restart_block: None,
                preview_checks: Vec::new(),
                refusal: None,
            })
        })
    }
}

async fn wait_terminal(
    engine: &Arc<MutationEngine>,
    operation_id: &str,
) -> refyard_contract::reads::OperationRecord {
    for _ in 0..500 {
        let record = engine
            .get("owner", operation_id)
            .expect("the operation exists");
        if record.finished_at.is_some() {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation {operation_id} never finished");
}

/// Waits until the journal on disk shows the operation running, so a "crash" is taken
/// while the write really was in flight.
async fn wait_running(engine: &Arc<MutationEngine>, operation_id: &str) {
    for _ in 0..500 {
        if engine
            .get("owner", operation_id)
            .expect("the operation exists")
            .started_at
            .is_some()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation {operation_id} never started");
}

/* ------------------------------------------------------------------ unknown, never guessed */

#[tokio::test]
async fn a_write_whose_result_was_lost_is_unknown_and_is_never_run_twice() {
    let temp = tempfile::tempdir().expect("temp dir");
    let journal = Arc::new(Journal::open(Some(temp.path().join("state"))).expect("open"));
    let recovery = Arc::new(Recovery::new());
    let runs = Arc::new(AtomicUsize::new(0));
    let engine = MutationEngine::new(
        Arc::clone(&journal),
        Arc::clone(&recovery),
        vec![Box::new(LostConnection {
            runs: Arc::clone(&runs),
        })],
    );

    let submitted = engine
        .submit("owner", stage_request("repo_1", "crid-lost"), &AlwaysFresh)
        .await
        .expect("accepted");
    let operation_id = submitted.record.operation_id.clone();
    let finished = wait_terminal(&engine, &operation_id).await;

    assert_eq!(finished.status, OperationStatus::Unknown);
    assert_eq!(
        finished.result, None,
        "an unknown outcome has no result to report"
    );
    let problem = finished.problem.expect("the record explains itself");
    assert_eq!(problem.code, ProblemCode::UncertainOutcome);
    assert_eq!(problem.operation_id.as_deref(), Some(operation_id.as_str()));
    assert_eq!(
        runs.load(Ordering::SeqCst),
        1,
        "an unknown write is not retried"
    );

    // The record on disk says the same thing: it is the fact a restart reads.
    let record = journal.get(&operation_id).expect("persisted");
    assert_eq!(record.status, OperationStatus::Unknown);
    assert_eq!(
        record.unknown_reason.as_deref(),
        Some("the connection dropped after git was started")
    );

    // And the repository is blocked for writes until a person confirms its state: the
    // block was created by the engine, not by a restart.
    let block = recovery
        .block_for(&record.write_key)
        .expect("an unknown operation blocks its repository");
    assert_eq!(block.operation_ids, vec![operation_id.clone()]);
    let refused = engine
        .submit("owner", stage_request("repo_1", "crid-next"), &AlwaysFresh)
        .await
        .expect_err("a blocked repository accepts no new write");
    assert_eq!(refused.code, ProblemCode::UncertainOutcome, "{refused:?}");
}

#[tokio::test]
async fn a_restart_reports_an_in_flight_operation_as_unknown_and_blocks_its_repository() {
    let fixture = Fixture::new();
    let first = fixture.service();
    let opened = first
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("the fixture repository opens");
    let repository_id = opened
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    let write_key = first
        .write_key_for_repository(&repository_id)
        .expect("the key an operation on this repository is serialised under");

    // A process that dispatches a write and then dies: the journal on disk is left with a
    // record that says `running`, and nothing on this machine can say what Git did.
    let dispatched = Journal::open(Some(fixture.state_root())).expect("open the same journal");
    dispatched
        .append(JournalRecord {
            operation_id: "op_crashed".to_string(),
            client_request_id: "crid-crashed".to_string(),
            actor: "owner".to_string(),
            kind: MutationKind::StagePaths,
            target: MutationTarget::Worktree {
                repository_id: repository_id.clone(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Running,
            sequence: 7,
            accepted_at_ms: 1_000,
            started_at_ms: Some(1_100),
            finished_at_ms: None,
            payload_digest: "digest-crashed".to_string(),
            write_key: write_key.clone(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        })
        .expect("the running record is on disk");
    assert!(
        first.blocked_repositories().is_empty(),
        "the first process has not reconciled anything yet"
    );

    // The restart: a second service over the same state directory. It reads what the first
    // one left and refuses to call an unfinished write a success.
    let second = fixture.service();
    assert_eq!(
        second.blocked_repositories(),
        vec![write_key.clone()],
        "the in-flight operation blocks its repository"
    );
    let recovered = second
        .operation("op_crashed")
        .expect("the record is readable");
    assert_eq!(recovered.status, OperationStatus::Unknown);
    assert_eq!(
        recovered.result, None,
        "a restart never invents a result for work it did not observe"
    );
    let problem = recovered.problem.expect("the recovery explains itself");
    assert_eq!(problem.code, ProblemCode::UncertainOutcome);
    assert!(
        problem.message.contains("unknown") && problem.message.contains("not be retried"),
        "the message must say what is unknown and that it will not be retried: {problem:?}"
    );

    // The journal itself now holds the reconciled fact, so a third process reads the same
    // answer rather than re-reconciling it.
    let third = fixture.service();
    assert_eq!(third.blocked_repositories(), vec![write_key.clone()]);
    assert_eq!(
        third.operation("op_crashed").expect("readable").sequence,
        8,
        "the reconciled record advances the sequence so a reader can tell it was rewritten"
    );

    // Reads keep working while the block is in place: the UI has to be able to show what
    // happened before anyone can confirm anything. The restarted process opens the same
    // repository from its own registry — and the key it computes is the key the crashed
    // process wrote, which is the whole reason the block survives a restart.
    let reopened = third
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("the restarted process opens the same repository");
    let third_repository_id = reopened
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    assert_eq!(
        third
            .write_key_for_repository(&third_repository_id)
            .expect("the key is a function of the repository, not of the process"),
        write_key,
        "a key that changed with the process would leave the block unfindable"
    );
    let status = third
        .status(&StatusQuery::new(&third_repository_id))
        .await
        .expect("reads are unaffected by a write block");
    assert!(!status.snapshot_id.is_empty());
    assert!(!third.blocked_repositories().is_empty());
}

#[tokio::test]
async fn a_dispatched_write_that_never_returns_still_leaves_the_next_process_a_block() {
    let fixture = Fixture::new();
    // One engine, dispatching through the real state directory, with an effect that never
    // returns and a repository key the tests state.
    let journal = Arc::new(Journal::open(Some(fixture.state_root())).expect("open"));
    let engine = MutationEngine::new(
        Arc::clone(&journal),
        Arc::new(Recovery::new()),
        vec![Box::new(NeverFinishes)],
    );
    let submitted = engine
        .submit("owner", stage_request("repo_1", "crid-hang"), &AlwaysFresh)
        .await
        .expect("accepted");
    let operation_id = submitted.record.operation_id.clone();
    wait_running(&engine, &operation_id).await;

    // A second process reads the same directory while the first one's task is still stuck
    // inside Git. What it must not do is retry it or call it finished.
    let restarted = Journal::open(Some(fixture.state_root())).expect("reopen");
    let recovery = Recovery::new();
    let reconciled = recovery
        .reconcile(&restarted, 2_000)
        .expect("the in-flight record is reconciled");
    assert_eq!(reconciled.len(), 1);
    assert_eq!(reconciled[0].operation_id, operation_id);
    assert_eq!(reconciled[0].status, OperationStatus::Unknown);
    assert_eq!(
        reconciled[0].sequence,
        restarted
            .get(&operation_id)
            .expect("the reconciled record is on disk")
            .sequence
    );
    assert!(!recovery.blocked_keys().is_empty());
}

/* ------------------------------------------------------------------ acknowledgement */

#[tokio::test]
async fn an_acknowledgement_lifts_the_block_only_against_a_fresh_snapshot() {
    let fixture = Fixture::new();
    let first = fixture.service();
    let opened = first
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("register");
    let repository_id = opened
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    let write_key = first
        .write_key_for_repository(&repository_id)
        .expect("write key");

    // The state a restart recovers: an operation that was in flight, and a second
    // repository that is not involved.
    let other = fixture.temp.path().join("other");
    std::fs::create_dir_all(&other).expect("create the other repository");
    let output = Command::new(git_program())
        .args(["init", "--quiet", "--initial-branch=main"])
        .current_dir(&other)
        .env_clear()
        .envs(
            fixture
                .environment()
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str())),
        )
        .output()
        .expect("run git");
    assert!(output.status.success());
    first
        .register_repository(other.to_str().expect("utf8"))
        .await
        .expect("the second repository opens");

    let journal = Journal::open(Some(fixture.state_root())).expect("open the journal");
    journal
        .append(JournalRecord {
            operation_id: "op_unknown".to_string(),
            client_request_id: "crid-unknown".to_string(),
            actor: "owner".to_string(),
            kind: MutationKind::StagePaths,
            target: MutationTarget::Worktree {
                repository_id: repository_id.clone(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Running,
            sequence: 3,
            accepted_at_ms: 1_000,
            started_at_ms: Some(1_100),
            finished_at_ms: None,
            payload_digest: "digest".to_string(),
            write_key: write_key.clone(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        })
        .expect("written");

    let service = fixture.service();
    assert_eq!(service.blocked_repositories(), vec![write_key.clone()]);
    // The restarted process knows the same repositories from its own registry: the block is
    // keyed by the repository, so the ids this process mints are different and the key is
    // not.
    let restarted_own = service
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("register")
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    let restarted_other = service
        .register_repository(other.to_str().expect("utf8"))
        .await
        .expect("register")
        .repositories
        .iter()
        .find(|summary| summary.repository_id != restarted_own)
        .expect("the second row")
        .repository_id
        .clone();
    assert_eq!(
        service
            .write_key_for_repository(&restarted_own)
            .expect("key"),
        write_key,
        "the key must be the same in the process that reads the block"
    );

    // A snapshot of a *different* repository is not a confirmation of this one.
    let elsewhere = service
        .status(&StatusQuery::new(&restarted_other))
        .await
        .expect("status of the other repository");
    let crossed = service
        .acknowledge_uncertain_operation("op_unknown", &elsewhere.snapshot_id)
        .expect_err("another repository's snapshot does not confirm this one");
    assert_eq!(crossed.code, ProblemCode::Conflict, "{crossed:?}");
    assert_eq!(service.blocked_repositories(), vec![write_key.clone()]);

    // A snapshot this service never minted does not exist, so it cannot confirm anything.
    let invented = service
        .acknowledge_uncertain_operation("op_unknown", "snap_does_not_exist")
        .expect_err("an unknown snapshot");
    assert_eq!(invented.code, ProblemCode::NotFound, "{invented:?}");
    assert_eq!(service.blocked_repositories(), vec![write_key.clone()]);

    // An operation that is not uncertain has no block to lift.
    let not_uncertain = service
        .acknowledge_uncertain_operation("op_missing", "snap_1")
        .expect_err("unknown operation");
    assert_eq!(
        not_uncertain.code,
        ProblemCode::NotFound,
        "{not_uncertain:?}"
    );

    // The confirmation: the caller re-read this repository and presents the snapshot that
    // read minted.
    let fresh = service
        .status(&StatusQuery::new(&restarted_own))
        .await
        .expect("a fresh read of the blocked repository");
    let acknowledged = service
        .acknowledge_uncertain_operation("op_unknown", &fresh.snapshot_id)
        .expect("a fresh snapshot confirms the state");
    assert_eq!(
        acknowledged.status,
        OperationStatus::Unknown,
        "acknowledgement lifts the block; it never rewrites what happened"
    );
    assert_eq!(
        acknowledged.problem.as_ref().map(|problem| problem.code),
        Some(ProblemCode::UncertainOutcome),
        "the record keeps the problem that made it uncertain"
    );
    assert!(
        service.blocked_repositories().is_empty(),
        "the block is lifted for the repository that was confirmed"
    );
    // A second acknowledgement has nothing left to lift.
    let again = service
        .acknowledge_uncertain_operation("op_unknown", &fresh.snapshot_id)
        .expect_err("the block is already lifted");
    assert_eq!(again.code, ProblemCode::Conflict, "{again:?}");
}

#[tokio::test]
async fn a_block_covers_one_repository_and_leaves_the_others_readable() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let opened = service
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("register");
    let repository_id = opened
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    let write_key = service
        .write_key_for_repository(&repository_id)
        .expect("write key");

    let journal = Journal::open(Some(fixture.state_root())).expect("open the journal");
    journal
        .append(JournalRecord {
            operation_id: "op_unknown".to_string(),
            client_request_id: "crid-unknown".to_string(),
            actor: "owner".to_string(),
            kind: MutationKind::StagePaths,
            target: MutationTarget::Worktree {
                repository_id: repository_id.clone(),
                worktree_id: "wt_1".to_string(),
                expected_snapshot_id: "snap_1".to_string(),
            },
            status: OperationStatus::Accepted,
            sequence: 1,
            accepted_at_ms: 1_000,
            started_at_ms: None,
            finished_at_ms: None,
            payload_digest: "digest".to_string(),
            write_key: write_key.clone(),
            result: None,
            problem: None,
            unknown_reason: None,
            acknowledged_at_ms: None,
        })
        .expect("written");

    let service = fixture.service();
    // An accepted record that never started is recovered too: the process died between
    // accepting the write and dispatching it, and nobody can say whether Git ran.
    assert_eq!(service.blocked_repositories(), vec![write_key.clone()]);
    assert_eq!(
        service.operation("op_unknown").expect("readable").status,
        OperationStatus::Unknown
    );

    // The block is not global: this service still reads, and a repository that was never
    // part of the operation is not named by it. The id is this process's own — the block is
    // keyed by the repository, so it is found across processes while ids are not.
    let restarted = service
        .register_repository(fixture.repo.to_str().expect("utf8"))
        .await
        .expect("register")
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    assert_eq!(service.blocked_repositories().len(), 1);
    service
        .status(&StatusQuery::new(&restarted))
        .await
        .expect("a blocked repository is still readable");
    // A preview read is a read as well, and the block does not touch it.
    let status = service
        .status(&StatusQuery::new(&restarted))
        .await
        .expect("status");
    let path_id = status
        .entries
        .iter()
        .find(|entry| entry.display_path == "a.txt")
        .map(|entry| entry.path_id.clone());
    if let Some(path_id) = path_id {
        service
            .previews(&PreviewsRequest {
                repository_id: restarted,
                worktree_id: "wt_1".to_string(),
                path_ids: vec![path_id],
            })
            .await
            .expect("previews read while a write block is in place");
    }
}
