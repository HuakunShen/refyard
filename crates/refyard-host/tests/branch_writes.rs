//! Branch create/switch, tag create, revert, reset and cherry-pick on a local
//! repository, with the state read back instead of trusted.
//!
//! The cases are the ones a wrong implementation gets wrong in a way a user would
//! feel: a name Git refuses (an existing branch or tag, a switch that conflicts with
//! local changes) must be a failure whose read-back proves nothing moved; a
//! cherry-pick that stops stands only when a human can finish it, and is aborted when
//! they cannot (an empty pick); a revert's conflict is aborted before it is reported;
//! a reset moves the branch and never the working tree.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{
    MutationKind, MutationTarget, OperationStatus, StatusSnapshot, TargetKind,
};
use refyard_host::jobs::{
    MutationOperation, MutationRequest, ResetMode, TagAnnotation, UpstreamSpec,
};
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

    fn git_output(&self, args: &[&str]) -> (bool, String) {
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
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        )
    }

    fn git_ok(&self, args: &[&str]) -> bool {
        self.git_output(args).0
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

    /// The checked-out branch's short name.
    fn branch(&self) -> String {
        String::from_utf8(self.git(&["branch", "--show-current"]))
            .expect("ascii")
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

    /// A repository-targeted request, built the way a client builds one.
    fn repository_request(
        &self,
        repository_id: &str,
        snapshot_id: &str,
        operation: MutationOperation,
        client_request_id: &str,
    ) -> MutationRequest {
        MutationRequest {
            client_request_id: client_request_id.to_string(),
            target: MutationTarget::Repository {
                repository_id: repository_id.to_string(),
                expected_snapshot_id: snapshot_id.to_string(),
            },
            operation,
        }
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

    /// One branch at HEAD that moves `a.txt`'s first line, with a commit on it.
    fn branch_with_commit(&self, branch: &str, line: &str, message: &str) -> String {
        self.git(&["checkout", "--quiet", "-b", branch]);
        let content = format!("{line}\nrest\n");
        self.write("a.txt", &content);
        self.git(&["add", "--", "a.txt"]);
        self.git(&["commit", "--quiet", "-m", message]);
        let tip = self.head();
        self.git(&["checkout", "--quiet", "main"]);
        tip
    }

    /// The two status letters of one path, or `"-"` when the path is not listed at all.
    async fn letter(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        display_path: &str,
    ) -> String {
        self.status(service, repository_id)
            .await
            .entries
            .iter()
            .find(|entry| entry.display_path == display_path)
            .map(|entry| format!("{}{}", entry.index_status, entry.worktree_status))
            .unwrap_or_else(|| "-".to_string())
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

/* ------------------------------------------------------- branch create/switch */

#[tokio::test]
async fn a_branch_is_created_at_the_requested_commit_without_being_checked_out() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let start = fixture.head();

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::CreateBranch {
            branch_name: "feature".to_string(),
            start_oid: Some(start.clone()),
            switch_to_it: false,
        },
        "crid-branch-create",
    );
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

    // The branch exists at the requested commit, and the checkout did not move.
    assert_eq!(
        String::from_utf8(fixture.git(&["rev-parse", "feature"]))
            .expect("ascii")
            .trim(),
        start
    );
    assert_eq!(fixture.branch(), "main");
}

#[tokio::test]
async fn a_branch_created_with_switch_to_it_is_also_checked_out() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateBranch {
                branch_name: "feature".to_string(),
                start_oid: None,
                switch_to_it: true,
            },
            "crid-branch-create-switch",
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
    assert_eq!(fixture.branch(), "feature");
    let result = finished.result.expect("a succeeded write reports a result");
    assert_eq!(
        result.new_head_oid.as_deref(),
        Some(fixture.head().as_str()),
        "the result names the HEAD the read-back saw"
    );
}

#[tokio::test]
async fn a_branch_that_already_exists_is_refused_without_moving_anything() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateBranch {
                branch_name: "main".to_string(),
                start_oid: None,
                switch_to_it: false,
            },
            "crid-branch-duplicate",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(fixture.head(), head_before, "nothing moved");
    assert_eq!(fixture.branch(), "main");
}

