use std::collections::BTreeSet;
use std::future::Future;
use std::path::Path;

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::HistoryQuery;
use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{
    EventPayload, FilesystemEntriesQuery, MutationKind, MutationTarget, OperationStatus,
    PreviewsRequest,
};
use refyard_host::embed::{EmbedConfig, EmbedLimits, EmbeddedRefyard};
use refyard_host::events::{EventSink, SubscriberEvent};
use refyard_host::jobs::journal::Journal;
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
        git: LocalGit::discover().expect("git is installed"),
        limits: limits(),
        enabled_mutations: BTreeSet::new(),
        service_instance_id: "embed-test".to_string(),
        target_id: "target-local".to_string(),
        target_generation: "generation-1".to_string(),
    }
}

fn init_repository(root: &Path, name: &str) -> std::path::PathBuf {
    let repo = root.join(name);
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
    std::fs::write(repo.join("file.txt"), "base\n").expect("file");
    git(&["add", "file.txt"]);
    git(&["commit", "-q", "-m", "initial"]);
    repo
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
        let good_path = std::env::var("REFYARD_GOOD_PATH").expect("good PATH");
        std::env::set_var("PATH", &good_path);
        let discovered = LocalGit::discover().expect("discover under good PATH");
        let resolved = discovered.program().to_path_buf();
        let root = tempfile::tempdir().expect("root");
        let mut cfg = config(root.path());
        cfg.git = discovered;
        let host = EmbeddedRefyard::open(cfg).expect("host");
        let fake = root.path().join("fake-bin");
        std::fs::create_dir_all(&fake).expect("fake bin");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = fake.join("git");
            std::fs::write(&path, "#!/bin/sh\nexit 99\n").expect("fake git");
            let mut mode = std::fs::metadata(&path)
                .expect("fake metadata")
                .permissions();
            mode.set_mode(0o755);
            std::fs::set_permissions(path, mode).expect("fake permissions");
        }
        #[cfg(windows)]
        std::fs::write(fake.join("git.exe"), "@exit /b 99\r\n").expect("fake git");
        std::env::set_var("PATH", &fake);
        let capability = host.capabilities().expect("captured Git capability read");
        assert_eq!(Path::new(&capability.git.executable_display), resolved);
        return;
    }
    let status = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "resolved_git_is_stable_when_process_path_changes",
            "--nocapture",
        ])
        .env("REFYARD_EMBED_GIT_CHILD", "1")
        .env("REFYARD_GOOD_PATH", std::env::var("PATH").expect("PATH"))
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
    let capabilities = host.capabilities().expect("capabilities");
    assert_eq!(capabilities.limits.queued_operations_per_actor, 1);
    assert_eq!(capabilities.limits.event_ring_max_events, 1);
    assert_eq!(capabilities.limits.event_ring_max_bytes, 256);
    let repo_a = init_repository(root.path(), "repo-a");
    let repo_b = init_repository(root.path(), "repo-b");
    let (first, second) = tokio::join!(
        host.register_repository(repo_a.to_str().expect("utf8 repo")),
        host.register_repository(repo_b.to_str().expect("utf8 repo")),
    );
    let results = [first, second];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .filter(|problem| problem.code == ProblemCode::LimitExceeded)
            .count(),
        1
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
    let repo = init_repository(root.path(), "recovery-repo");
    std::fs::write(repo.join("file.txt"), "crash\n").expect("change");
    std::process::Command::new("git")
        .args(["add", "file.txt"])
        .current_dir(&repo)
        .status()
        .expect("git add");
    let entered = root.path().join("recovery-entered");
    let invocation = root.path().join("recovery-invocation");
    let release = root.path().join("recovery-release");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let hook = repo.join(".git/hooks/pre-commit");
        std::fs::write(
            &hook,
            format!(
                "#!/bin/sh\nprintf 1 >> {}\ntouch {}\nwhile [ ! -f {} ]; do sleep 0.02; done\n",
                invocation.display(),
                entered.display(),
                release.display()
            ),
        )
        .expect("hook");
        let mut mode = std::fs::metadata(&hook)
            .expect("hook metadata")
            .permissions();
        mode.set_mode(0o755);
        std::fs::set_permissions(hook, mode).expect("hook permissions");
    }
    #[cfg(windows)]
    std::fs::write(
        repo.join(".git/hooks/pre-commit"),
        format!(
            "@echo 1>>{}\r\necho entered>{}\r\n:wait\rif not exist {} goto wait\r\n",
            invocation.display(),
            entered.display(),
            release.display()
        ),
    )
    .expect("hook");
    if std::env::var_os("REFYARD_RECOVERY_CHILD").is_some() {
        let child_root =
            std::path::PathBuf::from(std::env::var("REFYARD_RECOVERY_ROOT").expect("child root"));
        let child_repo =
            std::path::PathBuf::from(std::env::var("REFYARD_RECOVERY_REPO").expect("child repo"));
        let mut cfg = config(&child_root);
        cfg.enabled_mutations.insert(MutationKind::Commit);
        let host = EmbeddedRefyard::open(cfg).expect("child host");
        let response = host
            .register_repository(child_repo.to_str().expect("utf8 repo"))
            .await
            .expect("child register");
        let summary = response.repositories[0].clone();
        let snapshot = host
            .status(&StatusQuery::new(&summary.repository_id))
            .await
            .expect("child status");
        let request = MutationRequest {
            client_request_id: "crash-request".to_string(),
            target: MutationTarget::Worktree {
                repository_id: summary.repository_id,
                worktree_id: summary.primary_worktree_id,
                expected_snapshot_id: snapshot.snapshot_id,
            },
            operation: MutationOperation::Commit {
                message: "crash".to_string(),
            },
        };
        let mut child_events = host.subscribe_events();
        host.submit_mutation("actor-a", request)
            .await
            .expect("child submit");
        loop {
            let Some(SubscriberEvent::Event(event)) = child_events.recv().await else {
                std::process::exit(2)
            };
            if let EventPayload::Operation { operation } = event.payload {
                if operation.status == OperationStatus::Running {
                    break;
                }
            }
        }
        let child_entered = child_root.join("recovery-entered");
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while !child_entered.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("child hook entered");
        std::process::exit(0);
    }
    let mut child = std::process::Command::new(std::env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "restart_recovers_without_retry_and_keeps_actor_isolation",
            "--nocapture",
        ])
        .env("REFYARD_RECOVERY_CHILD", "1")
        .env("REFYARD_RECOVERY_ROOT", root.path())
        .env("REFYARD_RECOVERY_REPO", &repo)
        .spawn()
        .expect("crash child");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !entered.exists() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("hook entered");
    child.kill().expect("kill child");
    let _ = child.wait().expect("wait child");
    assert_eq!(
        std::fs::read_to_string(&invocation).expect("invocation count"),
        "1"
    );
    let mut recovery_cfg = config(root.path());
    recovery_cfg.enabled_mutations.insert(MutationKind::Commit);
    let reopened = EmbeddedRefyard::open(recovery_cfg).expect("reopen");
    let registered = reopened
        .register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("register after crash");
    let repository_id = &registered.repositories[0].repository_id;
    let recovery = reopened
        .recovery_for_repository(repository_id)
        .expect("recovery read")
        .expect("write block");
    assert_eq!(recovery.operation_ids, vec!["op_1".to_string()]);
    assert!(!recovery.reason.is_empty());
    assert_eq!(
        reopened
            .operation_for("actor-a", "op_1")
            .expect("owner lookup")
            .status,
        OperationStatus::Unknown
    );
    assert_eq!(
        reopened
            .operation_for("actor-b", "op_1")
            .expect_err("actor isolation")
            .code,
        ProblemCode::NotFound
    );
    let snapshot = reopened
        .status(&StatusQuery::new(repository_id))
        .await
        .expect("fresh snapshot");
    assert_eq!(
        reopened
            .acknowledge_uncertain_operation("op_1", "missing-snapshot")
            .expect_err("stale acknowledgement")
            .code,
        ProblemCode::NotFound
    );
    reopened
        .acknowledge_uncertain_operation("op_1", &snapshot.snapshot_id)
        .expect("fresh acknowledgement");
    assert!(reopened
        .recovery_for_repository(repository_id)
        .expect("recovery after acknowledgement")
        .is_none());
    assert_eq!(
        std::fs::read_to_string(&invocation).expect("no retry invocation count"),
        "1"
    );
    reopened.close().await.expect("close");
}

