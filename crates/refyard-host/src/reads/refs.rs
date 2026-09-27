//! The refs panel: branches, remote-tracking refs, tags and remotes in one read.
//!
//! Three of the fields here are display data that must never be mistaken for input or
//! authority:
//!
//! - **Remote URLs are redacted.** `https://user:token@host/path` becomes
//!   `https://host/path`; an SSH URL keeps its user because `git@host:path` names an
//!   account rather than authenticating. A URL is shown, never handed back as an
//!   argument.
//! - **`isCurrent` compares full ref names**, not short ones: `refs/heads/main` and
//!   `refs/remotes/origin/main` share a short name, and only HEAD's own ref may be
//!   marked current.
//! - **A tag's `targetOid` is the peeled object**, so an annotated tag shows the commit
//!   behind the tag object rather than the tag object itself.
//!
//! `truncated` is always false because a listing longer than the parser's bound is an
//! error rather than a shortened list — and a shortened ref list is how a UI comes to
//! believe a branch does not exist.

use refyard_contract::reads::{HeadState, ObjectFormat};
use refyard_contract::refs::{
    OtherRefEntry, OtherRefKind, RefEntry, RefUpstream, RefsRemoteEntry, RefsSnapshot,
    RemoteRefEntry, TagEntry,
};
use refyard_core::parse::meta::{parse_remote_list, RemoteUrlKind, RemoteUrlRecord};
use refyard_core::parse::numstat::REF_LIST_MAX_ENTRIES;
use refyard_core::parse::refs::{parse_for_each_ref, RefRecord};
use refyard_core::plan::refs::plan_remotes;
use refyard_core::plan::status::plan_for_each_ref;

use crate::providers::GitExecutor;
use crate::reads::{parse_error, read_head_state, run_required, ReadError};
use crate::registry::RepositoryRecord;
use crate::snapshots::{SnapshotKind, SnapshotRequest, SnapshotStore};

const FOR_EACH_REF_COMMAND: &str = "for-each-ref";
const REMOTES_COMMAND: &str = "remote -v";

/// One remote, with the URLs this host will display for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteGroup {
    pub name: String,
    pub fetch_url: String,
    pub push_url: Option<String>,
}

/// The refs and remotes one read observed.
///
/// Grouped because refs and remotes travel together: the refs panel shows both, and the
/// history panel needs the refs alone for its tips and its decoration.
pub struct RefFacts {
    pub refs: Vec<RefRecord>,
    pub remotes: Vec<RemoteGroup>,
}

/// Reads every ref and every configured remote.
pub async fn read_ref_facts(
    runs: &GitExecutor,
    record: &RepositoryRecord,
) -> Result<RefFacts, ReadError> {
    let directory = record.location.canonical_worktree.as_str();
    let ref_bytes =
        run_required(runs, directory, &plan_for_each_ref(), FOR_EACH_REF_COMMAND).await?;
    let refs = parse_for_each_ref(&ref_bytes, REF_LIST_MAX_ENTRIES)
        .map_err(|error| parse_error(FOR_EACH_REF_COMMAND, error))?;

    let remote_bytes = run_required(runs, directory, &plan_remotes(), REMOTES_COMMAND).await?;
    let remotes =
        parse_remote_list(&remote_bytes).map_err(|error| parse_error(REMOTES_COMMAND, error))?;
    Ok(RefFacts {
        refs,
        remotes: group_remotes(&remotes),
    })
}

/// Groups `remote -v` lines into one entry per remote.
///
/// Order follows first appearance, which is the order Git printed the remotes in; a
/// remote with a separate push URL appears twice and must stay one entry.
pub fn group_remotes(records: &[RemoteUrlRecord]) -> Vec<RemoteGroup> {
    let mut groups: Vec<RemoteGroup> = Vec::new();
    for record in records {
        let existing = groups.iter_mut().find(|group| group.name == record.name);
        match record.kind {
            RemoteUrlKind::Fetch => match existing {
                Some(group) => group.fetch_url = record.url.clone(),
                None => groups.push(RemoteGroup {
                    name: record.name.clone(),
                    fetch_url: record.url.clone(),
                    push_url: None,
                }),
            },
            RemoteUrlKind::Push => match existing {
                Some(group) => group.push_url = Some(record.url.clone()),
                None => groups.push(RemoteGroup {
                    name: record.name.clone(),
                    fetch_url: record.url.clone(),
                    push_url: Some(record.url.clone()),
                }),
            },
        }
    }
    groups
}