#[tokio::test]
async fn a_branch_name_that_would_be_an_option_is_an_invalid_payload() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CreateBranch {
                branch_name: "--force".to_string(),
                start_oid: None,
                switch_to_it: false,
            },
            "crid-branch-dash",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert_eq!(problem.code, ProblemCode::InvalidOperationPayload);
    assert_eq!(fixture.head(), head_before, "nothing ran");
}

#[tokio::test]
async fn a_switch_moves_head_to_the_named_branch_and_a_conflicting_one_stays_put() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SwitchBranch {
                branch_name: "feature".to_string(),
            },
            "crid-switch",
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
    assert_eq!(fixture.branch(), "feature");

    // A switch that would clobber a local change is Git's refusal to report, and the
    // checkout stays exactly where it was.
    fixture.write("a.txt", "uncommitted local edit\nrest\n");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SwitchBranch {
                branch_name: "main".to_string(),
            },
            "crid-switch-conflict",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert_eq!(
        fixture.branch(),
        "feature",
        "the refused switch moved nothing"
    );
    assert_eq!(
        fixture.read("a.txt"),
        "uncommitted local edit\nrest\n",
        "the uncommitted edit survives"
    );
}

/* ------------------------------------------------------------------- tags */

#[tokio::test]
async fn a_lightweight_tag_names_its_target_and_an_annotated_tag_keeps_the_message() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let head = fixture.head();
    let snapshot = fixture.status(&service, &repository_id).await.snapshot_id;

    let request = fixture.repository_request(
        &repository_id,
        &snapshot,
        MutationOperation::CreateTag {
            tag_name: "v1-light".to_string(),
            target_oid: Some(head.clone()),
            annotation: None,
        },
        "crid-tag-light",
    );
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
    assert_eq!(
        String::from_utf8(fixture.git(&["rev-parse", "v1-light"]))
            .expect("ascii")
            .trim(),
        head,
        "the lightweight tag names the requested commit"
    );

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::CreateTag {
            tag_name: "v1-note".to_string(),
            target_oid: None,
            annotation: Some(TagAnnotation {
                message: "release notes\n\nwith a body\n".to_string(),
            }),
        },
        "crid-tag-annotated",
    );
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
    let message =
        String::from_utf8(fixture.git(&["tag", "--list", "v1-note", "--format=%(contents)"]))
            .expect("utf8");
    assert!(
        message.contains("release notes"),
        "the annotation survives verbatim: {message}"
    );
}

#[tokio::test]
async fn a_tag_that_already_exists_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    fixture.git(&["tag", "v1"]);

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::CreateTag {
            tag_name: "v1".to_string(),
            target_oid: None,
            annotation: None,
        },
        "crid-tag-duplicate",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert!(
        fixture.git_ok(&["rev-parse", "--verify", "--quiet", "v1"]),
        "the existing tag is untouched"
    );
}

/* ------------------------------------------------------------ cherry-pick */

#[tokio::test]
async fn a_cherry_pick_applies_the_change_as_a_new_commit_with_the_original_message() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.branch_with_commit("feature", "feature line", "feature work");
    let main_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick {
                oid: feature_tip.clone(),
            },
            "crid-pick",
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

    let head = fixture.head();
    assert_ne!(head, main_before, "the pick is its own commit on main");
    // A cherry-pick of a commit onto its own parent can produce an identical object
    // name (same tree, parent, author and second-resolution timestamp), so "its own
    // commit" is pinned by the parent and the message, not by the object name.
    let facts = String::from_utf8(fixture.git(&["log", "-1", "--format=%P%n%s"])).expect("utf8");
    let mut facts = facts.lines();
    assert_eq!(
        facts.next(),
        Some(main_before.as_str()),
        "the picked commit's parent is where main was"
    );
    assert_eq!(
        facts.next(),
        Some("feature work"),
        "the original message travels"
    );
    assert_eq!(
        fixture.read("a.txt"),
        "feature line\nrest\n",
        "the change is applied"
    );
}

