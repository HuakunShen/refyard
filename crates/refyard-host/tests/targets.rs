//! Targets: identity, routing, generation discipline and disconnection.
//!
//! These cases need no SSH and no fixture container. The transport's own behaviour is
//! measured against a real `sshd` in `ssh_exec.rs`; what is measured here is the layer
//! above it — that a target is a first-class thing with a deterministic id and generation,
//! that a repository is opened *on* the target it named and read through that target's
//! executor, that an unknown target is refused rather than answered from this machine, and
//! that a rebuilt target invalidates what was minted against the previous build.
//!
//! Some cases use a scripted transport double: a `sh` script that ignores `ssh`'s option
//! vector and runs the one command string the provider built, here. It exercises the real
//! `SshGit` command-string path without a remote machine, and it is not evidence that SSH
//! works — the fixture cases in `ssh_exec.rs` are. A repository opened through it is a real
//! repository on this machine carrying a remote target's identity, which is what the
//! routing checks need.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::{HistoryQuery, Topology};
use refyard_contract::host::{ExecutionTargetKind, ExecutionTargetState};
use refyard_contract::problem::ProblemCode;
use refyard_host::providers::local::LocalGit;
use refyard_host::providers::ssh::SshGit;
use refyard_host::providers::GitExecutor;
use refyard_host::reads::history::read_history;
use refyard_host::registry::{build_record, parse_repository_layout, RepositoryRecord};
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};
use refyard_host::snapshots::{HistoryIntent, SnapshotKind, SnapshotRequest, SnapshotStore};
use refyard_host::targets::{
    ssh_target_generation, ssh_target_id, CreateTargetRequest, TargetRecord, TargetRegistry,
};

/// The command string the double must run is the last element of `ssh`'s argument vector;
/// everything before it is the fixed option policy and the alias, which this double has no
/// remote machine to apply.
const TRANSPORT_DOUBLE: &str = r#"#!/bin/sh
# A scripted transport double, not an SSH implementation: it ignores the option vector and
# the alias, and runs the one command string the provider built.
for last in "$@"; do :; done
exec sh -c "$last"
"#;

const LOCAL_TARGET: &str = "tgt_local";
const LOCAL_GENERATION: &str = "gen_1";
const SCRIPTED_TARGET: &str = "tgt_ssh_scripted";
const SCRIPTED_GENERATION: &str = "gen_ssh_scripted";

/// A temporary directory with a real Git repository, a scratch home and a scripted
/// transport inside it.
struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    repo: PathBuf,
    home: PathBuf,
    env: Vec<(String, String)>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().to_path_buf();
        let repo = root.join("repo");
        let home = root.join("home");
        std::fs::create_dir_all(&repo).expect("repo dir");
        std::fs::create_dir_all(&home).expect("home dir");
        std::fs::write(home.join(".gitconfig"), "").expect("global config");
        let env = fixture_environment(&home);
        let fixture = Self {
            _temp: temp,
            root,
            repo,
            home,
            env,
        };
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        std::fs::write(fixture.repo.join("a.txt"), "alpha\n").expect("seed");
        fixture.git(&["add", "-A"]);
        fixture.git(&["commit", "--quiet", "-m", "first"]);
        std::fs::write(fixture.repo.join("a.txt"), "alpha\nbeta\n").expect("second state");
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

    fn repo_path(&self) -> &str {
        self.repo.to_str().expect("a UTF-8 fixture path")
    }

    fn scripted_program(&self) -> PathBuf {
        let path = self.root.join("scripted-transport");
        std::fs::write(&path, TRANSPORT_DOUBLE).expect("write the transport double");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                .expect("make the double executable");
        }
        path
    }

    fn local_git(&self) -> LocalGit {
        LocalGit::at(git_program(), self.env.clone())
    }

    fn local_target(&self) -> TargetRecord {
        TargetRecord {
            target_id: LOCAL_TARGET.to_string(),
            kind: ExecutionTargetKind::Local,
            label: "This machine".to_string(),
            state: ExecutionTargetState::Ready,
            remote_path_browse: false,
            generation: LOCAL_GENERATION.to_string(),
            executor: Some(GitExecutor::Local(self.local_git())),
            unavailable: None,
            ssh: None,
        }
    }

    fn scripted_target(&self, generation: &str) -> TargetRecord {
        TargetRecord {
            target_id: SCRIPTED_TARGET.to_string(),
            kind: ExecutionTargetKind::SshConfig,
            label: "scripted".to_string(),
            state: ExecutionTargetState::Ready,
            remote_path_browse: false,
            generation: generation.to_string(),
            executor: Some(GitExecutor::Ssh(
                SshGit::at(self.scripted_program(), self.env.clone(), "scripted-host")
                    .expect("a host token"),
            )),
            unavailable: None,
            ssh: None,
        }
    }

    fn config(&self) -> ApplicationServiceConfig {
        ApplicationServiceConfig {
            git: self.local_git(),
            service_instance_id: "srvc_targets".to_string(),
            target_id: LOCAL_TARGET.to_string(),
            target_generation: LOCAL_GENERATION.to_string(),
            home: self.home.clone(),
        }
    }

    /// A service with the local target and the scripted SSH target, and a handle on the
    /// registry so a case can rebuild the SSH target under a new generation.
    fn service(&self) -> (ApplicationService, TargetRegistry) {
        let registry = TargetRegistry::new(self.local_target());
        registry.insert(self.scripted_target(SCRIPTED_GENERATION));
        let service = ApplicationService::with_targets(self.config(), registry.clone());
        (service, registry)
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
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".to_string()),
        ),
        ("HOME".to_string(), home.display().to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        ("GIT_CONFIG_GLOBAL".to_string(), "/dev/null".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        // An identity for the fixture's commits, so the fixture does not depend on the
        // developer's global Git configuration.
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
    ]
}

