use std::collections::BTreeSet;
use std::path::Path;

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::HistoryQuery;
use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{
    EventPayload, FilesystemEntriesQuery, MutationKind, MutationTarget, PreviewsRequest,
};
use refyard_host::embed::{EmbedConfig, EmbedLimits, EmbeddedRefyard};
use refyard_host::events::SubscriberEvent;
use refyard_host::jobs::queue::QueueLimits;
use refyard_host::jobs::{MutationOperation, MutationRequest};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::StatusQuery;

fn limits() -> EmbedLimits {
    EmbedLimits {
        queue: QueueLimits::default(),
        structured_stdout_max_bytes: 16 * 1024 * 1024,
        stderr_diagnostic_max_bytes: 256 * 1024,
        event_ring_max_events: 1_024,
        event_ring_max_bytes: 1_048_576,
        repository_max_count: 128,
        output_max_bytes: 16 * 1024 * 1024,
    }
}

fn config(state_root: &Path) -> EmbedConfig {
    EmbedConfig {
        state_root: state_root.to_path_buf(),
        home: state_root.join("home"),
        git: std::env::var_os("REFYARD_EMBED_GIT")
            .map(|path| {
                LocalGit::at(
                    path,
                    vec![("PATH".to_string(), "/usr/bin:/bin".to_string())],
                )
            })
            .unwrap_or_else(|| LocalGit::discover().expect("git is installed")),
        limits: limits(),
        enabled_mutations: BTreeSet::new(),
        service_instance_id: "embed-test".to_string(),
        target_id: "target-local".to_string(),
        target_generation: "generation-1".to_string(),
    }
}

fn commit_request(client_request_id: &str) -> MutationRequest {
    MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: "repo_missing".to_string(),
            worktree_id: "worktree_missing".to_string(),
            expected_snapshot_id: "snapshot_missing".to_string(),
        },
        operation: MutationOperation::Commit {
            message: "test".to_string(),
        },
    }
}

#[test]
fn open_uses_only_explicit_state_root() {
    let first = tempfile::tempdir().expect("first root");
    let second = tempfile::tempdir().expect("second root");
    let mut first_config = config(first.path());
    first_config.home = first.path().join("home-that-must-not-be-state");
    let mut second_config = config(second.path());
    second_config.home = second.path().join("home-that-must-not-be-state");
    let first_host = EmbeddedRefyard::open(first_config).expect("first host");
    let second_host = EmbeddedRefyard::open(second_config).expect("second host");
    assert!(first.path().join("journal").exists());
    assert!(second.path().join("journal").exists());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for root in [first.path(), second.path()] {
            for path in [root, &root.join("journal"), &root.join("journal/records")] {
                assert_eq!(
                    std::fs::metadata(path)
                        .expect("metadata")
                        .permissions()
                        .mode()
                        & 0o777,
                    0o700
                );
            }
        }
    }
    assert_ne!(first.path(), second.path());
    drop(first_host);
    drop(second_host);
}

#[test]
fn resolved_git_is_stable_when_process_path_changes() {
    if std::env::var_os("REFYARD_EMBED_GIT_CHILD").is_some() {
        let root = tempfile::tempdir().expect("root");
        let mut cfg = config(root.path());
        cfg.git = LocalGit::at(
            std::env::var_os("REFYARD_EMBED_GIT").expect("git path"),
            vec![("PATH".to_string(), "/usr/bin:/bin".to_string())],
        );
        let host = EmbeddedRefyard::open(cfg).expect("host");
        assert!(host
            .capabilities()
            .expect("capabilities")
            .git
            .executable_display
            .ends_with("/git"));
        return;
    }
    let git = LocalGit::discover().expect("git").program().to_path_buf();
    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "resolved_git_is_stable_when_process_path_changes",
            "--nocapture",
        ])
        .env("REFYARD_EMBED_GIT_CHILD", "1")
        .env("REFYARD_EMBED_GIT", git)
        .env("PATH", "/definitely/not-a-git-directory")
        .status()
        .expect("child test");
    assert!(status.success(), "child process failed");
}

