//! The local directory picker's read, against a real directory tree.
//!
//! The questions that decide whether the Browse control is usable are about the
//! filesystem, not about a schema: is a linked worktree offered as a repository, is a
//! symlink to a directory navigable while a symlink to a file is not, is `.git` kept out
//! of the listing, and does a directory with too much in it say so instead of quietly
//! showing a prefix. Every fixture here is temporary and self-contained.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::FilesystemEntryKind;
use refyard_host::providers::local::LocalGit;
use refyard_host::reads::filesystem::{expand_user_path, read_filesystem_entries};
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};

/// A temporary tree with one of everything a picker has to tell apart.
struct Tree {
    _temp: tempfile::TempDir,
    root: PathBuf,
    home: PathBuf,
}

impl Tree {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let root = temp.path().join("root");
        let home = temp.path().join("home");
        std::fs::create_dir_all(&root).expect("create root");
        std::fs::create_dir_all(&home).expect("create home");
        let tree = Self {
            _temp: temp,
            root,
            home,
        };

        tree.dir("alpha");
        tree.dir("beta");
        tree.dir("gamma");
        tree.dir(".git");
        tree.file("notes.txt", "not a directory\n");
        tree.file("beta/.git/HEAD", "ref: refs/heads/main\n");
        // A linked worktree and a submodule carry a `.git` *file*; both are repositories
        // to open, so the marker test must not require a directory.
        tree.file("gamma/.git", "gitdir: ../elsewhere\n");
        tree
    }

    fn dir(&self, relative: &str) -> PathBuf {
        let path = self.root.join(relative);
        std::fs::create_dir_all(&path).expect("create dir");
        path
    }

    /// A directory under this tree's home, for the tests that expand `~`.
    fn home_dir(&self, relative: &str) -> PathBuf {
        let path = self.home.join(relative);
        std::fs::create_dir_all(&path).expect("create home dir");
        path
    }

    fn file(&self, relative: &str, content: &str) {
        let path = self.root.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, content).expect("write file");
    }

    fn path(&self) -> &str {
        self.root.to_str().expect("utf8 path")
    }

    /// A service whose `~` is this tree's home, so the picker's shorthand is testable.
    fn service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(
                "/nonexistent/git",
                vec![("PATH".to_string(), "/usr/bin:/bin".to_string())],
            ),
            service_instance_id: "srvc_fixture".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
    }

    /// The same service with a real Git and a fixture `HOME`, for the one test that
    /// registers what the picker offered.
    fn service_with_git(&self) -> ApplicationService {
        let home = self.home.to_string_lossy().into_owned();
        std::fs::write(self.home.join(".gitconfig"), "").expect("empty global config");
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(
                git_program(),
                vec![
                    ("PATH".to_string(), "/usr/bin:/bin".to_string()),
                    ("HOME".to_string(), home.clone()),
                    (
                        "GIT_CONFIG_GLOBAL".to_string(),
                        format!("{home}/.gitconfig"),
                    ),
                    ("GIT_CONFIG_SYSTEM".to_string(), "/dev/null".to_string()),
                    ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
                    ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
                    ("LC_ALL".to_string(), "C".to_string()),
                ],
            ),
            service_instance_id: "srvc_fixture".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
    }
}

/// The path as the host reports it: resolved, which is what a person is approving.
///
/// On macOS a temporary directory is reached through `/var`, which is a symlink to
/// `/private/var`, so the fixture's own spelling and the host's answer differ by more than
/// whitespace. Comparing the resolved forms is what makes these assertions about the
/// directory rather than about its spelling.
fn canonical(path: &Path) -> String {
    std::fs::canonicalize(path)
        .expect("canonical path")
        .to_string_lossy()
        .into_owned()
}

/// The names offered for one directory, in the order the picker would show them.
fn names(entries: &[refyard_contract::reads::FilesystemEntry]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| entry.name.clone())
        .collect::<Vec<_>>()
}

