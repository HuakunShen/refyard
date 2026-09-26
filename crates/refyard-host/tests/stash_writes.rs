//! Stash create/apply/pop/drop and tip-commit amend on a local repository, with the
//! state read back instead of trusted.
//!
//! The safety-critical case is the moving stash locator: `stash@{n}` is a position in a
//! reflog that anyone's `git stash` shifts, so apply/pop/drop re-resolve the locator and
//! refuse a request whose entry has moved rather than acting on a different one. `pop`
//! and `drop` are destructive and gate on an explicit confirmation; a conflicted pop
//! leaves the entry in place and is `needsAttention`, never a failure that would suggest
//! nothing happened. Amending rewrites history, so it is confirmed and judged against a
//! moved HEAD.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{MutationTarget, OperationStatus, StatusSnapshot};
use refyard_host::jobs::{MutationOperation, MutationRequest, StashRef};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

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
        fixture.write("a.txt", "alpha\nbeta\n");
        fixture.write("b.txt", "second\n");
        fixture.git(&["add", "--", "a.txt"]);
        fixture.git(&["add", "--", "b.txt"]);
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

    fn read(&self, relative: &str) -> String {
        std::fs::read_to_string(self.repo.join(relative)).expect("read file")
    }

    /// HEAD's object name in this fixture repository.
    fn head(&self) -> String {
        String::from_utf8(self.git(&["rev-parse", "HEAD"]))
            .expect("an object name is ASCII")
            .trim()
            .to_string()
    }

    fn path(&self) -> &str {
        self.repo.to_str().expect("utf8 path")
    }

    fn state_root(&self) -> PathBuf {
        self.temp.path().join("state")
    }

    /// The service under test: the local target, this fixture's own Git and a durable
    /// journal, with this build's write effects.
    fn service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_ref_writes".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
        .with_state_root(self.state_root())
        .expect("the state directory is writable")
        .with_writes()
    }

    async fn open(&self, service: &ApplicationService) -> (String, String) {
        let response = service
            .register_repository(self.path())
            .await
            .expect("the fixture repository opens");
        let summary = response.repositories.first().expect("one repository");
        (
            summary.repository_id.clone(),
            summary.primary_worktree_id.clone(),
        )
    }

    async fn status(&self, service: &ApplicationService, repository_id: &str) -> StatusSnapshot {
        service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status")
    }

    /// A worktree-targeted request against the snapshot the status read just named.
    async fn worktree_request(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        worktree_id: &str,
        operation: MutationOperation,
        client_request_id: &str,
    ) -> MutationRequest {
        let snapshot_id = self.status(service, repository_id).await.snapshot_id;
        MutationRequest {
            client_request_id: client_request_id.to_string(),
            target: MutationTarget::Worktree {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                expected_snapshot_id: snapshot_id,
            },
            operation,
        }
    }

    /// One stash entry's object name as the request must carry it.
    fn stash_oid(&self, locator: &str) -> String {
        String::from_utf8(self.git(&["rev-parse", locator]))
            .expect("an object name is ASCII")
            .trim()
            .to_string()
    }

    /// How many stash entries the reflog holds right now.
    fn stash_count(&self) -> usize {
        let list = self.git(&["stash", "list"]);
        String::from_utf8(list)
            .expect("utf8")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .count()
    }

    /// Make an unstaged change to `a.txt`'s first line and return its new content.
    fn dirty(&self, line: &str) -> String {
        let content = format!("{line}\nbeta\n");
        self.write("a.txt", &content);
        content
    }
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

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

/// Waits for one operation to reach a terminal state.
async fn wait_terminal(
    service: &ApplicationService,
    operation_id: &str,
) -> refyard_contract::reads::OperationRecord {
    for _ in 0..1_000 {
        let record = service
            .operation(operation_id)
            .expect("the operation exists");
        if record.finished_at.is_some() {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("operation {operation_id} never finished");
}

/* ------------------------------------------------------------------- stash */

#[tokio::test]
async fn a_stash_saves_the_change_and_an_apply_restores_it_while_keeping_the_entry() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let content = fixture.dirty("stashed line");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: Some("wip".to_string()),
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert_eq!(fixture.stash_count(), 1, "one entry is saved");
    assert_eq!(
        fixture.read("a.txt"),
        "alpha\nbeta\n",
        "the tree is clean again"
    );

    let oid = fixture.stash_oid("stash@{0}");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ApplyStash {
                stash: StashRef {
                    oid: oid.clone(),
                    locator: "stash@{0}".to_string(),
                },
                restore_index: false,
            },
            "crid-stash-apply",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert_eq!(fixture.read("a.txt"), content, "the change is restored");
    assert_eq!(fixture.stash_count(), 1, "apply keeps the entry");
}

#[tokio::test]
async fn a_popped_stash_applies_and_is_dropped_on_success() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let content = fixture.dirty("popped line");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    let oid = fixture.stash_oid("stash@{0}");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::PopStash {
                stash: StashRef {
                    oid,
                    locator: "stash@{0}".to_string(),
                },
                restore_index: false,
                confirmed: true,
            },
            "crid-stash-pop",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert_eq!(fixture.read("a.txt"), content, "the change is restored");
    assert_eq!(fixture.stash_count(), 0, "a clean pop drops the entry");
}

