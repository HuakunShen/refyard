//! Stage, unstage and commit — the minimal write loop — on a local repository and over
//! SSH, with the state read back instead of trusted.
//!
//! The local half of this file runs against temporary repositories that carry their own
//! `HOME` and their own Git configuration, and it never touches a repository outside
//! `tempfile`'s directory. The remote half is `#[ignore]`d because it needs the Docker
//! fixture:
//!
//! ```text
//! pnpm native:ssh:fixture -- start
//! cargo test -p refyard-host --test ssh_mutations -- --ignored --test-threads=1
//! cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1
//! pnpm native:ssh:fixture -- stop
//! ```
//!
//! The remote cases create their own repository inside the container from this test —
//! a fresh `git init` under a unique `/srv` directory, seeded with the fixed commands the
//! fixture also uses — and they never write to the fixture's seeded repository
//! (`/srv/refyard fixture's rëpo`) or to `target/native-ssh-fixture/repo-local`. The read
//! comparisons in `ssh_exec.rs` compare those two byte for byte, so this file is only
//! honest if it leaves them exactly as it found them.
//!
//! The failures these cases exist to prevent:
//!
//! - a write that reports success while the index never moved, because `git` exited 0
//!   and nobody looked at the repository afterwards;
//! - a batch that stages half of what the user selected because one path id was stale;
//! - an unstage in an unborn repository that deletes working-tree files, because
//!   `git restore --staged` was used where there is no HEAD to restore from;
//! - a commit whose post-commit hook failed being reported as "nothing happened" — or
//!   as a plain failure — when Git has in fact written a commit.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{
    EventEnvelope, EventPayload, MutationKind, MutationTarget, OperationStatus, PreviewsRequest,
    StatusSnapshot, TargetKind,
};
use refyard_host::events::SubscriberEvent;
use refyard_host::jobs::{MutationOperation, MutationRequest};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

/* ------------------------------------------------------------------ fixture */

/// A temporary repository with its own identity, config and no inherited `GIT_*`.
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
    /// journal, with the three write effects this build implements.
    fn service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_mutations".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
        .with_state_root(self.state_root())
        .expect("the state directory is writable")
        .with_writes()
    }

    /// The same service without the write path, for the honesty case.
    fn read_only_service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_readonly".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
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

    /// The path id a status read minted for `display_path`.
    async fn path_id(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        named: &str,
    ) -> String {
        self.status(service, repository_id)
            .await
            .entries
            .iter()
            .find(|entry| entry.display_path == named)
            .unwrap_or_else(|| panic!("no status entry for {named}"))
            .path_id
            .clone()
    }

    /// A preview token for one path, and the snapshot the preview was read against.
    async fn preview(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        worktree_id: &str,
        path_id: &str,
    ) -> (String, String) {
        let response = service
            .previews(&PreviewsRequest {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                path_ids: vec![path_id.to_string()],
            })
            .await
            .expect("the preview read answers");
        let token = response.tokens.first().expect("a token per path");
        (token.preview_token.clone(), response.snapshot_id.clone())
    }

    /// A stage request for one path, built the way a client builds one: the ids and
    /// tokens a preview just issued, and the snapshot the status read named.
    async fn stage_request(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        worktree_id: &str,
        path_id: &str,
        client_request_id: &str,
    ) -> MutationRequest {
        let (token, snapshot_id) = self
            .preview(service, repository_id, worktree_id, path_id)
            .await;
        MutationRequest {
            client_request_id: client_request_id.to_string(),
            target: MutationTarget::Worktree {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                expected_snapshot_id: snapshot_id,
            },
            operation: MutationOperation::StagePaths {
                path_ids: vec![path_id.to_string()],
                preview_tokens: vec![token],
            },
        }
    }

    fn unstage_request(
        &self,
        repository_id: &str,
        worktree_id: &str,
        snapshot_id: &str,
        path_id: &str,
        client_request_id: &str,
    ) -> MutationRequest {
        MutationRequest {
            client_request_id: client_request_id.to_string(),
            target: MutationTarget::Worktree {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                expected_snapshot_id: snapshot_id.to_string(),
            },
            operation: MutationOperation::UnstagePaths {
                path_ids: vec![path_id.to_string()],
            },
        }
    }

    fn commit_request(
        &self,
        repository_id: &str,
        worktree_id: &str,
        snapshot_id: &str,
        message: &str,
        client_request_id: &str,
    ) -> MutationRequest {
        MutationRequest {
            client_request_id: client_request_id.to_string(),
            target: MutationTarget::Worktree {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                expected_snapshot_id: snapshot_id.to_string(),
            },
            operation: MutationOperation::Commit {
                message: message.to_string(),
            },
        }
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

/// The two status letters of one path, or `"-"` when the path is not listed at all.
fn letter(status: &StatusSnapshot, display_path: &str) -> String {
    status
        .entries
        .iter()
        .find(|entry| entry.display_path == display_path)
        .map(|entry| format!("{}{}", entry.index_status, entry.worktree_status))
        .unwrap_or_else(|| "-".to_string())
}

/* ------------------------------------------------------------------ stage */

#[tokio::test]
async fn a_stage_moves_one_path_into_the_index_and_leaves_the_others_alone() {
    // Prevents: a batch write that stages whatever the user selected *and* the paths a
    // mistaken pathspec expanded to — `git add` without literal pathspecs turns a file
    // called `*.txt` into every text file in the repository.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");

    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-stage",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the stage is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    let result = finished.result.expect("a succeeded stage reports a result");
    assert_eq!(result.changed_paths, Some(1));
    assert!(result.snapshot_invalidated);
    assert_eq!(
        result.new_head_oid.as_deref(),
        Some(fixture.head().as_str()),
        "the result names the HEAD the read-back saw"
    );

    // The index holds a.txt staged and nothing else: b.txt is still unmodified, and the
    // working tree is untouched.
    let status = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&status, "a.txt"), "M.");
    assert_eq!(
        letter(&status, "b.txt"),
        "-",
        "the other file is not listed at all, because nothing about it changed"
    );
    assert_eq!(fixture.read("a.txt"), "alpha\nbeta changed\n");
}

/* ------------------------------------------------------------------ unstage */

#[tokio::test]
async fn an_unstage_removes_one_path_from_the_index_and_keeps_the_working_file() {
    // Prevents: "unstage" implemented as a checkout, which throws away the edit the user
    // asked to keep — the difference between `git restore --staged` and `git restore`.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta staged\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.write("b.txt", "second changed\n");

    let status = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&status, "a.txt"), "M.");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture.unstage_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        &path_id,
        "crid-unstage",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the unstage is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );

    // The edit is still in the working tree; only the index moved.
    assert_eq!(fixture.read("a.txt"), "alpha\nbeta staged\n");
    let after = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&after, "a.txt"), ".M");
    assert_eq!(
        letter(&after, "b.txt"),
        ".M",
        "an unrelated modification is untouched"
    );
}

