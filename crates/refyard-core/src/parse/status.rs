//! `git status --porcelain=v2 --branch -z`.
//!
//! The stream is NUL-terminated records whose first byte is a type character. Ordinal
//! fields are fixed in count and width (`XY`, `sub`, three modes, two object names);
//! the path is everything after the last fixed field, kept as raw bytes. That is the
//! only way a file called `line\nbreak.txt` or `tab\tname.txt` survives — and files
//! with those names exist in the fixture corpus.
//!
//! Renames are the one record with two paths, and the second arrives as its own frame.
//! Reading it as part of the first frame is the classic way to corrupt a rename.
//!
//! Unknown `#` headers are ignored, because Git adds headers over time and a new one
//! must not break a read. An unknown *record type* is an error: silently skipping a
//! record type we do not understand would drop a change from the UI.

use crate::bytes::{decode_ascii, split_nul_frames, FrameReader};
use crate::problem::CoreError;

/// The record kinds the format uses, as the UI sees them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusRecordKind {
    Ordinary,
    Renamed,
    Copied,
    Unmerged,
    Untracked,
    Ignored,
}

impl StatusRecordKind {
    /// The wire name the contract uses.
    pub fn as_wire(self) -> &'static str {
        match self {
            StatusRecordKind::Ordinary => "ordinary",
            StatusRecordKind::Renamed => "renamed",
            StatusRecordKind::Copied => "copied",
            StatusRecordKind::Unmerged => "unmerged",
            StatusRecordKind::Untracked => "untracked",
            StatusRecordKind::Ignored => "ignored",
        }
    }
}

/// One stage of an unmerged path: base (1), ours (2), theirs (3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusUnmergedStage {
    pub stage: u8,
    pub mode: String,
    pub oid: String,
}

/// One entry of the working tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusRecord {
    pub kind: StatusRecordKind,
    /// `X` of porcelain v2. `.` means unmodified.
    pub index_status: String,
    /// `Y` of porcelain v2. `.` means unmodified.
    pub worktree_status: String,
    /// Raw `sub` field (`N...`, `S.M.`), uninterpreted.
    pub submodule_field: String,
    pub mode_head: Option<String>,
    pub mode_index: Option<String>,
    pub mode_worktree: Option<String>,
    pub oid_head: Option<String>,
    pub oid_index: Option<String>,
    /// Raw path bytes. Never decoded, never trimmed.
    pub path: Vec<u8>,
    /// Original path of a rename or copy, raw bytes.
    pub original_path: Option<Vec<u8>>,
    /// Similarity score of a rename or copy (`R100` yields 100).
    pub score: Option<u32>,
    pub stages: Vec<StatusUnmergedStage>,
    pub submodule_commit_changed: bool,
    pub submodule_modified: bool,
    pub submodule_untracked: bool,
}

/// Where HEAD was when the status was taken.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusBranch {
    /// True when at least one `# branch.*` header was present.
    pub seen: bool,
    /// `(initial)` in the header means an unborn branch, not a missing field.
    pub initial: bool,
    pub detached: bool,
    pub oid: Option<String>,
    pub head: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusParseResult {
    pub branch: StatusBranch,
    pub upstream: Option<String>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
    pub stash_count: Option<u64>,
    pub records: Vec<StatusRecord>,
}

const FORMAT: &str = "status --porcelain=v2 -z";

/// The default bound on entries, matching the published contract limit.
pub const STATUS_MAX_ENTRIES: usize = 100_000;

