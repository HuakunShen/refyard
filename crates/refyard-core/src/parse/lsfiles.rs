//! The `git ls-files --unmerged --stage -z` parser: the stages a conflict left.
//!
//! Measured shape (git 2.50.1), one record per NUL:
//!
//! ```text
//! 100644 f89d64da… 1\ta.txt\0
//! 100644 43372ede… 2\ta.txt\0
//! ```
//!
//! Three space-separated ASCII fields — mode, object name, stage — then a TAB and the
//! raw path bytes. The path may itself contain tabs and need not be UTF-8, so the
//! separator count is fixed (exactly two before it) and the path is kept as bytes: the
//! conflicted-path count is a count of distinct *paths*, and decoding first would let
//! two different byte sequences that render alike collapse into one.

use crate::problem::CoreError;

/// One unmerged index stage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmergedStage {
    /// 1 (base), 2 (ours) or 3 (theirs).
    pub stage: u8,
    /// Raw path bytes, exactly as Git printed them.
    pub path: Vec<u8>,
}

/// The most records one listing may hold, so a misunderstood format fails loudly instead
/// of looping.
const MAX_RECORDS: usize = 100_000;

pub fn parse_ls_files_unmerged(bytes: &[u8]) -> Result<Vec<UnmergedStage>, CoreError> {
    let mut stages = Vec::new();
    for record in bytes.split(|byte| *byte == 0) {
        if record.is_empty() {
            continue;
        }
        if stages.len() >= MAX_RECORDS {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                format!("the listing exceeds {MAX_RECORDS} records"),
            ));
        }
        // `mode SP object SP stage TAB path`: the stage is separated from the path by
        // exactly one TAB — the path itself may hold spaces and tabs, so neither can be
        // a split point here.
        let split: Vec<&[u8]> = record.splitn(3, |byte| *byte == b' ').collect();
        if split.len() != 3 {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                format!(
                    "expected mode, object and stage, then the path: got {} fields",
                    split.len()
                ),
            ));
        }
        // Mode and object are ASCII; they are validated for shape, not decoded.
        let (mode, object, tail) = (split[0], split[1], split[2]);
        if mode.len() != 6 || !mode.iter().all(|byte| (b'0'..=b'7').contains(byte)) {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                "unexpected file mode".to_string(),
            ));
        }
        if object.len() != 40 && object.len() != 64 {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                "unexpected object name length".to_string(),
            ));
        }
        let Some(tab_at) = tail.iter().position(|byte| *byte == b'\t') else {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                "expected a tab before the path".to_string(),
            ));
        };
        let (stage_field, path) = (&tail[..tab_at], &tail[tab_at + 1..]);
        if stage_field.len() != 1 || !matches!(stage_field[0], b'1'..=b'3') {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                "an unmerged listing only holds stages 1 to 3".to_string(),
            ));
        }
        if path.is_empty() {
            return Err(CoreError::output_unparsable(
                "ls-files --unmerged --stage -z",
                "an index entry has an empty path".to_string(),
            ));
        }
        stages.push(UnmergedStage {
            stage: stage_field[0] - b'0',
            path: path.to_vec(),
        });
    }
    Ok(stages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(mode: &str, object: &str, stage: u8, path: &[u8]) -> Vec<u8> {
        let mut record = Vec::new();
        record.extend_from_slice(mode.as_bytes());
        record.push(b' ');
        record.extend_from_slice(object.as_bytes());
        record.push(b' ');
        record.push(b'0' + stage);
        record.push(b'\t');
        record.extend_from_slice(path);
        record
    }

    #[test]
    fn every_stage_of_a_conflict_is_listed_with_its_raw_path_bytes() {
        // Prevents: a conflicted-path count computed from decoded text, where two paths
        // that render alike collapse into one — and a tab inside a file name splitting
        // the record at the wrong place.
        let oid40 = "0123456789abcdef0123456789abcdef01234567";
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&record("100644", oid40, 1, b"a.txt"));
        bytes.push(0);
        bytes.extend_from_slice(&record("100644", oid40, 2, b"a.txt"));
        bytes.push(0);
        bytes.extend_from_slice(&record("100644", oid40, 3, b"a\tb.txt"));
        bytes.push(0);
        bytes.extend_from_slice(&record("100644", oid40, 1, &[0xff, 0xfe]));
        bytes.push(0);

        let stages = parse_ls_files_unmerged(&bytes).expect("a parseable listing");
        assert_eq!(stages.len(), 4);
        assert_eq!(stages[0].stage, 1);
        assert_eq!(stages[1].stage, 2);
        assert_eq!(stages[2].path, b"a\tb.txt".to_vec(), "the tab survives");
        assert_eq!(stages[3].path, vec![0xff, 0xfe], "bytes, not text");
    }

    #[test]
    fn a_malformed_listing_is_an_error_rather_than_a_partial_answer() {
        let oid40 = "0123456789abcdef0123456789abcdef01234567";
        assert!(parse_ls_files_unmerged(b"not a record").is_err());
        assert!(
            parse_ls_files_unmerged(&record("100644", oid40, 0, b"a.txt")).is_err(),
            "stage 0 is not an unmerged stage"
        );
        assert!(
            parse_ls_files_unmerged(&record("100644", oid40, 2, b"")).is_err(),
            "an empty path is not an entry"
        );
        assert!(parse_ls_files_unmerged(&[]).expect("empty").is_empty());
    }
}