#[tokio::test]
async fn reads_require_registered_repository_and_snapshot_preconditions() {
    let root = tempfile::tempdir().expect("root");
    std::fs::create_dir_all(root.path().join("home")).expect("home");
    let mut read_cfg = config(root.path());
    read_cfg.enabled_mutations.insert(MutationKind::Commit);
    let host = EmbeddedRefyard::open(read_cfg).expect("host");
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

    let repo = init_repository(root.path(), "registered");
    let response = host
        .register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("register");
    let summary = response.repositories[0].clone();
    let snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("valid status");
    std::fs::write(repo.join("file.txt"), "changed\n").expect("change");
    std::process::Command::new("git")
        .args(["add", "file.txt"])
        .current_dir(&repo)
        .status()
        .expect("git add");
    // The indexed change makes the previously minted snapshot stale before any effect runs.
    let stale = MutationRequest {
        client_request_id: "stale".to_string(),
        target: MutationTarget::Worktree {
            repository_id: summary.repository_id.clone(),
            worktree_id: summary.primary_worktree_id.clone(),
            expected_snapshot_id: snapshot.snapshot_id,
        },
        operation: MutationOperation::Commit {
            message: "stale".to_string(),
        },
    };
    assert_eq!(
        host.submit_mutation("actor", stale)
            .await
            .expect_err("stale snapshot")
            .code,
        ProblemCode::StaleSnapshot
    );
    let revoked = host
        .revoke_repository(&summary.repository_id)
        .await
        .expect("revoke");
    assert!(revoked.repositories.is_empty());
    assert_eq!(
        host.status(&StatusQuery::new(&summary.repository_id))
            .await
            .expect_err("revoked")
            .code,
        ProblemCode::NotFound
    );
    host.register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("explicit re-register");
}

