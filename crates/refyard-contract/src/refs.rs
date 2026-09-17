//! Branches, remote-tracking refs, tags and remotes in one read.
//!
//! A projection of `refsSnapshotSchema`, `refEntrySchema`, `remoteRefEntrySchema` and
//! `tagEntrySchema` from `packages/git-contract/src/reads.ts`. URLs are redacted for
//! display; the host never returns a credential, so `fetchUrlDisplay` is for reading
//! and never for sending back as an operation input.
//!
//! Every field in this module is required — the contract has no `.optional()` here.
//! The fields that can be empty are `.nullable()` and are therefore written as
//! explicit `null` rather than omitted: `pushUrlDisplay`, `targetOid` and
//! `RefEntry.upstream`. `HeadState` is the definition from `reads.rs`, reused rather
//! than redeclared.

use serde::{Deserialize, Serialize};

use crate::reads::ObjectFormat;

pub use crate::reads::HeadState;

/// A local branch, with its upstream state when one is configured.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefEntry {
    /// The short name the UI shows, such as `main`.
    pub name: String,
    /// The fully qualified ref, such as `refs/heads/main`.
    pub full_name: String,
    pub oid: String,
    /// True for the branch HEAD is on.
    pub is_current: bool,
    /// Present only when the branch has a configured upstream.
    pub upstream: Option<RefUpstream>,
}

/// The configured upstream of a local branch and its divergence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefUpstream {
    pub full_name: String,
    pub ahead: u64,
    pub behind: u64,
    /// True when the upstream ref no longer exists on the remote.
    pub gone: bool,
}

/// A remote-tracking ref, as observed locally after the last fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRefEntry {
    pub name: String,
    pub full_name: String,
    pub oid: String,
    /// The remote this tracking ref belongs to.
    pub remote_name: String,
}

/// A tag. For an annotated tag `oid` is the tag object and `targetOid` the commit it
/// points at.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEntry {
    pub name: String,
    pub full_name: String,
    pub oid: String,
    pub annotated: bool,
    /// Null for a lightweight tag, whose `oid` is already the commit.
    pub target_oid: Option<String>,
}

/// A configured remote, as its URLs may be shown. Both URLs are redacted for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsRemoteEntry {
    pub name: String,
    pub fetch_url_display: String,
    /// Null when no separate push URL is configured.
    pub push_url_display: Option<String>,
}

/// Where a ref outside `refs/heads`, `refs/remotes` and `refs/tags` lives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OtherRefKind {
    Stash,
    Notes,
    Replace,
    Other,
}

/// A ref the UI shows under its own heading rather than as a branch, remote branch or
/// tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherRefEntry {
    pub full_name: String,
    pub oid: String,
    pub kind: OtherRefKind,
}

