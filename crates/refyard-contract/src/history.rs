//! History paging: a page of the commit graph, one commit's detail, and the query
//! that asks for them.
//!
//! A projection of `historyPageSchema`, `commitSummarySchema`, `commitDetailSchema`
//! and `historyQuerySchema` from `packages/git-contract/src/reads.ts`. `boundary` and
//! `missingParents` exist so a UI never draws an unloaded parent as a root, and
//! `tipsMoved` says the page is served from the tips it started with rather than
//! re-interpreted against a branch that advanced.
//!
//! Nullable and optional fields follow `reads.rs`: `.nullable()` is `Option<T>` with
//! no `skip_serializing_if` (written as `null`), `.optional()` carries
//! `skip_serializing_if = "Option::is_none"`.

use serde::{Deserialize, Serialize};

use crate::reads::ObjectFormat;

/// Whether every parent of every commit on this page is present in the repository, or
/// whether the page crosses a shallow or grafted edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Topology {
    Continuous,
    Sparse,
}

/// One row of history. `boundary` marks a shallow/grafted edge and `missingParents`
/// names parents whose objects are absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitSummary {
    pub oid: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub committed_at: String,
    /// Short names such as `main` or `origin/main`; empty when no ref points here.
    pub ref_names: Vec<String>,
    pub signed: bool,
    /// True when this commit sits at the edge of what the repository actually holds.
    pub boundary: bool,
    /// Parents named by this commit whose objects are absent.
    pub missing_parents: Vec<String>,
}

/// Full commit metadata and message, decoded through the host text codec.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub oid: String,
    pub parents: Vec<String>,
    pub tree_oid: String,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub committer_name: String,
    pub committer_email: String,
    pub committed_at: String,
    pub subject: String,
    pub body: String,
    /// The commit's declared encoding, or null when it declares none or the header
    /// was not a supported one.
    pub encoding: Option<String>,
    pub signed: bool,
}

/// A page of the commit graph in topological order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub snapshot_id: String,
    pub repository_id: String,
    pub read_at: String,
    pub object_format: ObjectFormat,
    pub shallow: bool,
    pub topology: Topology,
    pub commits: Vec<CommitSummary>,
    /// Null when this page is the last one.
    pub next_cursor: Option<String>,
    /// True when the tips this page was pinned to moved while it was being read.
    pub tips_moved: bool,
    pub truncated: bool,
    /// Present only when the request named a `detailOid`.
    pub detail: Option<CommitDetail>,
}

