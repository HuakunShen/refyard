//! A bounded diff read: selected paths, one commit, or a two-point range.
//!
//! A projection of `diffResponseSchema`, `diffFileSchema`, `filePatchSchema`,
//! `patchHunkSchema`, `patchLineSchema` and `diffQuerySchema` from
//! `packages/git-contract/src/reads.ts`. The patch arrives already parsed so the UI
//! renders lines without re-parsing patch grammar, and a file whose patch the
//! service refused to produce says *why* (`binary`, `oversize`, `unavailable`,
//! `submodule`) instead of arriving as an empty patch.
//!
//! Nullable and optional fields follow `reads.rs`: `.nullable()` is `Option<T>` with
//! no `skip_serializing_if` (written as `null`), `.optional()` carries
//! `skip_serializing_if = "Option::is_none"`.

use serde::{Deserialize, Serialize};

/// Which side of the diff a line belongs to, without its leading marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchLineKind {
    Context,
    Add,
    Remove,
}

/// One patch line; the leading ` `, `+` or `-` is carried by `kind`, not by `text`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchLine {
    pub kind: PatchLineKind,
    pub text: String,
    /// True for the `\ No newline at end of file` marker that follows this line.
    pub no_newline: bool,
}

/// A parsed hunk, so the UI renders lines without re-parsing patch grammar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchHunk {
    /// The `@@ -oldStart,oldLines +newStart,newLines @@` header as Git wrote it.
    pub header: String,
    pub old_start: i64,
    pub old_lines: i64,
    pub new_start: i64,
    pub new_lines: i64,
    pub lines: Vec<PatchLine>,
}

/// The patch of one file, or the reason there is none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FilePatch {
    /// Bounded and parsed patch text.
    Text {
        hunks: Vec<PatchHunk>,
        /// True when the file is untracked and the content came from an authorised
        /// read rather than from Git.
        synthesized: bool,
    },
    /// Git reported the file as binary, so there is no line patch to show.
    Binary,
    /// The patch exceeded a configured limit and was not read.
    Oversize { reason: String },
    /// The patch could not be produced; the reason is for a human.
    Unavailable { reason: String },
    /// A gitlink: its "content" is the object the submodule should be checked out at.
    Submodule {
        old_oid: Option<String>,
        new_oid: Option<String>,
    },
}

/// How a file changed between the two sides of the diff.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
}

/// The mode of each side of a diff entry. Either side may be null when it does not
/// exist, as for an added or deleted file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileModes {
    pub old: Option<String>,
    pub new: Option<String>,
}

/// One changed file with its bounded patch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path_id: String,
    pub display_path: String,
    /// Set for a rename or copy.
    pub old_path_id: Option<String>,
    pub old_display_path: Option<String>,
    pub change_kind: ChangeKind,
    pub is_binary: bool,
    pub is_submodule: bool,
    /// Null when the count is unknown, for example for a binary file.
    pub insertions: Option<u64>,
    pub deletions: Option<u64>,
    pub modes: Option<DiffFileModes>,
    pub patch: FilePatch,
}

/// The scope a diff was read at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffKind {
    /// Worktree against the index.
    Unstaged,
    /// Index against HEAD.
    Staged,
    /// Untracked files, whose content is read directly.
    Untracked,
    /// One commit against its first parent.
    Commit,
    /// Two points against each other.
    Range,
}

/// The request as the service resolved it, echoed back so a UI can label a diff
/// without re-deriving which two things were compared.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    pub kind: DiffKind,
    pub oid: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub path_id: Option<String>,
}

/// Per-response counts. They describe what is in `files`, not the whole change set
/// when the read was truncated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub files_changed: u64,
    pub insertions: u64,
    pub deletions: u64,
    pub binary_files: u64,
}

/// A bounded diff read: selected paths, one commit, or a two-point range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResponse {
    pub snapshot_id: String,
    pub repository_id: String,
    /// Null for a range or a commit diff, which is not bound to a worktree.
    pub worktree_id: Option<String>,
    pub read_at: String,
    pub request: DiffRequest,
    pub files: Vec<DiffFile>,
    pub stats: DiffStats,
    pub truncated: bool,
}