#[tokio::test]
async fn unstaging_in_a_repository_with_no_head_keeps_the_working_file() {
    // Prevents: an unborn branch answered with `git restore --staged`, which has no HEAD
    // to restore from — or, worse, a fallback that deletes the file from the working tree
    // to make the index clean.
    let fixture = Fixture::new();
    let repo = fixture.temp.path().join("unborn");
    std::fs::create_dir_all(&repo).expect("create the unborn repository");
    let output = Command::new(git_program())
        .args(["init", "--quiet", "--initial-branch=main"])
        .current_dir(&repo)
        .env_clear()
        .envs(
            fixture
                .env
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str())),
        )
        .output()
        .expect("run git");
    assert!(output.status.success());
    std::fs::write(repo.join("fresh.txt"), "never committed\n").expect("write");

    let service = fixture.service();
    let opened = service
        .register_repository(repo.to_str().expect("utf8"))
        .await
        .expect("the unborn repository opens");
    let repository_id = opened
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();
    let worktree_id = opened
        .repositories
        .first()
        .expect("one repository")
        .primary_worktree_id
        .clone();
    // Stage first: an unborn repository has to have something in the index for an
    // unstage to mean anything.
    let path_id = fixture.path_id(&service, &repository_id, "fresh.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-unborn-stage",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("stage accepted");
    let staged = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        staged.status,
        OperationStatus::Succeeded,
        "{:?}",
        staged.problem
    );

    let status = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&status, "fresh.txt"), "A.");
    let request = fixture.unstage_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        &path_id,
        "crid-unborn-unstage",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("unstage accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "an unborn repository must unstage rather than fail: {:?}",
        finished.problem
    );

    assert!(
        repo.join("fresh.txt").is_file(),
        "the working-tree file must still exist"
    );
    assert_eq!(
        std::fs::read_to_string(repo.join("fresh.txt")).expect("read"),
        "never committed\n"
    );
    let after = fixture.status(&service, &repository_id).await;
    assert_eq!(
        letter(&after, "fresh.txt"),
        "??",
        "the file is now untracked rather than staged"
    );
}

/* ------------------------------------------------------------------ commit */

#[tokio::test]
async fn a_commit_commits_the_index_with_the_message_and_never_stages_on_its_own() {
    // Prevents: `git commit -a` (or an implicit stage) sweeping in a working-tree change
    // the user did not select, and `--cleanup` stripping the message the user wrote.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta committed\n");
    fixture.git(&["add", "--", "a.txt"]);
    // A second, unstaged change: a commit that stages implicitly would include it.
    fixture.write("b.txt", "second, not staged\n");

    let status = fixture.status(&service, &repository_id).await;
    let request = fixture.commit_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        "the message\n\nwith a trailing blank line\n",
        "crid-commit",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the commit is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    let result = finished.result.expect("a result");
    let head = fixture.head();
    assert_eq!(
        result.new_head_oid.as_deref(),
        Some(head.as_str()),
        "the result names the commit the read-back saw, not one Git printed"
    );

    // The message is stored byte for byte, and b.txt's unstaged edit is not in the commit.
    let message = String::from_utf8(fixture.git(&["log", "-1", "--format=%B"])).expect("utf8");
    assert_eq!(message, "the message\n\nwith a trailing blank line\n\n");
    let committed = String::from_utf8(fixture.git(&["show", "HEAD:b.txt"])).expect("utf8");
    assert_eq!(
        committed, "second\n",
        "an implicit stage would have committed the edit"
    );
    let after = fixture.status(&service, &repository_id).await;
    assert_eq!(
        letter(&after, "a.txt"),
        "-",
        "the staged change is committed, so the path is no longer listed"
    );
    assert_eq!(
        letter(&after, "b.txt"),
        ".M",
        "the unstaged change survives"
    );
}

#[tokio::test]
async fn a_commit_with_nothing_staged_is_refused_without_running_anything() {
    // Prevents: `git commit` creating an empty commit, or reporting a confusing Git
    // failure for a state the host can see and name.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta\n");
    fixture.write("b.txt", "second\n");

    let status = fixture.status(&service, &repository_id).await;
    let head_before = fixture.git(&["rev-parse", "HEAD"]);
    let request = fixture.commit_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        "nothing to commit",
        "crid-empty-commit",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the request is accepted and then fails");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("the failure explains itself");
    assert_eq!(problem.code, ProblemCode::Conflict, "{problem:?}");
    assert!(
        problem.message.contains("stage something first"),
        "{problem:?}"
    );
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]), head_before);
}

#[tokio::test]
async fn staging_a_renamed_path_the_index_already_holds_keeps_the_rename() {
    // Prevents: a staged rename whose destination cannot be staged at all, because the
    // origin is named to `git add` although the index has already absorbed it — Git
    // refuses a pathspec matching neither the index nor the working tree, and the batch
    // would fail with "pathspec 'a.txt' did not match any files". The index must keep the
    // rename and pick up the edit.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    // A rename the index already holds (`git mv` stages it), with a further edit to the
    // destination so the stage has something to do.
    fixture.git(&["mv", "a.txt", "renamed.txt"]);
    fixture.write("renamed.txt", "alpha\nbeta\nmore\n");

    let status = fixture.status(&service, &repository_id).await;
    let renamed = status
        .entries
        .iter()
        .find(|entry| entry.display_path == "renamed.txt")
        .expect("the renamed path");
    assert_eq!(
        renamed.kind,
        refyard_contract::reads::StatusEntryKind::Renamed
    );
    assert_eq!(renamed.original_display_path.as_deref(), Some("a.txt"));
    assert_eq!(renamed.index_status, "R");

    let path_id = renamed.path_id.clone();
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-rename",
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

    let staged =
        String::from_utf8(fixture.git(&["diff", "--cached", "--name-status", "-M"])).expect("utf8");
    let fields: Vec<&str> = staged.trim().split('\t').collect();
    assert_eq!(
        fields.get(1..3),
        Some(["a.txt", "renamed.txt"].as_slice()),
        "the index must hold the rename, not a copy and a deletion: {staged:?}"
    );
    assert!(
        fields.first().is_some_and(|status| status.starts_with('R')),
        "the staged change must be a rename, not a modify plus a delete: {staged:?}"
    );
    let after = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&after, "renamed.txt"), "R.");
    assert_eq!(
        after
            .entries
            .iter()
            .filter(|entry| entry.display_path == "a.txt")
            .count(),
        0,
        "the origin is no longer a separate change"
    );
}

/* ------------------------------------------------------------------ the read-only build */

#[tokio::test]
async fn a_host_without_the_write_path_refuses_every_mutation_and_offers_none() {
    // Prevents: a capability answer that advertises writes a build cannot run, or a
    // journal record for an operation that was never accepted.
    let fixture = Fixture::new();
    let service = fixture.read_only_service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;

    let capabilities = service.capabilities().await.expect("capabilities");
    assert!(
        capabilities.operations.is_empty(),
        "a build without the write effects offers none"
    );

    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-refused",
        )
        .await;
    let refused = service
        .submit_mutation("owner", request)
        .await
        .expect_err("no effect is registered");
    assert_eq!(
        refused.code,
        ProblemCode::UnsupportedOperation,
        "{refused:?}"
    );
}

#[tokio::test]
async fn naming_a_state_directory_after_registering_the_writes_keeps_them() {
    // Prevents: a composition root that calls `with_state_root` last and silently loses
    // the write path, because the engine was rebuilt without the effects it had.
    let fixture = Fixture::new();
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at(git_program(), fixture.env.clone()),
        service_instance_id: "srvc_order".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: fixture.home.clone(),
    })
    .with_writes()
    .with_state_root(fixture.state_root())
    .expect("the state directory is writable");
    let capabilities = service.capabilities().await.expect("capabilities");
    assert_eq!(
        capabilities.operations.len(),
        41,
        "the write path must survive a later state directory being named"
    );

    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-order",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the write path is still registered");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);
}

/* ------------------------------------------------------------------ refusals start no Git */

/// A `git` that records every invocation and then runs the real one.
///
/// It exists so "the batch was refused before Git was started" can be measured: a test
/// that only asserted the problem code could not tell a refusal-before-Git from a refusal
/// after Git ran and changed nothing.
fn logging_git(fixture: &Fixture, log: &Path) -> LocalGit {
    let script = fixture.temp.path().join("logging-git.sh");
    let body = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nexec '{}' \"$@\"\n",
        log.display(),
        git_program().display()
    );
    std::fs::write(&script, body).expect("write the logging git");
    let mut permissions = std::fs::metadata(&script)
        .expect("the script exists")
        .permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    std::fs::set_permissions(&script, permissions).expect("make the script executable");
    LocalGit::at(script, fixture.env.clone())
}