/// Parses a complete status buffer.
///
/// Bounded by `max_entries`: a repository with more entries than the contract
/// publishes is an error rather than a truncated list, because a truncated status
/// would look like a repository with fewer changes.
pub fn parse_status(bytes: &[u8], max_entries: usize) -> Result<StatusParseResult, CoreError> {
    let frames = split_nul_frames(bytes, FORMAT)?;
    let mut branch_seen = false;
    let mut branch_initial = false;
    let mut branch_detached = false;
    let mut branch_oid: Option<String> = None;
    let mut branch_head: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead: Option<u64> = None;
    let mut behind: Option<u64> = None;
    let mut stash_count: Option<u64> = None;
    let mut records: Vec<StatusRecord> = Vec::new();

    let mut index = 0usize;
    while index < frames.len() {
        let frame = frames[index];
        if frame.is_empty() {
            index += 1;
            continue;
        }
        match frame[0] {
            b'#' => {
                let mut header = FrameReader::new(&frame[1..], FORMAT);
                header.expect_space()?;
                let key = header.take_ascii_field()?;
                match key.as_str() {
                    "branch.oid" => {
                        header.expect_space()?;
                        let value = header.take_rest_ascii()?;
                        branch_seen = true;
                        branch_initial = value == "(initial)";
                        branch_oid = if branch_initial { None } else { Some(value) };
                    }
                    "branch.head" => {
                        header.expect_space()?;
                        let value = header.take_rest_ascii()?;
                        branch_seen = true;
                        branch_detached = value == "(detached)";
                        branch_head = if branch_detached { None } else { Some(value) };
                    }
                    "branch.upstream" => {
                        header.expect_space()?;
                        upstream = Some(header.take_rest_ascii()?);
                    }
                    "branch.ab" => {
                        header.expect_space()?;
                        ahead = Some(read_signed_count(header.take_ascii_field()?, '+')?);
                        header.expect_space()?;
                        behind = Some(read_signed_count(header.take_ascii_field()?, '-')?);
                    }
                    "stash" => {
                        header.expect_space()?;
                        stash_count = Some(header.take_number()?);
                    }
                    // A header Git added after this build was written.
                    _ => {}
                }
            }
            b'1' => {
                check_bound(&records, max_entries)?;
                records.push(parse_ordinary(frame)?);
            }
            b'2' => {
                check_bound(&records, max_entries)?;
                let Some(original_frame) = frames.get(index + 1) else {
                    return Err(CoreError::output_unparsable(
                        FORMAT,
                        "rename record was not followed by its original path frame",
                    ));
                };
                index += 1;
                records.push(parse_rename(frame, original_frame)?);
            }
            b'u' => {
                check_bound(&records, max_entries)?;
                records.push(parse_unmerged(frame)?);
            }
            b'?' => {
                // The bound covers untracked and ignored records too. A directory of
                // build output is exactly where an unbounded list comes from, and the
                // TypeScript parser let those through while bounding tracked entries.
                check_bound(&records, max_entries)?;
                records.push(parse_path_only(frame, StatusRecordKind::Untracked)?);
            }
            b'!' => {
                check_bound(&records, max_entries)?;
                records.push(parse_path_only(frame, StatusRecordKind::Ignored)?);
            }
            other => {
                return Err(CoreError::output_unparsable(
                    FORMAT,
                    format!("unknown record type '{}'", char::from(other)),
                ))
            }
        }
        index += 1;
    }

    Ok(StatusParseResult {
        branch: StatusBranch {
            seen: branch_seen,
            initial: branch_initial,
            detached: branch_detached,
            oid: branch_oid,
            head: branch_head,
        },
        upstream,
        ahead,
        behind,
        stash_count,
        records,
    })
}

fn check_bound(records: &[StatusRecord], max_entries: usize) -> Result<(), CoreError> {
    if records.len() >= max_entries {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("status exceeded {max_entries} entries"),
        ));
    }
    Ok(())
}

fn read_signed_count(field: String, sign: char) -> Result<u64, CoreError> {
    let mut characters = field.chars();
    if characters.next() != Some(sign) {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("expected '{sign}<n>' but found '{field}'"),
        ));
    }
    let digits = characters.as_str();
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("expected a count after '{sign}' but found '{field}'"),
        ));
    }
    digits
        .parse::<u64>()
        .map_err(|_| CoreError::output_unparsable(FORMAT, "count out of range"))
}

/// `XY`, the two status characters every record type carries.
fn read_xy(reader: &mut FrameReader<'_>) -> Result<(String, String), CoreError> {
    let bytes = reader.take_bytes(2)?;
    let text = decode_ascii(bytes, FORMAT)?;
    let mut characters = text.chars();
    let index_status = characters.next().unwrap_or('.').to_string();
    let worktree_status = characters.next().unwrap_or('.').to_string();
    Ok((index_status, worktree_status))
}

/// A mode of all zeroes means "no such object in this position", not a mode.
fn decode_mode(bytes: &[u8]) -> Option<String> {
    if bytes.iter().all(|byte| *byte == b'0') {
        return None;
    }
    Some(String::from_utf8_lossy(bytes).into_owned())
}

