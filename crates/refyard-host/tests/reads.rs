//! The reads, exercised against real Git in an isolated fixture repository.
//!
//! Unit tests cover the pure parts — tip collection, cursor rules, hunk synthesis — but
//! the questions that decide whether a panel is correct are answered by Git: does an
//! unborn repository read as an empty page rather than a failure, does a shallow clone
//! mark its oldest row as a boundary, does a continuation return the *next* commit of the
//! same walk.
//!
//! Every fixture here is a temporary repository with its own `HOME`, its own Git config
//! files and no network, exactly as the JavaScript suite requires. No test writes to a
//! developer's repository, and none of them runs a write command against one.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::{HistoryQuery, Topology};
use refyard_contract::problem::ProblemCode;
use refyard_core::parse::worktree::parse_worktree_list;
use refyard_host::paths::PathRegistry;
use refyard_host::providers::local::LocalGit;
use refyard_host::providers::GitExecutor;
use refyard_host::reads::{history::read_history, refs::read_refs, status::read_status};
use refyard_host::registry::{open_repository, OpenOutcome, OpenRequest, RepositoryRecord};
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};
use refyard_host::snapshots::SnapshotStore;

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
        self.git_at(&self.repo, args)
    }

    fn git_at(&self, directory: &Path, args: &[&str]) -> Vec<u8> {
        let output = Command::new(git_program())
            .args(args)
            .current_dir(directory)
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
        write_at(&self.repo.join(relative), content);
    }

    fn commit_all(&self, message: &str) {
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

fn write_at(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, content).expect("write file");
}

/// A registered record for a directory, the way the service builds one.
async fn record_for(fixture: &Fixture, directory: &Path) -> RepositoryRecord {
    let mut next = || "repo_1".to_string();
    match open_repository(
        OpenRequest {
            program: &git_program(),
            env: &fixture.env,
            directory,
            allowed_root_id: "root_1",
            root_path: &fixture.repo,
            relative_path: "",
            target_id: "tgt_local",
            target_generation: "gen_1",
        },
        &mut next,
    )
    .await
    {
        OpenOutcome::Opened(record) => *record,
        OpenOutcome::Failed(outcome) => panic!(
            "layout read failed: {:?} {}",
            outcome.exit_code,
            String::from_utf8_lossy(&outcome.stderr)
        ),
    }
}

fn git_provider(fixture: &Fixture) -> GitExecutor {
    // The reads run through the same executor seam the service uses; for these fixtures it
    // is the local arm, which is the behaviour every case here was written against.
    GitExecutor::Local(LocalGit::at(git_program(), fixture.env.clone()))
}

#[tokio::test]
async fn a_registered_repository_answers_a_status_read() {
    // The whole path the product takes: approve a directory, open it, read its status.
    let fixture = Fixture::new();
    fixture.write("a.txt", "base\n");
    fixture.commit_all("base");
    fixture.write("a.txt", "changed\n");
    let (service, repository_id) = fixture.service().await;
    let mut query = StatusQuery::new(repository_id);
    query.include_ignored = true;
    let snapshot = service.status(&query).await.expect("status");
    assert_eq!(snapshot.entry_count, 1);
    assert_eq!(snapshot.entries[0].display_path, "a.txt");
    assert_eq!(snapshot.entries[0].worktree_status, "M");
    assert_eq!(snapshot.head.branch_name.as_deref(), Some("main"));
}

