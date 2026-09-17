//! `git rev-list --parents` topology rows, `git remote -v`, and object presence.
//!
//! Topology output is `<oid> <parent>…` per line, with a leading `-` on a row Git
//! marked as a boundary. Only object names and single spaces appear, so this is the
//! one history read that never touches a commit message: bodies come from
//! `cat-file --batch` separately, which is what keeps a message containing a newline
//! from looking like a new row.
//!
//! `remote -v` is read for display only, and `cat-file --batch-check` answers the
//! "which parent is not here" question that decides whether a history row is a
//! boundary. A name Git did not answer for at all counts as missing: reporting it as
//! present would draw a shallow edge as a loaded parent.
//!
//! The reference module also holds the `config -z` and `ls-tree -z` parsers; those are
//! not ported yet because no read in this slice needs them.

use crate::bytes::decode_ascii;
use crate::problem::CoreError;

const TOPOLOGY_FORMAT: &str = "rev-list --topo-order --parents";
const REMOTE_FORMAT: &str = "remote -v";
const PRESENCE_FORMAT: &str = "cat-file --batch-check";

/* -------------------------------------------------------------------- remotes */

/// Which URL a `remote -v` line was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteUrlKind {
    Fetch,
    Push,
}

impl RemoteUrlKind {
    /// The word Git printed in parentheses.
    pub fn as_str(self) -> &'static str {
        match self {
            RemoteUrlKind::Fetch => "fetch",
            RemoteUrlKind::Push => "push",
        }
    }
}

/// One `remote -v` line: a remote's name, one of its URLs, and which URL it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteUrlRecord {
    pub name: String,
    pub url: String,
    pub kind: RemoteUrlKind,
}

/// Parse `remote -v`: `<name>\t<url> (<kind>)`, one line per URL.
///
/// A remote with a separate push URL appears twice. Names are ASCII and validated as
/// such; the URL is decoded leniently because it is display data that the host redacts
/// before it is returned, and it is never used as an argument.
pub fn parse_remote_list(bytes: &[u8]) -> Result<Vec<RemoteUrlRecord>, CoreError> {
    let mut records = Vec::new();
    for line in split_lines(bytes) {
        if line.is_empty() {
            continue;
        }
        let Some(tab) = line.iter().position(|byte| *byte == b'\t') else {
            return Err(CoreError::output_unparsable(
                REMOTE_FORMAT,
                "expected <name>\\t<url> (<kind>) per line",
            ));
        };
        if tab == 0 {
            return Err(CoreError::output_unparsable(
                REMOTE_FORMAT,
                "expected <name>\\t<url> (<kind>) per line",
            ));
        }
        let name = decode_ascii(&line[..tab], REMOTE_FORMAT)?;
        let rest = &line[tab + 1..];
        let (kind, url_end) = if has_suffix(rest, b" (fetch)") {
            (RemoteUrlKind::Fetch, rest.len() - " (fetch)".len())
        } else if has_suffix(rest, b" (push)") {
            (RemoteUrlKind::Push, rest.len() - " (push)".len())
        } else {
            return Err(CoreError::output_unparsable(
                REMOTE_FORMAT,
                "a remote line did not end with (fetch) or (push)",
            ));
        };
        records.push(RemoteUrlRecord {
            name,
            // Latin-1, not UTF-8: the reference maps each byte to one code unit, so a
            // URL that is not valid UTF-8 still displays byte for byte.
            url: latin1(&rest[..url_end]),
            kind,
        });
    }
    Ok(records)
}

/* -------------------------------------------------------------------- presence */

/// Which of the requested names Git answered for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectPresence {
    /// Names Git reported as present, in the order they were requested.
    pub present: Vec<String>,
    /// Names Git reported as missing.
    pub missing: Vec<String>,
}