/// How many times the logging `git` ran a write command.
///
/// The submit path reads status *before* it accepts anything — the freshness check the
/// Node reference performs too — so a test cannot assert "no Git process ran at all". It
/// can and does assert that no *write* command ran, which is what "the batch is refused
/// before Git is started" means for a mutation.
fn write_invocations(log: &Path) -> usize {
    std::fs::read_to_string(log)
        .map(|text| {
            text.lines()
                .filter(|line| line.split_whitespace().any(|argument| argument == "add"))
                .count()
        })
        .unwrap_or(0)
}

#[tokio::test]
async fn a_refused_batch_never_started_git_and_left_the_repository_alone() {
    // Prevents: a batch that runs `git add` for the paths it could resolve and then fails
    // on the one it could not — the index would hold half of what the user selected, and
    // "nothing was written" would be false.
    let fixture = Fixture::new();
    let log = fixture.temp.path().join("git-invocations.log");
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: logging_git(&fixture, &log),
        service_instance_id: "srvc_refusals".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: fixture.home.clone(),
    })
    .with_state_root(fixture.state_root())
    .expect("the state directory is writable")
    .with_writes();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let head_before = fixture.head();

    // A path id nobody minted: the operation is refused by the effect, and no write
    // command may have started.
    let before = write_invocations(&log);
    let request = MutationRequest {
        client_request_id: "crid-unknown-path".to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            expected_snapshot_id: snapshot_id.clone(),
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec!["path_never_minted".to_string()],
            preview_tokens: vec!["pt_never_issued".to_string()],
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the operation is accepted and then refused by its own check");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(
        finished.problem.expect("the refusal").code,
        ProblemCode::NotFound
    );
    assert_eq!(
        write_invocations(&log),
        before,
        "the refusal started a write command; it must refuse the batch first"
    );

    // A preview whose content moved after the preview: stale, refused, no write started.
    let (token, preview_snapshot_id) = fixture
        .preview(&service, &repository_id, &worktree_id, &path_id)
        .await;
    fixture.write("a.txt", "alpha\nbeta changed again\n");
    let request = MutationRequest {
        client_request_id: "crid-stale".to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            expected_snapshot_id: preview_snapshot_id,
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec![path_id.clone()],
            preview_tokens: vec![token],
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the operation is accepted and then refused by its own check");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(
        finished.problem.expect("the refusal").code,
        ProblemCode::StalePreview
    );
    assert_eq!(
        write_invocations(&log),
        before,
        "a stale preview must be refused before a write command is started"
    );

    assert_eq!(fixture.head(), head_before);
    assert_eq!(
        fixture.read("a.txt"),
        "alpha\nbeta changed again\n",
        "no write may have touched the working tree"
    );
}

/* ------------------------------------------------------------------ hooks */

#[tokio::test]
async fn a_failing_pre_commit_hook_is_reported_and_leaves_the_repository_unchanged() {
    // Prevents: a hook failure turned into "succeeded because git was run", or a retry
    // (or a `--no-verify`) that commits what the user's own hook refused.
    let fixture = Fixture::new();
    let hook = fixture.repo.join(".git/hooks/pre-commit");
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'the fixture hook refuses this commit' >&2\nexit 1\n",
    )
    .expect("write the hook");
    make_executable(&hook);
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta staged\n");
    fixture.git(&["add", "--", "a.txt"]);

    let head_before = fixture.head();
    let status = fixture.status(&service, &repository_id).await;
    let request = fixture.commit_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        "a commit the hook refuses",
        "crid-hook-refused",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Failed,
        "the read-back proves nothing moved: {:?}",
        finished.problem
    );
    let problem = finished.problem.expect("the hook's error is kept");
    assert_eq!(problem.code, ProblemCode::GitCommandFailed, "{problem:?}");
    assert!(
        problem
            .message
            .contains("the fixture hook refuses this commit"),
        "Git's diagnostic is the evidence a person can act on: {problem:?}"
    );
    assert_eq!(fixture.head(), head_before, "no commit was created");
    let after = fixture.status(&service, &repository_id).await;
    assert_eq!(
        letter(&after, "a.txt"),
        "M.",
        "the staged change is exactly where it was"
    );
    assert_eq!(fixture.read("a.txt"), "alpha\nbeta staged\n");
}

#[tokio::test]
async fn a_commit_that_exists_while_git_reported_failure_is_needs_attention_not_a_failure() {
    // Prevents: a commit that landed being reported as "nothing happened" — and a commit
    // that landed being reported as a plain success when Git also complained. The JSON
    // fixture stands in for a hook or a transport that loses Git's exit status after the
    // commit is written; real `post-commit` hooks do not change `git commit`'s status.
    let fixture = Fixture::new();
    let script = fixture.temp.path().join("complaining-git.sh");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nfor arg in \"$@\"; do\n  if [ \"$arg\" = \"commit\" ]; then\n    '{}' \"$@\"\n    exit 1\n  fi\ndone\nexec '{}' \"$@\"\n",
            git_program().display(),
            git_program().display()
        ),
    )
    .expect("write the wrapper");
    make_executable(&script);
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at(script, fixture.env.clone()),
        service_instance_id: "srvc_complaint".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: fixture.home.clone(),
    })
    .with_state_root(fixture.state_root())
    .expect("the state directory is writable")
    .with_writes();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta committed\n");
    fixture.git(&["add", "--", "a.txt"]);

    let status = fixture.status(&service, &repository_id).await;
    let request = fixture.commit_request(
        &repository_id,
        &worktree_id,
        &status.snapshot_id,
        "a commit git complained about",
        "crid-complaint",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::NeedsAttention,
        "the read-back found the commit, so this is not a failure: {:?}",
        finished.problem
    );
    let problem = finished.problem.expect("the complaint is kept");
    assert_eq!(problem.code, ProblemCode::NeedsAttention, "{problem:?}");
    assert!(
        problem.message.contains(&fixture.head()),
        "the complaint must name the commit that exists: {problem:?}"
    );
    assert!(
        service.blocked_repositories().is_empty(),
        "a known outcome does not block the repository"
    );
    let subject = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(subject.trim(), "a commit git complained about");
}

/* ------------------------------------------------------------------ unknown, never guessed */

/// A `git` that stages for real and then dies without reporting a status, standing in for
/// a connection that dropped after the remote command had already run.
fn dying_git(fixture: &Fixture) -> LocalGit {
    let script = fixture.temp.path().join("dying-git.sh");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nfor arg in \"$@\"; do\n  if [ \"$arg\" = \"add\" ]; then\n    '{}' \"$@\"\n    kill -9 $$\n  fi\ndone\nexec '{}' \"$@\"\n",
            git_program().display(),
            git_program().display()
        ),
    )
    .expect("write the dying git");
    make_executable(&script);
    LocalGit::at(script, fixture.env.clone())
}

fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path).expect("exists").permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions).expect("chmod");
}

#[tokio::test]
async fn a_stage_whose_git_died_after_the_index_moved_is_unknown_and_blocks_the_repository() {
    // Prevents: a dropped connection reported as "nothing happened" when the index has
    // already changed, and an automatic retry that stages on top of an outcome nobody
    // established.
    let fixture = Fixture::new();
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: dying_git(&fixture),
        service_instance_id: "srvc_unknown".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: fixture.home.clone(),
    })
    .with_state_root(fixture.state_root())
    .expect("the state directory is writable")
    .with_writes();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-unknown",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Unknown,
        "the index moved while the command's result was lost: {:?}",
        finished.problem
    );
    let problem = finished
        .problem
        .clone()
        .expect("the uncertainty explains itself");
    assert_eq!(problem.code, ProblemCode::UncertainOutcome, "{problem:?}");
    assert!(
        problem.message.contains("not known"),
        "the record must say whether the outcome is known: {problem:?}"
    );

    // The stage did happen: the index holds it, which is exactly why nobody may call this
    // "failed" and nobody may retry it.
    let status = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&status, "a.txt"), "M.");

    // The repository is blocked for further writes until a person confirms its state.
    let blocked = service.blocked_repositories();
    assert_eq!(blocked.len(), 1, "the write left a block: {blocked:?}");
    let second = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-after-unknown",
        )
        .await;
    let refused = service
        .submit_mutation("owner", second)
        .await
        .expect_err("a blocked repository accepts nothing");
    assert_eq!(refused.code, ProblemCode::UncertainOutcome, "{refused:?}");

    // A fresh read of the repository, confirmed by a person, lifts the block — without
    // rewriting what happened.
    let fresh = fixture.status(&service, &repository_id).await;
    let acknowledged = service
        .acknowledge_uncertain_operation(&accepted.record.operation_id, &fresh.snapshot_id)
        .expect("a fresh snapshot confirms the state");
    assert_eq!(acknowledged.status, OperationStatus::Unknown);
    assert!(service.blocked_repositories().is_empty());
}