/// A service with only the local target, pointed at a Git that is never run.
fn service_without_git() -> ApplicationService {
    ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at("/nonexistent/git", Vec::new()),
        service_instance_id: "srvc_targets".to_string(),
        target_id: LOCAL_TARGET.to_string(),
        target_generation: LOCAL_GENERATION.to_string(),
        home: PathBuf::from("/nonexistent/home"),
    })
}

/// A record for one repository on one target, for the cases that never run Git.
fn synthetic_record(target_id: &str, generation: &str) -> RepositoryRecord {
    let layout =
        parse_repository_layout(b"/repo/.git\n/repo/.git\n/repo\nfalse\nsha1\nfalse\n", true)
            .expect("a layout");
    let mut record = build_record(
        layout,
        "/repo",
        "repo_1".to_string(),
        "root_1",
        Path::new("/repo"),
        "",
        target_id,
        generation,
    );
    record.location.canonical_common_dir = "/repo/.git".to_string();
    record
}

#[test]
fn a_new_service_holds_exactly_the_local_target() {
    let service = service_without_git();
    let targets = service.targets();
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0].target_id, LOCAL_TARGET);
    assert_eq!(targets[0].kind, ExecutionTargetKind::Local);
    assert_eq!(targets[0].state, ExecutionTargetState::Ready);
    assert!(!targets[0].remote_path_browse);
    assert_eq!(targets[0].generation, LOCAL_GENERATION);
}

#[tokio::test]
async fn creating_the_local_target_again_returns_the_same_one() {
    // `createTarget({kind: "local"})` is what a UI sends to stay on this machine; it must
    // not rebuild the target and invalidate the session's snapshots.
    let service = service_without_git();
    let first = service
        .create_target(CreateTargetRequest::Local)
        .await
        .expect("local");
    let again = service
        .create_target(CreateTargetRequest::Local)
        .await
        .expect("local again");
    assert_eq!(first, again);
    assert_eq!(first.generation, LOCAL_GENERATION);
}

#[tokio::test]
async fn an_unknown_target_is_refused_rather_than_answered_locally() {
    // The one failure a user cannot see is a remote request answered with this machine's
    // state, so an unknown id is a refusal that says which target was unknown.
    let fixture = Fixture::new();
    let (service, _) = fixture.service();
    let problem = service
        .register_repository_on(fixture.repo_path(), Some("tgt_ssh_missing"))
        .await
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::UnsupportedOperation);
    assert!(
        problem.message.contains("tgt_ssh_missing"),
        "the refusal must name the unknown target: {}",
        problem.message
    );
    assert!(
        service.repositories().await.repositories.is_empty(),
        "a refused target must not register anything"
    );
}