#[tokio::test]
async fn limits_are_published_and_enforced() {
    let root = tempfile::tempdir().expect("root");
    let mut cfg = config(root.path());
    cfg.limits.queue.max_queued_per_actor = 1;
    cfg.limits.structured_stdout_max_bytes = 1_234;
    cfg.limits.stderr_diagnostic_max_bytes = 567;
    cfg.limits.output_max_bytes = 789;
    cfg.limits.event_ring_max_events = 1;
    cfg.limits.event_ring_max_bytes = 256;
    cfg.limits.repository_max_count = 1;
    let host = EmbeddedRefyard::open(cfg).expect("host");
    assert_eq!(host.output_limits(), (789, 567));
    let capabilities = host.capabilities().expect("capabilities");
    assert_eq!(capabilities.limits.queued_operations_per_actor, 1);
    assert_eq!(capabilities.limits.event_ring_max_events, 1);
    assert_eq!(capabilities.limits.event_ring_max_bytes, 256);
    let repo_a = root.path().join("repo-a");
    let repo_b = root.path().join("repo-b");
    for repo in [&repo_a, &repo_b] {
        std::fs::create_dir_all(repo).expect("repo");
        let status = std::process::Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(repo)
            .status()
            .expect("git");
        assert!(status.success());
    }
    host.register_repository(repo_a.to_str().expect("utf8 repo"))
        .await
        .expect("first repo");
    assert_eq!(
        host.register_repository(repo_b.to_str().expect("utf8 repo"))
            .await
            .expect_err("limit")
            .code,
        ProblemCode::LimitExceeded
    );
}

#[test]
fn only_enabled_closed_mutations_are_capable() {
    let root = tempfile::tempdir().expect("root");
    let mut cfg = config(root.path());
    cfg.enabled_mutations.insert(MutationKind::StagePaths);
    let host = EmbeddedRefyard::open(cfg).expect("host");
    let capabilities = host.capabilities().expect("capabilities");
    assert_eq!(
        capabilities
            .operations
            .iter()
            .map(|op| op.kind)
            .collect::<Vec<_>>(),
        vec![MutationKind::StagePaths]
    );
}

#[tokio::test]
async fn restart_recovers_without_retry_and_keeps_actor_isolation() {
    let root = tempfile::tempdir().expect("root");
    let host = EmbeddedRefyard::open(config(root.path())).expect("host");
    let operation = host
        .submit_mutation("actor-a", commit_request("request-a"))
        .await
        .expect_err("commit is disabled in the empty configuration");
    assert_eq!(operation.code, ProblemCode::UnsupportedOperation);
    host.close().await.expect("close");
    let reopened = EmbeddedRefyard::open(config(root.path())).expect("reopen");
    assert_eq!(
        reopened
            .operation_for("actor-b", "op_1")
            .expect_err("actor isolation")
            .code,
        ProblemCode::NotFound
    );
}

#[tokio::test]
async fn reads_require_registered_repository_and_snapshot_preconditions() {
    let root = tempfile::tempdir().expect("root");
    std::fs::create_dir_all(root.path().join("home")).expect("home");
    let host = EmbeddedRefyard::open(config(root.path())).expect("host");
    assert_eq!(
        host.status(&StatusQuery::new("repo_missing"))
            .await
            .expect_err("unregistered status")
            .code,
        ProblemCode::NotFound
    );
    assert_eq!(
        host.history(&HistoryQuery {
            repository_id: "repo_missing".to_string(),
            worktree_id: None,
            cursor: None,
            limit: None,
            detail_oid: None,
            first_parent_only: None,
            message: None,
            author: None,
            oid_prefix: None,
            ref_full_name: None,
            committed_after: None,
            committed_before: None,
            path_id: None,
        })
        .await
        .expect_err("unregistered history")
        .code,
        ProblemCode::NotFound
    );
    assert_eq!(
        host.refs("repo_missing")
            .await
            .expect_err("unregistered refs")
            .code,
        ProblemCode::NotFound
    );
    assert_eq!(
        host.diff(&DiffQuery {
            repository_id: "repo_missing".to_string(),
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        })
        .await
        .expect_err("unregistered diff")
        .code,
        ProblemCode::NotFound
    );
    assert_eq!(
        host.filesystem_entries(&FilesystemEntriesQuery {
            path: None,
            target_id: None
        })
        .await
        .expect("filesystem is independent of repository registration")
        .entries
        .len(),
        0
    );
    let _ = host
        .previews(&PreviewsRequest {
            repository_id: "repo_missing".to_string(),
            worktree_id: "worktree_missing".to_string(),
            path_ids: vec!["path_missing".to_string()],
        })
        .await
        .expect_err("unregistered previews");
}