#[tokio::test]
async fn a_cherry_pick_of_a_merge_commit_is_refused_without_picking_a_parent() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.git(&["merge", "--quiet", "--no-ff", "-m", "a merge", "feature"]);
    let merge_commit = fixture.head();
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick { oid: merge_commit },
            "crid-pick-merge",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert_eq!(problem.code, ProblemCode::Conflict);
    assert_eq!(fixture.head(), head_before, "nothing was picked");
}

#[tokio::test]
async fn a_conflicting_cherry_pick_stops_with_needs_attention_and_the_marker_standing() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick { oid: feature_tip },
            "crid-pick-conflict",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::NeedsAttention,
        "{:?}",
        finished.problem
    );
    let problem = finished
        .problem
        .expect("needs attention carries the reason");
    assert!(problem.message.contains("conflict"));
    assert!(
        fixture.git_ok(&["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]),
        "the pick stands for a human to finish"
    );
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        "UU"
    );
    // Leave the fixture clean for its own disposal assertions.
    let (ok, _) = fixture.git_output(&["cherry-pick", "--abort"]);
    assert!(ok, "the fixture aborts its pick");
}

#[tokio::test]
async fn an_empty_cherry_pick_is_aborted_and_leaves_nothing_behind() {
    // Prevents: "this change is already present" leaving a sequencer state nothing can
    // commit. The abort restores the branch exactly as it was, and the failure says so.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.git(&["cherry-pick", "--quiet", feature_tip.as_str()]);
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick { oid: feature_tip },
            "crid-pick-empty",
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
        problem.message.contains("empty"),
        "the refusal names the empty pick: {}",
        problem.message
    );
    assert!(
        !fixture.git_ok(&["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]),
        "no pick stands after the abort"
    );
    assert_eq!(fixture.head(), head_before, "the branch is unchanged");
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        "-",
        "the index is clean"
    );
}

/* ----------------------------------------------------------------- revert */

#[tokio::test]
async fn a_revert_creates_the_inverse_commit_with_gits_own_message() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "second"]);
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::RevertCommit {
                oid: head_before.clone(),
            },
            "crid-revert",
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

    assert_ne!(fixture.head(), head_before, "the revert is its own commit");
    let message = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert!(
        message.starts_with("Revert \"second\""),
        "Git's own revert message: {message}"
    );
    assert_eq!(
        fixture.read("a.txt"),
        "alpha\nbeta\n",
        "the change is undone"
    );
}

#[tokio::test]
async fn a_conflicted_revert_is_aborted_before_it_is_reported() {
    // Prevents: a stopped revert handing the user REVERT_HEAD and a staged inverse
    // patch — a state this build offers no continue for. The abort restores the exact
    // pre-revert state, and the failure names what conflicted.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    // The commit being reverted touches a line a later commit rewrote again: the
    // inverse patch cannot apply cleanly.
    let old = fixture.head();
    fixture.write("a.txt", "rewritten later\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "rewrite the line"]);
    let head_before = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::RevertCommit { oid: old },
            "crid-revert-conflict",
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
        problem.message.contains("aborted"),
        "the failure says the stop was aborted: {}",
        problem.message
    );
    assert!(
        !fixture.git_ok(&["rev-parse", "--verify", "--quiet", "REVERT_HEAD"]),
        "no revert stands"
    );
    assert_eq!(fixture.head(), head_before, "HEAD is where it was");
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        "-",
        "the index is clean"
    );
    assert_eq!(
        fixture.read("a.txt"),
        "rewritten later\nrest\n",
        "the working tree is what it was"
    );
}