#[tokio::test]
async fn an_unknown_target_is_refused_for_the_local_picker_too() {
    let service = service_without_git();
    let problem = service
        .filesystem_entries_on(Some("/"), Some("tgt_ssh_missing"))
        .await
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::UnsupportedOperation);
    assert!(problem.message.contains("tgt_ssh_missing"));
}

#[tokio::test]
async fn the_same_path_on_two_targets_is_two_repositories() {
    let fixture = Fixture::new();
    let (service, _) = fixture.service();
    let remote = service
        .register_repository_on(fixture.repo_path(), Some(SCRIPTED_TARGET))
        .await
        .expect("remote registration");
    let remote_id = remote.repositories[0].repository_id.clone();
    assert_eq!(
        remote.repositories[0].target_id.as_deref(),
        Some(SCRIPTED_TARGET)
    );

    let local = service
        .register_repository(fixture.repo_path())
        .await
        .expect("local");
    let local_id = local
        .repositories
        .iter()
        .find(|summary| summary.repository_id != remote_id)
        .expect("the local repository")
        .repository_id
        .clone();
    assert_ne!(remote_id, local_id, "the two targets are two repositories");

    // Both read the same repository bytes, each through its own target's executor.
    let remote_status = service
        .status(&StatusQuery::new(&remote_id))
        .await
        .expect("remote status");
    let local_status = service
        .status(&StatusQuery::new(&local_id))
        .await
        .expect("local status");
    assert_eq!(remote_status.head.oid, local_status.head.oid);
    assert_eq!(remote_status.entry_count, local_status.entry_count);
    assert_eq!(remote_status.entries.len(), local_status.entries.len());
}

#[tokio::test]
async fn disconnecting_a_target_revokes_its_repositories_and_leaves_the_local_ones() {
    let fixture = Fixture::new();
    let (service, _) = fixture.service();
    let remote = service
        .register_repository_on(fixture.repo_path(), Some(SCRIPTED_TARGET))
        .await
        .expect("remote registration");
    let remote_id = remote.repositories[0].repository_id.clone();
    let local = service
        .register_repository(fixture.repo_path())
        .await
        .expect("local");
    let local_id = local
        .repositories
        .iter()
        .find(|summary| summary.repository_id != remote_id)
        .expect("the local repository")
        .repository_id
        .clone();

    service
        .disconnect_target(SCRIPTED_TARGET)
        .expect("disconnect drops the target");
    assert!(
        service
            .targets()
            .iter()
            .all(|summary| summary.target_id != SCRIPTED_TARGET),
        "the disconnected target must not be listed"
    );
    let repositories = service.repositories().await;
    assert_eq!(repositories.repositories.len(), 1);
    assert_eq!(repositories.repositories[0].repository_id, local_id);

    // A later read for the dropped repository is a not-found, not a silent local read.
    let problem = service
        .status(&StatusQuery::new(&remote_id))
        .await
        .expect_err("the repository is gone with its target");
    assert_eq!(problem.code, ProblemCode::NotFound);

    // The local repository is untouched.
    service
        .status(&StatusQuery::new(&local_id))
        .await
        .expect("the local repository still reads");
}

#[test]
fn disconnecting_the_local_target_is_refused() {
    let service = service_without_git();
    let problem = service
        .disconnect_target(LOCAL_TARGET)
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::UnsupportedOperation);
    assert_eq!(service.targets().len(), 1);
}

#[test]
fn disconnecting_an_unknown_target_is_a_not_found() {
    let service = service_without_git();
    assert_eq!(
        service
            .disconnect_target("tgt_ssh_missing")
            .expect_err("unknown")
            .code,
        ProblemCode::NotFound
    );
}

