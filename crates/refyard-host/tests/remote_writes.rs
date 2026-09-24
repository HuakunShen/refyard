//! Remote add/update/remove on a local repository: config changes only, never network.
//!
//! The security-critical case is a remote URL that names a *command* — Git's `ext::`
//! transport helper or an `--upload-pack=` option both execute code when a later fetch
//! uses them. Such a URL is refused at the trusted boundary and never reaches `git`, so
//! it can never be configured. The honesty-critical case is `updateRemote`'s partial
//! state (a rename that lands before a URL change fails). And `removeRemote` is
//! destructive, gated on an explicit confirmation.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{MutationTarget, OperationStatus, StatusSnapshot};
use refyard_host::jobs::{
    FetchTagMode, MutationOperation, MutationRequest, PullMode, WorktreeReference,
};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

struct Fixture {
    temp: tempfile::TempDir,
    home: PathBuf,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

#[allow(dead_code)]
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

/* ----------------------------------------------------------------- remotes */

/// The configured remote names, one per line.
fn remote_names(fixture: &Fixture) -> String {
    String::from_utf8(fixture.git(&["remote"])).expect("utf8")
}

#[tokio::test]
async fn an_added_remote_round_trips_through_a_remove() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;

    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: "https://example.com/owner/r.git".to_string(),
            push_url: Some("ssh://git@example.com/owner/r.git".to_string()),
        },
        "crid-remote-add",
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
    let names = remote_names(&fixture);
    assert!(
        names.contains("origin"),
        "the remote is configured: {names}"
    );
    assert_eq!(
        String::from_utf8(fixture.git(&["remote", "get-url", "origin"]))
            .expect("utf8")
            .trim(),
        "https://example.com/owner/r.git",
        "the fetch URL is set"
    );
    assert_eq!(
        String::from_utf8(fixture.git(&["remote", "get-url", "--push", "origin"]))
            .expect("utf8")
            .trim(),
        "ssh://git@example.com/owner/r.git",
        "the push URL is set separately"
    );

    // Remove it (destructive, confirmed) and prove it is gone.
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::RemoveRemote {
            remote_name: "origin".to_string(),
            confirmed: true,
        },
        "crid-remote-remove",
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
        !remote_names(&fixture).contains("origin"),
        "the remote is gone"
    );
}

#[tokio::test]
async fn a_remote_url_that_names_a_command_is_refused_and_never_configured() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;

    // `ext::` is Git's transport-helper form: it names a command to run. It must never
    // be configured, or a later fetch would execute it.
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: "ext::sh -c evil".to_string(),
            push_url: None,
        },
        "crid-remote-add-unsafe",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("not accepted"),
        "the refusal names the unsafe URL: {}",
        problem.message
    );
    assert!(
        !remote_names(&fixture).contains("origin"),
        "nothing was configured"
    );
}

#[tokio::test]
async fn an_update_renames_the_remote_and_moves_its_urls() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: "https://example.com/old.git".to_string(),
            push_url: None,
        },
        "crid-remote-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::UpdateRemote {
            remote_name: "origin".to_string(),
            new_name: Some("upstream".to_string()),
            fetch_url: Some("ssh://git@example.com/new.git".to_string()),
            push_url: None,
        },
        "crid-remote-update",
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
    let names = remote_names(&fixture);
    assert!(names.contains("upstream"), "renamed: {names}");
    assert!(!names.contains("origin"), "the old name is gone: {names}");
    assert_eq!(
        String::from_utf8(fixture.git(&["remote", "get-url", "upstream"]))
            .expect("utf8")
            .trim(),
        "ssh://git@example.com/new.git",
        "the fetch URL moved with the rename"
    );
}

#[tokio::test]
async fn an_update_that_changes_nothing_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: "https://example.com/r.git".to_string(),
            push_url: None,
        },
        "crid-remote-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::UpdateRemote {
            remote_name: "origin".to_string(),
            new_name: None,
            fetch_url: None,
            push_url: None,
        },
        "crid-remote-update-empty",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("rename") || problem.message.contains("change a URL"),
        "the refusal says nothing would change: {}",
        problem.message
    );
}