/* ------------------------------------------------------------------ events */

#[tokio::test]
async fn a_write_publishes_its_state_changes_and_the_repository_invalidation() {
    // Prevents: a UI that only learns about a write from an event stream — the stream is
    // a hint, and a client that never subscribed must recover everything from the journal.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let mut subscription = service.subscribe_events();
    fixture.write("a.txt", "alpha\nbeta changed\n");

    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-events",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);

    // The live subscription saw the accepted and terminal states, and the invalidation.
    let mut seen: Vec<EventEnvelope> = Vec::new();
    while let Ok(Some(event)) =
        tokio::time::timeout(Duration::from_millis(100), subscription.recv()).await
    {
        match event {
            SubscriberEvent::Event(envelope) => {
                let invalidation =
                    matches!(envelope.payload, EventPayload::RepositoryChanged { .. });
                seen.push(envelope);
                if invalidation {
                    break;
                }
            }
            SubscriberEvent::Missed { .. } => panic!("a live subscriber missed frames"),
        }
    }
    let statuses: Vec<OperationStatus> = seen
        .iter()
        .filter_map(|envelope| match &envelope.payload {
            EventPayload::Operation { operation } => Some(operation.status),
            _ => None,
        })
        .collect();
    assert!(
        statuses.contains(&OperationStatus::Accepted),
        "{statuses:?}"
    );
    assert!(
        statuses.contains(&OperationStatus::Succeeded),
        "{statuses:?}"
    );
    match seen.last().expect("an invalidation").payload.clone() {
        EventPayload::RepositoryChanged {
            repository_id: changed,
            worktree_ids,
            snapshot_invalidated,
        } => {
            assert_eq!(changed, repository_id);
            assert_eq!(worktree_ids, vec![worktree_id.clone()]);
            assert!(snapshot_invalidated);
        }
        other => panic!("expected the repository invalidation last, got {other:?}"),
    }
    // Sequences are strictly increasing, so a client can tell it missed one.
    let sequences: Vec<u64> = seen.iter().map(|envelope| envelope.sequence).collect();
    assert!(
        sequences.windows(2).all(|pair| pair[0] < pair[1]),
        "{sequences:?}"
    );
    assert_eq!(
        *sequences.last().expect("an event"),
        service.events().high_watermark()
    );

    // A client that never subscribed recovers the same fact from the journal.
    let operations = service.operations("owner", 10);
    assert_eq!(operations.operations.len(), 1);
    assert_eq!(operations.operations[0].status, OperationStatus::Succeeded);
    assert_eq!(operations.operations[0].operation_id, finished.operation_id);
}

#[tokio::test]
async fn a_replayed_request_is_not_executed_twice() {
    // Prevents: a client that lost the response and retried the same request id staging
    // a second time — and a spent preview token surfacing as a stale-preview failure for
    // a request that in fact already ran.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let request = fixture
        .stage_request(
            &service,
            &repository_id,
            &worktree_id,
            &path_id,
            "crid-retry",
        )
        .await;
    let first = service
        .submit_mutation("owner", request.clone())
        .await
        .expect("the first submission is accepted");
    let finished = wait_terminal(&service, &first.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);

    let second = service
        .submit_mutation("owner", request)
        .await
        .expect("the same request id and payload are the same operation");
    assert!(second.duplicate);
    assert_eq!(second.record.operation_id, first.record.operation_id);
    assert_eq!(second.record.status, OperationStatus::Succeeded);
    assert_eq!(
        service.operations("owner", 10).operations.len(),
        1,
        "one request id is one operation"
    );
}

#[tokio::test]
async fn capabilities_name_exactly_the_forty_one_implemented_writes() {
    // Prevents: a capability answer that offers a write this build cannot run, or hides
    // one it can — the UI enables controls from this list.
    let fixture = Fixture::new();
    let service = fixture.service();
    let capabilities = service.capabilities().await.expect("capabilities");
    let kinds: Vec<(MutationKind, Vec<TargetKind>)> = capabilities
        .operations
        .iter()
        .map(|operation| (operation.kind, operation.targets.clone()))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (MutationKind::StagePaths, vec![TargetKind::Worktree]),
            (MutationKind::UnstagePaths, vec![TargetKind::Worktree]),
            (MutationKind::Commit, vec![TargetKind::Worktree]),
            (MutationKind::AmendCommit, vec![TargetKind::Worktree]),
            (MutationKind::CreateBranch, vec![TargetKind::Repository]),
            (MutationKind::SwitchBranch, vec![TargetKind::Worktree]),
            (MutationKind::RenameBranch, vec![TargetKind::Repository]),
            (MutationKind::DeleteBranch, vec![TargetKind::Repository]),
            (
                MutationKind::SetBranchUpstream,
                vec![TargetKind::Repository]
            ),
            (MutationKind::AddRemote, vec![TargetKind::Repository]),
            (MutationKind::UpdateRemote, vec![TargetKind::Repository]),
            (MutationKind::RemoveRemote, vec![TargetKind::Repository]),
            (MutationKind::Fetch, vec![TargetKind::Repository]),
            (MutationKind::Push, vec![TargetKind::Repository]),
            (MutationKind::Pull, vec![TargetKind::Worktree]),
            (MutationKind::CreateStash, vec![TargetKind::Worktree]),
            (MutationKind::ApplyStash, vec![TargetKind::Worktree]),
            (MutationKind::PopStash, vec![TargetKind::Worktree]),
            (MutationKind::DropStash, vec![TargetKind::Repository]),
            (MutationKind::CreateTag, vec![TargetKind::Repository]),
            (MutationKind::DeleteTag, vec![TargetKind::Repository]),
            (MutationKind::PushTag, vec![TargetKind::Repository]),
            (MutationKind::CreateWorktree, vec![TargetKind::Repository]),
            (MutationKind::LockWorktree, vec![TargetKind::Repository]),
            (MutationKind::UnlockWorktree, vec![TargetKind::Repository]),
            (MutationKind::AddSubmodule, vec![TargetKind::Worktree]),
            (MutationKind::UpdateSubmodule, vec![TargetKind::Worktree]),
            (MutationKind::SyncSubmodule, vec![TargetKind::Worktree]),
            (MutationKind::Merge, vec![TargetKind::Worktree]),
            (MutationKind::ContinueMerge, vec![TargetKind::Worktree]),
            (MutationKind::AbortMerge, vec![TargetKind::Worktree]),
            (MutationKind::RevertCommit, vec![TargetKind::Worktree]),
            (MutationKind::ResetBranch, vec![TargetKind::Worktree]),
            (MutationKind::CherryPick, vec![TargetKind::Worktree]),
            (MutationKind::ContinueCherryPick, vec![TargetKind::Worktree]),
            (MutationKind::AbortCherryPick, vec![TargetKind::Worktree]),
            (MutationKind::Rebase, vec![TargetKind::Worktree]),
            (MutationKind::ContinueRebase, vec![TargetKind::Worktree]),
            (MutationKind::AbortRebase, vec![TargetKind::Worktree]),
            (MutationKind::DropCommit, vec![TargetKind::Worktree]),
            (MutationKind::SquashCommit, vec![TargetKind::Worktree]),
        ]
    );
    let unavailable = capabilities
        .unavailable
        .iter()
        .flat_map(|reason| reason.operations.clone())
        .collect::<Vec<MutationKind>>();
    assert_eq!(
        unavailable.len(),
        refyard_contract::reads::MUTATION_KINDS.len() - 41
    );
    for offered in [
        MutationKind::StagePaths,
        MutationKind::UnstagePaths,
        MutationKind::Commit,
        MutationKind::AmendCommit,
        MutationKind::CreateBranch,
        MutationKind::SwitchBranch,
        MutationKind::RenameBranch,
        MutationKind::DeleteBranch,
        MutationKind::SetBranchUpstream,
        MutationKind::AddRemote,
        MutationKind::UpdateRemote,
        MutationKind::RemoveRemote,
        MutationKind::Fetch,
        MutationKind::Push,
        MutationKind::Pull,
        MutationKind::CreateStash,
        MutationKind::ApplyStash,
        MutationKind::PopStash,
        MutationKind::DropStash,
        MutationKind::CreateTag,
        MutationKind::DeleteTag,
        MutationKind::PushTag,
        MutationKind::CreateWorktree,
        MutationKind::LockWorktree,
        MutationKind::UnlockWorktree,
        MutationKind::AddSubmodule,
        MutationKind::UpdateSubmodule,
        MutationKind::SyncSubmodule,
        MutationKind::Merge,
        MutationKind::ContinueMerge,
        MutationKind::AbortMerge,
        MutationKind::RevertCommit,
        MutationKind::ResetBranch,
        MutationKind::CherryPick,
        MutationKind::ContinueCherryPick,
        MutationKind::AbortCherryPick,
        MutationKind::Rebase,
        MutationKind::ContinueRebase,
        MutationKind::AbortRebase,
        MutationKind::DropCommit,
        MutationKind::SquashCommit,
    ] {
        assert!(
            !unavailable.contains(&offered),
            "{offered:?} is implemented"
        );
    }
    assert!(unavailable.contains(&MutationKind::DiscardTrackedPaths));
    assert!(unavailable.contains(&MutationKind::InitRepository));
    assert!(unavailable.contains(&MutationKind::RemoveWorktree));
}