#[tokio::test]
async fn a_directory_is_offered_with_its_repositories_first_and_its_files_left_out() {
    let tree = Tree::new();
    let response = read_filesystem_entries(Some(tree.path()), &tree.home)
        .await
        .expect("lists the fixture");

    assert_eq!(
        names(&response.entries),
        vec!["beta", "gamma", "alpha"],
        "repositories come first, then directories, and `.git` and files are never entries"
    );
    let beta = response
        .entries
        .iter()
        .find(|entry| entry.name == "beta")
        .expect("beta is offered");
    assert_eq!(beta.kind, FilesystemEntryKind::Repository);
    assert_eq!(beta.path, canonical(&tree.dir("beta")));
    let alpha = response
        .entries
        .iter()
        .find(|entry| entry.name == "alpha")
        .expect("alpha is offered");
    assert_eq!(
        alpha.kind,
        FilesystemEntryKind::Directory,
        "a directory without a Git marker stays navigable"
    );
    assert!(!response.truncated);
}

#[tokio::test]
async fn a_git_file_marks_a_repository_the_same_way_a_git_directory_does() {
    let tree = Tree::new();
    let response = read_filesystem_entries(Some(tree.path()), &tree.home)
        .await
        .expect("lists the fixture");

    // A linked worktree and a submodule have a `.git` file, so requiring a directory here
    // would hide exactly the repositories a workbench exists to open.
    let gamma = response
        .entries
        .iter()
        .find(|entry| entry.name == "gamma")
        .expect("gamma is offered");
    assert_eq!(gamma.kind, FilesystemEntryKind::Repository);
}

#[tokio::test]
async fn the_parent_of_the_listed_directory_is_reported_so_a_person_can_go_back() {
    let tree = Tree::new();
    let sub = tree.dir("alpha");
    let response = read_filesystem_entries(Some(sub.to_str().expect("utf8")), &tree.home)
        .await
        .expect("lists a subdirectory");

    assert_eq!(response.path, canonical(&sub));
    let expected_parent = canonical(&tree.root);
    assert_eq!(
        response.parent_path.as_deref(),
        Some(expected_parent.as_str()),
        "without a parent path the picker cannot navigate upwards"
    );
    assert!(response.entries.is_empty());
}

#[tokio::test]
async fn a_shorthand_path_is_expanded_against_the_hosts_home() {
    let tree = Tree::new();
    let projects = tree.home_dir("projects");
    let response = read_filesystem_entries(Some("~/projects"), &tree.home)
        .await
        .expect("expands ~");

    assert_eq!(
        response.path,
        canonical(&projects),
        "the response names the real directory, not the shorthand"
    );
}

#[tokio::test]
async fn an_absent_path_starts_at_the_hosts_home() {
    let tree = Tree::new();
    tree.home_dir("repos");
    let response = read_filesystem_entries(None, &tree.home)
        .await
        .expect("defaults to home");

    assert_eq!(names(&response.entries), vec!["repos"]);
}

#[tokio::test]
async fn a_path_that_is_not_absolute_is_refused() {
    let tree = Tree::new();
    let refused = read_filesystem_entries(Some("relative/path"), &tree.home).await;

    // Silently resolving a relative path against the host's own working directory would
    // make the picker show a directory the person did not name.
    assert_eq!(
        refused.expect_err("refused").code,
        ProblemCode::InvalidRequest
    );
    assert_eq!(
        expand_user_path("  ~/x  ", Path::new("/home/u")),
        Path::new("/home/u").join("x").to_string_lossy()
    );
    assert_eq!(
        expand_user_path("~someone/x", Path::new("/home/u")),
        "~someone/x",
        "another user's home is not this host's to expand"
    );
}