#[tokio::test]
async fn a_remove_without_confirmation_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: "https://example.com/r.git".to_string(),
            push_url: None,
        },
        "crid-remote-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::RemoveRemote {
            remote_name: "origin".to_string(),
            confirmed: false,
        },
        "crid-remote-remove-unconfirmed",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert_eq!(problem.code, ProblemCode::InvalidRequest);
    assert!(
        problem.message.contains("confirmation"),
        "{}",
        problem.message
    );
    assert!(
        remote_names(&fixture).contains("origin"),
        "nothing was removed"
    );
}

/* ------------------------------------------------------------ push / pushTag */

/// A bare repository at `<temp>/<name>`, to act as a local file remote (no network).
fn bare_remote(fixture: &Fixture, name: &str) -> String {
    let path = fixture.temp.path().join(name);
    let path_str = path.to_str().expect("utf8").to_string();
    fixture.git(&["init", "--bare", "--quiet", &path_str]);
    path_str
}

/// Read one ref from a remote repository's object database, without cloning.
fn remote_has(git_dir: &str, refname: &str) -> bool {
    Command::new(git_program())
        .args([
            "--git-dir",
            git_dir,
            "rev-parse",
            "--verify",
            "--quiet",
            refname,
        ])
        .output()
        .expect("run git")
        .status
        .success()
}

#[tokio::test]
async fn a_push_moves_one_ref_and_a_tag_push_publishes_one_tag() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let remote_path = bare_remote(&fixture, "remote.git");

    // Configure the remote (an absolute local path is an approved URL form).
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: remote_path.clone(),
            push_url: None,
        },
        "crid-remote-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    // Push exactly one explicit ref.
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::Push {
            remote_name: "origin".to_string(),
            source_ref: "refs/heads/main".to_string(),
            destination_ref: "refs/heads/main".to_string(),
            set_upstream: false,
        },
        "crid-push",
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
        remote_has(&remote_path, "refs/heads/main"),
        "the remote has the branch"
    );

    // Push one tag by name.
    fixture.git(&["tag", "v1"]);
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::PushTag {
            remote_name: "origin".to_string(),
            tag_name: "v1".to_string(),
        },
        "crid-push-tag",
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
        remote_has(&remote_path, "refs/tags/v1"),
        "the remote has the tag"
    );
}

#[tokio::test]
async fn a_push_refuses_to_contact_an_unsafe_configured_remote() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    // A remote configured *outside* the app with a transport-helper URL (names a
    // command). The push must refuse to contact it even though the request itself is
    // well-formed.
    fixture.git(&["remote", "add", "origin", "ext::evil-helper"]);

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::Push {
            remote_name: "origin".to_string(),
            source_ref: "refs/heads/main".to_string(),
            destination_ref: "refs/heads/main".to_string(),
            set_upstream: false,
        },
        "crid-push-unsafe",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(finished.status, OperationStatus::Failed);
    let problem = finished.problem.expect("a refusal carries the reason");
    assert!(
        problem.message.contains("unsafe configured URL"),
        "the refusal names the unsafe remote: {}",
        problem.message
    );
}

/* ------------------------------------------------------------ fetch / pull */