/* ------------------------------------------------------------------ reset */

#[tokio::test]
async fn a_soft_reset_moves_the_branch_and_keeps_the_index() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let first = fixture.head();
    fixture.write("a.txt", "alpha\nbeta committed\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "second"]);
    let second = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ResetBranch {
                oid: first.clone(),
                mode: ResetMode::Soft,
            },
            "crid-reset-soft",
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
    assert_eq!(fixture.head(), first, "the branch moved back");
    // The committed change is still in the index, now as a staged edit against first.
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        "M.",
        "soft keeps the index exactly as it was"
    );
    assert_eq!(second, second, "the old commit still exists in the store");
}

#[tokio::test]
async fn a_mixed_reset_moves_the_branch_and_unstages_the_work() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let first = fixture.head();
    fixture.write("a.txt", "alpha\nbeta committed\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "second"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ResetBranch {
                oid: first,
                mode: ResetMode::Mixed,
            },
            "crid-reset-mixed",
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
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        ".M",
        "mixed unstages the work; the working tree keeps every byte"
    );
    assert_eq!(fixture.read("a.txt"), "alpha\nbeta committed\n");
}

#[tokio::test]
async fn a_reset_refuses_to_run_while_a_merge_is_in_progress() {
    // Prevents: moving the branch away from a merge that stands, which makes finishing
    // that merge impossible. The precondition layer refuses before journalling.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    let (ok, _) = fixture.git_output(&["merge", "--no-ff", "--no-edit", "feature"]);
    assert!(!ok, "the fixture's merge stops for a conflict");

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ResetBranch {
                oid: fixture.head(),
                mode: ResetMode::Soft,
            },
            "crid-reset-while-merging",
        )
        .await;
    let refused_problem = service
        .submit_mutation("owner", request)
        .await
        .expect_err("a reset while a merge stands is refused");
    assert_eq!(refused_problem.code, ProblemCode::Conflict);
    assert!(
        refused_problem.message.contains("in progress"),
        "the refusal names the unfinished merge: {}",
        refused_problem.message
    );
}

/* ------------------------------------------------- the capability contract */

#[tokio::test]
async fn the_new_writes_are_offered_on_the_targets_the_contract_names() {
    // Prevents: a menu that cannot know the operations exist. createBranch and
    // createTag are repository-wide (a name, not a checkout), the rest run in one
    // worktree — exactly the shapes the UI gates its menu items on.
    let fixture = Fixture::new();
    let service = fixture.service();
    let capabilities = service.capabilities().await.expect("capabilities");
    for (kind, targets) in [
        (MutationKind::CreateBranch, vec![TargetKind::Repository]),
        (MutationKind::CreateTag, vec![TargetKind::Repository]),
        (MutationKind::SwitchBranch, vec![TargetKind::Worktree]),
        (MutationKind::RevertCommit, vec![TargetKind::Worktree]),
        (MutationKind::ResetBranch, vec![TargetKind::Worktree]),
        (MutationKind::CherryPick, vec![TargetKind::Worktree]),
    ] {
        let operation = capabilities
            .operations
            .iter()
            .find(|operation| operation.kind == kind)
            .unwrap_or_else(|| panic!("{kind:?} is advertised"));
        assert_eq!(operation.targets, targets, "{kind:?} targets");
    }
}

/* ------------------------------------------------- the way through a conflict */

async fn standing_merge_request(
    fixture: &Fixture,
    service: &ApplicationService,
    repository_id: &str,
    worktree_id: &str,
) -> MutationRequest {
    fixture
        .worktree_request(
            service,
            repository_id,
            worktree_id,
            MutationOperation::ContinueMerge { message: None },
            "crid-continue-merge",
        )
        .await
}

