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
use refyard_host::jobs::{MutationOperation, MutationRequest};
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