/* ------------------------------------------------------------------ the fixture-backed cases */

/// The state `scripts/native-ssh-fixture.ts` wrote when it started the container.
struct SshFixture {
    alias: String,
    config_file: PathBuf,
    home: PathBuf,
    repo_path: String,
    local_repo_path: PathBuf,
    known_hosts: PathBuf,
    host: String,
    port: Option<u64>,
}

impl SshFixture {
    /// Reads the state file the fixture wrote, or skips the case with a clear message.
    ///
    /// A fixture that is absent or stopped is an environment a case cannot run in, not a
    /// product failure: failing here would report the absence of a container as a broken
    /// transport.
    fn load_or_skip() -> Option<Self> {
        let path = ssh_state_path();
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!(
                "skipping: no SSH fixture state at {}; start it with `pnpm native:ssh:fixture -- start`",
                path.display()
            );
            return None;
        };
        let state: serde_json::Value =
            serde_json::from_str(&text).expect("the fixture state is JSON");
        let field = |name: &str| -> String {
            state
                .get(name)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| panic!("the fixture state has no {name}"))
                .to_string()
        };
        let fixture = Self {
            alias: field("alias"),
            config_file: PathBuf::from(field("config_file")),
            home: PathBuf::from(field("home")),
            repo_path: field("repo_path"),
            local_repo_path: PathBuf::from(field("local_repo_path")),
            known_hosts: PathBuf::from(field("known_hosts")),
            host: field("host"),
            port: state.get("port").and_then(serde_json::Value::as_u64),
        };
        if !fixture_is_listening(&fixture.host, fixture.port) {
            eprintln!(
                "skipping: nothing is listening at {}:{} (fixture state exists but the container is stopped)",
                fixture.host,
                fixture
                    .port
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "?".to_string())
            );
            return None;
        }
        Some(fixture)
    }
}

fn ssh_state_path() -> PathBuf {
    match std::env::var("REFYARD_SSH_FIXTURE_STATE") {
        Ok(path) => PathBuf::from(path).join("state.json"),
        Err(_) => {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/native-ssh-fixture/state.json")
        }
    }
}

fn fixture_is_listening(host: &str, port: Option<u64>) -> bool {
    let Ok(address) = host.parse::<std::net::IpAddr>() else {
        return false;
    };
    let Some(port) = port.and_then(|value| u16::try_from(value).ok()) else {
        return false;
    };
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::new(address, port),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
}

/// A provider pointed at the fixture's configuration source, with an environment that
/// carries nothing but a `PATH` and the fixture's own home.
fn fixture_ssh(fixture: &SshFixture) -> refyard_host::providers::ssh::SshGit {
    refyard_host::providers::ssh::SshGit::at_config(
        refyard_host::ssh::openssh::discover().expect("ssh is installed on this machine"),
        ssh_client_environment(&fixture.home),
        &fixture.alias,
        Some(fixture.config_file.clone()),
    )
    .expect("the fixture alias and configuration source are valid")
}

fn ssh_client_environment(home: &Path) -> Vec<(String, String)> {
    vec![
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ),
        ("HOME".to_string(), home.display().to_string()),
        ("LANG".to_string(), "C.UTF-8".to_string()),
        ("TERM".to_string(), "dumb".to_string()),
    ]
}

/// A service with the fixture's SSH target available, plus this machine's own Git for
/// the local comparison, and the write effects registered.
fn ssh_service(fixture: &SshFixture, local: &LocalMirror) -> ApplicationService {
    ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at(git_program(), local.env.clone()),
        service_instance_id: "srvc_ssh_mutations".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: local.home.clone(),
    })
    .with_ssh_config_file(fixture.config_file.clone())
    .with_ssh_environment(ssh_client_environment(&fixture.home))
    .with_state_root(local.temp.path().join("state"))
    .expect("the state directory is writable")
    .with_writes()
}

/// Runs one fixed remote command and fails the test when it did not answer.
///
/// The command strings here are a *fixture*: they create the repository the mutation
/// cases act on, and they never touch the mounted application. Every one is built from
/// literal text plus single-quote encoding, so nothing a caller supplies becomes syntax.
async fn remote_command(ssh: &refyard_host::providers::ssh::SshGit, command: &str) -> Vec<u8> {
    let outcome = ssh.run_raw_command(command, 1 << 20, 1 << 16).await;
    assert!(
        outcome.succeeded(),
        "the fixture command {command:?} failed: state {:?} exit {:?} stderr {}",
        outcome.state,
        outcome.exit_code,
        String::from_utf8_lossy(&outcome.stderr)
    );
    outcome.stdout
}

/// The fixed commands both repositories are seeded with, so their trees — and therefore
/// their initial commit — are byte-identical.
const SEED_FILES: [(&str, &str); 2] = [("a.txt", "alpha\nbeta\n"), ("b.txt", "second\n")];
const SEED_MODIFIED: &str = "alpha\nbeta changed\n";
const SEED_DATE: &str = "2026-01-02T03:04:05+00:00";
const SEED_NAME: &str = "Refyard Fixture";
const SEED_EMAIL: &str = "fixture@refyard.invalid";
const SEED_MESSAGE: &str = "fixture: initial content";

/// The unique directory this test's remote repository lives in.
///
/// Under `/srv`, where the fixture's remote user owns the tree, and unique per test run so
/// two runs — or two cases — never share a repository. Nothing here is on a mounted path:
/// the fixture's seeded repository and the local copy the read comparisons use are never
/// written to.
fn remote_repository_path(label: &str) -> String {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!(
        "/srv/refyard-mutations-{label}-{}-{unique}",
        std::process::id()
    )
}

