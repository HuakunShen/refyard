//! The worktrees read, exercised against real Git in an isolated fixture repository.
//!
//! The questions that decide whether the panel is correct are answered by Git: does a
//! linked worktree carry the branch it checks out, does a lock reason survive the trip,
//! does a worktree whose directory is gone read as prunable rather than disappearing,
//! and does a bare repository list itself without claiming a main worktree.
//!
//! Every fixture here is a temporary repository with its own `HOME`, its own Git config
//! files and no network, exactly as the JavaScript suite requires. No test writes to a
//! developer's repository.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::HeadKind;
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};

/// A temporary repository with its own identity, config and no inherited `GIT_*`.
struct Fixture {
    /// Deleted when the fixture drops, whatever the test did.
    _temp: tempfile::TempDir,
    scratch: PathBuf,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let scratch = temp.path().to_path_buf();
        let home = scratch.join("home");
        let repo = scratch.join("repo");
        std::fs::create_dir_all(&home).expect("create fixture home");
        std::fs::create_dir_all(&repo).expect("create fixture repo");
        std::fs::write(home.join(".gitconfig"), "").expect("empty global config");
        let env = fixture_environment(&home);
        let fixture = Self {
            _temp: temp,
            scratch,
            repo,
            env,
        };
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
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

    fn commit_all(&self, message: &str) {
        std::fs::write(self.repo.join("a.txt"), "base\n").expect("write file");
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "-m", message]);
    }

    fn head(&self) -> String {
        String::from_utf8(self.git(&["rev-parse", "HEAD"]))
            .expect("utf8")
            .trim()
            .to_string()
    }

    /// Registers this fixture with a service, the way the product does.
    async fn service(&self) -> (ApplicationService, String) {
        let service = ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_fixture".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.scratch.join("home"),
        });
        let response = service
            .register_repository(self.repo.to_str().expect("utf8 path"))
            .await
            .expect("registers");
        let repository_id = response.repositories[0].repository_id.clone();
        (service, repository_id)
    }
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    let home = home.to_str().expect("utf8 home");
    vec![
        ("PATH".to_string(), "/usr/bin:/bin".to_string()),
        ("HOME".to_string(), home.to_string()),
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            format!("{home}/.gitconfig"),
        ),
        ("GIT_CONFIG_SYSTEM".to_string(), "/dev/null".to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("LC_ALL".to_string(), "C".to_string()),
        ("LANG".to_string(), "C".to_string()),
        ("GIT_AUTHOR_NAME".to_string(), "Refyard Fixture".to_string()),
        (
            "GIT_AUTHOR_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
        (
            "GIT_COMMITTER_NAME".to_string(),
            "Refyard Fixture".to_string(),
        ),
        (
            "GIT_COMMITTER_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
        (
            "GIT_AUTHOR_DATE".to_string(),
            "2026-01-01T00:00:00+00:00".to_string(),
        ),
        (
            "GIT_COMMITTER_DATE".to_string(),
            "2026-01-01T00:00:00+00:00".to_string(),
        ),
    ]
}

#[tokio::test]
async fn the_primary_and_linked_worktrees_read_with_stable_ids() {
    // The primary keeps the id every other read addresses (`wt_1`, the repositories
    // read's primaryWorktreeId); a linked worktree's id is the deterministic function
    // of its path that lock/unlock/remove already resolve — the same worktree must
    // be one id on both sides of a click.
    let fixture = Fixture::new();
    fixture.commit_all("base");
    let linked = fixture.scratch.join("wt-linked");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        "-b",
        "feature",
        linked.to_str().expect("utf8 path"),
    ]);
    let (service, repository_id) = fixture.service().await;
    let response = service.worktrees(&repository_id).await.expect("worktrees");
    assert_eq!(response.worktrees.len(), 2);

    let primary = &response.worktrees[0];
    assert_eq!(primary.worktree_id, "wt_1");
    assert!(primary.is_main);
    assert_eq!(primary.head.branch_name.as_deref(), Some("main"));
    assert_eq!(primary.head.kind, HeadKind::Born);
    assert_eq!(primary.head.oid.as_deref(), Some(fixture.head().as_str()));

    let linked_row = &response.worktrees[1];
    assert!(!linked_row.is_main);
    assert_eq!(linked_row.head.branch_name.as_deref(), Some("feature"));
    // The id is a function of the very path the row displays, so a client that
    // reads the list and a write that resolves the path can never disagree.
    assert_eq!(
        linked_row.worktree_id,
        refyard_core::plan::worktrees::worktree_id_for_path(linked_row.display_path.as_bytes())
    );
    // Git lists the worktree's real path (on macOS the temp dir's /var resolves
    // to /private/var), so the displayed path is the canonicalized one.
    let listed = std::fs::canonicalize(&linked).expect("the linked worktree exists");
    assert_eq!(linked_row.display_path, listed.to_str().expect("utf8 path"));
}