#[test]
fn ssh_target_ids_and_generations_are_deterministic_functions_of_their_inputs() {
    // A client that saw an id before a restart must see the same one after it, while a
    // config edit or a different probe answer must produce a different generation.
    let id = ssh_target_id("source_abc", "prod");
    assert_eq!(id, ssh_target_id("source_abc", "prod"));
    assert!(id.starts_with("tgt_ssh_"));
    // The contract's `TargetId` spelling: ^tgt_[A-Za-z0-9_-]{1,96}$.
    assert!(id.strip_prefix("tgt_").is_some_and(|rest| {
        !rest.is_empty()
            && rest.len() <= 96
            && rest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    }));
    assert!(
        !id.contains("prod"),
        "an id is opaque; an alias that is not URL-safe never appears in one"
    );

    let generation = ssh_target_generation("source_abc", "sha256-1", "prod", "shell=ok;git=2.50");
    assert_eq!(
        generation,
        ssh_target_generation("source_abc", "sha256-1", "prod", "shell=ok;git=2.50")
    );
    assert_ne!(
        generation,
        ssh_target_generation("source_abc", "sha256-2", "prod", "shell=ok;git=2.50")
    );
    assert_ne!(
        generation,
        ssh_target_generation("source_abc", "sha256-1", "prod", "probe-failed:Unavailable")
    );
}

#[tokio::test]
async fn catalogue_reads_are_stable_enough_to_mint_a_stable_target_id() {
    // The id a client is shown is derived from the candidate's (source, alias), so two
    // reads of an unchanged configuration mint the same one.
    let temp = tempfile::tempdir().expect("temp dir");
    let ssh_dir = temp.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).expect("ssh dir");
    std::fs::write(
        ssh_dir.join("config"),
        "Host prod\n  HostName 192.0.2.1\nHost staging\n  HostName 192.0.2.2\n",
    )
    .expect("config");
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at("/nonexistent/git", Vec::new()),
        service_instance_id: "srvc_targets".to_string(),
        target_id: LOCAL_TARGET.to_string(),
        target_generation: LOCAL_GENERATION.to_string(),
        home: temp.path().to_path_buf(),
    });
    let first = service.ssh_hosts().await.expect("config listing");
    let again = service.ssh_hosts().await.expect("config listing again");
    assert_eq!(first.revision, again.revision);
    let prod = first
        .hosts
        .iter()
        .find(|candidate| candidate.alias == "prod")
        .expect("prod");
    let prod_again = again
        .hosts
        .iter()
        .find(|candidate| candidate.alias == "prod")
        .expect("prod");
    assert_eq!(prod.host_id, prod_again.host_id);
    let staging = first
        .hosts
        .iter()
        .find(|candidate| candidate.alias == "staging")
        .expect("staging");
    assert_ne!(
        ssh_target_id(&prod.source_id, &prod.alias),
        ssh_target_id(&staging.source_id, &staging.alias)
    );
}

#[tokio::test]
async fn creating_a_target_for_a_host_id_that_is_not_in_the_catalogue_is_a_not_found() {
    let temp = tempfile::tempdir().expect("temp dir");
    let ssh_dir = temp.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).expect("ssh dir");
    std::fs::write(ssh_dir.join("config"), "Host prod\n  HostName 192.0.2.1\n").expect("config");
    let service = ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at("/nonexistent/git", Vec::new()),
        service_instance_id: "srvc_targets".to_string(),
        target_id: LOCAL_TARGET.to_string(),
        target_generation: LOCAL_GENERATION.to_string(),
        home: temp.path().to_path_buf(),
    });
    let problem = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: "host_not_a_candidate".to_string(),
        })
        .await
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::NotFound);
    assert!(problem.message.contains("host_not_a_candidate"));
    assert_eq!(service.targets().len(), 1, "no target was created");
}

#[tokio::test]
async fn a_remote_repository_path_must_be_absolute() {
    let fixture = Fixture::new();
    let (service, _) = fixture.service();
    let problem = service
        .register_repository_on("relative/repo", Some(SCRIPTED_TARGET))
        .await
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::InvalidRequest);
    assert!(
        service.repositories().await.repositories.is_empty(),
        "a refused path must not register anything"
    );
}

