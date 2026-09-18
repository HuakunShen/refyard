//! Previews: a token that binds the *content* a caller was shown, and the file readers
//! that produce it.
//!
//! The failure this file exists to prevent is the one a status letter cannot see: a file
//! edited from one modified state into another is still `M`, so a request built from an
//! earlier look would stage bytes nobody read. Every case here therefore writes real bytes
//! into a temporary repository with its own `HOME` and its own Git configuration, and the
//! preview is judged against the bytes on disk rather than against a marker.
//!
//! The second half is the read itself. A local path and a remote path answer through the
//! same typed result, because "this is a directory", "this is a symlink", "there is no such
//! file" and "this is larger than the host will read" are different facts and a single
//! generic failure would let a caller believe a file it never saw.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::problem::ProblemCode;
use refyard_contract::reads::{ContentKind, FingerprintAlgorithm, PreviewsRequest};
use refyard_host::files::preview::{PreviewCheck, PreviewClaim, PreviewRefusal, PreviewStore};
use refyard_host::files::{
    local, remote, ContentKind as FileContentKind, FileRead, PREVIEW_MAX_BYTES,
};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{
    ApplicationService, ApplicationServiceConfig, PreviewSubmission, StatusQuery,
};

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
        let fixture = Self {
            temp,
            home,
            repo,
            env: Vec::new(),
        };
        let mut fixture = fixture;
        fixture.env = fixture_environment(&fixture.home);
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        fixture.write("a.txt", "alpha\nbeta\n");
        fixture.write("b.txt", "second\n");
        git_add(&fixture, "a.txt");
        git_add(&fixture, "b.txt");
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
        self.write_bytes(relative, content.as_bytes());
    }

    fn write_bytes(&self, relative: &str, content: &[u8]) {
        let path = self.repo.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, content).expect("write file");
    }

    fn path(&self) -> &str {
        self.repo.to_str().expect("utf8 path")
    }

    fn state_root(&self) -> PathBuf {
        self.temp.path().join("state")
    }

    fn service(&self) -> ApplicationService {
        ApplicationService::new(ApplicationServiceConfig {
            git: LocalGit::at(git_program(), self.env.clone()),
            service_instance_id: "srvc_previews".to_string(),
            target_id: "tgt_local".to_string(),
            target_generation: "gen_1".to_string(),
            home: self.home.clone(),
        })
        .with_state_root(self.state_root())
        .expect("the journal directory is writable")
    }

    /// Registers the repository and returns its id and worktree id.
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

    /// The path id a status read minted for `display_path`.
    async fn path_id(
        &self,
        service: &ApplicationService,
        repository_id: &str,
        named: &str,
    ) -> String {
        let status = service
            .status(&StatusQuery::new(repository_id))
            .await
            .expect("status");
        status
            .entries
            .iter()
            .find(|entry| entry.display_path == named)
            .unwrap_or_else(|| panic!("no status entry for {named}"))
            .path_id
            .clone()
    }

    /// The preview token for one selected path, and the response's snapshot id.
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
        let token = response.tokens.first().expect("a token per requested path");
        assert!(
            token.preview_token.len() >= 8,
            "a token that short cannot be unique: {:?}",
            token.preview_token
        );
        assert_eq!(token.fingerprint_algorithm, FingerprintAlgorithm::Sha256);
        (token.preview_token.clone(), response.snapshot_id.clone())
    }

    /// The submission the fixture builds: the ids and tokens the plan's case names.
    fn submission(
        repository_id: &str,
        worktree_id: &str,
        path_id: &str,
        token: &str,
    ) -> PreviewSubmission {
        PreviewSubmission {
            repository_id: repository_id.to_string(),
            worktree_id: worktree_id.to_string(),
            path_ids: vec![path_id.to_string()],
            preview_tokens: vec![token.to_string()],
        }
    }
}

fn git_add(fixture: &Fixture, relative: &str) {
    fixture.git(&["add", "--", relative]);
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    let mut environment = vec![
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ),
        ("HOME".to_string(), home.display().to_string()),
        ("LC_ALL".to_string(), "C".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            home.join(".gitconfig").display().to_string(),
        ),
    ];
    environment.push(("LANG".to_string(), "C".to_string()));
    environment
}