/// A name of all zeroes means "no object", which is how an added path reports HEAD.
fn read_zeroed_oid(value: Option<String>) -> Option<String> {
    match value {
        Some(text) if text.bytes().all(|byte| byte == b'0') => None,
        other => other,
    }
}

/// `sub` is four characters: `N`/`S`, then commit/worktree/untracked flags.
fn submodule_flags(sub: &str) -> (bool, bool, bool) {
    let bytes = sub.as_bytes();
    if bytes.len() != 4 || bytes[0] != b'S' {
        return (false, false, false);
    }
    (bytes[1] == b'C', bytes[2] == b'M', bytes[3] == b'U')
}

fn parse_ordinary(frame: &[u8]) -> Result<StatusRecord, CoreError> {
    let mut reader = FrameReader::new(&frame[1..], FORMAT);
    reader.expect_space()?;
    let (index_status, worktree_status) = read_xy(&mut reader)?;
    reader.expect_space()?;
    let sub = decode_ascii(reader.take_bytes(4)?, FORMAT)?;
    reader.expect_space()?;
    let mode_head = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let mode_index = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let mode_worktree = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let oid_head = reader.take_oid()?;
    reader.expect_space()?;
    let oid_index = reader.take_oid()?;
    reader.expect_space()?;
    let path = reader.take_rest().to_vec();
    if path.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "ordinary entry has an empty path",
        ));
    }
    let (submodule_commit_changed, submodule_modified, submodule_untracked) = submodule_flags(&sub);
    Ok(StatusRecord {
        kind: StatusRecordKind::Ordinary,
        index_status,
        worktree_status,
        submodule_field: sub,
        mode_head,
        mode_index,
        mode_worktree,
        oid_head: read_zeroed_oid(Some(oid_head)),
        oid_index: read_zeroed_oid(Some(oid_index)),
        path,
        original_path: None,
        score: None,
        stages: Vec::new(),
        submodule_commit_changed,
        submodule_modified,
        submodule_untracked,
    })
}

fn parse_rename(frame: &[u8], original_frame: &[u8]) -> Result<StatusRecord, CoreError> {
    let mut reader = FrameReader::new(&frame[1..], FORMAT);
    reader.expect_space()?;
    let (index_status, worktree_status) = read_xy(&mut reader)?;
    reader.expect_space()?;
    let sub = decode_ascii(reader.take_bytes(4)?, FORMAT)?;
    reader.expect_space()?;
    let mode_head = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let mode_index = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let mode_worktree = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    let oid_head = reader.take_oid()?;
    reader.expect_space()?;
    let oid_index = reader.take_oid()?;
    reader.expect_space()?;
    // The score is one letter (`R` or `C`) followed by digits with no separator
    // before the path.
    let score_kind = decode_ascii(reader.take_bytes(1)?, FORMAT)?;
    let mut score_text = String::new();
    while let Some(next) = reader.peek() {
        if next == b' ' {
            break;
        }
        score_text.push(char::from(next));
        reader.take_bytes(1)?;
    }
    if score_text.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "rename/copy entry has no similarity score",
        ));
    }
    let score = score_text.parse::<u32>().map_err(|_| {
        CoreError::output_unparsable(FORMAT, "rename/copy similarity score is not a number")
    })?;
    reader.expect_space()?;
    let path = reader.take_rest().to_vec();
    if path.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "rename/copy entry has an empty path",
        ));
    }
    if original_frame.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "rename/copy entry has an empty original path",
        ));
    }
    let (submodule_commit_changed, submodule_modified, submodule_untracked) = submodule_flags(&sub);
    Ok(StatusRecord {
        kind: if score_kind == "C" {
            StatusRecordKind::Copied
        } else {
            StatusRecordKind::Renamed
        },
        index_status,
        worktree_status,
        submodule_field: sub,
        mode_head,
        mode_index,
        mode_worktree,
        oid_head: read_zeroed_oid(Some(oid_head)),
        oid_index: read_zeroed_oid(Some(oid_index)),
        path,
        original_path: Some(original_frame.to_vec()),
        score: Some(score),
        stages: Vec::new(),
        submodule_commit_changed,
        submodule_modified,
        submodule_untracked,
    })
}

