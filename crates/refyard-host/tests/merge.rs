//! Merge — the write that can legitimately stop in the middle — on a local repository,
//! with the state read back instead of trusted.
//!
//! The cases here are the ones a wrong merge implementation gets wrong in a way a user
//! would feel:
//!
//! - a fast-forward is reported with the HEAD the read-back found, not the one Git was
//!   asked for;
//! - a conflicting merge is `needsAttention` with `MERGE_HEAD` left standing — the merge
//!   is unfinished, not undone — and a second merge is refused while it stands;
//! - an already-merged source is a success that moved nothing, never a failure;
//! - a source that is not a commit, or not an object name at all, is refused before Git
//!   runs, because a leading dash or a path must never reach `git merge`'s argv;
//! - an unborn head has nothing to merge into and is refused with that reason.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{
    MutationKind, MutationTarget, OperationStatus, StatusSnapshot, TargetKind,
};
use refyard_host::jobs::{MergeMode, MutationOperation, MutationRequest};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

/* ------------------------------------------------------------------ fixture */

/// Everything one merge request names, apart from where it is aimed.
struct MergeAsk<'a> {
    source: &'a str,
    mode: MergeMode,
    message: Option<&'a str>,
    client_request_id: &'a str,
}

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

    fn git_ok(&self, args: &[&str]) -> bool {
        Command::new(git_program())
            .args(args)
            .current_dir(&self.repo)
            .env_clear()
            .envs(
                self.env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str())),
            )
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    fn write(&self, relative: &str, content: &str) {
        std::fs::write(self.repo.join(relative), content).expect("write file");
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
            service_instance_id: "srvc_merge".to_string(),
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

    fn merge_request(
        &self,
        repository_id: &str,
        worktree_id: &str,
        snapshot_id: &str,
        ask: MergeAsk<'_>,
    ) -> MutationRequest {
        MutationRequest {
            client_request_id: ask.client_request_id.to_string(),
            target: MutationTarget::Worktree {
                repository_id: repository_id.to_string(),
                worktree_id: worktree_id.to_string(),
                expected_snapshot_id: snapshot_id.to_string(),
            },
            operation: MutationOperation::Merge {
                source_oid: ask.source.to_string(),
                mode: ask.mode,
                message: ask.message.map(str::to_string),
            },
        }
    }

    /// A merge request with a snapshot this service minted just now.
    async fn fresh_merge_request(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        worktree_id: &str,
        ask: MergeAsk<'_>,
    ) -> MutationRequest {
        let snapshot_id = self.status(service, repository_id).await.snapshot_id;
        self.merge_request(repository_id, worktree_id, &snapshot_id, ask)
    }

    /// One branch at HEAD that moves `a.txt`'s first line to `line`, with a commit.
    fn diverge(&self, branch: &str, line: &str, message: &str) -> String {
        self.git(&["checkout", "--quiet", "-b", branch]);
        let content = format!("{line}\nrest\n");
        self.write("a.txt", &content);
        self.git(&["add", "--", "a.txt"]);
        self.git(&["commit", "--quiet", "-m", message]);
        let tip = self.head();
        self.git(&["checkout", "--quiet", "main"]);
        tip
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

/// The two status letters of one path, or `"-"` when the path is not listed at all.
fn letter(status: &StatusSnapshot, display_path: &str) -> String {
    status
        .entries
        .iter()
        .find(|entry| entry.display_path == display_path)
        .map(|entry| format!("{}{}", entry.index_status, entry.worktree_status))
        .unwrap_or_else(|| "-".to_string())
}

/* ------------------------------------------------------------- capabilities */

#[tokio::test]
async fn merge_is_offered_on_a_worktree_target_once_registered() {
    // Prevents: a menu that cannot know the operation exists. The capability answer is
    // what the UI gates every merge item on, so a merge that runs but is not advertised
    // is as wrong as one that is advertised and refuses.
    let fixture = Fixture::new();
    let service = fixture.service();
    let capabilities = service.capabilities().await.expect("capabilities");
    let merge = capabilities
        .operations
        .iter()
        .find(|operation| operation.kind == MutationKind::Merge)
        .expect("merge is advertised");
    assert_eq!(merge.targets, vec![TargetKind::Worktree]);
}

/* ------------------------------------------------------------------ merge */

#[tokio::test]
async fn a_fast_forwardable_merge_moves_head_to_the_merged_commit() {
    // Prevents: a merge reported with the object name it was asked for rather than the
    // HEAD the read-back found — the two differ the moment anything else moved.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.diverge("feature", "feature line", "feature work");

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-ff",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    let result = finished.result.expect("a succeeded merge reports a result");
    assert_eq!(
        result.new_head_oid.as_deref(),
        Some(feature_tip.as_str()),
        "fast-forward: HEAD is the merged commit"
    );
    assert_eq!(fixture.head(), feature_tip);
}

#[tokio::test]
async fn a_no_ff_merge_creates_a_merge_commit_with_the_message_given() {
    // Prevents: a mode flag that is dropped on the way to argv, turning "always a merge
    // commit" into a silent fast-forward, and a message that Git's cleanup rewrites.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.diverge("feature", "feature line", "feature work");
    let main_before = fixture.head();

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::NoFF,
                message: Some("merge the feature\n\nwith a body\n"),
                client_request_id: "crid-merge-no-ff",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );

    let head = fixture.head();
    assert_ne!(head, main_before, "HEAD moved");
    assert_ne!(head, feature_tip, "the merge commit is its own commit");
    let parents = String::from_utf8(fixture.git(&["rev-list", "--parents", "-n", "1", "HEAD"]))
        .expect("object names are ascii");
    assert_eq!(
        parents.split_whitespace().count(),
        3,
        "a merge commit names two parents: {parents}"
    );
    let message =
        String::from_utf8(fixture.git(&["log", "-1", "--format=%B"])).expect("utf8 message");
    // `git merge -m` runs Git's own message normalisation, which terminates the message
    // with a newline — the same behaviour the browser form's `-m` produces, since the
    // two run the same argv.
    assert_eq!(message, "merge the feature\n\nwith a body\n\n");
}

#[tokio::test]
async fn an_already_merged_source_succeeds_without_moving_head() {
    // Prevents: "Already up to date." being read as a failure because HEAD did not move —
    // a merge of a merged branch is a no-op success, and the second entry in a re-opened
    // menu must not report an error for it.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.diverge("feature", "feature line", "feature work");
    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-first",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Succeeded);
    let merged_head = fixture.head();

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-again",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the second merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Succeeded,
        "{:?}",
        finished.problem
    );
    let result = finished.result.expect("an up-to-date merge still succeeds");
    assert_eq!(
        result.new_head_oid.as_deref(),
        Some(merged_head.as_str()),
        "nothing moved"
    );
}