/* ------------------------------------------------------------------ content, not a letter */

#[tokio::test]
async fn a_preview_binds_content_and_refuses_a_path_changed_behind_the_same_status_letter() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // A tracked file with an uncommitted modification: status says `M`.
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let (token, _) = fixture
        .preview(&service, &repository_id, &worktree_id, &path_id)
        .await;

    // The user looks at the previewed bytes and then something rewrites the file. It is
    // still `M`, and it is still the same path id — only the content moved.
    fixture.write("a.txt", "alpha\nbeta changed again\n");
    let still_modified = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("status");
    let entry = still_modified
        .entries
        .iter()
        .find(|entry| entry.display_path == "a.txt")
        .expect("the path is still listed");
    assert_eq!(
        entry.worktree_status, "M",
        "the whole point is that the status letter did not change"
    );
    assert_eq!(
        entry.path_id, path_id,
        "the same bytes in the same worktree keep the id they were minted under, so the id \
         cannot be what detects the change"
    );

    let refused = service
        .redeem_previews(&Fixture::submission(
            &repository_id,
            &worktree_id,
            &path_id,
            &token,
        ))
        .await
        .expect_err("content changed after it was previewed");
    assert_eq!(refused.code, ProblemCode::StalePreview, "{refused:?}");
    assert!(
        refused.message.contains("re-preview") || refused.message.contains("preview"),
        "the refusal must say what to do about it: {refused:?}"
    );

    // Put the previewed bytes back. The stale refusal consumed nothing — a batch that is
    // refused leaves every token alone — so the same token now matches the content it was
    // minted over and is accepted.
    fixture.write("a.txt", "alpha\nbeta changed\n");
    service
        .redeem_previews(&Fixture::submission(
            &repository_id,
            &worktree_id,
            &path_id,
            &token,
        ))
        .await
        .expect("the content the token was minted over is back");

    // And now it is spent: a replayed request cannot act on content the user has not been
    // shown again, even though the bytes still match.
    let replayed = service
        .redeem_previews(&Fixture::submission(
            &repository_id,
            &worktree_id,
            &path_id,
            &token,
        ))
        .await
        .expect_err("a token is single use");
    assert_eq!(replayed.code, ProblemCode::StalePreview, "{replayed:?}");
    assert!(
        replayed.message.contains("already been used"),
        "the refusal must say the token was spent: {replayed:?}"
    );
}

/* ------------------------------------------------------------------ authorisation by path id */

#[tokio::test]
async fn a_preview_serves_only_a_path_id_this_worktree_already_minted() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    fixture.write("a.txt", "alpha\nbeta changed\n");
    let _ = fixture.path_id(&service, &repository_id, "a.txt").await;

    // A path id nobody minted names a file the caller was never shown.
    let invented = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: vec!["path_9999".to_string()],
        })
        .await
        .expect_err("an id this registry never minted");
    assert_eq!(invented.code, ProblemCode::NotFound, "{invented:?}");

    // An empty selection and an oversized one are both refused: the second is the bound the
    // published limits name, and refusing it here is what stops a preview from reading a
    // whole repository.
    let empty = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: Vec::new(),
        })
        .await
        .expect_err("at least one path id is required");
    assert_eq!(empty.code, ProblemCode::InvalidRequest, "{empty:?}");

    let too_many = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: (0..1_001).map(|index| format!("path_{index}")).collect(),
        })
        .await
        .expect_err("more than 1000 paths may not be previewed at once");
    assert_eq!(too_many.code, ProblemCode::LimitExceeded, "{too_many:?}");

    // Another worktree of the same repository is not this worktree.
    let elsewhere = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: "wt_9".to_string(),
            path_ids: vec!["path_1".to_string()],
        })
        .await
        .expect_err("unknown worktree");
    assert_eq!(elsewhere.code, ProblemCode::NotFound, "{elsewhere:?}");
}