/// A diff is always bounded and always scoped: worktree-vs-index, index-vs-HEAD, one
/// commit, or a two-point range. `pathId` restricts it to one path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiffQuery {
    pub repository_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    pub kind: DiffKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_id: Option<String>,
    /// Per-file patch ceiling; defaults to the service's `patchMaxBytesPerFile`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A 40-character SHA-1-shaped object name.
    const OID_A: &str = "0123456789abcdef0123456789abcdef01234567";
    /// A second 40-character SHA-1-shaped object name.
    const OID_B: &str = "fedcba9876543210fedcba9876543210fedcba98";

    #[test]
    fn diff_response_serializes_the_shape_the_contract_publishes() {
        let response = DiffResponse {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            worktree_id: Some("wt_1".to_string()),
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            request: DiffRequest {
                kind: DiffKind::Unstaged,
                oid: None,
                from: None,
                to: None,
                path_id: Some("path_1".to_string()),
            },
            files: vec![DiffFile {
                path_id: "path_1".to_string(),
                display_path: "src/lib.rs".to_string(),
                old_path_id: Some("path_2".to_string()),
                old_display_path: Some("src/old_lib.rs".to_string()),
                change_kind: ChangeKind::Renamed,
                is_binary: false,
                is_submodule: false,
                insertions: Some(1),
                deletions: Some(1),
                modes: Some(DiffFileModes {
                    old: Some("100644".to_string()),
                    new: Some("100755".to_string()),
                }),
                patch: FilePatch::Text {
                    hunks: vec![PatchHunk {
                        header: "@@ -1,2 +1,2 @@".to_string(),
                        old_start: 1,
                        old_lines: 2,
                        new_start: 1,
                        new_lines: 2,
                        lines: vec![
                            PatchLine {
                                kind: PatchLineKind::Context,
                                text: "fn main() {".to_string(),
                                no_newline: false,
                            },
                            PatchLine {
                                kind: PatchLineKind::Remove,
                                text: "    old();".to_string(),
                                no_newline: false,
                            },
                            PatchLine {
                                kind: PatchLineKind::Add,
                                text: "    new();".to_string(),
                                no_newline: true,
                            },
                        ],
                    }],
                    synthesized: false,
                },
            }],
            stats: DiffStats {
                files_changed: 1,
                insertions: 1,
                deletions: 1,
                binary_files: 0,
            },
            truncated: false,
        };

        assert_eq!(
            serde_json::to_value(&response).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "worktreeId": "wt_1",
                "readAt": "2026-09-18T10:00:00.000Z",
                "request": {
                    "kind": "unstaged",
                    "oid": null,
                    "from": null,
                    "to": null,
                    "pathId": "path_1",
                },
                "files": [{
                    "pathId": "path_1",
                    "displayPath": "src/lib.rs",
                    "oldPathId": "path_2",
                    "oldDisplayPath": "src/old_lib.rs",
                    "changeKind": "renamed",
                    "isBinary": false,
                    "isSubmodule": false,
                    "insertions": 1,
                    "deletions": 1,
                    "modes": { "old": "100644", "new": "100755" },
                    "patch": {
                        "kind": "text",
                        "hunks": [{
                            "header": "@@ -1,2 +1,2 @@",
                            "oldStart": 1,
                            "oldLines": 2,
                            "newStart": 1,
                            "newLines": 2,
                            "lines": [
                                { "kind": "context", "text": "fn main() {", "noNewline": false },
                                { "kind": "remove", "text": "    old();", "noNewline": false },
                                { "kind": "add", "text": "    new();", "noNewline": true },
                            ],
                        }],
                        "synthesized": false,
                    },
                }],
                "stats": {
                    "filesChanged": 1,
                    "insertions": 1,
                    "deletions": 1,
                    "binaryFiles": 0,
                },
                "truncated": false,
            })
        );
    }

    #[test]
    fn keeps_nullable_keys_present_and_drops_absent_optionals() {
        // A commit diff has no worktree, an unmerged file has no line counts or
        // modes, and a range diff names both endpoints — none of those keys may
        // vanish. `DiffQuery`'s unused selectors are `.optional()` and must vanish.
        let response = DiffResponse {
            snapshot_id: "snap_1".to_string(),
            repository_id: "repo_1".to_string(),
            worktree_id: None,
            read_at: "2026-09-18T10:00:00.000Z".to_string(),
            request: DiffRequest {
                kind: DiffKind::Range,
                oid: None,
                from: Some(OID_A.to_string()),
                to: Some(OID_B.to_string()),
                path_id: None,
            },
            files: vec![DiffFile {
                path_id: "path_1".to_string(),
                display_path: "vendor/blob.bin".to_string(),
                old_path_id: None,
                old_display_path: None,
                change_kind: ChangeKind::Added,
                is_binary: true,
                is_submodule: false,
                insertions: None,
                deletions: None,
                modes: None,
                patch: FilePatch::Binary,
            }],
            stats: DiffStats {
                files_changed: 1,
                insertions: 0,
                deletions: 0,
                binary_files: 1,
            },
            truncated: true,
        };

        assert_eq!(
            serde_json::to_value(&response).expect("serializes"),
            json!({
                "snapshotId": "snap_1",
                "repositoryId": "repo_1",
                "worktreeId": null,
                "readAt": "2026-09-18T10:00:00.000Z",
                "request": {
                    "kind": "range",
                    "oid": null,
                    "from": OID_A,
                    "to": OID_B,
                    "pathId": null,
                },
                "files": [{
                    "pathId": "path_1",
                    "displayPath": "vendor/blob.bin",
                    "oldPathId": null,
                    "oldDisplayPath": null,
                    "changeKind": "added",
                    "isBinary": true,
                    "isSubmodule": false,
                    "insertions": null,
                    "deletions": null,
                    "modes": null,
                    "patch": { "kind": "binary" },
                }],
                "stats": {
                    "filesChanged": 1,
                    "insertions": 0,
                    "deletions": 0,
                    "binaryFiles": 1,
                },
                "truncated": true,
            })
        );

        let query = DiffQuery {
            repository_id: "repo_1".to_string(),
            worktree_id: None,
            kind: DiffKind::Staged,
            oid: None,
            from: None,
            to: None,
            path_id: None,
            max_bytes: None,
        };
        assert_eq!(
            serde_json::to_value(&query).expect("serializes"),
            json!({ "repositoryId": "repo_1", "kind": "staged" })
        );
    }

    #[test]
    fn a_refused_patch_names_its_reason_instead_of_looking_empty() {
        assert_eq!(
            serde_json::to_value(FilePatch::Oversize {
                reason: "larger than patchMaxBytesPerFile".to_string(),
            })
            .expect("serializes"),
            json!({ "kind": "oversize", "reason": "larger than patchMaxBytesPerFile" })
        );
        assert_eq!(
            serde_json::to_value(FilePatch::Submodule {
                old_oid: Some(OID_A.to_string()),
                new_oid: None,
            })
            .expect("serializes"),
            json!({ "kind": "submodule", "oldOid": OID_A, "newOid": null })
        );
    }

    #[test]
    fn a_strict_query_refuses_a_key_the_contract_does_not_have() {
        // Guessing at a half-remembered parameter name must fail loudly rather than
        // return a diff of something the caller did not ask for.
        let parsed: Result<DiffQuery, _> = serde_json::from_value(json!({
            "repositoryId": "repo_1",
            "kind": "unstaged",
            "maxSize": 1024
        }));
        assert!(parsed.is_err(), "an unknown query key must not deserialize");

        let parsed: DiffQuery = serde_json::from_value(json!({
            "repositoryId": "repo_1",
            "kind": "commit",
            "oid": OID_A,
            "maxBytes": 1024
        }))
        .expect("the contract's own keys deserialize");
        assert_eq!(parsed.max_bytes, Some(1024));
    }
}
