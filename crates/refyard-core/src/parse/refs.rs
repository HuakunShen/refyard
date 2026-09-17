//! `git for-each-ref` and `git reflog show`.
//!
//! `for-each-ref` emits one ref per line with `%00`-separated fields; the trailing
//! `%(*objectname)` is the peeled object of an annotated tag, which is what the UI
//! needs to show the commit behind a tag. The last field is NUL-terminated by the
//! format string, so a ref with fewer fields than expected is a parse error rather
//! than a silently shifted record.
//!
//! Ref names and object names are ASCII by construction, so they are decoded
//! strictly: a byte above 0x7f in a ref name means the output is not what we think it
//! is, and inventing a replacement character there would hide that.

use crate::bytes::{decode_ascii, split_nul_frames};
use crate::problem::CoreError;

const FOR_EACH_REF: &str = "for-each-ref";
const REFLOG: &str = "reflog show";

/// One ref, with the fields the refs panel renders.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefRecord {
    pub ref_name: String,
    pub oid: String,
    /// `commit`, `tag`, `tree`, `blob` — or `unknown` when Git reports something this
    /// build has not seen.
    pub object_type: String,
    /// The ref this one points at, when it is symbolic.
    pub symref: Option<String>,
    /// The upstream ref name, when one is configured.
    pub upstream: Option<String>,
    /// `[ahead 1, behind 2]`, `[gone]`, or absent.
    pub upstream_track: Option<UpstreamTrack>,
    /// True for the branch HEAD points at.
    pub is_head: bool,
    /// The peeled object of an annotated tag.
    pub peeled_oid: Option<String>,
}

/// What `%(upstream:track)` said.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpstreamTrack {
    pub ahead: u64,
    pub behind: u64,
    /// The upstream ref no longer exists.
    pub gone: bool,
}

/// One reflog entry, used for the stash list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReflogRecord {
    pub locator: String,
    pub oid: String,
    /// The subject, kept as bytes: a stash message is user text.
    pub subject: Vec<u8>,
    pub timestamp: i64,
}

/// Parses `for-each-ref` output produced with the eight-field format.
pub fn parse_for_each_ref(bytes: &[u8], max_entries: usize) -> Result<Vec<RefRecord>, CoreError> {
    let mut records: Vec<RefRecord> = Vec::new();
    for line in bytes.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        if records.len() >= max_entries {
            return Err(CoreError::output_unparsable(
                FOR_EACH_REF,
                format!("ref listing exceeded {max_entries} entries"),
            ));
        }
        let normalized = normalize_line(line);
        let fields = split_nul_frames(&normalized, FOR_EACH_REF)?;
        // Eight fields are written; the format's trailing %00 makes the final
        // (peeled-object) field terminate the record, so a tag with no peeled object
        // arrives as an empty eighth field rather than a missing one.
        if fields.len() != 8 {
            return Err(CoreError::output_unparsable(
                FOR_EACH_REF,
                format!("expected 8 fields per ref but found {}", fields.len()),
            ));
        }
        let field = |index: usize| -> Result<String, CoreError> {
            decode_ascii(fields[index], FOR_EACH_REF)
        };
        let optional = |index: usize| -> Result<Option<String>, CoreError> {
            if fields[index].is_empty() {
                Ok(None)
            } else {
                Ok(Some(decode_ascii(fields[index], FOR_EACH_REF)?))
            }
        };
        let object_type = field(2)?;
        records.push(RefRecord {
            ref_name: field(0)?,
            oid: field(1)?,
            object_type: if object_type.is_empty() {
                "unknown".to_string()
            } else {
                object_type
            },
            symref: optional(3)?,
            upstream: optional(4)?,
            upstream_track: parse_upstream_track(&field(5)?),
            is_head: field(6)? == "*",
            peeled_oid: optional(7)?,
        });
    }
    Ok(records)
}

/// `%(upstream:track)` writes `[ahead 1]`, `[behind 2]`, `[ahead 1, behind 2]` or
/// `[gone]`; an empty field means the branch is level with its upstream.
pub fn parse_upstream_track(text: &str) -> Option<UpstreamTrack> {
    let inner = text.trim();
    if inner.is_empty() {
        return None;
    }
    let inner = inner.strip_prefix('[')?.strip_suffix(']')?;
    if inner == "gone" {
        return Some(UpstreamTrack {
            ahead: 0,
            behind: 0,
            gone: true,
        });
    }
    let mut ahead = 0u64;
    let mut behind = 0u64;
    for part in inner.split(',') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.trim().parse::<u64>().ok()?;
            continue;
        }
        if let Some(value) = part.strip_prefix("behind ") {
            behind = value.trim().parse::<u64>().ok()?;
            continue;
        }
        // An unrecognised track form is not something to guess about.
        return None;
    }
    Some(UpstreamTrack {
        ahead,
        behind,
        gone: false,
    })
}