#[tokio::test]
async fn a_token_bound_to_another_repository_worktree_or_build_is_refused() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (first_id, first_worktree) = fixture.open(&service).await;
    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &first_id, "a.txt").await;
    let (token, _) = fixture
        .preview(&service, &first_id, &first_worktree, &path_id)
        .await;

    // A second, different repository: an id from the first names nothing here.
    let other = fixture.temp.path().join("other");
    std::fs::create_dir_all(&other).expect("create the second repository");
    let output = Command::new(git_program())
        .args(["init", "--quiet", "--initial-branch=main"])
        .current_dir(&other)
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
    let opened = service
        .register_repository(other.to_str().expect("utf8"))
        .await
        .expect("the second repository opens");
    let second = opened
        .repositories
        .iter()
        .find(|summary| summary.repository_id != first_id)
        .expect("the second row")
        .repository_id
        .clone();

    let crossed = service
        .redeem_previews(&Fixture::submission(
            &second,
            &first_worktree,
            &path_id,
            &token,
        ))
        .await
        .expect_err("a path id from another repository is not a path here");
    assert!(
        matches!(
            crossed.code,
            ProblemCode::NotFound | ProblemCode::StalePreview | ProblemCode::InvalidRequest
        ),
        "{crossed:?}"
    );

    // The token's own binding is checked inside the store, where the worktree, repository
    // and target generation travel with the claim. A store is the only place a token from
    // another worktree of the same repository can arise in this build, because a
    // registration here mints exactly one worktree.
    let store = PreviewStore::with_contract_limits();
    let claim = PreviewClaim {
        repository_id: "repo_1".to_string(),
        worktree_id: "wt_1".to_string(),
        target_generation: "gen_1".to_string(),
        path_id: "path_1".to_string(),
        fingerprint_hex: Some("aa".to_string()),
        size_bytes: Some(1),
        content_kind: FileContentKind::Text,
    };
    let issued = store.issue(claim.clone());
    let check = |worktree: &str, repository: &str, generation: &str, path: &str| PreviewCheck {
        preview_token: issued.preview_token.clone(),
        repository_id: repository.to_string(),
        worktree_id: worktree.to_string(),
        target_generation: generation.to_string(),
        path_id: path.to_string(),
        current_fingerprint_hex: Some("aa".to_string()),
    };
    assert_eq!(
        store.verify(&[check("wt_1", "repo_1", "gen_1", "path_1")]),
        Ok(()),
        "the claim's own binding is accepted"
    );
    assert_eq!(
        store.verify(&[check("wt_2", "repo_1", "gen_1", "path_1")]),
        Err(PreviewRefusal::WrongWorktree)
    );
    assert_eq!(
        store.verify(&[check("wt_1", "repo_2", "gen_1", "path_1")]),
        Err(PreviewRefusal::WrongRepository)
    );
    assert_eq!(
        store.verify(&[check("wt_1", "repo_1", "gen_2", "path_1")]),
        Err(PreviewRefusal::StaleGeneration)
    );
    assert_eq!(
        store.verify(&[check("wt_1", "repo_1", "gen_1", "path_2")]),
        Err(PreviewRefusal::WrongPath)
    );

    // A token this store never issued does not exist, and a content change is stale.
    let mut unknown = check("wt_1", "repo_1", "gen_1", "path_1");
    unknown.preview_token = "pt_not_a_token".to_string();
    assert_eq!(
        store.verify(&[unknown.clone()]),
        Err(PreviewRefusal::UnknownToken)
    );
    let mut changed = check("wt_1", "repo_1", "gen_1", "path_1");
    changed.current_fingerprint_hex = Some("bb".to_string());
    assert_eq!(store.redeem(&[changed]), Err(PreviewRefusal::StaleContent));
    // The all-or-nothing rule: the stale refusal above must not have consumed the token.
    assert_eq!(
        store.redeem(&[check("wt_1", "repo_1", "gen_1", "path_1")]),
        Ok(())
    );
    assert_eq!(
        store.redeem(&[check("wt_1", "repo_1", "gen_1", "path_1")]),
        Err(PreviewRefusal::AlreadyUsed)
    );
    // A path that cannot be read at all is stale rather than silently equal to the empty
    // fingerprint an unreadable preview issued.
    let unreadable = PreviewCheck {
        preview_token: store
            .issue(PreviewClaim {
                fingerprint_hex: None,
                size_bytes: None,
                content_kind: FileContentKind::Unrepresentable,
                ..claim.clone()
            })
            .preview_token,
        repository_id: "repo_1".to_string(),
        worktree_id: "wt_1".to_string(),
        target_generation: "gen_1".to_string(),
        path_id: "path_1".to_string(),
        current_fingerprint_hex: None,
    };
    assert_eq!(store.redeem(&[unreadable]), Err(PreviewRefusal::Unreadable));
}