/// Creates and seeds a fresh repository in the container through the fixture's SSH path.
async fn seed_remote(
    ssh: &refyard_host::providers::ssh::SshGit,
    directory: &str,
    with_modification: bool,
) {
    let quoted = refyard_host::ssh::quote::quote_posix(directory).expect("a quotable path");
    remote_command(ssh, &format!("mkdir -p -- {quoted}")).await;
    remote_command(ssh, &format!("git -C {quoted} init -q -b main")).await;
    remote_command(
        ssh,
        &format!(
            "git -C {quoted} config user.name {} && git -C {quoted} config user.email {}",
            refyard_host::ssh::quote::quote_posix(SEED_NAME).expect("quotable"),
            refyard_host::ssh::quote::quote_posix(SEED_EMAIL).expect("quotable")
        ),
    )
    .await;
    for (name, content) in SEED_FILES {
        write_remote_file(ssh, directory, name, content).await;
    }
    remote_command(ssh, &format!("git -C {quoted} add -A")).await;
    remote_command(
        ssh,
        &format!(
            "GIT_AUTHOR_DATE={date} GIT_COMMITTER_DATE={date} git -C {quoted} commit -q -m {message}",
            date = refyard_host::ssh::quote::quote_posix(SEED_DATE).expect("quotable"),
            message = refyard_host::ssh::quote::quote_posix(SEED_MESSAGE).expect("quotable")
        ),
    )
    .await;
    if with_modification {
        write_remote_file(ssh, directory, "a.txt", SEED_MODIFIED).await;
    }
}

/// Writes one file in the container, byte for byte, with `printf`.
async fn write_remote_file(
    ssh: &refyard_host::providers::ssh::SshGit,
    directory: &str,
    name: &str,
    content: &str,
) {
    let path = format!("{directory}/{name}");
    remote_command(
        ssh,
        &format!(
            "printf {} > {}",
            refyard_host::ssh::quote::quote_posix(content).expect("quotable"),
            refyard_host::ssh::quote::quote_posix(&path).expect("quotable")
        ),
    )
    .await;
}

/// Runs one read plan over SSH and returns its bytes.
async fn remote_bytes(
    ssh: &refyard_host::providers::ssh::SshGit,
    directory: &str,
    plan: refyard_core::plan::GitPlan,
) -> Vec<u8> {
    let outcome = ssh.run(directory, plan, None).await;
    assert!(
        outcome.succeeded() && outcome.output_complete,
        "a read over ssh failed: state {:?} exit {:?} stderr {}",
        outcome.state,
        outcome.exit_code,
        String::from_utf8_lossy(&outcome.stderr)
    );
    outcome.stdout
}

/// The local mirror of the remote seed: same content, same identity, same dates, so the
/// two repositories produce the same object names and their status bytes are comparable.
struct LocalMirror {
    temp: tempfile::TempDir,
    home: PathBuf,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

impl LocalMirror {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&home).expect("create home");
        std::fs::create_dir_all(&repo).expect("create repo");
        std::fs::write(
            home.join(".gitconfig"),
            format!("[user]\n\tname = {SEED_NAME}\n\temail = {SEED_EMAIL}\n"),
        )
        .expect("write the fixture's global config");
        let mirror = Self {
            temp,
            home,
            repo,
            env: Vec::new(),
        };
        let mirror = Self {
            env: fixture_environment(&mirror.home),
            ..mirror
        };
        mirror.seed();
        mirror
    }

    fn git(&self, args: &[&str], dates: bool) -> Vec<u8> {
        let mut command = Command::new(git_program());
        command.args(args).current_dir(&self.repo).env_clear().envs(
            self.env
                .iter()
                .map(|(name, value)| (name.as_str(), value.as_str())),
        );
        if dates {
            command
                .env("GIT_AUTHOR_DATE", SEED_DATE)
                .env("GIT_COMMITTER_DATE", SEED_DATE);
        }
        let output = command.output().expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn seed(&self) {
        self.git(&["init", "-q", "-b", "main"], false);
        self.git(&["config", "user.name", SEED_NAME], false);
        self.git(&["config", "user.email", SEED_EMAIL], false);
        for (name, content) in SEED_FILES {
            std::fs::write(self.repo.join(name), content).expect("write seed");
        }
        self.git(&["add", "-A"], false);
        self.git(&["commit", "-q", "-m", SEED_MESSAGE], true);
        std::fs::write(self.repo.join("a.txt"), SEED_MODIFIED).expect("modify a.txt");
    }

    fn path(&self) -> &str {
        self.repo.to_str().expect("utf8 path")
    }

    /// This machine's git running the same plan, for the byte comparison.
    async fn run(&self, plan: &refyard_core::plan::GitPlan) -> Vec<u8> {
        let git = LocalGit::at(git_program(), self.env.clone());
        let outcome = git.run(&self.repo, plan, None).await;
        assert!(
            outcome.succeeded() && outcome.output_complete,
            "the local mirror read failed: state {:?} exit {:?}",
            outcome.state,
            outcome.exit_code
        );
        outcome.stdout
    }
}

/// The remote repository's HEAD, as the far side spells it.
async fn remote_head(ssh: &refyard_host::providers::ssh::SshGit, directory: &str) -> String {
    let bytes = remote_bytes(ssh, directory, refyard_core::plan::status::plan_head_oid()).await;
    String::from_utf8(bytes).expect("ascii").trim().to_string()
}

/// The commit summary facts that must agree between two repositories whose commits were
/// made at different wall-clock instants: the tree, the subject and the parents.
async fn remote_commit_facts(
    ssh: &refyard_host::providers::ssh::SshGit,
    directory: &str,
) -> Vec<u8> {
    let plan = refyard_core::plan::GitPlan::read(
        ["show", "-s", "--format=%T%x00%s%x00%P"]
            .iter()
            .map(|value| value.to_string())
            .collect(),
    );
    remote_bytes(ssh, directory, plan).await
}

fn local_commit_facts(mirror: &LocalMirror) -> Vec<u8> {
    mirror.git(&["show", "-s", "--format=%T%x00%s%x00%P"], false)
}

/// A status stream's NUL frames without the `# branch.oid` frame.
///
/// Two repositories that committed the same tree at different instants have different
/// commit object names; every other byte of their status must still agree.
fn status_frames_without_head_oid(bytes: &[u8]) -> Vec<Vec<u8>> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|frame| !frame.starts_with(b"# branch.oid "))
        .map(|frame| frame.to_vec())
        .collect()
}

/// The fixture service with its SSH target created from the catalogue, ready to use.
async fn ssh_target(
    service: &ApplicationService,
    fixture: &SshFixture,
) -> refyard_contract::host::ExecutionTargetSummary {
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the fixture config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == fixture.alias)
        .expect("the fixture alias is in its own config");
    let target = service
        .create_target(refyard_host::targets::CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("creating the target is not an error");
    assert_eq!(
        target.state,
        refyard_contract::host::ExecutionTargetState::Ready,
        "the fixture host must probe ready for these cases to mean anything"
    );
    target
}

/// Registers one repository on one target and returns its ids.
///
/// The target is named rather than inferred: two repositories registered through one
/// service are two rows, and picking "the one that is not the other" is how a test ends up
/// comparing a repository with itself.
async fn register_on(
    service: &ApplicationService,
    path: &str,
    target_id: &str,
) -> (String, String) {
    let response = service
        .register_repository_on(path, Some(target_id))
        .await
        .unwrap_or_else(|problem| panic!("registering {path} failed: {problem:?}"));
    let summary = response
        .repositories
        .iter()
        .find(|summary| summary.target_id.as_deref() == Some(target_id))
        .expect("the registered repository row");
    (
        summary.repository_id.clone(),
        summary.primary_worktree_id.clone(),
    )
}