/// Run git in `cwd` under the fixture's isolated environment (own HOME/config).
fn run_git_in(fixture: &Fixture, cwd: &Path, args: &[&str]) -> Vec<u8> {
    let output = Command::new(git_program())
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(fixture.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
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

/// Does a ref exist in the fixture's own working repository?
fn worktree_ref_exists(fixture: &Fixture, refname: &str) -> bool {
    Command::new(git_program())
        .args(["rev-parse", "--verify", "--quiet", refname])
        .current_dir(&fixture.repo)
        .env_clear()
        .envs(fixture.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .output()
        .expect("run git")
        .status
        .success()
}

/// Advance a bare remote's `main` by one commit, through a throwaway clone.
fn advance_remote(fixture: &Fixture, remote_path: &str, name: &str, msg: &str) {
    let work = fixture.temp.path().join(name);
    let work_str = work.to_str().expect("utf8").to_string();
    run_git_in(
        fixture,
        &fixture.repo,
        &["clone", "--quiet", remote_path, &work_str],
    );
    std::fs::write(work.join("new.txt"), "advanced\n").expect("write");
    run_git_in(fixture, &work, &["add", "--", "new.txt"]);
    run_git_in(fixture, &work, &["commit", "--quiet", "-m", msg]);
    run_git_in(fixture, &work, &["push", "--quiet", "origin", "main:main"]);
}

/// Add `origin` and push `main` (optionally setting upstream) through the effects.
async fn add_and_push_main(
    fixture: &Fixture,
    service: &ApplicationService,
    repository_id: &str,
    remote_path: &str,
    set_upstream: bool,
) {
    let snapshot_id = fixture.status(service, repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: remote_path.to_string(),
            push_url: None,
        },
        "crid-setup-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(service, &accepted.record.operation_id).await;

    let snapshot_id = fixture.status(service, repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        repository_id,
        &snapshot_id,
        MutationOperation::Push {
            remote_name: "origin".to_string(),
            source_ref: "refs/heads/main".to_string(),
            destination_ref: "refs/heads/main".to_string(),
            set_upstream,
        },
        "crid-setup-push",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(service, &accepted.record.operation_id).await;
}

/// A bare clone of the fixture's own repository — a remote that already has `main`
/// and whose HEAD points at `main`, so it clones cleanly. (An empty `git init --bare`
/// has HEAD referring to `master`, which does not exist yet, and clones of it produce
/// no branch at all — which is exactly what broke the first cut of these tests.)
fn cloned_remote(fixture: &Fixture, name: &str) -> String {
    let path = fixture.temp.path().join(name);
    let path_str = path.to_str().expect("utf8").to_string();
    let repo_str = fixture.repo.to_str().expect("utf8").to_string();
    run_git_in(
        fixture,
        &fixture.repo,
        &["clone", "--bare", "--quiet", &repo_str, &path_str],
    );
    path_str
}

#[tokio::test]
async fn a_fetch_brings_remote_tracking_refs_in() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    // The remote already carries `main`; the local repo has never touched it, so there
    // is genuinely no `origin/main` until a fetch brings one in.
    let remote_path = cloned_remote(&fixture, "remote.git");

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::AddRemote {
            remote_name: "origin".to_string(),
            fetch_url: remote_path.clone(),
            push_url: None,
        },
        "crid-setup-add",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    wait_terminal(&service, &accepted.record.operation_id).await;

    assert!(
        !worktree_ref_exists(&fixture, "refs/remotes/origin/main"),
        "no tracking ref before the fetch"
    );
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::Fetch {
            remote_name: "origin".to_string(),
            prune: false,
            tags: FetchTagMode::None,
        },
        "crid-fetch",
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
        worktree_ref_exists(&fixture, "refs/remotes/origin/main"),
        "the fetch created the remote-tracking ref"
    );
}

#[tokio::test]
async fn a_pull_fast_forwards_the_branch_when_the_remote_is_ahead() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let remote_path = cloned_remote(&fixture, "remote.git");
    add_and_push_main(&fixture, &service, &repository_id, &remote_path, true).await;
    // Make the upstream explicit rather than trusting `push --set-upstream` semantics.
    fixture.git(&["branch", "--set-upstream-to=origin/main", "main"]);
    advance_remote(&fixture, &remote_path, "adv", "advanced work");

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::Pull {
            remote_name: "origin".to_string(),
            mode: PullMode::FfOnly,
        },
        "crid-pull",
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
    let subject = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(
        subject.trim(),
        "advanced work",
        "the branch moved to the remote tip"
    );
}

#[tokio::test]
async fn a_pull_that_cannot_fast_forward_keeps_the_two_facts_apart() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let remote_path = cloned_remote(&fixture, "remote.git");
    add_and_push_main(&fixture, &service, &repository_id, &remote_path, true).await;
    fixture.git(&["branch", "--set-upstream-to=origin/main", "main"]);
    advance_remote(&fixture, &remote_path, "adv", "advanced work");

    // A local commit the remote does not have: the histories now diverge, so the fetch
    // half will move tracking refs but the fast-forward half must not move the branch.
    std::fs::write(fixture.repo.join("local.txt"), "local\n").expect("write");
    fixture.git(&["add", "--", "local.txt"]);
    fixture.git(&["commit", "--quiet", "-m", "local work"]);

    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::Pull {
            remote_name: "origin".to_string(),
            mode: PullMode::FfOnly,
        },
        "crid-pull-diverged",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    // Not a silent failure: the fetch half happened and the branch half refused — two
    // facts kept apart, and nothing was merged or rebased.
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
        problem.message.contains("remote-tracking ref"),
        "reports the fetch half: {}",
        problem.message
    );
    assert!(
        problem.message.contains("not fast-forwarded"),
        "reports the branch half: {}",
        problem.message
    );
    let subject = String::from_utf8(fixture.git(&["log", "-1", "--format=%s"])).expect("utf8");
    assert_eq!(subject.trim(), "local work", "the branch did not move");
}