#[tokio::test]
async fn an_untracked_diff_on_a_remote_target_is_refused_instead_of_read_locally() {
    // The untracked synthesis reads this machine's filesystem; answering it for a remote
    // path would read a local file and call it remote.
    let fixture = Fixture::new();
    let (service, _) = fixture.service();
    let registered = service
        .register_repository_on(fixture.repo_path(), Some(SCRIPTED_TARGET))
        .await
        .expect("registration");
    let repository_id = registered.repositories[0].repository_id.clone();
    let problem = service
        .diff(&DiffQuery {
            repository_id,
            worktree_id: None,
            kind: DiffKind::Untracked,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        })
        .await
        .expect_err("refused");
    assert_eq!(problem.code, ProblemCode::UnsupportedOperation);
}

#[tokio::test]
async fn a_cursor_minted_before_the_target_was_rebuilt_is_refused() {
    // The scenario: a client pages history, the target is rebuilt under a new generation,
    // and the cursor it holds names a build that no longer exists. The refusal must come
    // from the continuation rules, before any command runs — the executor here cannot run
    // a command at all.
    let store = SnapshotStore::default();
    let snapshot = store.mint(SnapshotRequest {
        kind: SnapshotKind::History,
        repository_id: "repo_1",
        worktree_id: Some("wt_1"),
        target_generation: "gen_1",
        tips: vec!["tip1".to_string()],
        head_oid: Some("tip1".to_string()),
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: Some(HistoryIntent {
            first_parent_only: false,
            topology: Topology::Continuous,
        }),
    });
    let cursor = store.mint_cursor(&snapshot, 0, 25);
    let record = synthetic_record("tgt_ssh_rebuilt", "gen_1");
    let query = HistoryQuery {
        repository_id: "repo_1".to_string(),
        worktree_id: None,
        cursor: Some(cursor),
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
    };
    let executor = GitExecutor::Local(LocalGit::at("/nonexistent/git", Vec::new()));

    // Before the rebuild the cursor is resolved and the read proceeds — it then fails
    // because this executor cannot run Git, and that failure is not a cursor refusal.
    let error = read_history(&executor, &record, &store, &query, "gen_1", "now")
        .await
        .expect_err("the executor cannot run");
    assert_ne!(
        error.to_problem().code,
        ProblemCode::StaleSnapshot,
        "the cursor must be honoured on the build it was minted for"
    );

    // After the rebuild the same cursor is refused rather than walked.
    let error = read_history(&executor, &record, &store, &query, "gen_2", "now")
        .await
        .expect_err("refused");
    assert_eq!(error.to_problem().code, ProblemCode::StaleSnapshot);
    assert!(
        error.to_problem().message.contains("earlier build"),
        "the refusal must say why: {}",
        error.to_problem().message
    );
}

#[tokio::test]
async fn a_repository_on_a_rebuilt_target_is_refused_until_it_is_opened_again() {
    // The service-level half of the same rule: the target registry's generation is the
    // authority, so a repository recorded against the old build cannot be read by the new
    // one even though its target still exists under the same id.
    let fixture = Fixture::new();
    let (service, registry) = fixture.service();
    let registered = service
        .register_repository_on(fixture.repo_path(), Some(SCRIPTED_TARGET))
        .await
        .expect("registration");
    let repository_id = registered.repositories[0].repository_id.clone();
    service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("reads before the rebuild");

    // The target is rebuilt: same id, new generation, a fresh executor.
    registry.insert(fixture.scripted_target("gen_ssh_rebuilt"));
    let problem = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect_err("the repository was opened on the previous build");
    assert_eq!(problem.code, ProblemCode::StaleSnapshot);
    assert!(
        problem.message.contains("earlier build"),
        "the refusal must say why: {}",
        problem.message
    );

    // Opening the path again on the rebuilt target mints a new identity that reads.
    let reopened = service
        .register_repository_on(fixture.repo_path(), Some(SCRIPTED_TARGET))
        .await
        .expect("re-opened");
    let new_id = reopened
        .repositories
        .iter()
        .find(|summary| summary.repository_id != repository_id)
        .expect("a new repository identity")
        .repository_id
        .clone();
    assert_ne!(new_id, repository_id);
    service
        .status(&StatusQuery::new(&new_id))
        .await
        .expect("the new identity reads on the new build");
    // The old identity is gone rather than silently re-homed.
    assert_eq!(
        service
            .status(&StatusQuery::new(&repository_id))
            .await
            .expect_err("the old identity was replaced")
            .code,
        ProblemCode::NotFound
    );
}