/// Parse `cat-file --batch-check=%(objectname)` output.
///
/// A present object prints its own name; a missing one prints `<input> missing`. The
/// answer is presence only — no body is transferred. `requested` is the fallback name
/// for a answered line that carries none, exactly as the reference uses it.
pub fn parse_object_presence(
    bytes: &[u8],
    requested: &[&str],
) -> Result<ObjectPresence, CoreError> {
    let mut present = Vec::new();
    let mut missing = Vec::new();
    let lines: Vec<&[u8]> = split_lines(bytes)
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect();
    for (index, line) in lines.iter().enumerate() {
        let text = decode_ascii(line, PRESENCE_FORMAT)?;
        if let Some(name) = text.strip_suffix(" missing") {
            missing.push(name.to_string());
            continue;
        }
        let oid = text.split(' ').next().unwrap_or_default();
        let fallback = requested.get(index).copied().unwrap_or_default();
        present.push(if oid.is_empty() {
            fallback.to_string()
        } else {
            oid.to_string()
        });
    }
    Ok(ObjectPresence { present, missing })
}

/* ------------------------------------------------------------------- topology */

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

/// The `\n`-separated lines of a Git line format.
fn split_lines(bytes: &[u8]) -> Vec<&[u8]> {
    split_on_byte(bytes, b'\n')
}

/// True when `bytes` ends with an ASCII suffix.
fn has_suffix(bytes: &[u8], suffix: &[u8]) -> bool {
    bytes.len() >= suffix.len() && &bytes[bytes.len() - suffix.len()..] == suffix
}

/// One character per byte, so a value that is not valid UTF-8 survives as text.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| char::from(*byte)).collect()
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

    #[test]
    fn reads_a_fetch_and_a_push_url_of_the_same_remote() {
        let records = parse_remote_list(
            b"origin\thttps://example.test/refyard.git (fetch)\norigin\tgit@example.test:refyard.git (push)\n",
        )
        .expect("remotes");
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].name, "origin");
        assert_eq!(records[0].url, "https://example.test/refyard.git");
        assert_eq!(records[0].kind, RemoteUrlKind::Fetch);
        assert_eq!(records[1].kind, RemoteUrlKind::Push);
        assert_eq!(records[1].url, "git@example.test:refyard.git");
    }

    #[test]
    fn a_remote_url_that_is_not_utf8_still_decodes_byte_for_byte() {
        // The host redacts a credential before display and never uses the URL as an
        // argument, so the requirement here is only that no byte is lost.
        let records =
            parse_remote_list(b"odd\thttps://example.test/caf\xe9.git (fetch)\n").expect("remotes");
        assert_eq!(records[0].url, "https://example.test/caf\u{e9}.git");
    }

    #[test]
    fn refuses_a_remote_line_without_a_kind() {
        // Without the suffix there is no way to tell a fetch URL from a push URL, and
        // guessing would show the user the wrong endpoint for a push.
        let error =
            parse_remote_list(b"origin\thttps://example.test/x.git\n").expect_err("no kind");
        assert!(error.to_string().contains("(fetch)"));
    }

    #[test]
    fn refuses_a_remote_line_with_no_tab_separator() {
        let error =
            parse_remote_list(b"origin https://example.test/x.git (fetch)\n").expect_err("no tab");
        assert!(matches!(error, CoreError::OutputUnparsable { .. }));
    }

    #[test]
    fn reads_which_of_the_requested_names_git_answered_for() {
        let requested = ["aaaa", "bbbb", "cccc"];
        let bytes = b"aaaa\nbbbb missing\ncccc\n";
        let presence = parse_object_presence(bytes, &requested).expect("presence");
        assert_eq!(
            presence.present,
            vec!["aaaa".to_string(), "cccc".to_string()]
        );
        assert_eq!(presence.missing, vec!["bbbb".to_string()]);
    }

    #[test]
    fn a_presence_line_with_no_name_falls_back_to_what_was_asked() {
        // `cat-file --batch-check=%(objectname)` prints the name, but a Git that
        // answered with an empty field must still be attributed to a request rather
        // than dropped.
        let presence = parse_object_presence(b" \n", &["aaaa"]).expect("presence");
        assert_eq!(presence.present, vec!["aaaa".to_string()]);
    }

    #[test]
    fn an_empty_presence_answer_is_an_empty_result() {
        // A batch that asked nothing prints nothing, and that is not a failure.
        let presence = parse_object_presence(b"", &[]).expect("presence");
        assert!(presence.present.is_empty());
        assert!(presence.missing.is_empty());
    }
}