#[tokio::test]
async fn events_replay_or_report_gap_while_operation_lookup_stays_authoritative() {
    let root = tempfile::tempdir().expect("root");
    let repo = init_repository(root.path(), "event-repo");
    std::fs::write(repo.join("file.txt"), "event\n").expect("change");
    std::process::Command::new("git")
        .args(["add", "file.txt"])
        .current_dir(&repo)
        .status()
        .expect("git add");
    let mut cfg = config(root.path());
    cfg.enabled_mutations.insert(MutationKind::Commit);
    cfg.limits.event_ring_max_events = 2;
    cfg.limits.event_ring_max_bytes = 4_096;
    let host = EmbeddedRefyard::open(cfg).expect("host");
    let response = host
        .register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("register");
    let summary = response.repositories[0].clone();
    let snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("status");
    let mut events = host.subscribe_events();
    let request = MutationRequest {
        client_request_id: "event-request".to_string(),
        target: MutationTarget::Worktree {
            repository_id: summary.repository_id.clone(),
            worktree_id: summary.primary_worktree_id.clone(),
            expected_snapshot_id: snapshot.snapshot_id,
        },
        operation: MutationOperation::Commit {
            message: "event commit".to_string(),
        },
    };
    let submitted = host
        .submit_mutation("actor", request)
        .await
        .expect("submit");
    let operation_id = submitted.record.operation_id.clone();
    let mut terminal = false;
    while !terminal {
        let Some(SubscriberEvent::Event(event)) = events.recv().await else {
            panic!("events closed")
        };
        if let EventPayload::Operation { operation } = event.payload {
            terminal = operation.operation_id == operation_id && operation.finished_at.is_some();
        }
    }
    let replay = host.replay_events(Some(0));
    assert!(!replay.is_empty());
    let (gap_from, gap_to) = match replay[0].payload {
        EventPayload::EventGap {
            from_sequence,
            to_sequence,
        } => (from_sequence, to_sequence),
        _ => panic!("replay behind the ring must report an exact gap"),
    };
    assert_eq!(gap_from, 1);
    assert!(gap_to >= gap_from);
    assert!(replay.iter().skip(1).all(|event| event.sequence > gap_to));
    assert!(replay
        .iter()
        .skip(1)
        .any(|event| matches!(event.payload, EventPayload::Operation { .. })));
    let byte_only = EventSink::with_limits(128, 64);
    byte_only.publish(EventPayload::EventGap {
        from_sequence: 1,
        to_sequence: 2,
    });
    byte_only.publish(EventPayload::EventGap {
        from_sequence: 3,
        to_sequence: 4,
    });
    let byte_replay = byte_only.replay(Some(0));
    assert!(matches!(
        byte_replay[0].payload,
        EventPayload::EventGap {
            from_sequence: 1,
            ..
        }
    ));
    let record = host
        .operation_for("actor", &operation_id)
        .expect("journal authority");
    assert!(record.finished_at.is_some());
    assert_eq!(
        host.operation_for("other", &operation_id)
            .expect_err("actor isolation")
            .code,
        ProblemCode::NotFound
    );
    host.close().await.expect("close");
}