fn parse_unmerged(frame: &[u8]) -> Result<StatusRecord, CoreError> {
    let mut reader = FrameReader::new(&frame[1..], FORMAT);
    reader.expect_space()?;
    let (index_status, worktree_status) = read_xy(&mut reader)?;
    reader.expect_space()?;
    let sub = decode_ascii(reader.take_bytes(4)?, FORMAT)?;
    reader.expect_space()?;
    // Four modes: stages 1-3 and the working tree, each six octal digits.
    let mut stage_modes: Vec<String> = Vec::new();
    for _ in 0..3 {
        let bytes = reader.take_bytes(6)?;
        stage_modes.push(decode_mode(bytes).unwrap_or_else(|| "000000".to_string()));
        reader.expect_space()?;
    }
    let mode_worktree = decode_mode(reader.take_bytes(6)?);
    reader.expect_space()?;
    // Then the three stage object names.
    let mut oids: Vec<String> = Vec::new();
    for _ in 0..3 {
        oids.push(reader.take_oid()?);
        reader.expect_space()?;
    }
    let path = reader.take_rest().to_vec();
    if path.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "unmerged entry has an empty path",
        ));
    }

    let mut stages: Vec<StatusUnmergedStage> = Vec::new();
    for index in 0..3usize {
        let mode = stage_modes[index].clone();
        let oid = oids[index].clone();
        // A stage that does not exist is written as an all-zero mode.
        if mode == "000000" {
            continue;
        }
        stages.push(StatusUnmergedStage {
            stage: (index as u8) + 1,
            mode,
            oid,
        });
    }
    Ok(StatusRecord {
        kind: StatusRecordKind::Unmerged,
        index_status,
        worktree_status,
        submodule_field: sub,
        mode_head: None,
        mode_index: None,
        mode_worktree,
        oid_head: None,
        oid_index: None,
        path,
        original_path: None,
        score: None,
        stages,
        // The format does not carry submodule flags on an unmerged record.
        submodule_commit_changed: false,
        submodule_modified: false,
        submodule_untracked: false,
    })
}