/// A remote URL with any credential removed.
///
/// A URL that cannot be parsed is returned with everything before the last `@` removed,
/// which is the conservative direction: it can lose a host name but never leaks a token.
/// `ssh://user@host/path` keeps its user, because there the user selects an account
/// rather than authenticating.
pub fn redact_remote_url(url: &str) -> String {
    let Some(separator) = url.find("://") else {
        // scp-like `user@host:path`. A bare user names an account; a colon before the
        // `@` means a password, and everything up to the `@` goes.
        let at = url.rfind('@');
        let colon = url.find(':');
        return match (at, colon) {
            (Some(at), Some(colon)) if colon < at => url[at + 1..].to_string(),
            _ => url.to_string(),
        };
    };
    let scheme = &url[..separator];
    let rest = &url[separator + 3..];
    let slash = rest.find('/');
    let authority = match slash {
        Some(slash) => &rest[..slash],
        None => rest,
    };
    let path = match slash {
        Some(slash) => &rest[slash..],
        None => "",
    };
    let Some(at) = authority.rfind('@') else {
        return url.to_string();
    };
    let user_info = &authority[..at];
    let has_password = user_info.contains(':');
    if scheme == "ssh" && !has_password {
        return url.to_string();
    }
    format!("{scheme}://{}{path}", &authority[at + 1..])
}

/// Which heading a ref outside `refs/heads`, `refs/remotes` and `refs/tags` belongs
/// under.
pub fn other_ref_kind(ref_name: &str) -> OtherRefKind {
    if ref_name == "refs/stash" {
        return OtherRefKind::Stash;
    }
    if ref_name.starts_with("refs/notes/") {
        return OtherRefKind::Notes;
    }
    if ref_name.starts_with("refs/replace/") {
        return OtherRefKind::Replace;
    }
    OtherRefKind::Other
}

/// The object format this repository uses, as the layout read detected it.
pub fn object_format_of(record: &RepositoryRecord) -> ObjectFormat {
    if record.layout.object_format == "sha256" {
        ObjectFormat::Sha256
    } else {
        ObjectFormat::Sha1
    }
}

/// Reads refs and records a snapshot for them.
pub async fn read_refs(
    runs: &GitExecutor,
    record: &RepositoryRecord,
    snapshots: &SnapshotStore,
    read_at: &str,
) -> Result<RefsSnapshot, ReadError> {
    let facts = read_ref_facts(runs, record).await?;
    let head = read_head_state(runs, record).await?;
    let snapshot = snapshots.mint(SnapshotRequest {
        kind: SnapshotKind::Refs,
        repository_id: &record.repository_id,
        worktree_id: Some(&record.worktree_id),
        target_generation: &record.location.target_generation,
        tips: Vec::new(),
        head_oid: head.oid.clone(),
        observed_refs_fingerprint: None,
        index_key: None,
        history_intent: None,
    });
    Ok(build_snapshot(
        &record.repository_id,
        object_format_of(record),
        &facts,
        &head,
        &snapshot.snapshot_id,
        read_at,
    ))
}