#[tokio::test]
async fn an_unborn_repository_is_an_empty_history_not_a_failure() {
    // A repository with no commits is a normal state; reporting it as a failed read
    // would make a new repository look broken.
    let fixture = Fixture::new();
    let (service, repository_id) = fixture.service().await;
    let page = service
        .history(&HistoryQuery {
            repository_id,
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
        .expect("history");
    assert!(page.commits.is_empty());
    assert_eq!(page.next_cursor, None);
    assert!(!page.truncated);
    assert_eq!(page.topology, Topology::Continuous);
}

#[tokio::test]
async fn a_page_continues_from_its_cursors_snapshot_and_not_from_a_moved_branch() {
    // This is the failure the cursor exists to prevent: a page that re-interprets HEAD
    // interleaves commits from a branch that moved while the user was reading.
    let fixture = Fixture::new();
    fixture.write("a.txt", "one\n");
    fixture.commit_all("one");
    fixture.write("a.txt", "two\n");
    fixture.commit_all("two");
    fixture.write("a.txt", "three\n");
    fixture.commit_all("three");
    let (service, repository_id) = fixture.service().await;
    let query = |limit: Option<u64>, cursor: Option<String>| HistoryQuery {
        repository_id: repository_id.clone(),
        worktree_id: None,
        cursor,
        limit,
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
    let first = service
        .history(&query(Some(1), None))
        .await
        .expect("first page");
    assert_eq!(first.commits.len(), 1);
    assert_eq!(first.commits[0].subject, "three");
    assert!(first.truncated);
    let cursor = first.next_cursor.clone().expect("a cursor");

    // The branch moves between the two pages.
    fixture.write("a.txt", "four\n");
    fixture.commit_all("four");
    let second = service
        .history(&query(Some(1), Some(cursor.clone())))
        .await
        .expect("second page");
    assert_eq!(second.commits.len(), 1);
    assert_eq!(
        second.commits[0].subject, "two",
        "the continuation is the next row of the snapshot's walk, not of the new branch"
    );
    assert!(second.tips_moved, "the moved tip is reported, not hidden");

    // The cursor owns the page size and the first-parent mode.
    let mismatch = service.history(&query(Some(2), Some(cursor.clone()))).await;
    assert_eq!(
        mismatch.expect_err("refused").code,
        ProblemCode::InvalidRequest
    );
    let unknown = service
        .history(&query(Some(1), Some("cur_never_minted".to_string())))
        .await;
    assert_eq!(
        unknown.expect_err("refused").code,
        ProblemCode::StaleSnapshot
    );
}

#[tokio::test]
async fn a_shallow_clone_marks_its_oldest_row_as_a_boundary_with_its_missing_parent() {
    // A shallow clone must not be drawn as a complete history: the row whose parent is
    // absent locally is a boundary, and its missing parents are named.
    let fixture = Fixture::new();
    fixture.write("a.txt", "one\n");
    fixture.commit_all("one");
    fixture.write("a.txt", "two\n");
    fixture.commit_all("two");
    let remote = fixture.scratch.join("remote.git");
    fixture.git(&[
        "clone",
        "--bare",
        "--quiet",
        fixture.repo.to_str().expect("utf8"),
        remote.to_str().expect("utf8"),
    ]);
    let shallow = fixture.scratch.join("shallow");
    // `file://` rather than a plain path: Git ignores `--depth` for a local clone and
    // would quietly produce a full history, which is exactly the state this test is
    // about.
    let url = format!("file://{}", remote.to_str().expect("utf8"));
    fixture.git(&[
        "clone",
        "--quiet",
        "--depth=1",
        &url,
        shallow.to_str().expect("utf8"),
    ]);

    let record = record_for(&fixture, &shallow).await;
    assert!(record.layout.is_shallow, "the layout read detects depth");
    let provider = git_provider(&fixture);
    let snapshots = SnapshotStore::default();
    let page = read_history(
        &provider,
        &record,
        &snapshots,
        &HistoryQuery {
            repository_id: record.repository_id.clone(),
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
        },
        "gen_1",
        "2026-01-01T00:00:00.000Z",
    )
    .await
    .expect("history");
    assert!(page.shallow);
    assert_eq!(page.commits.len(), 1);
    let row = &page.commits[0];
    assert!(
        row.boundary,
        "the oldest row of a shallow clone is a boundary"
    );
    assert_eq!(
        row.missing_parents.len(),
        1,
        "the parent the clone does not hold is named"
    );
    assert_eq!(row.parents, row.missing_parents);
}

#[tokio::test]
async fn refs_report_branches_tags_and_a_redacted_remote() {
    let fixture = Fixture::new();
    fixture.write("a.txt", "base\n");
    fixture.commit_all("base");
    fixture.git(&["tag", "-a", "v1", "-m", "release"]);
    fixture.git(&["branch", "topic"]);
    fixture.git(&[
        "remote",
        "add",
        "origin",
        "https://user:token@example.test/refyard.git",
    ]);
    let record = record_for(&fixture, &fixture.repo).await;
    let provider = git_provider(&fixture);
    let snapshots = SnapshotStore::default();
    let snapshot = read_refs(&provider, &record, &snapshots, "2026-01-01T00:00:00.000Z")
        .await
        .expect("refs");
    let branch_names: Vec<&str> = snapshot
        .branches
        .iter()
        .map(|branch| branch.name.as_str())
        .collect();
    assert_eq!(branch_names, vec!["main", "topic"]);
    assert!(snapshot.branches[0].is_current);
    assert_eq!(snapshot.tags.len(), 1);
    assert!(snapshot.tags[0].annotated);
    assert!(snapshot.tags[0].target_oid.is_some());
    assert_eq!(
        snapshot.remotes[0].fetch_url_display, "https://example.test/refyard.git",
        "a credential must never reach a response"
    );
}

#[tokio::test]
async fn a_diff_returns_a_patch_only_for_the_path_that_was_named() {
    let fixture = Fixture::new();
    fixture.write("a.txt", "one\n");
    fixture.write("b.txt", "one\n");
    fixture.commit_all("base");
    fixture.write("a.txt", "one\ntwo\n");
    fixture.write("b.txt", "one\ntwo\n");
    let (service, repository_id) = fixture.service().await;
    let described = service
        .diff(&DiffQuery {
            repository_id: repository_id.clone(),
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        })
        .await
        .expect("described");
    assert_eq!(described.files.len(), 2);
    assert!(
        described.truncated,
        "the response says the patches are missing"
    );
    for file in &described.files {
        assert!(matches!(
            file.patch,
            refyard_contract::diff::FilePatch::Unavailable { .. }
        ));
    }

    let target = described
        .files
        .iter()
        .find(|file| file.display_path == "b.txt")
        .expect("b.txt is in the change set");
    let patched = service
        .diff(&DiffQuery {
            repository_id: repository_id.clone(),
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: Some(target.path_id.clone()),
            max_bytes: None,
        })
        .await
        .expect("patched");
    assert!(!patched.truncated);
    let a = patched
        .files
        .iter()
        .find(|file| file.display_path == "a.txt")
        .expect("a.txt is still listed");
    assert!(matches!(
        a.patch,
        refyard_contract::diff::FilePatch::Unavailable { .. }
    ));
    let b = patched
        .files
        .iter()
        .find(|file| file.display_path == "b.txt")
        .expect("b.txt is listed");
    match &b.patch {
        refyard_contract::diff::FilePatch::Text { hunks, synthesized } => {
            assert!(!synthesized);
            assert_eq!(hunks.len(), 1);
            // One context line and one addition: the unchanged line is context, not an
            // addition, and a patch that counted it as one would overstate the change.
            assert_eq!(hunks[0].lines.len(), 2);
        }
        other => panic!("expected a text patch, got {other:?}"),
    }
    assert_eq!(b.insertions, Some(1));

    // An id from another worktree or an unknown id cannot name a path here.
    let unknown = service
        .diff(&DiffQuery {
            repository_id,
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: Some("path_999".to_string()),
            max_bytes: None,
        })
        .await;
    assert_eq!(unknown.expect_err("refused").code, ProblemCode::NotFound);
}

#[tokio::test]
async fn a_non_ascii_path_still_finds_its_patch() {
    // A documented divergence from the Node reference: it looks a fetched patch up by
    // decoding the changed path one character per byte, so `名.txt` never matches the
    // patch it just fetched and is reported as "no patch was requested". This port joins
    // by raw bytes. The differential suite therefore records a patch for an ASCII path
    // (see tests/native/differential.test.ts), and this test pins the correct behaviour
    // for the rest.
    let fixture = Fixture::new();
    fixture.write("名.txt", "one\n");
    fixture.commit_all("base");
    fixture.write("名.txt", "one\ntwo\n");
    let (service, repository_id) = fixture.service().await;
    let described = service
        .diff(&DiffQuery {
            repository_id: repository_id.clone(),
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        })
        .await
        .expect("described");
    let target = described
        .files
        .iter()
        .find(|file| file.display_path == "名.txt")
        .expect("the unicode path is in the change set");
    let patched = service
        .diff(&DiffQuery {
            repository_id,
            worktree_id: None,
            kind: DiffKind::Unstaged,
            oid: None,
            from: None,
            to: None,
            path_id: Some(target.path_id.clone()),
            max_bytes: None,
        })
        .await
        .expect("patched");
    match &patched.files[0].patch {
        refyard_contract::diff::FilePatch::Text { hunks, synthesized } => {
            assert!(!synthesized);
            assert_eq!(hunks.len(), 1);
        }
        other => panic!("the patch for a unicode path must be the fetched one: {other:?}"),
    }
    assert_eq!(patched.files[0].insertions, Some(1));
}

#[tokio::test]
async fn an_untracked_path_gets_a_synthesized_patch_marked_as_such() {
    let fixture = Fixture::new();
    fixture.write("a.txt", "base\n");
    fixture.commit_all("base");
    fixture.write("new.txt", "fresh\nline\n");
    fixture.write("empty.txt", "");
    let (service, repository_id) = fixture.service().await;
    let response = service
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
        .expect("untracked diff");
    assert_eq!(response.files.len(), 2);
    // Git lists untracked paths in name order, so the fixture looks each one up by the
    // path it asked about rather than by position.
    let fresh = response
        .files
        .iter()
        .find(|file| file.display_path == "new.txt")
        .expect("new.txt is in the change set");
    match &fresh.patch {
        refyard_contract::diff::FilePatch::Text { hunks, synthesized } => {
            assert!(synthesized, "a synthesized patch must say so");
            assert_eq!(hunks[0].new_lines, 2);
        }
        other => panic!("expected a text patch, got {other:?}"),
    }
    let empty = response
        .files
        .iter()
        .find(|file| file.display_path == "empty.txt")
        .expect("empty.txt is in the change set");
    assert_eq!(empty.insertions, Some(0));
}

#[tokio::test]
async fn status_can_include_ignored_paths_when_asked_and_omits_them_otherwise() {
    // An ignored file is a real state a user needs to see on request, and a file the
    // plain status must not list.
    let fixture = Fixture::new();
    fixture.write(".gitignore", "ignored.txt\n");
    fixture.write("a.txt", "base\n");
    fixture.commit_all("base");
    fixture.write("ignored.txt", "noise\n");
    let (service, repository_id) = fixture.service().await;
    let plain = service
        .status(&StatusQuery::new(repository_id.clone()))
        .await
        .expect("plain status");
    assert_eq!(plain.entry_count, 0);
    let mut query = StatusQuery::new(repository_id);
    query.include_ignored = true;
    let including = service.status(&query).await.expect("including ignored");
    assert_eq!(including.entry_count, 1);
    assert_eq!(
        including.entries[0].kind,
        refyard_contract::reads::StatusEntryKind::Ignored
    );
}

#[tokio::test]
async fn a_paths_read_of_a_linked_worktree_uses_its_own_git_directory() {
    // A linked worktree's Git directory is inside the common one; reading the primary
    // worktree's directory instead would report the wrong HEAD and the wrong index.
    let fixture = Fixture::new();
    fixture.write("a.txt", "base\n");
    fixture.commit_all("base");
    let linked = fixture.scratch.join("linked");
    fixture.git(&[
        "worktree",
        "add",
        "--quiet",
        linked.to_str().expect("utf8"),
        "-b",
        "feature",
    ]);
    write_at(&linked.join("a.txt"), "feature change\n");
    let record = record_for(&fixture, &linked).await;
    assert!(
        record.layout.git_dir.contains("worktrees"),
        "the linked worktree has its own git dir: {}",
        record.layout.git_dir
    );
    let provider = git_provider(&fixture);
    let snapshots = SnapshotStore::default();
    let (snapshot, _) = read_status(
        &provider,
        &record,
        &PathRegistry::new(),
        &snapshots,
        false,
        "2026-01-01T00:00:00.000Z",
    )
    .await
    .expect("status");
    assert_eq!(snapshot.head.branch_name.as_deref(), Some("feature"));
    assert_eq!(snapshot.entries.len(), 1);
    assert_eq!(snapshot.entries[0].worktree_status, "M");
}

#[tokio::test]
async fn git_worktree_porcelain_z_parses_primary_and_detached_linked_worktrees() {
    let fixture = Fixture::new();
    fixture.write("README.md", "seed\n");
    fixture.commit_all("seed");

    let linked = fixture.scratch.join("linked worktree");
    fixture.git(&[
        "worktree",
        "add",
        "--detach",
        "--quiet",
        linked.to_str().expect("UTF-8 fixture path"),
        "HEAD",
    ]);
    let bytes = fixture.git(&["worktree", "list", "--porcelain", "-z"]);
    let worktrees = parse_worktree_list(&bytes).expect("Git's actual porcelain output parses");
    let primary_path = fixture.git(&["rev-parse", "--show-toplevel"]);
    let primary_path = primary_path.strip_suffix(b"\n").expect("Git newline");
    let linked_path = fixture.git_at(&linked, &["rev-parse", "--show-toplevel"]);
    let linked_path = linked_path.strip_suffix(b"\n").expect("Git newline");

    assert_eq!(worktrees.len(), 2);
    assert!(
        worktrees
            .iter()
            .any(|worktree| worktree.path_bytes == primary_path),
        "expected primary path {:?}, got {:?}",
        primary_path,
        worktrees
            .iter()
            .map(|worktree| worktree.path_bytes.as_slice())
            .collect::<Vec<_>>()
    );
    let primary = worktrees
        .iter()
        .find(|worktree| worktree.path_bytes == primary_path)
        .expect("primary worktree is present");
    assert_eq!(primary.branch_ref.as_deref(), Some("refs/heads/main"));
    assert!(!primary.detached);
    assert_eq!(primary.head_oid.as_deref(), Some(fixture.head().as_str()));

    let linked = worktrees
        .iter()
        .find(|worktree| worktree.path_bytes == linked_path)
        .expect("linked worktree is present despite the space in its path");
    assert!(linked.detached);
    assert_eq!(linked.branch_ref, None);
    assert_eq!(linked.head_oid.as_deref(), Some(fixture.head().as_str()));
}

#[tokio::test]
async fn a_diff_of_one_commit_compares_it_with_its_first_parent() {
    let fixture = Fixture::new();
    fixture.write("a.txt", "one\n");
    fixture.commit_all("one");
    fixture.write("a.txt", "two\n");
    let head = fixture.head();
    fixture.commit_all("two");
    let (service, repository_id) = fixture.service().await;
    let response = service
        .diff(&DiffQuery {
            repository_id,
            worktree_id: None,
            kind: DiffKind::Commit,
            oid: Some(head),
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        })
        .await
        .expect("commit diff");
    assert_eq!(response.files.len(), 1);
    assert_eq!(
        response.files[0].change_kind,
        refyard_contract::diff::ChangeKind::Modified
    );
}