fn parse_path_only(frame: &[u8], kind: StatusRecordKind) -> Result<StatusRecord, CoreError> {
    let mut reader = FrameReader::new(&frame[1..], FORMAT);
    reader.expect_space()?;
    let path = reader.take_rest().to_vec();
    if path.is_empty() {
        return Err(CoreError::output_unparsable(
            FORMAT,
            "path-only entry has an empty path",
        ));
    }
    Ok(StatusRecord {
        kind,
        index_status: "?".to_string(),
        worktree_status: "?".to_string(),
        submodule_field: "N...".to_string(),
        mode_head: None,
        mode_index: None,
        mode_worktree: None,
        oid_head: None,
        oid_index: None,
        path,
        original_path: None,
        score: None,
        stages: Vec::new(),
        submodule_commit_changed: false,
        submodule_modified: false,
        submodule_untracked: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(bytes: &[u8]) -> StatusParseResult {
        parse_status(bytes, STATUS_MAX_ENTRIES).expect("parses")
    }

    const OID_A: &str = "1111111111111111111111111111111111111111";
    const OID_B: &str = "2222222222222222222222222222222222222222";

    #[test]
    fn reads_a_clean_branch_header_without_inventing_entries() {
        let result =
            parse(b"# branch.oid 1111111111111111111111111111111111111111\0# branch.head main\0");
        assert!(result.branch.seen);
        assert_eq!(result.branch.head.as_deref(), Some("main"));
        assert!(!result.branch.initial);
        assert!(!result.branch.detached);
        assert!(result.records.is_empty());
    }

    #[test]
    fn reports_an_unborn_branch_from_the_initial_marker() {
        // `(initial)` is Git's spelling of "no commit yet", not a branch named that.
        let result = parse(b"# branch.oid (initial)\0# branch.head main\0");
        assert!(result.branch.initial);
        assert_eq!(result.branch.oid, None);
        assert_eq!(result.branch.head.as_deref(), Some("main"));
    }

    #[test]
    fn reports_a_detached_head_without_a_branch_name() {
        let result = parse(
            b"# branch.oid 1111111111111111111111111111111111111111\0# branch.head (detached)\0",
        );
        assert!(result.branch.detached);
        assert_eq!(result.branch.head, None);
    }

    #[test]
    fn keeps_a_newline_inside_a_path() {
        // A file whose name contains a newline is a real repository state. Splitting
        // the stream on newlines would cut this record in half.
        let bytes = format!("1 .M N... 100644 100644 100644 {OID_A} {OID_A} a\nb.txt\0");
        let result = parse(bytes.as_bytes());
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].path, b"a\nb.txt");
        assert_eq!(result.records[0].kind, StatusRecordKind::Ordinary);
    }

    #[test]
    fn reads_a_rename_with_its_original_path_from_the_next_frame() {
        let bytes = format!(
            "2 R. N... 100644 100644 100644 {OID_A} {OID_B} R100 new name.txt\0old name.txt\0"
        );
        let result = parse(bytes.as_bytes());
        assert_eq!(result.records.len(), 1);
        let record = &result.records[0];
        assert_eq!(record.kind, StatusRecordKind::Renamed);
        assert_eq!(record.path, b"new name.txt");
        assert_eq!(record.original_path.as_deref(), Some(&b"old name.txt"[..]));
        assert_eq!(record.score, Some(100));
    }

    #[test]
    fn refuses_a_rename_record_whose_original_path_frame_is_missing() {
        // The classic corruption: reading the next record's bytes as this rename's
        // original path.
        let bytes = format!("2 R. N... 100644 100644 100644 {OID_A} {OID_B} R100 new.txt\0");
        assert!(parse_status(bytes.as_bytes(), STATUS_MAX_ENTRIES).is_err());
    }

    #[test]
    fn reads_an_unmerged_record_with_every_stage_that_exists() {
        let bytes = format!(
            "u UU N... 100644 100644 100644 100644 {OID_A} {OID_B} {} conflict.txt\0",
            "3".repeat(40)
        );
        let result = parse(bytes.as_bytes());
        let record = &result.records[0];
        assert_eq!(record.kind, StatusRecordKind::Unmerged);
        assert_eq!(record.stages.len(), 3);
        assert_eq!(record.stages[0].stage, 1);
        assert_eq!(record.stages[1].oid, OID_B);
    }

    #[test]
    fn treats_a_zeroed_object_name_as_absent_rather_than_as_an_object() {
        let bytes = format!(
            "1 A. N... 000000 100644 100644 {} {OID_B} added.txt\0",
            "0".repeat(40)
        );
        let result = parse(bytes.as_bytes());
        assert_eq!(result.records[0].oid_head, None);
        assert_eq!(result.records[0].mode_head, None);
        assert_eq!(result.records[0].oid_index, Some(OID_B.to_string()));
    }

    #[test]
    fn keeps_untracked_and_ignored_paths_raw() {
        let result = parse(b"? untracked\tname.txt\0! ignored.txt\0");
        assert_eq!(result.records.len(), 2);
        assert_eq!(result.records[0].kind, StatusRecordKind::Untracked);
        assert_eq!(result.records[0].path, b"untracked\tname.txt");
        assert_eq!(result.records[1].kind, StatusRecordKind::Ignored);
    }

    #[test]
    fn reads_ahead_and_behind_from_the_branch_ab_header() {
        let result = parse(b"# branch.ab +2 -3\0# branch.head main\0");
        assert_eq!(result.ahead, Some(2));
        assert_eq!(result.behind, Some(3));
    }

    #[test]
    fn ignores_a_header_it_does_not_know() {
        // Git adds headers over time; a new one must not break an existing read.
        let result = parse(b"# branch.head main\0# branch.someFutureThing x\0");
        assert_eq!(result.branch.head.as_deref(), Some("main"));
    }

    #[test]
    fn refuses_an_unknown_record_type_instead_of_dropping_it() {
        assert!(parse_status(b"z something\0", STATUS_MAX_ENTRIES).is_err());
    }

    #[test]
    fn refuses_a_stream_that_ends_inside_a_record() {
        assert!(parse_status(b"# branch.head main", STATUS_MAX_ENTRIES).is_err());
    }

    #[test]
    fn refuses_more_entries_than_the_contract_publishes() {
        // A silently truncated status would read as "this repository has fewer
        // changes", which is worse than an explicit refusal.
        let mut bytes = Vec::new();
        for index in 0..3 {
            bytes.extend_from_slice(format!("? file{index}.txt\0").as_bytes());
        }
        assert!(parse_status(&bytes, 2).is_err());
        assert!(parse_status(&bytes, 3).is_ok());
    }
}