#[tokio::test]
async fn queued_cancel_is_cancelled_but_running_mutation_is_not() {
    let root = tempfile::tempdir().expect("root");
    let repo = init_repository(root.path(), "queue-repo");
    let gate = root.path().join("queue-gate");
    std::fs::write(repo.join("file.txt"), "first\n").expect("change");
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
    git(&["add", "file.txt"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
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
    cfg.limits.queue.max_global_git_processes = 1;
    cfg.limits.queue.max_queued_per_actor = 1;
    cfg.enabled_mutations.insert(MutationKind::Commit);
    let host = EmbeddedRefyard::open(cfg).expect("host");
    let response = host
        .register_repository(repo.to_str().expect("utf8 repo"))
        .await
        .expect("register");
    let summary = response.repositories[0].clone();
    let snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("status");
    let request = |id: &str, snapshot_id: String| MutationRequest {
        client_request_id: id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: summary.repository_id.clone(),
            worktree_id: summary.primary_worktree_id.clone(),
            expected_snapshot_id: snapshot_id,
        },
        operation: MutationOperation::Commit {
            message: id.to_string(),
        },
    };
    let mut events = host.subscribe_events();
    let first = host
        .submit_mutation("actor", request("first", snapshot.snapshot_id))
        .await
        .expect("first submit");
    let first_id = first.record.operation_id.clone();
    loop {
        let Some(SubscriberEvent::Event(event)) = events.recv().await else {
            panic!("events closed")
        };
        if let EventPayload::Operation { operation } = event.payload {
            if operation.operation_id == first_id
                && operation.status == refyard_contract::reads::OperationStatus::Running
            {
                break;
            }
        }
    }
    std::fs::write(repo.join("file.txt"), "second\n").expect("second change");
    git(&["add", "file.txt"]);
    let second_snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("second status");
    let second = host
        .submit_mutation("actor", request("second", second_snapshot.snapshot_id))
        .await
        .expect("second queued");
    let second_id = second.record.operation_id.clone();
    let third_snapshot = host
        .status(&StatusQuery::new(&summary.repository_id))
        .await
        .expect("third status");
    assert_eq!(
        host.submit_mutation("actor", request("third", third_snapshot.snapshot_id))
            .await
            .expect_err("queue saturation")
            .code,
        ProblemCode::ResourceBusy
    );
    assert!(host
        .operations("actor", 20)
        .operations
        .iter()
        .filter(|operation| operation.client_request_id == "third")
        .all(|operation| operation.status != OperationStatus::Accepted));
    assert_eq!(
        host.cancel_operation("actor", &second_id)
            .expect("cancel queued")
            .status,
        refyard_contract::reads::OperationStatus::Cancelled
    );
    assert_eq!(
        host.cancel_operation("actor", &first_id)
            .expect_err("running conflict")
            .code,
        ProblemCode::Conflict
    );
    std::fs::write(gate, b"release").expect("release gate");
    loop {
        let Some(SubscriberEvent::Event(event)) = events.recv().await else {
            panic!("events closed")
        };
        if let EventPayload::Operation { operation } = event.payload {
            if operation.operation_id == first_id && operation.finished_at.is_some() {
                assert_ne!(
                    operation.status,
                    refyard_contract::reads::OperationStatus::Cancelled
                );
                break;
            }
        }
    }
    host.close().await.expect("close");
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
        let entered = root.path().join("pre-commit-entered");
        let hook = repo.join(".git/hooks/pre-commit");
        std::fs::write(
            &hook,
            format!(
                "#!/bin/sh\ntouch {}\nwhile [ ! -f {} ]; do sleep 0.02; done\n",
                entered.display(),
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
    {
        let gate = root.path().join("pre-commit-gate");
        let entered = root.path().join("pre-commit-entered");
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !entered.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("hook entered");
        let mut close_future = Box::pin(host.close());
        let pending = std::future::poll_fn(|cx| match close_future.as_mut().poll(cx) {
            std::task::Poll::Pending => std::task::Poll::Ready(true),
            std::task::Poll::Ready(result) => std::task::Poll::Ready(result.is_ok()),
        })
        .await;
        assert!(pending, "close must remain pending while hook is entered");
        std::fs::write(gate, b"release").expect("release gate");
        close_future.await.expect("close task");
    }
    #[cfg(not(unix))]
    host.close().await.expect("close");
    let durable = Journal::open(Some(root.path().to_path_buf())).expect("journal after close");
    assert!(durable
        .get(&operation_id)
        .expect("terminal journal record")
        .finished_at_ms
        .is_some());
    drop(durable);
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