/* ------------------------------------------------------------------ the two readers */

#[test]
fn one_local_reader_answers_every_kind_of_path_with_its_own_typed_result() {
    let fixture = Fixture::new();
    let root = fixture.repo.clone();

    let text = local::read(&root, b"a.txt");
    match &text {
        FileRead::Bytes {
            bytes,
            content_kind,
        } => {
            assert_eq!(bytes, b"alpha\nbeta\n");
            assert_eq!(*content_kind, FileContentKind::Text);
        }
        other => panic!("a regular file must be read as bytes, got {other:?}"),
    }
    assert_eq!(text.size_bytes(), Some(11));

    fixture.write_bytes("blob.bin", b"\x00\x01\x02not text");
    assert_eq!(
        local::read(&root, b"blob.bin").content_kind(),
        FileContentKind::Binary,
        "a NUL in the sniffed prefix means binary, which is what the UI shows instead of \
         replacement characters"
    );

    assert_eq!(local::read(&root, b"missing.txt"), FileRead::Missing);
    std::fs::create_dir_all(root.join("docs")).expect("create a directory");
    assert_eq!(local::read(&root, b"docs"), FileRead::Directory);

    let symlink = root.join("link.txt");
    std::os::unix::fs::symlink(root.join("a.txt"), &symlink).expect("create symlink");
    assert_eq!(
        local::read(&root, b"link.txt"),
        FileRead::Symlink,
        "a symlink is not a regular file: following it would read bytes the path does not own"
    );

    // A submodule is a directory whose contents belong to another repository.
    let submodule = root.join("vendor");
    std::fs::create_dir_all(&submodule).expect("create the submodule directory");
    std::fs::write(submodule.join(".git"), "gitdir: ../.git/modules/vendor\n")
        .expect("write the gitlink file");
    assert_eq!(local::read(&root, b"vendor"), FileRead::Submodule);

    // A file larger than the host will read is refused by its own name, not truncated.
    let oversize = root.join("big.txt");
    let file = std::fs::File::create(&oversize).expect("create the large file");
    file.set_len(PREVIEW_MAX_BYTES + 1)
        .expect("size the large file");
    drop(file);
    assert_eq!(
        local::read(&root, b"big.txt"),
        FileRead::Oversize {
            size_bytes: Some(PREVIEW_MAX_BYTES + 1)
        }
    );

    // A path whose bytes contain NUL cannot address a file at all.
    assert_eq!(local::read(&root, b"bad\0name"), FileRead::Unrepresentable);

    // A name that is not UTF-8 is still a name on this machine, and the reader keeps its
    // bytes rather than substituting a replacement character.
    use std::os::unix::ffi::OsStrExt;
    let raw = root.join(std::ffi::OsStr::from_bytes(b"caf\xe9.txt"));
    if std::fs::write(&raw, b"latin-1 name").is_ok() {
        match local::read(&root, b"caf\xe9.txt") {
            FileRead::Bytes {
                bytes,
                content_kind,
            } => {
                assert_eq!(bytes, b"latin-1 name");
                assert_eq!(content_kind, FileContentKind::Text);
            }
            other => panic!("a non-UTF-8 name must still be readable locally, got {other:?}"),
        }
    }
}