/// Parses `reflog show --format=%gd%x00%H%x00%gs%x00%ct`.
pub fn parse_reflog(bytes: &[u8], max_entries: usize) -> Result<Vec<ReflogRecord>, CoreError> {
    let mut records: Vec<ReflogRecord> = Vec::new();
    for line in bytes.split(|byte| *byte == b'\n') {
        if line.is_empty() {
            continue;
        }
        if records.len() >= max_entries {
            return Err(CoreError::output_unparsable(
                REFLOG,
                format!("reflog exceeded {max_entries} entries"),
            ));
        }
        let normalized = normalize_line(line);
        let fields = split_nul_frames(&normalized, REFLOG)?;
        if fields.len() != 4 {
            return Err(CoreError::output_unparsable(
                REFLOG,
                format!(
                    "expected 4 fields per reflog entry but found {}",
                    fields.len()
                ),
            ));
        }
        let timestamp = decode_ascii(fields[3], REFLOG)?
            .trim()
            .parse::<i64>()
            .map_err(|_| CoreError::output_unparsable(REFLOG, "commit time is not a number"))?;
        records.push(ReflogRecord {
            locator: decode_ascii(fields[0], REFLOG)?,
            oid: decode_ascii(fields[1], REFLOG)?,
            // Not decoded: a stash message is user text and stays bytes until the
            // codec decides how to display it.
            subject: fields[2].to_vec(),
            timestamp,
        });
    }
    Ok(records)
}

/// Git separates records with `\n` and fields with NUL, so a record's own NUL run
/// ends at the newline. Appending a terminator lets the shared splitter be used on
/// one line without special-casing the last field.
fn normalize_line(line: &[u8]) -> Vec<u8> {
    let mut owned = line.to_vec();
    if owned.last() != Some(&0) {
        owned.push(0);
    }
    owned
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One record as Git writes it: fields joined by NUL, the record *terminated* by
    /// a NUL, then the newline that separates records.
    fn line(fields: &[&str]) -> String {
        format!(
            "{}\u{0}\n",
            fields
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
                .join("\u{0}")
        )
    }

    #[test]
    fn reads_a_branch_with_its_upstream_and_head_marker() {
        let text = line(&[
            "refs/heads/main",
            "1111111111111111111111111111111111111111",
            "commit",
            "",
            "refs/remotes/origin/main",
            "[ahead 2, behind 1]",
            "*",
            "",
        ]);
        let records = parse_for_each_ref(text.as_bytes(), 100).expect("parses");
        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.ref_name, "refs/heads/main");
        assert!(record.is_head);
        assert_eq!(record.upstream.as_deref(), Some("refs/remotes/origin/main"));
        assert_eq!(
            record.upstream_track,
            Some(UpstreamTrack {
                ahead: 2,
                behind: 1,
                gone: false
            })
        );
        assert_eq!(record.peeled_oid, None);
    }

    #[test]
    fn reads_the_peeled_object_of_an_annotated_tag() {
        // Without the peeled name the UI cannot show which commit a tag points at.
        let text = line(&[
            "refs/tags/v1",
            "2222222222222222222222222222222222222222",
            "tag",
            "",
            "",
            "",
            "",
            "3333333333333333333333333333333333333333",
        ]);
        let records = parse_for_each_ref(text.as_bytes(), 100).expect("parses");
        assert_eq!(
            records[0].peeled_oid.as_deref(),
            Some("3333333333333333333333333333333333333333")
        );
        assert_eq!(records[0].object_type, "tag");
    }

    #[test]
    fn reports_a_gone_upstream_as_gone_rather_than_as_level() {
        let track = parse_upstream_track("[gone]").expect("track");
        assert!(track.gone);
        assert_eq!(track.ahead, 0);
        assert_eq!(track.behind, 0);
    }

    #[test]
    fn treats_an_empty_track_field_as_no_upstream_status() {
        assert_eq!(parse_upstream_track(""), None);
    }

    #[test]
    fn refuses_an_unrecognised_track_form_instead_of_guessing() {
        assert_eq!(parse_upstream_track("[sideways 3]"), None);
    }

    #[test]
    fn refuses_a_ref_line_with_the_wrong_field_count() {
        // A shifted parse would attach another ref's object name to this name.
        let text = "refs/heads/main\u{0}1111111111111111111111111111111111111111\u{0}commit\n";
        assert!(parse_for_each_ref(text.as_bytes(), 100).is_err());
    }

    #[test]
    fn reads_reflog_entries_with_a_raw_subject() {
        let text = format!(
            "stash@{{0}}\u{0}{}\u{0}WIP on main: 1234567 base\u{0}1770000000\n",
            "4".repeat(40)
        );
        let records = parse_reflog(text.as_bytes(), 100).expect("parses");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].locator, "stash@{0}");
        assert_eq!(records[0].subject, b"WIP on main: 1234567 base");
        assert_eq!(records[0].timestamp, 1_770_000_000);
    }

    #[test]
    fn bounds_the_ref_listing() {
        let mut text = String::new();
        for index in 0..3 {
            text.push_str(&line(&[
                &format!("refs/heads/b{index}"),
                "1111111111111111111111111111111111111111",
                "commit",
                "",
                "",
                "",
                "",
                "",
            ]));
        }
        assert!(parse_for_each_ref(text.as_bytes(), 2).is_err());
        assert!(parse_for_each_ref(text.as_bytes(), 3).is_ok());
    }
}
