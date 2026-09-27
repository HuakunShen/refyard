//! Parsers for submodule configuration, index gitlinks and recorded tree entries.

use crate::bytes::{decode_ascii, is_object_name, split_nul_frames, FrameReader};
use crate::problem::CoreError;

const CONFIG_FORMAT: &str = "config -z";
const INDEX_FORMAT: &str = "ls-files --stage -z";
const TREE_FORMAT: &str = "ls-tree -z";

/// A bounded parse result. A complete NUL-framed stream can still report that rows
/// beyond the caller's display limit were omitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BoundedEntries<T> {
    pub entries: Vec<T>,
    pub truncated: bool,
}

/// One `submodule.<name>.<key>` record from Git config, with the value left as bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigEntry {
    pub key: String,
    pub value: Vec<u8>,
}

/// One staged entry. Paths remain raw bytes so tabs, newlines and non-UTF-8 names
/// cannot collide after display decoding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    pub mode: String,
    pub oid: String,
    pub stage: u8,
    pub path: Vec<u8>,
    pub gitlink: bool,
}

/// One object recorded by `git ls-tree -z`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TreeEntry {
    pub mode: String,
    pub object_type: String,
    pub oid: String,
    pub path: Vec<u8>,
}

/// Parses `git config -z --get-regexp`: each frame is `key\nvalue`.
///
/// Splitting only at the first newline preserves values that contain newlines.
pub fn parse_config_entries(
    bytes: &[u8],
    max_entries: usize,
) -> Result<BoundedEntries<ConfigEntry>, CoreError> {
    let mut entries = Vec::with_capacity(max_entries.min(64));
    let mut truncated = false;
    for frame in split_nul_frames(bytes, CONFIG_FORMAT)? {
        if frame.is_empty() {
            continue;
        }
        if entries.len() >= max_entries {
            truncated = true;
            continue;
        }
        let separator = frame.iter().position(|byte| *byte == b'\n');
        let Some(separator) = separator.filter(|index| *index > 0) else {
            return Err(CoreError::output_unparsable(
                CONFIG_FORMAT,
                "expected <key>\\n<value> per record",
            ));
        };
        entries.push(ConfigEntry {
            key: decode_ascii(&frame[..separator], CONFIG_FORMAT)?,
            value: frame[separator + 1..].to_vec(),
        });
    }
    Ok(BoundedEntries { entries, truncated })
}

/// Parses `git ls-files --stage -z`, preserving the path after its fixed header.
pub fn parse_ls_files_stage(
    bytes: &[u8],
    max_entries: usize,
) -> Result<BoundedEntries<IndexEntry>, CoreError> {
    let mut entries = Vec::with_capacity(max_entries.min(64));
    let mut truncated = false;
    for frame in split_nul_frames(bytes, INDEX_FORMAT)? {
        if frame.is_empty() {
            continue;
        }
        if entries.len() >= max_entries {
            truncated = true;
            continue;
        }
        let mut reader = FrameReader::new(frame, INDEX_FORMAT);
        let mode = reader.take_ascii_field()?;
        validate_mode(&mode, INDEX_FORMAT)?;
        reader.expect_space()?;
        let oid = reader.take_oid()?;
        reader.expect_space()?;
        let stage = reader.take_byte()?;
        if !(b'0'..=b'3').contains(&stage) {
            return Err(CoreError::output_unparsable(
                INDEX_FORMAT,
                "expected stage 0, 1, 2 or 3",
            ));
        }
        if reader.take_byte()? != b'\t' {
            return Err(CoreError::output_unparsable(
                INDEX_FORMAT,
                "expected a tab before the path",
            ));
        }
        let path = reader.take_rest().to_vec();
        if path.is_empty() {
            return Err(CoreError::output_unparsable(
                INDEX_FORMAT,
                "index path is empty",
            ));
        }
        entries.push(IndexEntry {
            gitlink: mode == "160000",
            mode,
            oid,
            stage: stage - b'0',
            path,
        });
    }
    Ok(BoundedEntries { entries, truncated })
}