/// History page request. `cursor` continues a page from the tips it started with;
/// `detailOid` additionally returns one full commit message. Every filter is literal
/// text — the host turns it into Git's own matching, never into a regular expression
/// the caller wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryQuery {
    pub repository_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Page size; defaults to the service's `historyDefaultPageSize` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail_oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_parent_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// A lowercase hexadecimal object-name prefix of at least four characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid_prefix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_full_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed_after: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub committed_before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A 40-character SHA-1-shaped object name.
    const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
    /// A second 40-character SHA-1-shaped object name.
    const OID_B: &str = "fedcba9876543210fedcba9876543210fedcba98";
    /// A third 40-character SHA-1-shaped object name.
    const OID_C: &str = "89abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn history_page_serializes_the_shape_the_contract_publishes() {
        let page = HistoryPage {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            object_format: ObjectFormat::Sha1,
            shallow: true,
            topology: Topology::Sparse,
            commits: vec![CommitSummary {
                oid: OID_A.to_string(),
                parents: vec![OID_B.to_string()],
                subject: "Add the history page".to_string(),
                author_name: "A Person".to_string(),
                author_email: "a@example.test".to_string(),
                authored_at: "2026-09-18T09:00:00.000Z".to_string(),
                committed_at: "2026-09-18T09:05:00.000Z".to_string(),
                ref_names: vec!["main".to_string(), "origin/main".to_string()],
                signed: false,
                boundary: true,
                missing_parents: vec![OID_C.to_string()],
            }],
            next_cursor: Some("cur_1".to_string()),
            tips_moved: false,
            truncated: false,
            detail: Some(CommitDetail {
                oid: OID_A.to_string(),
                parents: vec![OID_B.to_string()],
                tree_oid: OID_C.to_string(),
                author_name: "A Person".to_string(),
                author_email: "a@example.test".to_string(),
                authored_at: "2026-09-18T09:00:00.000Z".to_string(),
                committer_name: "A Committer".to_string(),
                committer_email: "c@example.test".to_string(),
                committed_at: "2026-09-18T09:05:00.000Z".to_string(),
                subject: "Add the history page".to_string(),
                body: "Why it exists.\n".to_string(),
                encoding: None,
                signed: false,
            }),
        };

        assert_eq!(
            serde_json::to_value(&page).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "objectFormat": "sha1",
                "shallow": true,
                "topology": "sparse",
                "commits": [{
                    "oid": OID_A,
                    "parents": [OID_B],
                    "subject": "Add the history page",
                    "authorName": "A Person",
                    "authorEmail": "a@example.test",
                    "authoredAt": "2026-09-18T09:00:00.000Z",
                    "committedAt": "2026-09-18T09:05:00.000Z",
                    "refNames": ["main", "origin/main"],
                    "signed": false,
                    "boundary": true,
                    "missingParents": [OID_C],
                }],
                "nextCursor": "cur_1",
                "tipsMoved": false,
                "truncated": false,
                "detail": {
                    "oid": OID_A,
                    "parents": [OID_B],
                    "treeOid": OID_C,
                    "authorName": "A Person",
                    "authorEmail": "a@example.test",
                    "authoredAt": "2026-09-18T09:00:00.000Z",
                    "committerName": "A Committer",
                    "committerEmail": "c@example.test",
                    "committedAt": "2026-09-18T09:05:00.000Z",
                    "subject": "Add the history page",
                    "body": "Why it exists.\n",
                    "encoding": null,
                    "signed": false,
                },
            })
        );
    }

    #[test]
    fn keeps_nullable_keys_present_and_drops_absent_optionals() {
        // `nextCursor` and `detail` are `.nullable()` — they are written as `null`
        // when there is nothing there. Every filter in the query is `.optional()`,
        // so an unused one must vanish instead of being sent as `null`.
        let page = HistoryPage {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            object_format: ObjectFormat::Sha1,
            shallow: false,
            topology: Topology::Continuous,
            commits: vec![],
            next_cursor: None,
            tips_moved: true,
            truncated: true,
            detail: None,
        };
        assert_eq!(
            serde_json::to_value(&page).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "objectFormat": "sha1",
                "shallow": false,
                "topology": "continuous",
                "commits": [],
                "nextCursor": null,
                "tipsMoved": true,
                "truncated": true,
                "detail": null,
            })
        );

        let query = HistoryQuery {
            repository_id: "repo_1".to_string(),
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
        };
        assert_eq!(
            serde_json::to_value(&query).expect("serializes"),
            json!({ "repositoryId": "repo_1" })
        );

        let query = HistoryQuery {
            repository_id: "repo_1".to_string(),
            worktree_id: Some("wt_1".to_string()),
            cursor: Some("cur_1".to_string()),
            limit: Some(50),
            detail_oid: Some(OID_A.to_string()),
            first_parent_only: Some(true),
            message: Some("fix the parser".to_string()),
            author: Some("A Person".to_string()),
            oid_prefix: Some("0123abcd".to_string()),
            ref_full_name: Some("refs/heads/main".to_string()),
            committed_after: Some("2026-01-01T00:00:00.000Z".to_string()),
            committed_before: Some("2026-09-18T00:00:00.000Z".to_string()),
            path_id: Some("path_1".to_string()),
        };
        assert_eq!(
            serde_json::to_value(&query).expect("serializes"),
            json!({
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "cursor": "cur_1",
                "limit": 50,
                "detailOid": OID_A,
                "firstParentOnly": true,
                "message": "fix the parser",
                "author": "A Person",
                "oidPrefix": "0123abcd",
                "refFullName": "refs/heads/main",
                "committedAfter": "2026-01-01T00:00:00.000Z",
                "committedBefore": "2026-09-18T00:00:00.000Z",
                "pathId": "path_1",
            })
        );
    }

    #[test]
    fn a_strict_query_refuses_a_key_the_contract_does_not_have() {
        // A misspelled filter that was silently dropped would show the user a page
        // they did not ask for.
        let parsed: Result<HistoryQuery, _> = serde_json::from_value(json!({
            "repositoryId": "repo_1",
            "firstParent": true
        }));
        assert!(parsed.is_err(), "an unknown query key must not deserialize");
    }
}