#[test]
fn events_replay_or_report_gap_while_operation_lookup_stays_authoritative() {
    let root = tempfile::tempdir().expect("root");
    let host = EmbeddedRefyard::open(config(root.path())).expect("host");
    assert!(host.replay_events(None).is_empty());
    assert_eq!(host.replay_events(Some(1)).len(), 0);
    assert_eq!(
        host.operation_for("actor-a", "missing")
            .expect_err("journal is authoritative")
            .code,
        ProblemCode::NotFound
    );
}

#[test]
fn queued_cancel_is_cancelled_but_running_mutation_is_not() {
    let root = tempfile::tempdir().expect("root");
    let host = EmbeddedRefyard::open(config(root.path())).expect("host");
    let result = host.cancel_operation("actor-a", "op_missing");
    assert_eq!(
        result.expect_err("unknown operation").code,
        ProblemCode::NotFound
    );
}

#[tokio::test]
async fn close_does_not_fabricate_a_terminal_result() {
    let root = tempfile::tempdir().expect("root");
    let repo = root.path().join("repo");
    std::fs::create_dir_all(&repo).expect("repo");
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(&repo)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.name", "Embed Test"]);
    git(&["config", "user.email", "embed@example.invalid"]);
    std::fs::write(repo.join("file.txt"), "before\n").expect("file");
    git(&["add", "file.txt"]);
    git(&["commit", "-q", "-m", "initial"]);
    std::fs::write(repo.join("file.txt"), "after\n").expect("file");
    git(&["add", "file.txt"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let gate = root.path().join("pre-commit-gate");
        let hook = repo.join(".git/hooks/pre-commit");
        std::fs::write(
            &hook,
            format!(
                "#!/bin/sh\nwhile [ ! -f {} ]; do sleep 0.02; done\n",
                gate.display()
            ),
        )
        .expect("hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("hook metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(hook, permissions).expect("hook permissions");
    }

    let mut cfg = config(root.path());
    cfg.enabled_mutations.insert(MutationKind::Commit);
    let host = EmbeddedRefyard::open(cfg).expect("host");
    let repositories = host
        .register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("register");
    let summary = &repositories.repositories[0];
    let snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("status");
    let request = MutationRequest {
        client_request_id: "close-request".to_string(),
        target: MutationTarget::Worktree {
            repository_id: summary.repository_id.clone(),
            worktree_id: summary.primary_worktree_id.clone(),
            expected_snapshot_id: snapshot.snapshot_id,
        },
        operation: MutationOperation::Commit {
            message: "close commit".to_string(),
        },
    };
    let mut events = host.subscribe_events();
    let submitted = host
        .submit_mutation("actor-a", request)
        .await
        .expect("submit");
    let operation_id = submitted.record.operation_id.clone();
    loop {
        let Some(SubscriberEvent::Event(event)) = events.recv().await else {
            panic!("event stream closed")
        };
        if let EventPayload::Operation { operation } = event.payload {
            if operation.operation_id == operation_id
                && operation.status == refyard_contract::reads::OperationStatus::Running
            {
                break;
            }
        }
    }
    #[cfg(unix)]
    let gate_task = {
        let gate = root.path().join("pre-commit-gate");
        let close_task = tokio::spawn(async move { host.close().await });
        tokio::task::yield_now().await;
        assert!(!close_task.is_finished(), "close must wait for running Git");
        std::fs::write(gate, b"release").expect("release gate");
        close_task.await.expect("close task")
    };
    #[cfg(unix)]
    gate_task.expect("close");
    #[cfg(not(unix))]
    host.close().await.expect("close");
    let reopened = EmbeddedRefyard::open(config(root.path())).expect("reopen");
    let record = reopened
        .operation_for("actor-a", &operation_id)
        .expect("durable operation");
    assert!(
        record.finished_at.is_some(),
        "close must wait for observed terminal work"
    );
    assert_ne!(
        record.status,
        refyard_contract::reads::OperationStatus::Cancelled
    );
}