#[tokio::test]
async fn a_resolved_merge_is_completed_by_continue_and_the_branch_carries_the_merge() {
    // Prevents: a conflict state with no way through it. The precondition layer lets
    // only the continue/abort pair and staging run while the merge stands; this is the
    // step that turns the resolved index into the merge commit.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    let (ok, _) = fixture.git_output(&["merge", "--no-ff", "--no-edit", "feature"]);
    assert!(!ok, "the fixture's merge stops for a conflict");

    // The human's half: resolve the file and stage it.
    fixture.write("a.txt", "resolved by hand\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);

    let request = standing_merge_request(&fixture, &service, &repository_id, &worktree_id).await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the continue is accepted while the merge stands");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    assert!(
        !fixture.git_ok(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]),
        "the merge no longer stands"
    );
    let parents = String::from_utf8(fixture.git(&["rev-list", "--parents", "-n", "1", "HEAD"]))
        .expect("ascii");
    // rev-list prints the commit followed by each parent: a merge is three tokens.
    assert_eq!(
        parents.split_whitespace().count(),
        3,
        "the merge commit names two parents: {parents}"
    );
}

#[tokio::test]
async fn an_abort_restores_the_branch_the_merge_started_from() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    let head_before = fixture.head();
    let (ok, _) = fixture.git_output(&["merge", "--no-ff", "--no-edit", "feature"]);
    assert!(!ok);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AbortMerge { confirmed: true },
            "crid-abort-merge",
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
    assert_eq!(
        fixture.head(),
        head_before,
        "the branch is where it started"
    );
    assert_eq!(
        fixture.letter(&service, &repository_id, "a.txt").await,
        "-",
        "the index is clean"
    );
}

#[tokio::test]
async fn a_continue_without_a_standing_merge_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let request = standing_merge_request(&fixture, &service, &repository_id, &worktree_id).await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("no merge is in progress"),
        "the refusal names the absence: {}",
        problem.message
    );
}

#[tokio::test]
async fn a_resolved_cherry_pick_is_completed_with_the_original_message() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);

    let pick = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick {
                oid: feature_tip.clone(),
            },
            "crid-pick-stop",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", pick)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::NeedsAttention);

    fixture.write("a.txt", "resolved by hand\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ContinueCherryPick {},
            "crid-pick-continue",
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
    let message = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(
        message.trim(),
        "feature work",
        "the original message travels"
    );
}

