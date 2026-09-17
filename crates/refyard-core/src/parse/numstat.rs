//! `git diff --numstat -z` and `git diff --name-status -z` parsers.
//!
//! Both formats put a path in a field that can itself contain the separator, so both
//! are parsed positionally: fixed ASCII fields first, then raw bytes. The shapes are
//!
//! ```text
//! numstat:      1\t1\tbase.txt\0
//!               0\t0\t\0rename-src.txt\0moved 新\tname.txt\0   (rename: two more frames)
//!               -\t-\tbin.dat\0                                (binary)
//! name-status:  M\0base.txt\0
//!               R100\0rename-src.txt\0moved 新\tname.txt\0       (old, then new)
//! ```
//!
//! A rename is the case that punishes guessing: in numstat the counts line ends with
//! an empty third field and the two paths follow as *separate* NUL-terminated frames,
//! while in name-status the score rides along in the status field. Both are handled
//! explicitly here, and neither decoder ever trims or normalises a path — a path that
//! is not UTF-8 is still a path, and a trailing space in one is part of its name.

use crate::bytes::{decode_ascii, split_nul_frames};
use crate::problem::CoreError;

const NUMSTAT_FORMAT: &str = "diff --numstat -z";
const NAME_STATUS_FORMAT: &str = "diff --name-status -z";

/// Default entry bound for both formats.
///
/// This is `CORE_LIMITS.refListMaxEntries` from the published limits; it is duplicated
/// rather than imported because core has no contract runtime to import it from. The
/// bound exists so a diff read cannot be turned into unbounded memory by a repository
/// with a very large change set.
pub const REF_LIST_MAX_ENTRIES: usize = 5_000;

/// What happened to a path, as the porcelain status letters report it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
}

impl ChangeKind {
    /// The name the TypeScript core uses for this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            ChangeKind::Added => "added",
            ChangeKind::Modified => "modified",
            ChangeKind::Deleted => "deleted",
            ChangeKind::Renamed => "renamed",
            ChangeKind::Copied => "copied",
            ChangeKind::TypeChanged => "typeChanged",
            ChangeKind::Unmerged => "unmerged",
        }
    }
}

/// One numstat entry.
///
/// There is deliberately no change kind here: numstat reports line counts only, and
/// the caller joins it with name-status to learn what happened. Inventing "modified"
/// for every entry would hide a delete.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumstatEntry {
    /// `None` for a binary change: Git prints `-`, which is not a count.
    pub insertions: Option<u64>,
    pub deletions: Option<u64>,
    pub path: Vec<u8>,
    pub original_path: Option<Vec<u8>>,
    pub binary: bool,
}

/// One name-status entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameStatusEntry {
    pub change_kind: ChangeKind,
    pub path: Vec<u8>,
    pub original_path: Option<Vec<u8>>,
    /// Rename/copy similarity percentage, when the status carries one.
    pub score: Option<u64>,
    /// The raw status token, e.g. `M`, `D`, `R100`, `U`.
    pub raw_status: String,
}

/// The bound each parse accepts, mirroring the TypeScript `{ maxEntries?: number }`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DiffParseOptions {
    /// Overrides [`REF_LIST_MAX_ENTRIES`] for one call.
    pub max_entries: Option<usize>,
}