/// Stage one path through the service and require the operation to succeed.
async fn stage_path(
    service: &ApplicationService,
    repository_id: &str,
    worktree_id: &str,
    path_id: &str,
    client_request_id: &str,
) -> String {
    let previews = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.to_string(),
            worktree_id: worktree_id.to_string(),
            path_ids: vec![path_id.to_string()],
        })
        .await
        .expect("the preview read answers");
    let token = previews
        .tokens
        .first()
        .expect("a token")
        .preview_token
        .clone();
    let request = MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.to_string(),
            worktree_id: worktree_id.to_string(),
            expected_snapshot_id: previews.snapshot_id.clone(),
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec![path_id.to_string()],
            preview_tokens: vec![token],
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the stage is accepted");
    let finished = wait_terminal(service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "the stage failed: {:?}",
        finished.problem
    );
    finished.operation_id
}

/// Unstage one path through the service and require the operation to succeed.
async fn unstage_path(
    service: &ApplicationService,
    repository_id: &str,
    worktree_id: &str,
    path_id: &str,
    snapshot_id: &str,
    client_request_id: &str,
) -> refyard_contract::reads::OperationRecord {
    let request = MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.to_string(),
            worktree_id: worktree_id.to_string(),
            expected_snapshot_id: snapshot_id.to_string(),
        },
        operation: MutationOperation::UnstagePaths {
            path_ids: vec![path_id.to_string()],
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the unstage is accepted");
    let finished = wait_terminal(service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "the unstage failed: {:?}",
        finished.problem
    );
    finished
}