/// Maps observed refs onto the wire shape.
fn build_snapshot(
    repository_id: &str,
    object_format: ObjectFormat,
    facts: &RefFacts,
    head: &HeadState,
    snapshot_id: &str,
    read_at: &str,
) -> RefsSnapshot {
    let current_branch_ref = head
        .branch_name
        .as_ref()
        .map(|name| format!("refs/heads/{name}"));
    RefsSnapshot {
        snapshot_id: snapshot_id.to_string(),
        repository_id: repository_id.to_string(),
        read_at: read_at.to_string(),
        object_format,
        head: head.clone(),
        branches: facts
            .refs
            .iter()
            .filter(|item| item.ref_name.starts_with("refs/heads/"))
            .map(|item| RefEntry {
                name: item.ref_name["refs/heads/".len()..].to_string(),
                full_name: item.ref_name.clone(),
                oid: item.oid.clone(),
                is_current: current_branch_ref.as_deref() == Some(item.ref_name.as_str()),
                upstream: item.upstream.as_ref().map(|upstream| RefUpstream {
                    full_name: upstream.clone(),
                    ahead: item.upstream_track.map(|track| track.ahead).unwrap_or(0),
                    behind: item.upstream_track.map(|track| track.behind).unwrap_or(0),
                    gone: item.upstream_track.map(|track| track.gone).unwrap_or(false),
                }),
            })
            .collect(),
        remote_branches: facts
            .refs
            .iter()
            .filter(|item| item.ref_name.starts_with("refs/remotes/"))
            .map(|item| {
                let short = &item.ref_name["refs/remotes/".len()..];
                let slash = short.find('/');
                RemoteRefEntry {
                    name: short.to_string(),
                    full_name: item.ref_name.clone(),
                    oid: item.oid.clone(),
                    remote_name: match slash {
                        Some(slash) => short[..slash].to_string(),
                        None => short.to_string(),
                    },
                }
            })
            .collect(),
        tags: facts
            .refs
            .iter()
            .filter(|item| item.ref_name.starts_with("refs/tags/"))
            .map(|item| TagEntry {
                name: item.ref_name["refs/tags/".len()..].to_string(),
                full_name: item.ref_name.clone(),
                oid: item.oid.clone(),
                // An annotated tag's ref points at a tag object; a lightweight tag's ref
                // points straight at the commit.
                annotated: item.object_type == "tag",
                target_oid: item.peeled_oid.clone(),
            })
            .collect(),
        remotes: facts
            .remotes
            .iter()
            .map(|remote| RefsRemoteEntry {
                name: remote.name.clone(),
                fetch_url_display: redact_remote_url(&remote.fetch_url),
                push_url_display: remote.push_url.as_deref().map(redact_remote_url),
            })
            .collect(),
        other_refs: facts
            .refs
            .iter()
            .filter(|item| {
                !item.ref_name.starts_with("refs/heads/")
                    && !item.ref_name.starts_with("refs/remotes/")
                    && !item.ref_name.starts_with("refs/tags/")
            })
            .map(|item| OtherRefEntry {
                full_name: item.ref_name.clone(),
                oid: item.oid.clone(),
                kind: other_ref_kind(&item.ref_name),
            })
            .collect(),
        // A ref listing is read whole: a listing over the parser's bound is refused
        // rather than shortened, so a client is never shown a partial ref set.
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::HeadKind;
    use refyard_core::parse::refs::UpstreamTrack;

    fn remote(name: &str, url: &str, kind: RemoteUrlKind) -> RemoteUrlRecord {
        RemoteUrlRecord {
            name: name.to_string(),
            url: url.to_string(),
            kind,
        }
    }

    fn ref_record(name: &str, oid: &str) -> RefRecord {
        RefRecord {
            ref_name: name.to_string(),
            oid: oid.to_string(),
            object_type: "commit".to_string(),
            symref: None,
            upstream: None,
            upstream_track: None,
            is_head: false,
            peeled_oid: None,
        }
    }

    fn head_on(branch: &str, oid: &str) -> HeadState {
        HeadState {
            kind: HeadKind::Born,
            branch_name: Some(branch.to_string()),
            oid: Some(oid.to_string()),
            detached: false,
        }
    }

    fn unborn() -> HeadState {
        HeadState {
            kind: HeadKind::Unborn,
            branch_name: None,
            oid: None,
            detached: false,
        }
    }

    #[test]
    fn a_remote_with_two_urls_stays_one_entry() {
        // A separate push URL is one remote, not two: two entries would offer the user
        // two endpoints for the same name.
        let groups = group_remotes(&[
            remote("origin", "https://example.test/f.git", RemoteUrlKind::Fetch),
            remote("origin", "git@example.test:f.git", RemoteUrlKind::Push),
            remote(
                "upstream",
                "https://example.test/u.git",
                RemoteUrlKind::Fetch,
            ),
        ]);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].name, "origin");
        assert_eq!(groups[0].fetch_url, "https://example.test/f.git");
        assert_eq!(
            groups[0].push_url.as_deref(),
            Some("git@example.test:f.git")
        );
        assert_eq!(groups[1].push_url, None);
    }

    #[test]
    fn a_push_url_alone_is_still_a_remote() {
        let groups = group_remotes(&[remote("odd", "git@example.test:o.git", RemoteUrlKind::Push)]);
        assert_eq!(groups[0].fetch_url, "git@example.test:o.git");
        assert_eq!(
            groups[0].push_url.as_deref(),
            Some("git@example.test:o.git")
        );
    }

    #[test]
    fn a_token_in_an_https_url_is_removed() {
        // The one value that must never reach a response body.
        assert_eq!(
            redact_remote_url("https://user:secret@example.test/repo.git"),
            "https://example.test/repo.git"
        );
        assert_eq!(
            redact_remote_url("https://token@example.test/repo.git"),
            "https://example.test/repo.git"
        );
    }

    #[test]
    fn an_ssh_url_keeps_its_account_but_not_its_password() {
        // `git@host:path` names an account, not a secret; `user:password@host` does not.
        assert_eq!(
            redact_remote_url("ssh://git@example.test/repo.git"),
            "ssh://git@example.test/repo.git"
        );
        assert_eq!(
            redact_remote_url("ssh://git:pw@example.test/repo.git"),
            "ssh://example.test/repo.git"
        );
        assert_eq!(
            redact_remote_url("git@example.test:repo.git"),
            "git@example.test:repo.git"
        );
    }

    #[test]
    fn an_scp_like_url_with_a_password_loses_everything_before_the_at() {
        assert_eq!(
            redact_remote_url("user:pw@example.test:repo.git"),
            "example.test:repo.git"
        );
    }

    #[test]
    fn a_relative_url_is_shown_as_it_is() {
        // A local fixture remote is display data too, and rewriting it would hide where
        // the user's fetches actually go.
        assert_eq!(redact_remote_url("../local.git"), "../local.git");
    }

    #[test]
    fn refs_outside_the_three_namespaces_get_their_own_kind() {
        assert_eq!(other_ref_kind("refs/stash"), OtherRefKind::Stash);
        assert_eq!(other_ref_kind("refs/notes/commits"), OtherRefKind::Notes);
        assert_eq!(other_ref_kind("refs/replace/abc"), OtherRefKind::Replace);
        assert_eq!(other_ref_kind("refs/bisect/good"), OtherRefKind::Other);
    }

    #[test]
    fn only_the_branch_head_is_on_may_be_current() {
        // A remote-tracking ref with the same short name must not be marked current;
        // the UI would otherwise imply a fetch moved the user's own branch.
        let facts = RefFacts {
            refs: vec![
                ref_record("refs/heads/main", "aaa"),
                ref_record("refs/remotes/origin/main", "aaa"),
            ],
            remotes: Vec::new(),
        };
        let snapshot = build_snapshot(
            "repo_1",
            ObjectFormat::Sha256,
            &facts,
            &head_on("main", "aaa"),
            "snap_1",
            "2026-09-18T00:00:00.000Z",
        );
        assert!(snapshot.branches[0].is_current);
        assert_eq!(snapshot.object_format, ObjectFormat::Sha256);
        assert_eq!(snapshot.remote_branches[0].remote_name, "origin");
        assert_eq!(snapshot.remote_branches[0].name, "origin/main");
        assert_eq!(
            snapshot.remote_branches[0].full_name,
            "refs/remotes/origin/main"
        );
    }

    #[test]
    fn a_detached_head_leaves_every_branch_not_current() {
        let facts = RefFacts {
            refs: vec![ref_record("refs/heads/main", "aaa")],
            remotes: Vec::new(),
        };
        let detached = HeadState {
            kind: HeadKind::Born,
            branch_name: None,
            oid: Some("bbb".to_string()),
            detached: true,
        };
        let snapshot = build_snapshot(
            "repo_1",
            ObjectFormat::Sha1,
            &facts,
            &detached,
            "snap_1",
            "2026-09-18T00:00:00.000Z",
        );
        assert!(!snapshot.branches[0].is_current);
        assert!(snapshot.head.detached);
    }

    #[test]
    fn an_annotated_tag_reports_the_object_it_points_at() {
        let mut tag = ref_record("refs/tags/v1", "tagobject");
        tag.object_type = "tag".to_string();
        tag.peeled_oid = Some("commitoid".to_string());
        let facts = RefFacts {
            refs: vec![tag, ref_record("refs/tags/light", "commitoid")],
            remotes: Vec::new(),
        };
        let snapshot = build_snapshot(
            "repo_1",
            ObjectFormat::Sha1,
            &facts,
            &unborn(),
            "snap_1",
            "2026-09-18T00:00:00.000Z",
        );
        assert!(snapshot.tags[0].annotated);
        assert_eq!(snapshot.tags[0].target_oid.as_deref(), Some("commitoid"));
        assert!(!snapshot.tags[1].annotated);
        assert_eq!(snapshot.tags[1].target_oid, None);
    }

    #[test]
    fn a_branch_with_a_gone_upstream_reports_gone_rather_than_level() {
        let mut branch = ref_record("refs/heads/main", "aaa");
        branch.upstream = Some("refs/remotes/origin/main".to_string());
        branch.upstream_track = Some(UpstreamTrack {
            ahead: 0,
            behind: 0,
            gone: true,
        });
        let facts = RefFacts {
            refs: vec![branch],
            remotes: Vec::new(),
        };
        let snapshot = build_snapshot(
            "repo_1",
            ObjectFormat::Sha1,
            &facts,
            &unborn(),
            "snap_1",
            "2026-09-18T00:00:00.000Z",
        );
        let upstream = snapshot.branches[0].upstream.clone().expect("upstream");
        assert!(upstream.gone);
        assert_eq!(upstream.ahead, 0);
    }

    #[test]
    fn a_stash_ref_is_reported_as_an_other_ref_of_kind_stash() {
        let facts = RefFacts {
            refs: vec![ref_record("refs/stash", "aaa")],
            remotes: Vec::new(),
        };
        let snapshot = build_snapshot(
            "repo_1",
            ObjectFormat::Sha1,
            &facts,
            &unborn(),
            "snap_1",
            "2026-09-18T00:00:00.000Z",
        );
        assert_eq!(snapshot.other_refs.len(), 1);
        assert_eq!(snapshot.other_refs[0].kind, OtherRefKind::Stash);
        assert!(snapshot.branches.is_empty());
    }
}