/// Parse `git diff --numstat -z`.
///
/// An empty stream is an empty result: a clean diff prints nothing at all, and that is
/// a complete answer.
pub fn parse_numstat(
    bytes: &[u8],
    options: DiffParseOptions,
) -> Result<Vec<NumstatEntry>, CoreError> {
    let max_entries = options.max_entries.unwrap_or(REF_LIST_MAX_ENTRIES);
    let frames = split_nul_frames(bytes, NUMSTAT_FORMAT)?;
    let mut entries: Vec<NumstatEntry> = Vec::new();
    let mut index = 0usize;

    while index < frames.len() {
        let frame = frames[index];
        if frame.is_empty() {
            index += 1;
            continue;
        }
        if entries.len() >= max_entries {
            return Err(CoreError::output_unparsable(
                NUMSTAT_FORMAT,
                format!("numstat exceeded {max_entries} entries"),
            ));
        }

        // Counts are TAB-separated and the path follows the second TAB, so the TAB
        // count is fixed and a path containing tabs keeps them.
        let mut offset = 0usize;
        let insertions_field = take_until(frame, &mut offset, b'\t');
        expect_byte(
            frame,
            &mut offset,
            b'\t',
            "a tab after the insertion count",
            NUMSTAT_FORMAT,
        )?;
        let deletions_field = take_until(frame, &mut offset, b'\t');
        expect_byte(
            frame,
            &mut offset,
            b'\t',
            "a tab after the deletion count",
            NUMSTAT_FORMAT,
        )?;
        let path_part = &frame[offset..];

        let insertions_text = decode_ascii(insertions_field, NUMSTAT_FORMAT)?;
        let deletions_text = decode_ascii(deletions_field, NUMSTAT_FORMAT)?;
        let binary = insertions_text == "-" && deletions_text == "-";
        let insertions = if binary {
            None
        } else {
            Some(parse_count(&insertions_text, NUMSTAT_FORMAT)?)
        };
        let deletions = if binary {
            None
        } else {
            Some(parse_count(&deletions_text, NUMSTAT_FORMAT)?)
        };

        if path_part.is_empty() {
            // A rename or copy: the next two frames are the original and the new path.
            let (Some(original_path), Some(new_path)) =
                (frames.get(index + 1), frames.get(index + 2))
            else {
                return Err(CoreError::output_unparsable(
                    NUMSTAT_FORMAT,
                    "rename entry was not followed by its two path frames",
                ));
            };
            index += 2;
            if original_path.is_empty() || new_path.is_empty() {
                return Err(CoreError::output_unparsable(
                    NUMSTAT_FORMAT,
                    "rename entry has an empty path",
                ));
            }
            entries.push(NumstatEntry {
                insertions,
                deletions,
                path: new_path.to_vec(),
                original_path: Some(original_path.to_vec()),
                binary,
            });
            index += 1;
            continue;
        }

        entries.push(NumstatEntry {
            insertions,
            deletions,
            path: path_part.to_vec(),
            original_path: None,
            binary,
        });
        index += 1;
    }

    Ok(entries)
}

/// Parse `git diff --name-status -z`.
pub fn parse_name_status(
    bytes: &[u8],
    options: DiffParseOptions,
) -> Result<Vec<NameStatusEntry>, CoreError> {
    let max_entries = options.max_entries.unwrap_or(REF_LIST_MAX_ENTRIES);
    let frames = split_nul_frames(bytes, NAME_STATUS_FORMAT)?;
    let mut entries: Vec<NameStatusEntry> = Vec::new();
    let mut index = 0usize;

    while index < frames.len() {
        let frame = frames[index];
        if frame.is_empty() {
            index += 1;
            continue;
        }
        if entries.len() >= max_entries {
            return Err(CoreError::output_unparsable(
                NAME_STATUS_FORMAT,
                format!("name-status exceeded {max_entries} entries"),
            ));
        }

        let status = decode_ascii(frame, NAME_STATUS_FORMAT)?;
        // The frame is non-empty and every byte was checked ASCII, so the first
        // character is exactly one byte.
        let letter = &status[..1];
        let change_kind = change_kind_from_letter(letter, NAME_STATUS_FORMAT)?;
        let has_second = letter == "R" || letter == "C";
        let mut score: Option<u64> = None;
        if has_second {
            let score_text = &status[1..];
            if score_text.is_empty() || !score_text.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(CoreError::output_unparsable(
                    NAME_STATUS_FORMAT,
                    format!("rename/copy status '{status}' has no score"),
                ));
            }
            score = Some(score_text.parse::<u64>().map_err(|_| {
                CoreError::output_unparsable(
                    NAME_STATUS_FORMAT,
                    format!("rename/copy status '{status}' has no score"),
                )
            })?);
        } else if status.len() != 1 {
            return Err(CoreError::output_unparsable(
                NAME_STATUS_FORMAT,
                format!("unexpected status token '{status}'"),
            ));
        }

        if has_second {
            let (Some(original_path), Some(new_path)) =
                (frames.get(index + 1), frames.get(index + 2))
            else {
                return Err(CoreError::output_unparsable(
                    NAME_STATUS_FORMAT,
                    "rename/copy entry was not followed by its two path frames",
                ));
            };
            index += 2;
            if original_path.is_empty() || new_path.is_empty() {
                return Err(CoreError::output_unparsable(
                    NAME_STATUS_FORMAT,
                    "rename/copy entry has an empty path",
                ));
            }
            entries.push(NameStatusEntry {
                change_kind,
                path: new_path.to_vec(),
                original_path: Some(original_path.to_vec()),
                score,
                raw_status: status,
            });
            index += 1;
            continue;
        }

        let Some(path) = frames.get(index + 1) else {
            return Err(CoreError::output_unparsable(
                NAME_STATUS_FORMAT,
                "status entry was not followed by a path frame",
            ));
        };
        index += 1;
        if path.is_empty() {
            return Err(CoreError::output_unparsable(
                NAME_STATUS_FORMAT,
                "status entry has an empty path",
            ));
        }
        entries.push(NameStatusEntry {
            change_kind,
            path: path.to_vec(),
            original_path: None,
            score: None,
            raw_status: status,
        });
        index += 1;
    }

    Ok(entries)
}