/* ------------------------------------------------------------ addSubmodule */

#[tokio::test]
async fn a_submodule_adds_from_a_local_path() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // A source repository to add as a submodule.
    let src = fixture.temp.path().join("subsource");
    let src_str = src.to_str().expect("utf8").to_string();
    run_git_in(&fixture, &fixture.repo, &["init", "--quiet", &src_str]);
    std::fs::write(src.join("lib.txt"), "lib\n").expect("write");
    run_git_in(&fixture, &src, &["add", "--", "lib.txt"]);
    run_git_in(&fixture, &src, &["commit", "--quiet", "-m", "sub commit"]);
    // Git blocks the `file` protocol for submodules by default. A local-path submodule
    // is legitimate here (the URL form the contract allows), so the isolated fixture's
    // own config permits it — this is test setup, never a production setting.
    run_git_in(
        &fixture,
        &fixture.repo,
        &["config", "--global", "protocol.file.allow", "always"],
    );

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AddSubmodule {
                remote_url: src_str.clone(),
                relative_path: "vendor/lib".to_string(),
                branch_name: None,
                initialize: true,
            },
            "crid-sub-add",
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
        fixture.repo.join("vendor/lib/lib.txt").exists(),
        "the submodule is cloned and checked out"
    );
    let gitmodules = std::fs::read_to_string(fixture.repo.join(".gitmodules")).expect("read");
    assert!(gitmodules.contains("vendor/lib"), ".gitmodules records it");
}

#[tokio::test]
async fn a_submodule_url_that_names_a_command_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::AddSubmodule {
                remote_url: "ext::evil-helper".to_string(),
                relative_path: "vendor/lib".to_string(),
                branch_name: None,
                initialize: true,
            },
            "crid-sub-unsafe",
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
        problem.message.contains("remote URL"),
        "the refusal names the unsafe URL: {}",
        problem.message
    );
}

/* ---------------------------------------- updateSubmodule / syncSubmodule */

