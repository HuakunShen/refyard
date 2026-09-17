//! `git rev-list --parents` topology rows.
//!
//! Output is `<oid> <parent>…` per line, with a leading `-` on a row Git marked as a
//! boundary. Only object names and single spaces appear, so this is the one history
//! read that never touches a commit message: bodies come from `cat-file --batch`
//! separately, which is what keeps a message containing a newline from looking like a
//! new row.
//!
//! The reference module also holds the `remote -v`, `config -z` and `ls-tree -z`
//! parsers; only the topology read is ported in this file.

use crate::bytes::decode_ascii;
use crate::problem::CoreError;

const TOPOLOGY_FORMAT: &str = "rev-list --topo-order --parents";

/// One row of the walk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TopologyEntry {
    pub oid: String,
    pub parent_oids: Vec<String>,
    /// True when Git marked this commit as a boundary (`-` prefix).
    pub boundary: bool,
}

/// Parse `rev-list --parents` output.
///
/// Object names are checked for emptiness only, exactly as the reference does: this
/// text is Git's own walk, and a stricter rule here would be a second specification
/// that the differential oracle does not share.
pub fn parse_rev_list_topology(bytes: &[u8]) -> Result<Vec<TopologyEntry>, CoreError> {
    let mut entries = Vec::new();
    for line in split_on_byte(bytes, b'\n') {
        if line.is_empty() {
            continue;
        }
        let text = decode_ascii(line, TOPOLOGY_FORMAT)?;
        let (text, boundary) = match text.strip_prefix('-') {
            Some(rest) => (rest, true),
            None => (text.as_str(), false),
        };
        let mut fields = text.split(' ');
        // `split` always yields at least one field, empty text included, and an empty
        // name is exactly the case the reference refuses.
        let oid = match fields.next() {
            Some(oid) if !oid.is_empty() => oid,
            _ => {
                return Err(CoreError::output_unparsable(
                    TOPOLOGY_FORMAT,
                    "a row had no object name",
                ));
            }
        };
        let parents: Vec<&str> = fields.collect();
        for parent in &parents {
            if parent.is_empty() {
                return Err(CoreError::output_unparsable(
                    TOPOLOGY_FORMAT,
                    "a row contained an empty parent field",
                ));
            }
        }
        entries.push(TopologyEntry {
            oid: oid.to_string(),
            parent_oids: parents.iter().map(|parent| (*parent).to_string()).collect(),
            boundary,
        });
    }
    Ok(entries)
}

/// Split on one byte, dropping only the final empty element after a trailing
/// separator. An interior empty frame is kept, because skipping it is the caller's
/// decision and not the splitter's.
fn split_on_byte(bytes: &[u8], separator: u8) -> Vec<&[u8]> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == separator {
            parts.push(&bytes[start..index]);
            start = index + 1;
        }
    }
    if start < bytes.len() {
        parts.push(&bytes[start..]);
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed capture `revListTopology`, produced by a real walk.
    const REV_LIST_TOPOLOGY: &[u8] = b"fef12e3705ae5eb4037d164d06a78a9dda8392c2 d21595332413c62dbd2bc0b53bd88575d5a61a1b\nd21595332413c62dbd2bc0b53bd88575d5a61a1b 9315856cb6d1f7e13d2ba8266384fab3e81e9297\n9315856cb6d1f7e13d2ba8266384fab3e81e9297 7192fcddf81d3e09d3ba4af8ee7536929215302c\n";

    #[test]
    fn reads_rows_and_their_parents() {
        let entries = parse_rev_list_topology(REV_LIST_TOPOLOGY).expect("topology");
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].oid, "fef12e3705ae5eb4037d164d06a78a9dda8392c2");
        assert_eq!(
            entries[0].parent_oids,
            vec!["d21595332413c62dbd2bc0b53bd88575d5a61a1b".to_string()]
        );
        assert!(!entries[0].boundary);
    }

    #[test]
    fn a_trailing_newline_does_not_add_a_row() {
        // An empty final line read as a row would make every page report one commit
        // with no object name.
        assert_eq!(
            parse_rev_list_topology(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")
                .expect("topology")
                .len(),
            1
        );
    }

    #[test]
    fn marks_a_row_git_prefixed_with_a_minus_as_a_boundary() {
        let entries = parse_rev_list_topology(
            b"-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
        )
        .expect("topology");
        assert!(entries[0].boundary);
        assert_eq!(entries[0].oid, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(
            entries[0].parent_oids,
            vec!["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()]
        );
    }

    #[test]
    fn reads_a_merge_row_with_every_parent_in_order() {
        // Parent order is the merge's first-parent order; dropping or reordering it
        // would draw the graph with the wrong ancestry.
        let entries = parse_rev_list_topology(
            b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc\n",
        )
        .expect("topology");
        assert_eq!(
            entries[0].parent_oids,
            vec![
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
                "cccccccccccccccccccccccccccccccccccccccc".to_string()
            ]
        );
    }

    #[test]
    fn a_root_row_has_no_parents() {
        let entries = parse_rev_list_topology(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n")
            .expect("topology");
        assert!(entries[0].parent_oids.is_empty());
    }

    #[test]
    fn refuses_a_row_with_no_object_name() {
        // `-` alone is a boundary marker with nothing behind it; treating it as an
        // object name would put a dash in the graph as a commit.
        let error = parse_rev_list_topology(b"-\n").expect_err("empty row");
        assert!(error.to_string().contains("no object name"));
    }

    #[test]
    fn refuses_a_row_with_an_empty_parent_field() {
        // Two spaces where one name is missing is a corrupted walk, not a merge with
        // an unnamed second parent.
        let error = parse_rev_list_topology(b"aaaa bbbb  cccc\n").expect_err("empty parent field");
        assert!(error.to_string().contains("empty parent field"));
    }

    #[test]
    fn skips_blank_lines_inside_the_output() {
        let entries =
            parse_rev_list_topology(b"\naaaa\n\naaaa bbbb\n").expect("topology with blanks");
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn an_empty_stream_is_an_empty_topology() {
        assert_eq!(parse_rev_list_topology(b"").expect("empty"), Vec::new());
    }

    #[test]
    fn refuses_a_row_with_a_non_ascii_byte() {
        // Object names are hex; a non-ASCII byte means the stream is not what the
        // command claims it is.
        let error = parse_rev_list_topology("aaaa\u{e9}bbbb\n".as_bytes()).expect_err("non-ASCII");
        assert!(matches!(error, CoreError::OutputUnparsable { .. }));
    }
}