/// Map one porcelain status letter to a change kind, refusing unknown letters.
///
/// A letter this code does not know is a format the UI cannot describe; guessing
/// "modified" for it would render a status the user did not make.
fn change_kind_from_letter(letter: &str, format: &str) -> Result<ChangeKind, CoreError> {
    match letter {
        "A" => Ok(ChangeKind::Added),
        "M" => Ok(ChangeKind::Modified),
        "D" => Ok(ChangeKind::Deleted),
        "R" => Ok(ChangeKind::Renamed),
        "C" => Ok(ChangeKind::Copied),
        "T" => Ok(ChangeKind::TypeChanged),
        "U" => Ok(ChangeKind::Unmerged),
        _ => Err(CoreError::output_unparsable(
            format,
            format!("unknown change status '{letter}' (at byte 0)"),
        )),
    }
}

/// Parse a decimal line count.
///
/// An empty field is refused. The TypeScript reference computes `NaN` for it; a value
/// that is not a number is not a count, and passing one on would make the UI add a
/// number that does not exist.
fn parse_count(field: &str, format: &str) -> Result<u64, CoreError> {
    if field.is_empty() || !field.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CoreError::output_unparsable(
            format,
            format!("expected a line count but found '{field}'"),
        ));
    }
    field.parse::<u64>().map_err(|_| {
        CoreError::output_unparsable(format, format!("expected a line count but found '{field}'"))
    })
}

/// Read up to the next `separator`, leaving the cursor on it.
fn take_until<'a>(frame: &'a [u8], offset: &mut usize, separator: u8) -> &'a [u8] {
    let start = *offset;
    let mut end = start;
    while end < frame.len() && frame[end] != separator {
        end += 1;
    }
    *offset = end;
    &frame[start..end]
}