#[tokio::test]
async fn a_conflicting_merge_stops_with_needs_attention_and_merge_head_standing() {
    // Prevents: a conflicted merge reported as `failed`, which tells the UI nothing
    // happened when Git in fact left MERGE_HEAD and a three-way index behind — the state
    // the user now has to resolve.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.diverge("feature", "feature line", "feature work");
    // main moves the same line: the histories diverge on one path.
    let content = "main line\nrest\n";
    fixture.write("a.txt", content);
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-conflict",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
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
    assert_eq!(problem.code, ProblemCode::NeedsAttention);
    assert!(
        problem.message.contains("conflict"),
        "the message names the conflicts: {}",
        problem.message
    );
    assert!(
        problem.message.contains('1'),
        "the message counts the conflicted paths: {}",
        problem.message
    );
    // The merge is unfinished, not undone: MERGE_HEAD stands and the path is unmerged.
    assert!(
        fixture.git_ok(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]),
        "MERGE_HEAD is left standing"
    );
    let status = fixture.status(&service, &repository_id).await;
    assert_eq!(letter(&status, "a.txt"), "UU");
}

#[tokio::test]
async fn a_merge_refuses_to_start_while_another_is_in_progress() {
    // Prevents: a second merge walking into the unfinished one — the next request must
    // refuse against the state that is actually there.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let feature_tip = fixture.diverge("feature", "feature line", "feature work");
    let content = "main line\nrest\n";
    fixture.write("a.txt", content);
    fixture.git(&["add", "--", "a.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "main work"]);

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-conflicted",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::NeedsAttention);
    let head_before = fixture.head();

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &feature_tip,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-while-merging",
            },
        )
        .await;
    // The precondition layer refuses the request before it is even journalled: an
    // unfinished merge is a state every other write must stay out of, and the refusal
    // names it rather than queueing an operation that could only fail.
    let refused_problem = service
        .submit_mutation("owner", request)
        .await
        .expect_err("a merge while one is in progress is refused");
    assert_eq!(refused_problem.code, ProblemCode::Conflict);
    assert!(
        refused_problem.message.contains("in progress"),
        "the refusal names the unfinished merge: {}",
        refused_problem.message
    );
    assert_eq!(
        fixture.head(),
        head_before,
        "the refused merge moved nothing"
    );
}

#[tokio::test]
async fn a_merge_refuses_an_unborn_head_before_anything_runs() {
    // Prevents: `git merge` answering an unborn HEAD with a confusing porcelain error —
    // the host can name this state itself and does so before Git is started.
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

    let service = fixture.service();
    let opened = service
        .register_repository(repo.to_str().expect("utf8"))
        .await
        .expect("the unborn repository opens");
    let summary = opened.repositories.first().expect("one repository");
    let repository_id = summary.repository_id.clone();
    let worktree_id = summary.primary_worktree_id.clone();
    let source = fixture.head();

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &source,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-unborn",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("no commit yet"),
        "the refusal names the unborn head: {}",
        problem.message
    );
}

#[tokio::test]
async fn a_merge_refuses_a_source_that_is_not_a_commit_without_moving_anything() {
    // Prevents: an object name that is missing — or names a blob or a tree — reaching
    // `git merge`, whose refusal would say nothing about what actually happened.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let head_before = fixture.head();
    let missing = "0".repeat(40);

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: &missing,
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-missing",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("not a commit"),
        "the refusal names the source: {}",
        problem.message
    );
    assert_eq!(fixture.head(), head_before, "nothing moved");
}

#[tokio::test]
async fn a_merge_source_that_cannot_be_an_object_name_is_an_invalid_payload() {
    // Prevents: a dash-leading or spaced "object name" reaching argv, where Git would
    // read it as an option or a path. The planner's validation is the boundary; this is
    // what refusing there looks like on the wire.
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;
    let head_before = fixture.head();

    let request = fixture
        .fresh_merge_request(
            &service,
            &repository_id,
            &worktree_id,
            MergeAsk {
                source: "--abort",
                mode: MergeMode::Default,
                message: None,
                client_request_id: "crid-merge-dash",
            },
        )
        .await;
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("the merge is accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert_eq!(problem.code, ProblemCode::InvalidOperationPayload);
    assert_eq!(fixture.head(), head_before, "nothing ran and nothing moved");
}