/// Branches, remote-tracking refs, tags and remotes in one read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefsSnapshot {
    pub snapshot_id: String,
    pub repository_id: String,
    pub read_at: String,
    pub object_format: ObjectFormat,
    pub head: HeadState,
    pub branches: Vec<RefEntry>,
    pub remote_branches: Vec<RemoteRefEntry>,
    pub tags: Vec<TagEntry>,
    pub remotes: Vec<RefsRemoteEntry>,
    pub other_refs: Vec<OtherRefEntry>,
    /// True when a list was cut short by `refListMaxEntries`.
    pub truncated: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reads::HeadKind;
    use serde_json::json;

    /// A 40-character SHA-1-shaped object name.
    const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
    /// A second 40-character SHA-1-shaped object name.
    const OID_B: &str = "fedcba9876543210fedcba9876543210fedcba98";

    #[test]
    fn refs_snapshot_serializes_the_shape_the_contract_publishes() {
        let snapshot = RefsSnapshot {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            object_format: ObjectFormat::Sha1,
            head: HeadState {
                kind: HeadKind::Born,
                branch_name: Some("main".to_string()),
                oid: Some(OID_A.to_string()),
                detached: false,
            },
            branches: vec![RefEntry {
                name: "main".to_string(),
                full_name: "refs/heads/main".to_string(),
                oid: OID_A.to_string(),
                is_current: true,
                upstream: Some(RefUpstream {
                    full_name: "refs/remotes/origin/main".to_string(),
                    ahead: 3,
                    behind: 0,
                    gone: false,
                }),
            }],
            remote_branches: vec![RemoteRefEntry {
                name: "origin/main".to_string(),
                full_name: "refs/remotes/origin/main".to_string(),
                oid: OID_A.to_string(),
                remote_name: "origin".to_string(),
            }],
            tags: vec![TagEntry {
                name: "v1.2.0".to_string(),
                full_name: "refs/tags/v1.2.0".to_string(),
                oid: OID_B.to_string(),
                annotated: true,
                target_oid: Some(OID_A.to_string()),
            }],
            remotes: vec![RefsRemoteEntry {
                name: "origin".to_string(),
                fetch_url_display: "https://example.test/refyard.git".to_string(),
                push_url_display: Some("https://example.test/refyard.git".to_string()),
            }],
            other_refs: vec![OtherRefEntry {
                full_name: "refs/stash".to_string(),
                oid: OID_B.to_string(),
                kind: OtherRefKind::Stash,
            }],
            truncated: false,
        };

        assert_eq!(
            serde_json::to_value(&snapshot).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "objectFormat": "sha1",
                "head": {
                    "kind": "born",
                    "branchName": "main",
                    "oid": OID_A,
                    "detached": false,
                },
                "branches": [{
                    "name": "main",
                    "fullName": "refs/heads/main",
                    "oid": OID_A,
                    "isCurrent": true,
                    "upstream": {
                        "fullName": "refs/remotes/origin/main",
                        "ahead": 3,
                        "behind": 0,
                        "gone": false,
                    },
                }],
                "remoteBranches": [{
                    "name": "origin/main",
                    "fullName": "refs/remotes/origin/main",
                    "oid": OID_A,
                    "remoteName": "origin",
                }],
                "tags": [{
                    "name": "v1.2.0",
                    "fullName": "refs/tags/v1.2.0",
                    "oid": OID_B,
                    "annotated": true,
                    "targetOid": OID_A,
                }],
                "remotes": [{
                    "name": "origin",
                    "fetchUrlDisplay": "https://example.test/refyard.git",
                    "pushUrlDisplay": "https://example.test/refyard.git",
                }],
                "otherRefs": [{
                    "fullName": "refs/stash",
                    "oid": OID_B,
                    "kind": "stash",
                }],
                "truncated": false,
            })
        );
    }

    #[test]
    fn nullable_fields_are_written_as_null_because_this_module_has_no_optionals() {
        // A ref list with nothing to say about upstreams, push URLs or tag targets
        // must still be a complete object: the keys are required, only their values
        // are nullable.
        let snapshot = RefsSnapshot {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            object_format: ObjectFormat::Sha256,
            head: HeadState {
                kind: HeadKind::Unborn,
                branch_name: None,
                oid: None,
                detached: true,
            },
            branches: vec![RefEntry {
                name: "wip".to_string(),
                full_name: "refs/heads/wip".to_string(),
                oid: OID_A.to_string(),
                is_current: false,
                upstream: None,
            }],
            remote_branches: vec![],
            tags: vec![TagEntry {
                name: "v1.0.0".to_string(),
                full_name: "refs/tags/v1.0.0".to_string(),
                oid: OID_A.to_string(),
                annotated: false,
                target_oid: None,
            }],
            remotes: vec![RefsRemoteEntry {
                name: "origin".to_string(),
                fetch_url_display: "git@example.test:refyard.git".to_string(),
                push_url_display: None,
            }],
            other_refs: vec![],
            truncated: true,
        };

        assert_eq!(
            serde_json::to_value(&snapshot).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "objectFormat": "sha256",
                "head": {
                    "kind": "unborn",
                    "branchName": null,
                    "oid": null,
                    "detached": true,
                },
                "branches": [{
                    "name": "wip",
                    "fullName": "refs/heads/wip",
                    "oid": OID_A,
                    "isCurrent": false,
                    "upstream": null,
                }],
                "remoteBranches": [],
                "tags": [{
                    "name": "v1.0.0",
                    "fullName": "refs/tags/v1.0.0",
                    "oid": OID_A,
                    "annotated": false,
                    "targetOid": null,
                }],
                "remotes": [{
                    "name": "origin",
                    "fetchUrlDisplay": "git@example.test:refyard.git",
                    "pushUrlDisplay": null,
                }],
                "otherRefs": [],
                "truncated": true,
            })
        );
    }

    #[test]
    fn refuses_an_other_ref_kind_that_is_not_in_the_contract() {
        let parsed: Result<OtherRefEntry, _> = serde_json::from_value(json!({
            "fullName": "refs/whatever",
            "oid": OID_A,
            "kind": "reflog"
        }));
        assert!(parsed.is_err(), "an unknown other-ref kind must not parse");
    }
}