#[tokio::test]
async fn a_submodule_update_and_sync_run_on_the_configured_submodules() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    let src = fixture.temp.path().join("subsource");
    let src_str = src.to_str().expect("utf8").to_string();
    run_git_in(&fixture, &fixture.repo, &["init", "--quiet", &src_str]);
    std::fs::write(src.join("lib.txt"), "lib\n").expect("write");
    run_git_in(&fixture, &src, &["add", "--", "lib.txt"]);
    run_git_in(&fixture, &src, &["commit", "--quiet", "-m", "sub commit"]);
    run_git_in(
        &fixture,
        &fixture.repo,
        &["config", "--global", "protocol.file.allow", "always"],
    );
    run_git_in(
        &fixture,
        &fixture.repo,
        &["submodule", "add", "--", &src_str, "vendor/lib"],
    );
    // Commit the gitlink so the parent records which commit the submodule should hold.
    fixture.git(&["add", "--", ".gitmodules", "vendor/lib"]);
    fixture.git(&["commit", "--quiet", "-m", "add submodule"]);

    // An empty path selection means every configured submodule.
    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::UpdateSubmodule {
                path_ids: vec![],
                initialize: true,
                recursive: false,
            },
            "crid-sub-update",
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
        fixture.repo.join("vendor/lib/lib.txt").exists(),
        "checked out"
    );

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SyncSubmodule {
                path_ids: vec![],
                recursive: true,
            },
            "crid-sub-sync",
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
}

#[tokio::test]
async fn an_unsafe_configured_submodule_url_is_refused_before_updating() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // A crafted .gitmodules naming a transport-helper URL (a command). The safety scan
    // must refuse to contact it — before update/sync run at all.
    std::fs::write(
        fixture.repo.join(".gitmodules"),
        "[submodule \"lib\"]\n\tpath = vendor/lib\n\turl = ext::evil-helper\n",
    )
    .expect("write");

    let request = fixture
        .worktree_request(
            &service,
            &repository_id,
            &worktree_id,
            MutationOperation::SyncSubmodule {
                path_ids: vec![],
                recursive: true,
            },
            "crid-sub-unsafe-sync",
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
        problem.message.contains("unsafe configured URL"),
        "the refusal names the unsafe URL: {}",
        problem.message
    );
}

/* ----------------------------------------------- createWorktree */

#[tokio::test]
async fn a_create_worktree_adds_a_linked_worktree() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;
    let head = String::from_utf8(fixture.git(&["rev-parse", "HEAD"]))
        .expect("utf8")
        .trim()
        .to_string();

    // Detached form: a worktree at a commit, no branch.
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::CreateWorktree {
            relative_destination: "wt-detached".to_string(),
            reference: WorktreeReference::Detached { oid: head.clone() },
        },
        "crid-wt-detached",
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

    // New-branch form: a fresh branch at a commit, checked out in the new worktree.
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::CreateWorktree {
            relative_destination: "wt-new".to_string(),
            reference: WorktreeReference::NewBranch {
                branch_name: "feature".to_string(),
                start_oid: head.clone(),
            },
        },
        "crid-wt-new",
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

    // Both linked worktrees now exist beside the primary.
    let list = String::from_utf8(fixture.git(&["worktree", "list"])).expect("utf8");
    assert!(
        list.lines().count() >= 3,
        "the primary plus two linked worktrees:\n{list}"
    );
}

#[tokio::test]
async fn a_create_worktree_refuses_a_branch_already_checked_out_elsewhere() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, _worktree_id) = fixture.open(&service).await;

    // `main` is checked out in the primary worktree. Git refuses to check it out again;
    // this build reports that refusal and never overrides it.
    let snapshot_id = fixture.status(&service, &repository_id).await.snapshot_id;
    let request = fixture.repository_request(
        &repository_id,
        &snapshot_id,
        MutationOperation::CreateWorktree {
            relative_destination: "wt-taken".to_string(),
            reference: WorktreeReference::ExistingBranch {
                branch_name: "main".to_string(),
            },
        },
        "crid-wt-taken",
    );
    let accepted = service
        .submit_mutation("owner", request)
        .await
        .expect("accepted");
    let finished = wait_terminal(&service, &accepted.record.operation_id).await;
    assert_eq!(
        finished.status,
        OperationStatus::Failed,
        "{:?}",
        finished.problem
    );
}