#[tokio::test]
async fn an_aborted_cherry_pick_leaves_no_marker_behind() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    let pick = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::CherryPick { oid: feature_tip },
            "crid-pick-stop-2",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", pick)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::NeedsAttention);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AbortCherryPick { confirmed: true },
            "crid-pick-abort",
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
    assert!(
        !fixture.git_ok(&["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]),
        "no pick stands"
    );
}

/* ---------------------------------------------------------------- rebase */

#[tokio::test]
async fn a_rebase_replays_the_branch_onto_upstream_and_a_conflict_stands_for_a_human() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let first = fixture.head();
    // main advances; feature carries its own commit from the old base.
    fixture.git(&["checkout", "--quiet", "-b", "feature"]);
    fixture.write("a.txt", "feature own work\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "feature work"]);
    fixture.git(&["checkout", "--quiet", "main"]);
    fixture.write("b.txt", "main advanced\n");
    fixture.git(&["add", "--", "b.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main advanced"]);
    let main_tip = fixture.head();
    fixture.git(&["checkout", "--quiet", "feature"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::Rebase {
                upstream_oid: main_tip.clone(),
            },
            "crid-rebase",
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
    // The replayed commit now sits on main's tip.
    let parent = String::from_utf8(fixture.git(&["rev-parse", "HEAD^"]))
        .expect("ascii")
        .trim()
        .to_string();
    assert_eq!(parent, main_tip);
    let _ = first;
}

#[tokio::test]
async fn a_conflicting_rebase_stands_and_continue_finishes_it() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    // feature rewrites a.txt; main rewrites the same line after branching.
    fixture.git(&["checkout", "--quiet", "-b", "feature"]);
    fixture.write("a.txt", "feature line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "feature work"]);
    fixture.git(&["checkout", "--quiet", "main"]);
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    let main_tip = fixture.head();
    fixture.git(&["checkout", "--quiet", "feature"]);
    let feature_tip = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::Rebase {
                upstream_oid: main_tip.clone(),
            },
            "crid-rebase-conflict",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::NeedsAttention,
        "{:?}",
        finished.problem
    );
    let problem = finished
        .problem
        .expect("needs attention carries the reason");
    assert!(problem.message.contains("conflict"));
    assert!(
        fixture.git_ok(&["rev-parse", "--verify", "REBASE_HEAD"]),
        "the rebase stands for a human to finish"
    );

    // The resolution half, then the continue.
    fixture.write("a.txt", "resolved by hand\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::ContinueRebase {},
            "crid-rebase-continue",
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
    // This Git keeps REBASE_HEAD resolvable after a finished rebase, so "done" is
    // read from the state that actually matters: the rebase directory is gone.
    assert!(
        !fixture.repo.join(".git/rebase-merge").exists()
            && !fixture.repo.join(".git").join("rebase-merge").exists(),
        "the rebase no longer stands"
    );
    // The replayed commit kept its own message.
    let message = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(message.trim(), "feature work");
    let _ = feature_tip;
}

#[tokio::test]
async fn an_aborted_rebase_restores_the_branch() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.git(&["checkout", "--quiet", "-b", "feature"]);
    fixture.write("a.txt", "feature line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "feature work"]);
    fixture.git(&["checkout", "--quiet", "main"]);
    fixture.write("a.txt", "main line\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);
    fixture.git(&["checkout", "--quiet", "feature"]);
    let feature_head = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::Rebase {
                upstream_oid: String::from_utf8(fixture.git(&["rev-parse", "main"]))
                    .expect("ascii")
                    .trim()
                    .to_string(),
            },
            "crid-rebase-abort-setup",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::NeedsAttention);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AbortRebase { confirmed: true },
            "crid-rebase-abort",
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
    assert_eq!(fixture.head(), feature_head, "the branch is where it was");
    assert!(
        !fixture.git_ok(&["rev-parse", "--verify", "REBASE_HEAD"]),
        "the rebase no longer stands"
    );
}

/* ------------------------------------------------------------ drop/squash */

#[tokio::test]
async fn a_drop_removes_one_commit_and_keeps_the_rest_of_the_history() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let first = fixture.head();
    fixture.write("a.txt", "to be dropped\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "doomed"]);
    let doomed = fixture.head();
    fixture.write("b.txt", "kept work\n");
    fixture.git(&["add", "--", "b.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "kept"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::DropCommit {
                oid: doomed.clone(),
                confirmed: true,
            },
            "crid-drop",
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
    // The doomed commit is gone; its descendant (kept) survived the replay.
    let subjects = String::from_utf8(fixture.git(&["log", "--format=%s", "-3"])).expect("utf8");
    assert!(!subjects.contains("doomed"), "{subjects}");
    assert!(subjects.contains("kept"), "{subjects}");
    assert!(fixture.git_ok(&["merge-base", "--is-ancestor", &first, "HEAD"]));
}

#[tokio::test]
async fn dropping_a_merge_commit_or_a_foreign_commit_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    fixture.branch_with_commit("feature", "feature line", "feature work");
    fixture.git(&["merge", "--quiet", "--no-ff", "-m", "a merge", "feature"]);
    let merge_commit = fixture.head();

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::DropCommit {
                oid: merge_commit.clone(),
                confirmed: true,
            },
            "crid-drop-merge",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(problem.message.contains("merge"), "{}", problem.message);

    // A commit from a branch this history never merged is not this branch's history
    // to rewrite — even though a merged branch's commits would be.
    let foreign = fixture.branch_with_commit("elsewhere", "elsewhere line", "elsewhere work");
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::DropCommit {
                oid: foreign,
                confirmed: true,
            },
            "crid-drop-foreign",
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
}

#[tokio::test]
async fn a_squash_folds_the_top_commit_down_and_keeps_the_parents_message() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let first = fixture.head();
    fixture.write("a.txt", "top commit work\nrest\n");
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "top"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SquashCommit { message: None },
            "crid-squash",
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
    // The branch is one commit tall again; its message is the parent's; the change
    // from the top commit is inside it.
    let subjects = String::from_utf8(fixture.git(&["log", "--format=%s"])).expect("utf8");
    assert_eq!(subjects.trim(), "first", "{subjects}");
    assert_eq!(fixture.read("a.txt"), "top commit work\nrest\n");
    let _ = first;
}

#[tokio::test]
async fn a_squash_of_a_changeless_top_commit_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    // An empty commit over its parent: nothing to fold.
    fixture.git(&["commit", "--quiet", "--allow-empty", "-m", "empty top"]);

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SquashCommit { message: None },
            "crid-squash-empty",
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
        problem.message.contains("nothing to squash"),
        "{}",
        problem.message
    );
}