#[tokio::test]
async fn a_locked_worktree_carries_its_reason() {
    // Prevents: a lock whose reason is lost, which the panel would show as a bare
    // lock with no hint of why the worktree is frozen.
    let fixture = Fixture::new();
    fixture.commit_all("base");
    let linked = fixture.scratch.join("wt-locked");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        "-b",
        "feature",
        linked.to_str().expect("utf8 path"),
    ]);
    fixture.git(&[
        "worktree",
        "lock",
        "--reason=on a removable disk",
        linked.to_str().expect("utf8 path"),
    ]);
    let (service, repository_id) = fixture.service().await;
    let response = service.worktrees(&repository_id).await.expect("worktrees");
    let locked = &response.worktrees[1];
    assert!(locked.is_locked);
    assert_eq!(locked.lock_reason.as_deref(), Some("on a removable disk"));
    assert!(!response.worktrees[0].is_locked);
    assert!(response.worktrees[0].lock_reason.is_none());
}

#[tokio::test]
async fn a_detached_worktree_reports_no_branch() {
    let fixture = Fixture::new();
    fixture.commit_all("base");
    let head = fixture.head();
    let detached = fixture.scratch.join("wt-detached");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        "--detach",
        detached.to_str().expect("utf8 path"),
        &head,
    ]);
    let (service, repository_id) = fixture.service().await;
    let response = service.worktrees(&repository_id).await.expect("worktrees");
    let detached_row = &response.worktrees[1];
    assert!(detached_row.is_detached);
    assert!(detached_row.head.detached);
    assert_eq!(detached_row.head.branch_name, None);
    assert_eq!(detached_row.head.oid.as_deref(), Some(head.as_str()));
}

#[tokio::test]
async fn a_worktree_whose_directory_is_gone_reads_as_prunable() {
    // Prevents: a worktree quietly vanishing from the list because its directory
    // was deleted — the honest answer is "prunable", which is what Git says.
    let fixture = Fixture::new();
    fixture.commit_all("base");
    let linked = fixture.scratch.join("wt-gone");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        "-b",
        "feature",
        linked.to_str().expect("utf8 path"),
    ]);
    std::fs::remove_dir_all(&linked).expect("remove the linked worktree directory");
    let (service, repository_id) = fixture.service().await;
    let response = service.worktrees(&repository_id).await.expect("worktrees");
    assert_eq!(response.worktrees.len(), 2, "the gone worktree is still listed");
    assert!(response.worktrees[1].is_prunable);
    assert!(!response.worktrees[0].is_prunable);
}

#[tokio::test]
async fn an_unknown_repository_is_refused_rather_than_answered_from_the_first_one() {
    let fixture = Fixture::new();
    fixture.commit_all("base");
    let (service, _repository_id) = fixture.service().await;
    let problem = service.worktrees("repo_9").await.expect_err("unknown");
    assert_eq!(problem.code, ProblemCode::NotFound);
}