#[tokio::test]
async fn a_conflicted_pop_keeps_the_entry_and_reports_needs_attention() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // Stash one change to line 1, then commit a *different* change to line 1 so the
    // pop cannot merge them and must stop with a conflict.
    fixture.dirty("stashed line");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    fixture.write("a.txt", "committed line\nbeta\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "a competing change"]);

    let oid = fixture.stash_oid("stash@{0}");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::PopStash {
                stash: StashRef {
                    oid,
                    locator: "stash@{0}".to_string(),
                },
                restore_index: false,
                confirmed: true,
            },
            "crid-stash-pop-conflict",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    // A conflicted pop is work for a human and must not look like "nothing happened".
    assert_eq!(
        finished.status,
        OperationStatus::NeedsAttention,
        "{:?}",
        finished.problem
    );
    let problem = finished
        .problem
        .expect("needs attention carries the reason");
    assert!(
        problem.message.contains("stash is still there"),
        "the report says the entry survived: {}",
        problem.message
    );
    assert_eq!(
        fixture.stash_count(),
        1,
        "Git keeps the entry on a conflicted pop"
    );
}

#[tokio::test]
async fn dropping_a_stash_removes_that_entry() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    fixture.dirty("to discard");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;
    let oid = fixture.stash_oid("stash@{0}");

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::DropStash {
                stash: StashRef {
                    oid,
                    locator: "stash@{0}".to_string(),
                },
                confirmed: true,
            },
            "crid-stash-drop",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert_eq!(fixture.stash_count(), 0, "the entry is gone");
}

#[tokio::test]
async fn a_stash_locator_that_moved_is_refused_rather_than_acting_on_the_wrong_entry() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // First entry, captured under `stash@{0}`.
    fixture.dirty("first entry");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create-1",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;
    let first_oid = fixture.stash_oid("stash@{0}");

    // A second stash shifts every position: `stash@{0}` now names a different entry.
    fixture.dirty("second entry");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create-2",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    // The request still says `stash@{0}` but carries the *first* entry's object: the
    // locator has moved, so this must refuse instead of acting on the second entry.
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ApplyStash {
                stash: StashRef {
                    oid: first_oid,
                    locator: "stash@{0}".to_string(),
                },
                restore_index: false,
            },
            "crid-stash-apply-stale",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("moved"),
        "the refusal names the stale locator: {}",
        problem.message
    );
    assert_eq!(fixture.stash_count(), 2, "neither entry was touched");
}

#[tokio::test]
async fn a_pop_and_a_drop_without_confirmation_are_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    fixture.dirty("guarded");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateStash {
                message: None,
                include_untracked: false,
                keep_index: false,
            },
            "crid-stash-create",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;
    let oid = fixture.stash_oid("stash@{0}");

    for (operation, client_request_id) in [
        (
            MutationOperation::PopStash {
                stash: StashRef {
                    oid: oid.clone(),
                    locator: "stash@{0}".to_string(),
                },
                restore_index: false,
                confirmed: false,
            },
            "crid-stash-pop-unconfirmed",
        ),
        (
            MutationOperation::DropStash {
                stash: StashRef {
                    oid: oid.clone(),
                    locator: "stash@{0}".to_string(),
                },
                confirmed: false,
            },
            "crid-stash-drop-unconfirmed",
        ),
    ] {
        let request = fixture
            .worktree_request(
                &service,
                &repository_id,
                &worktree_id,
                operation,
                client_request_id,
            )
            .await;
        let accepted = service
            .submit_mutation("owner", request)
            .await
            .expect("accepted");
        let finished = wait_terminal(&service, &accepted.record.operation_id).await;
        assert_eq!(
            finished.status,
            OperationStatus::Failed,
            "{client_request_id}"
        );
        let problem = finished.problem.expect("a refusal carries the reason");
        assert_eq!(
            problem.code,
            ProblemCode::InvalidRequest,
            "{client_request_id}"
        );
        assert!(
            problem.message.contains("confirmation"),
            "{client_request_id}: {}",
            problem.message
        );
    }
    assert_eq!(
        fixture.stash_count(),
        1,
        "the unconfirmed calls changed nothing"
    );
}

/* ------------------------------------------------------------------- amend */

#[tokio::test]
async fn an_amend_rewrites_the_tip_and_keeps_the_message_when_none_is_given() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    // Stage a real change so the amend folds it in and truly rewrites the tip. (An amend
    // that reproduces a byte-identical commit — nothing changed and the timestamps
    // collide — legitimately leaves HEAD unmoved, which is not what this case is about.)
    fixture.write("a.txt", "amended content\nbeta\n");
    fixture.git(&["add", "--", "a.txt"]);
    let before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AmendCommit {
                message: None,
                confirmed: true,
            },
            "crid-amend-keep",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert_ne!(
        fixture.head(),
        before,
        "the tip was rewritten to a new object"
    );
    let subject = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(subject.trim(), "first", "the message is kept");
    let tip_content = String::from_utf8(fixture.git(&["show", "HEAD:a.txt"])).expect("utf8");
    assert_eq!(
        tip_content, "amended content\nbeta\n",
        "the staged change is folded in"
    );
}

#[tokio::test]
async fn an_amend_with_a_new_message_replaces_it() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AmendCommit {
                message: Some("rewritten message".to_string()),
                confirmed: true,
            },
            "crid-amend-message",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    let subject = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(
        subject.trim(),
        "rewritten message",
        "the message was replaced"
    );
}