/// Submit one commit through the service and return the finished record.
async fn commit_index(
    service: &ApplicationService,
    repository_id: &str,
    worktree_id: &str,
    snapshot_id: &str,
    message: &str,
    client_request_id: &str,
) -> refyard_contract::reads::OperationRecord {
    let request = MutationRequest {
        client_request_id: client_request_id.to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.to_string(),
            worktree_id: worktree_id.to_string(),
            expected_snapshot_id: snapshot_id.to_string(),
        },
        operation: MutationOperation::Commit {
            message: message.to_string(),
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the commit is accepted");
    wait_terminal(service, &accepted.record.operation_id).await
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn stage_unstage_and_commit_over_ssh_leave_the_same_index_as_the_local_flow() {
    // Prevents: a write path that runs *something* over SSH and reports success — the
    // same stages, the same index and the same commit tree have to come out of both
    // transports, and the repository the read comparisons depend on must stay untouched.
    let Some(fixture) = SshFixture::load_or_skip() else {
        return;
    };
    let ssh = fixture_ssh(&fixture);
    let mirror = LocalMirror::new();
    let service = ssh_service(&fixture, &mirror);
    let target = ssh_target(&service, &fixture).await;

    // The fixture's own seeded repository and the local copy of it are off limits: this
    // case works on a repository it creates itself.
    assert_ne!(
        fixture.repo_path,
        fixture.local_repo_path.display().to_string()
    );

    let remote_directory = remote_repository_path("parity");
    seed_remote(&ssh, &remote_directory, true).await;
    let (remote_id, remote_worktree) =
        register_on(&service, &remote_directory, &target.target_id).await;
    let (local_id, local_worktree) = register_on(&service, mirror.path(), "tgt_local").await;
    assert_ne!(remote_id, local_id);
    assert_eq!(
        remote_head(&ssh, &remote_directory).await,
        String::from_utf8(mirror.git(&["rev-parse", "HEAD"], false))
            .expect("ascii")
            .trim()
            .to_string(),
        "the seeds must agree before a difference in the writes can mean anything"
    );

    // The same flow on both sides, compared byte for byte after every step. Only the
    // pre-commit comparisons can be byte-identical: the two commits are made at
    // different wall-clock instants, so their object names differ by design.
    let status_plan = || {
        refyard_core::plan::status::plan_status(refyard_core::plan::status::StatusOptions::default())
    };
    let mut bytes: Vec<(String, Vec<u8>)> = Vec::new();
    for (label, repository_id, worktree_id) in [
        ("remote", &remote_id, &remote_worktree),
        ("local", &local_id, &local_worktree),
    ] {
        let status = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        assert_eq!(letter(&status, "a.txt"), ".M", "{label}");
        let path_id = status
            .entries
            .iter()
            .find(|entry| entry.display_path == "a.txt")
            .expect("the modified file")
            .path_id
            .clone();
        stage_path(
            &service,
            repository_id,
            worktree_id,
            &path_id,
            &format!("crid-{label}-stage-1"),
        )
        .await;
        let after_stage = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        assert_eq!(letter(&after_stage, "a.txt"), "M.", "{label} after stage");
        // The raw bytes right now, so the two transports are compared at the same step.
        let after_stage_bytes = if label == "remote" {
            remote_bytes(&ssh, &remote_directory, status_plan()).await
        } else {
            mirror.run(&status_plan()).await
        };
        bytes.push((format!("{label} after the first stage"), after_stage_bytes));

        let unstage = unstage_path(
            &service,
            repository_id,
            worktree_id,
            &path_id,
            &after_stage.snapshot_id,
            &format!("crid-{label}-unstage"),
        )
        .await;
        assert_eq!(
            unstage.status,
            OperationStatus::Succeeded,
            "{label} unstage"
        );
        let after_unstage = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        assert_eq!(
            letter(&after_unstage, "a.txt"),
            ".M",
            "{label} after unstage"
        );
        let after_unstage_bytes = if label == "remote" {
            remote_bytes(&ssh, &remote_directory, status_plan()).await
        } else {
            mirror.run(&status_plan()).await
        };
        bytes.push((format!("{label} after the unstage"), after_unstage_bytes));

        stage_path(
            &service,
            repository_id,
            worktree_id,
            &path_id,
            &format!("crid-{label}-stage-2"),
        )
        .await;
        let after_second_stage = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        assert_eq!(letter(&after_second_stage, "a.txt"), "M.", "{label}");
        assert_eq!(
            after_second_stage.entry_count, 1,
            "{label}: only the selected path is staged, and nothing else is listed"
        );

        let commit = commit_index(
            &service,
            repository_id,
            worktree_id,
            &after_second_stage.snapshot_id,
            "fixture: the ssh mutation case",
            &format!("crid-{label}-commit"),
        )
        .await;
        assert_eq!(
            commit.status,
            OperationStatus::Succeeded,
            "{label} commit: {:?}",
            commit.problem
        );
        let status_after_commit = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        assert_eq!(
            status_after_commit.entry_count, 0,
            "{label}: the working tree is clean after the commit"
        );
    }

    // The raw bytes have to be equal at every point: the staged index rows carry the
    // object names Git wrote, so a transport that staged something else cannot pass.
    let remote_after_stage = &bytes[0].1;
    let local_after_stage = &bytes[2].1;
    let remote_after_unstage = &bytes[1].1;
    let local_after_unstage = &bytes[3].1;
    assert_eq!(
        remote_after_stage, local_after_stage,
        "the transports disagree about the index after a stage"
    );
    assert_eq!(
        remote_after_unstage, local_after_unstage,
        "the transports disagree about the index after an unstage"
    );
    assert!(
        !remote_after_stage.is_empty(),
        "a status read that answered nothing cannot prove anything"
    );

    // One more modification on each side, so the final comparison is of a non-empty
    // change set rather than of two clean repositories that would agree trivially. The
    // branch oid line is dropped: the two commits were made at different wall-clock
    // instants, so their *object names* differ by design while everything they describe
    // — the committed tree, the index rows, the working tree — must not.
    write_remote_file(&ssh, &remote_directory, "b.txt", "second changed\n").await;
    std::fs::write(mirror.repo.join("b.txt"), "second changed\n").expect("modify");
    let remote_status = remote_bytes(&ssh, &remote_directory, status_plan()).await;
    let local_status = mirror.run(&status_plan()).await;
    assert_eq!(
        status_frames_without_head_oid(&remote_status),
        status_frames_without_head_oid(&local_status),
        "the transports disagree about the state the writes left behind"
    );
    assert!(
        status_frames_without_head_oid(&remote_status).len() > 2,
        "the comparison must include the changed entry, not only the branch headers"
    );

    // The commits differ in their object names (different wall-clock instants) and must
    // agree in everything that describes what was committed.
    assert_eq!(
        remote_commit_facts(&ssh, &remote_directory).await,
        local_commit_facts(&mirror),
        "the two commits do not commit the same tree"
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn an_unborn_repository_unstages_over_ssh_without_touching_the_remote_file() {
    // Prevents: an unborn repository answered with `git restore --staged` (which has no
    // HEAD to restore from) or a fallback that removes the working-tree file.
    let Some(fixture) = SshFixture::load_or_skip() else {
        return;
    };
    let ssh = fixture_ssh(&fixture);
    let mirror = LocalMirror::new();
    let service = ssh_service(&fixture, &mirror);
    let target = ssh_target(&service, &fixture).await;

    let directory = remote_repository_path("unborn");
    let quoted = refyard_host::ssh::quote::quote_posix(&directory).expect("quotable");
    remote_command(&ssh, &format!("mkdir -p -- {quoted}")).await;
    remote_command(&ssh, &format!("git -C {quoted} init -q -b main")).await;
    write_remote_file(&ssh, &directory, "fresh.txt", "never committed\n").await;
    remote_command(&ssh, &format!("git -C {quoted} add -A")).await;

    let (repository_id, worktree_id) = register_on(&service, &directory, &target.target_id).await;
    let status = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    assert_eq!(
        status.head.kind,
        refyard_contract::reads::HeadKind::Unborn,
        "the fixture repository must have no HEAD"
    );
    assert_eq!(letter(&status, "fresh.txt"), "A.");
    let path_id = status
        .entries
        .iter()
        .find(|entry| entry.display_path == "fresh.txt")
        .expect("the added file")
        .path_id
        .clone();

    unstage_path(
        &service,
        &repository_id,
        &worktree_id,
        &path_id,
        &status.snapshot_id,
        "crid-unborn-unstage-ssh",
    )
    .await;

    let after = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    assert_eq!(
        letter(&after, "fresh.txt"),
        "??",
        "the file is untracked rather than staged"
    );
    let content = remote_command(
        &ssh,
        &format!(
            "cat {}",
            refyard_host::ssh::quote::quote_posix(&format!("{directory}/fresh.txt"))
                .expect("quotable")
        ),
    )
    .await;
    assert_eq!(
        content, b"never committed\n",
        "the working-tree file must survive an unstage in an unborn repository"
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_failing_hook_over_ssh_is_visible_and_leaves_the_remote_repository_unchanged() {
    // Prevents: a hook failure swallowed by the transport, or a commit reported as having
    // happened when the user's own pre-commit hook refused it.
    let Some(fixture) = SshFixture::load_or_skip() else {
        return;
    };
    let ssh = fixture_ssh(&fixture);
    let mirror = LocalMirror::new();
    let service = ssh_service(&fixture, &mirror);
    let target = ssh_target(&service, &fixture).await;

    let directory = remote_repository_path("hook");
    seed_remote(&ssh, &directory, true).await;
    let (repository_id, worktree_id) = register_on(&service, &directory, &target.target_id).await;
    let status = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    let path_id = status
        .entries
        .iter()
        .find(|entry| entry.display_path == "a.txt")
        .expect("the modified file")
        .path_id
        .clone();
    stage_path(
        &service,
        &repository_id,
        &worktree_id,
        &path_id,
        "crid-ssh-hook-stage",
    )
    .await;

    let quoted = refyard_host::ssh::quote::quote_posix(&directory).expect("quotable");
    remote_command(
        &ssh,
        &format!(
            "printf {} > {}/.git/hooks/pre-commit && chmod 755 {}/.git/hooks/pre-commit",
            refyard_host::ssh::quote::quote_posix(
                "#!/bin/sh\necho 'the remote fixture hook refuses this commit' >&2\nexit 1\n"
            )
            .expect("quotable"),
            quoted,
            quoted
        ),
    )
    .await;

    let head_before = remote_head(&ssh, &directory).await;
    let staged = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    let commit = commit_index(
        &service,
        &repository_id,
        &worktree_id,
        &staged.snapshot_id,
        "a commit the remote hook refuses",
        "crid-ssh-hook-commit",
    )
    .await;
    assert_eq!(
        commit.status,
        OperationStatus::Failed,
        "the read-back found nothing moved: {:?}",
        commit.problem
    );
    let problem = commit.problem.expect("the hook's error is kept");
    assert!(
        problem
            .message
            .contains("the remote fixture hook refuses this commit"),
        "the remote diagnostic must reach the caller: {problem:?}"
    );

    assert_eq!(
        remote_head(&ssh, &directory).await,
        head_before,
        "no commit may have been created"
    );
    let after = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    assert_eq!(
        letter(&after, "a.txt"),
        "M.",
        "the staged change is exactly where it was"
    );
    let content = remote_command(
        &ssh,
        &format!(
            "cat {}",
            refyard_host::ssh::quote::quote_posix(&format!("{directory}/a.txt")).expect("quotable")
        ),
    )
    .await;
    assert_eq!(content, SEED_MODIFIED.as_bytes());
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_refused_remote_batch_leaves_the_remote_repository_unchanged() {
    // Prevents: a batch that resolves what it can over SSH and stages those paths before
    // failing on the one it could not resolve.
    let Some(fixture) = SshFixture::load_or_skip() else {
        return;
    };
    let ssh = fixture_ssh(&fixture);
    let mirror = LocalMirror::new();
    let service = ssh_service(&fixture, &mirror);
    let target = ssh_target(&service, &fixture).await;

    let directory = remote_repository_path("refused");
    seed_remote(&ssh, &directory, true).await;
    let (repository_id, worktree_id) = register_on(&service, &directory, &target.target_id).await;
    let plan = refyard_core::plan::status::plan_status(
        refyard_core::plan::status::StatusOptions::default(),
    );
    let before = remote_bytes(&ssh, &directory, plan.clone()).await;

    let status = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    let request = MutationRequest {
        client_request_id: "crid-ssh-refused".to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            expected_snapshot_id: status.snapshot_id,
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec!["path_never_minted".to_string()],
            preview_tokens: vec!["pt_never_issued".to_string()],
        },
    };
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted and then refused by its own check");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(
        finished.problem.expect("the refusal").code,
        ProblemCode::NotFound
    );
    assert_eq!(
        remote_bytes(&ssh, &directory, plan).await,
        before,
        "a refused batch must leave the remote repository exactly as it was"
    );
}

/// The read comparisons in `ssh_exec.rs` compare the fixture's seeded repository with its
/// local copy byte for byte. This case is the guard that these mutation cases did not
/// write to either of them.
#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn the_fixture_seeded_repository_and_its_local_copy_are_still_identical() {
    let Some(fixture) = SshFixture::load_or_skip() else {
        return;
    };
    let ssh = fixture_ssh(&fixture);
    let plan = refyard_core::plan::status::plan_status(
        refyard_core::plan::status::StatusOptions::default(),
    );
    let remote = remote_bytes(&ssh, &fixture.repo_path, plan.clone()).await;
    let local_git = LocalGit::at(git_program(), ssh_client_environment(&fixture.home));
    let outcome = local_git.run(&fixture.local_repo_path, &plan, None).await;
    assert!(outcome.succeeded(), "the local copy is readable");
    assert_eq!(
        remote, outcome.stdout,
        "the mutation cases wrote to the fixture's seeded repository or its local copy"
    );
    assert!(
        fixture.known_hosts.is_file(),
        "the fixture's client files are untouched"
    );
}