#[test]
fn the_remote_reader_sends_one_fixed_bounded_command_and_never_a_local_path() {
    let command =
        remote::read_command("/srv/fixture's repo", "a b.txt").expect("an encodable path");
    assert!(command.starts_with("sh -c '"), "{command}");
    assert!(
        command.contains("'\"'\"'"),
        "the apostrophe in the remote path must be encoded, not become shell syntax: {command}"
    );
    assert!(
        command.contains(&PREVIEW_MAX_BYTES.to_string()),
        "the byte bound must be enforced on the far side, not only after the bytes arrived: {command}"
    );
    assert!(
        !command.contains("sha256sum") && !command.contains("python"),
        "the fingerprint is computed here, over the bytes that arrived: {command}"
    );
    assert!(
        command.contains("refyard-read"),
        "the fixed script is named so a diagnostic on the far side can say what ran: {command}"
    );

    // A path that cannot travel through a command string is refused before anything runs:
    // the SSH provider takes one string, so a NUL or a byte sequence that is not UTF-8 has
    // no encoding there.
    assert_eq!(
        remote::read_command("/srv/repo", "bad\0name")
            .expect_err("NUL")
            .code,
        ProblemCode::UnsupportedPathEncoding
    );
    assert_eq!(
        remote::encode_relative(b"caf\xe9.txt").expect_err("not UTF-8"),
        FileRead::Unrepresentable
    );
    assert_eq!(
        remote::encode_relative(b"plain.txt").expect("UTF-8"),
        "plain.txt"
    );
}

/* ------------------------------------------------------------------ the read over the wire */

#[tokio::test]
async fn a_path_that_cannot_be_read_is_a_token_without_content_rather_than_a_fabricated_one() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    // A tracked file the user deleted: status reports it, and the preview has no bytes. The
    // token carries no size and no content rather than pretending the file is empty.
    std::fs::remove_file(fixture.repo.join("b.txt")).expect("delete the tracked file");
    let path_id = fixture.path_id(&service, &repository_id, "b.txt").await;
    let response = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: vec![path_id.clone()],
        })
        .await
        .expect("a deleted path is previewable as content the host cannot read");
    let token = &response.tokens[0];
    assert_eq!(token.size_bytes, None, "a missing file has no size");
    assert_eq!(token.content_kind, ContentKind::Unrepresentable);

    // And a submission built on it is stale: nothing was read, so nothing can be changed.
    let refused = service
        .redeem_previews(&Fixture::submission(
            &repository_id,
            &worktree_id,
            &path_id,
            &token.preview_token,
        ))
        .await
        .expect_err("a path with no readable content cannot be confirmed");
    assert_eq!(refused.code, ProblemCode::StalePreview, "{refused:?}");

    // A file over the bound is not previewable at all, and the refusal names the bound
    // rather than silently fingerprinting a prefix of it.
    let oversize = fixture.repo.join("huge.txt");
    let file = std::fs::File::create(&oversize).expect("create the large file");
    file.set_len(PREVIEW_MAX_BYTES + 1).expect("size it");
    drop(file);
    let huge = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: vec![fixture.path_id(&service, &repository_id, "huge.txt").await],
        })
        .await
        .expect_err("a file over the read bound is refused");
    assert_eq!(huge.code, ProblemCode::LimitExceeded, "{huge:?}");
}

#[tokio::test]
async fn a_preview_of_an_unchanged_file_reports_the_bytes_it_read() {
    let fixture = Fixture::new();
    let service = fixture.service();
    let (repository_id, worktree_id) = fixture.open(&service).await;

    fixture.write("a.txt", "alpha\nbeta changed\n");
    let path_id = fixture.path_id(&service, &repository_id, "a.txt").await;
    let response = service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: vec![path_id.clone()],
        })
        .await
        .expect("previews");
    let token = &response.tokens[0];
    assert_eq!(token.path_id, path_id);
    assert_eq!(token.size_bytes, Some(19));
    assert_eq!(token.content_kind, ContentKind::Text);
    assert!(
        token.expires_at.ends_with('Z') && token.expires_at.len() == 24,
        "expiresAt is an ISO-8601 instant: {}",
        token.expires_at
    );
    // The response names the state the preview was taken against, so a mutation built on it
    // can be refused when the index moved in between.
    assert!(!response.snapshot_id.is_empty());
    assert_eq!(response.repository_id, repository_id);
    assert_eq!(response.worktree_id, worktree_id);
    service
        .redeem_previews(&Fixture::submission(
            &repository_id,
            &worktree_id,
            &path_id,
            &token.preview_token,
        ))
        .await
        .expect("unchanged content is confirmed");
}