#[tokio::test]
async fn a_missing_directory_and_a_file_are_told_apart() {
    let tree = Tree::new();
    let missing = read_filesystem_entries(
        Some(tree.root.join("nowhere").to_str().expect("utf8")),
        &tree.home,
    )
    .await
    .expect_err("missing");
    assert_eq!(missing.code, ProblemCode::NotFound);

    let file = read_filesystem_entries(
        Some(tree.root.join("notes.txt").to_str().expect("utf8")),
        &tree.home,
    )
    .await
    .expect_err("not a directory");
    assert_eq!(
        file.code,
        ProblemCode::InvalidRequest,
        "a file is a different answer from a path that does not exist"
    );
}

#[tokio::test]
async fn more_entries_than_a_picker_shows_are_reported_as_truncated() {
    let tree = Tree::new();
    let many = tree.dir("many");
    for index in 0..ENTRY_OVERFLOW {
        std::fs::create_dir_all(many.join(format!("dir-{index:03}"))).expect("create entry");
    }

    let response = read_filesystem_entries(Some(many.to_str().expect("utf8")), &tree.home)
        .await
        .expect("lists a large directory");

    assert_eq!(response.entries.len(), 200, "the listing is bounded");
    assert!(
        response.truncated,
        "a silently short listing would make a person believe a directory holds 200 things"
    );
}

/// One more entry than the picker returns, plus the one the scan inspects beyond the limit.
const ENTRY_OVERFLOW: usize = 210;

#[cfg(unix)]
#[tokio::test]
async fn a_symlinked_directory_is_navigable_and_a_symlinked_file_is_not() {
    let tree = Tree::new();
    let target = tree.dir("elsewhere");
    std::os::unix::fs::symlink(&target, tree.root.join("linked")).expect("symlink to a directory");
    std::os::unix::fs::symlink(tree.root.join("notes.txt"), tree.root.join("linked-file"))
        .expect("symlink to a file");
    std::os::unix::fs::symlink(tree.root.join("gone"), tree.root.join("broken"))
        .expect("broken symlink");

    let response = read_filesystem_entries(Some(tree.path()), &tree.home)
        .await
        .expect("lists the fixture");

    let names = names(&response.entries);
    assert!(names.contains(&"linked".to_string()));
    assert!(
        names.contains(&"elsewhere".to_string()),
        "the link's target is a directory in its own right: {names:?}"
    );
    assert!(
        !names.contains(&"linked-file".to_string()),
        "a link to a file cannot be opened as a repository: {names:?}"
    );
    assert!(
        !names.contains(&"broken".to_string()),
        "a link that resolves to nothing would be a click that fails: {names:?}"
    );
}

#[tokio::test]
async fn the_service_answers_the_picker_read_without_git() {
    let tree = Tree::new();
    let service = tree.service();

    let response = service
        .filesystem_entries(Some(tree.path()))
        .await
        .expect("lists through the service");

    assert!(names(&response.entries).contains(&"beta".to_string()));
    assert!(
        service
            .implemented_reads()
            .contains(&refyard_contract::reads::ReadKind::Filesystem),
        "capabilities must offer the read the picker uses"
    );
}

#[tokio::test]
async fn a_fixture_repository_registers_from_a_path_the_picker_returned() {
    let tree = Tree::new();
    // A real repository, so registration has a Git to ask.
    let repo = tree.dir("real");
    std::fs::create_dir_all(repo.join(".git")).expect("create .git");
    let output = Command::new(git_program())
        .args(["init", "--quiet", "--initial-branch=main"])
        .current_dir(&repo)
        .output()
        .expect("run git init");
    assert!(output.status.success(), "git init failed");

    let service = tree.service_with_git();
    let listed = service
        .filesystem_entries(Some(tree.path()))
        .await
        .expect("lists");
    let offered = listed
        .entries
        .iter()
        .find(|entry| entry.name == "real")
        .expect("the repository is offered");
    assert_eq!(offered.kind, FilesystemEntryKind::Repository);

    // The point of the read: what it returns is a path that can be approved as it stands.
    let registered = service
        .register_repository(&offered.path)
        .await
        .expect("registers the path the picker offered");
    assert_eq!(registered.repositories.len(), 1);
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}