/// Parses `git ls-tree -z`: `<mode> <type> <oid>\t<path>`.
pub fn parse_ls_tree(
    bytes: &[u8],
    max_entries: usize,
) -> Result<BoundedEntries<TreeEntry>, CoreError> {
    let mut entries = Vec::with_capacity(max_entries.min(64));
    let mut truncated = false;
    for frame in split_nul_frames(bytes, TREE_FORMAT)? {
        if frame.is_empty() {
            continue;
        }
        if entries.len() >= max_entries {
            truncated = true;
            continue;
        }
        let Some(tab) = frame.iter().position(|byte| *byte == b'\t') else {
            return Err(CoreError::output_unparsable(
                TREE_FORMAT,
                "expected <mode> <type> <oid>\\t<path> per record",
            ));
        };
        if tab == 0 || tab + 1 == frame.len() {
            return Err(CoreError::output_unparsable(
                TREE_FORMAT,
                "tree record has an empty header or path",
            ));
        }
        let fields: Vec<&[u8]> = frame[..tab].split(|byte| *byte == b' ').collect();
        if fields.len() != 3 {
            return Err(CoreError::output_unparsable(
                TREE_FORMAT,
                "expected exactly three space-separated header fields",
            ));
        }
        let mode = decode_ascii(fields[0], TREE_FORMAT)?;
        validate_mode(&mode, TREE_FORMAT)?;
        let object_type = decode_ascii(fields[1], TREE_FORMAT)?;
        if !is_object_name(fields[2]) {
            return Err(CoreError::output_unparsable(
                TREE_FORMAT,
                "expected a Git object name of 40 or 64 lowercase hex characters",
            ));
        }
        let oid = decode_ascii(fields[2], TREE_FORMAT)?;
        entries.push(TreeEntry {
            mode,
            object_type,
            oid,
            path: frame[tab + 1..].to_vec(),
        });
    }
    Ok(BoundedEntries { entries, truncated })
}

fn validate_mode(mode: &str, format: &str) -> Result<(), CoreError> {
    if mode.len() != 6 || !mode.bytes().all(|byte| (b'0'..=b'7').contains(&byte)) {
        return Err(CoreError::output_unparsable(
            format,
            "expected a six-digit octal file mode",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_parser_keeps_raw_paths_and_marks_gitlinks() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let input = format!(
            "100644 {oid} 0\tordinary\tfile\nname\0\
             160000 {oid} 0\tmodules/child\0"
        );
        let parsed = parse_ls_files_stage(input.as_bytes(), 10).expect("index entries");

        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 2);
        assert_eq!(parsed.entries[0].path, b"ordinary\tfile\nname");
        assert!(!parsed.entries[0].gitlink);
        assert_eq!(parsed.entries[1].path, b"modules/child");
        assert!(parsed.entries[1].gitlink);
        assert_eq!(parsed.entries[1].stage, 0);
    }

    #[test]
    fn config_parser_splits_only_the_first_newline_and_reports_truncation() {
        let input =
            b"submodule.child.path\nmodules/child\0submodule.child.url\nline one\nline two\0";
        let parsed = parse_config_entries(input, 1).expect("config entries");

        assert!(parsed.truncated);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].key, "submodule.child.path");
        assert_eq!(parsed.entries[0].value, b"modules/child");
    }

    #[test]
    fn tree_parser_preserves_path_bytes_and_object_kind() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let input = format!("160000 commit {oid}\tmodules/child\0");
        let parsed = parse_ls_tree(input.as_bytes(), 10).expect("tree entries");

        assert!(!parsed.truncated);
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.entries[0].mode, "160000");
        assert_eq!(parsed.entries[0].object_type, "commit");
        assert_eq!(parsed.entries[0].path, b"modules/child");
    }
}