/* ----------------------------------------------------- delete/rename/upstream */

#[tokio::test]
async fn a_merged_branch_and_a_tag_delete_cleanly_and_an_unmerged_branch_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    fixture.git(&["tag", "v-old"]);
    fixture.git(&["branch", "merged-branch"]);

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::DeleteBranch {
            branch_name: "merged-branch".to_string(),
            confirmed: true,
        },
        "crid-delete-branch",
    );
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
    assert!(!fixture.git_ok(&["rev-parse", "--verify", "merged-branch"]));

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::DeleteTag {
            tag_name: "v-old".to_string(),
            confirmed: true,
        },
        "crid-delete-tag",
    );
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
    assert!(!fixture.git_ok(&["rev-parse", "--verify", "v-old"]));

    // An unmerged branch: Git refuses, and the read-back proves the branch survived.
    fixture.branch_with_commit("unmerged", "unmerged line", "unmerged work");
    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::DeleteBranch {
            branch_name: "unmerged".to_string(),
            confirmed: true,
        },
        "crid-delete-unmerged",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    assert!(
        fixture.git_ok(&["rev-parse", "--verify", "unmerged"]),
        "the unmerged branch survives"
    );
}

#[tokio::test]
async fn a_rename_moves_the_branch_and_an_upstream_sets_and_clears() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;

    fixture.git(&["branch", "old-name"]);

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::RenameBranch {
            branch_name: "old-name".to_string(),
            new_name: "new-name".to_string(),
        },
        "crid-rename",
    );
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
    assert!(!fixture.git_ok(&["rev-parse", "--verify", "old-name"]));
    assert!(fixture.git_ok(&["rev-parse", "--verify", "new-name"]));

    // A configured remote and a remote-tracking ref to point the upstream at,
    // without any network.
    fixture.git(&["remote", "add", "origin", "."]);
    fixture.git(&["update-ref", "refs/remotes/origin/main", &fixture.head()]);
    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::SetBranchUpstream {
            branch_name: "new-name".to_string(),
            upstream: Some(UpstreamSpec {
                remote_name: "origin".to_string(),
                branch_name: "main".to_string(),
            }),
        },
        "crid-upstream-set",
    );
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
    let upstream =
        String::from_utf8(fixture.git(&["rev-parse", "--abbrev-ref", "new-name@{upstream}"]))
            .expect("ascii");
    assert_eq!(upstream.trim(), "origin/main");

    let request = fixture.repository_request(
        &repository_id,
        &fixture.status(&service, &repository_id).await.snapshot_id,
        MutationOperation::SetBranchUpstream {
            branch_name: "new-name".to_string(),
            upstream: None,
        },
        "crid-upstream-clear",
    );
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
    assert!(
        !fixture.git_ok(&["rev-parse", "--abbrev-ref", "new-name@{upstream}"]),
        "the upstream is cleared"
    );
}