/// Require one specific byte, e.g. the TAB between the counts and the path.
fn expect_byte(
    frame: &[u8],
    offset: &mut usize,
    expected: u8,
    name: &str,
    format: &str,
) -> Result<(), CoreError> {
    if frame.get(*offset) != Some(&expected) {
        return Err(CoreError::output_unparsable(
            format,
            format!("expected {name} (at byte {offset})"),
        ));
    }
    *offset += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed capture `numstatRename`, which Git produced for a real change set.
    const NUMSTAT_RENAME: &[u8] =
        b"2\t1\tbase.txt\x000\t1\tdelete-me.txt\x000\t0\t\x00rename-src.txt\x00moved \xe6\x96\xb0\tname.txt\x00";
    /// The committed capture `nameStatusRename`.
    const NAME_STATUS_RENAME: &[u8] =
        b"M\x00base.txt\x00D\x00delete-me.txt\x00R100\x00rename-src.txt\x00moved \xe6\x96\xb0\tname.txt\x00";
    /// The committed capture `numstatBinary`.
    const NUMSTAT_BINARY: &[u8] = b"-\t-\tbin.dat\x000\t0\tscript.sh\x00";
    /// The committed capture `nameStatusUnmerged`.
    const NAME_STATUS_UNMERGED: &[u8] = b"U\x00base.txt\x00M\x00base.txt\x00";

    fn default_options() -> DiffParseOptions {
        DiffParseOptions::default()
    }

    #[test]
    fn reads_counts_a_two_frame_rename_and_a_binary_count() {
        let entries = parse_numstat(NUMSTAT_RENAME, default_options()).expect("numstat");
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].insertions, Some(2));
        assert_eq!(entries[0].deletions, Some(1));
        assert_eq!(entries[0].path, b"base.txt".to_vec());
        assert!(!entries[0].binary);
        assert_eq!(entries[1].path, b"delete-me.txt".to_vec());
        // The rename's two paths arrive in their own frames: the counts frame ends
        // with an empty third field, and the original path comes before the new one.
        assert_eq!(
            entries[2].original_path.as_deref(),
            Some(b"rename-src.txt".as_slice())
        );
        assert_eq!(entries[2].path, b"moved \xe6\x96\xb0\tname.txt".to_vec());

        let binary = parse_numstat(NUMSTAT_BINARY, default_options()).expect("binary");
        let bin = binary
            .iter()
            .find(|entry| entry.path == b"bin.dat")
            .expect("bin.dat");
        assert!(bin.binary);
        // Git prints `-`, which is not a count: a UI that added it as zero would
        // report a binary change as empty.
        assert_eq!(bin.insertions, None);
        assert_eq!(bin.deletions, None);
    }

    #[test]
    fn keeps_a_path_with_a_space_and_a_tab() {
        let bytes = b"1\t2\tspace \tand tab\x00";
        let entries = parse_numstat(bytes, default_options()).expect("numstat");
        assert_eq!(entries[0].path, b"space \tand tab".to_vec());
    }

    #[test]
    fn refuses_a_rename_whose_two_path_frames_are_missing() {
        // Truncated output would otherwise attach the next record's path to this
        // rename and lose the original name.
        let error = parse_numstat(b"0\t0\t\x00old.txt\x00", default_options())
            .expect_err("truncated rename");
        assert!(error.to_string().contains("two path frames"));
    }

    #[test]
    fn refuses_a_stream_that_does_not_end_with_nul() {
        // A record cut mid-path is a wrong answer, not a short one.
        let error = parse_numstat(b"1\t1\tbase.txt", default_options()).expect_err("cut stream");
        assert!(matches!(error, CoreError::OutputIncomplete { .. }));
    }

    #[test]
    fn refuses_a_rename_entry_with_an_empty_path() {
        let error = parse_numstat(b"0\t0\t\x00\x00new.txt\x00", default_options())
            .expect_err("empty original path");
        assert!(error.to_string().contains("empty path"));
    }

    #[test]
    fn refuses_a_count_that_is_not_a_number() {
        let error = parse_numstat(b"3x\t4\tp.txt\x00", default_options()).expect_err("bad count");
        assert!(error.to_string().contains("expected a line count"));
    }

    #[test]
    fn refuses_an_empty_count_field_rather_than_reporting_a_missing_number() {
        // The TypeScript reference would produce NaN here; a count that is not a
        // number must not reach a caller that adds it up.
        assert!(parse_numstat(b"\t\tp.txt\x00", default_options()).is_err());
    }

    #[test]
    fn refuses_an_entry_beyond_the_entry_bound() {
        let options = DiffParseOptions {
            max_entries: Some(0),
        };
        let error = parse_numstat(b"1\t1\ta\x00", options).expect_err("bound");
        assert!(error.to_string().contains("exceeded 0 entries"));
    }

    #[test]
    fn an_empty_numstat_stream_is_a_complete_empty_answer() {
        assert_eq!(
            parse_numstat(b"", default_options()).expect("empty"),
            Vec::new()
        );
    }

    #[test]
    fn reads_name_status_with_the_score_and_both_rename_paths() {
        let entries =
            parse_name_status(NAME_STATUS_RENAME, default_options()).expect("name-status");
        assert_eq!(entries.len(), 3);
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.change_kind)
                .collect::<Vec<_>>(),
            vec![
                ChangeKind::Modified,
                ChangeKind::Deleted,
                ChangeKind::Renamed
            ]
        );
        assert_eq!(entries[2].score, Some(100));
        assert_eq!(entries[2].raw_status, "R100");
        assert_eq!(
            entries[2].original_path.as_deref(),
            Some(b"rename-src.txt".as_slice())
        );
        assert_eq!(entries[2].path, b"moved \xe6\x96\xb0\tname.txt".to_vec());
    }

    #[test]
    fn reads_an_unmerged_listing_where_one_path_appears_twice() {
        // A conflicted path is reported once as unmerged and once as modified; a
        // parser that keyed entries by path would drop one of the two rows.
        let entries = parse_name_status(NAME_STATUS_UNMERGED, default_options()).expect("unmerged");
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.raw_status.as_str())
                .collect::<Vec<_>>(),
            vec!["U", "M"]
        );
        assert!(entries.iter().all(|entry| entry.path == b"base.txt"));
        assert_eq!(entries[0].change_kind, ChangeKind::Unmerged);
    }

    #[test]
    fn keeps_a_path_with_a_space_and_a_tab_in_name_status() {
        let entries =
            parse_name_status(b"M\x00a b\tc\x00", default_options()).expect("name-status");
        assert_eq!(entries[0].path, b"a b\tc".to_vec());
    }

    #[test]
    fn refuses_an_unknown_status_letter() {
        // A status the UI cannot describe must be an error, never a silent "modified".
        let error = parse_name_status(b"X\x00p.txt\x00", default_options()).expect_err("unknown");
        assert!(error.to_string().contains("unknown change status 'X'"));
    }

    #[test]
    fn refuses_a_rename_without_a_score() {
        let error =
            parse_name_status(b"R\x00old\x00new\x00", default_options()).expect_err("no score");
        assert!(error.to_string().contains("has no score"));
    }

    #[test]
    fn refuses_a_rename_with_a_non_numeric_score() {
        assert!(parse_name_status(b"R100x\x00old\x00new\x00", default_options()).is_err());
    }

    #[test]
    fn refuses_a_status_token_that_carries_more_than_the_letter() {
        let error =
            parse_name_status(b"MM\x00p.txt\x00", default_options()).expect_err("two letters");
        assert!(error.to_string().contains("unexpected status token 'MM'"));
    }

    #[test]
    fn refuses_a_status_entry_without_a_path_frame() {
        let error = parse_name_status(b"M\x00", default_options()).expect_err("no path");
        assert!(error.to_string().contains("path frame"));
    }

    #[test]
    fn refuses_a_status_entry_with_an_empty_path() {
        let error = parse_name_status(b"M\x00\x00", default_options()).expect_err("empty path");
        assert!(error.to_string().contains("empty path"));
    }

    #[test]
    fn refuses_a_name_status_stream_that_is_not_nul_terminated() {
        let error = parse_name_status(b"M\x00p.txt", default_options()).expect_err("cut stream");
        assert!(matches!(error, CoreError::OutputIncomplete { .. }));
    }

    #[test]
    fn skips_empty_frames_between_records() {
        // Consecutive NULs carry no record; treating one as a path would shift every
        // later entry by one frame.
        let entries = parse_name_status(b"\x00M\x00p.txt\x00", default_options()).expect("skipped");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, b"p.txt".to_vec());
    }

    #[test]
    fn copies_carry_a_score_like_renames_and_use_two_path_frames() {
        let entries =
            parse_name_status(b"C75\x00orig.txt\x00copy.txt\x00", default_options()).expect("copy");
        assert_eq!(entries[0].change_kind, ChangeKind::Copied);
        assert_eq!(entries[0].score, Some(75));
        assert_eq!(entries[0].path, b"copy.txt".to_vec());
        assert_eq!(
            entries[0].original_path.as_deref(),
            Some(b"orig.txt".as_slice())
        );
    }

    #[test]
    fn change_kind_names_match_the_typescript_names() {
        assert_eq!(ChangeKind::TypeChanged.as_str(), "typeChanged");
        assert_eq!(ChangeKind::Unmerged.as_str(), "unmerged");
    }
}
