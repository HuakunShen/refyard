//! Parsing `git fetch --porcelain` (and the shared object-name shape) into per-ref
//! outcomes.
//!
//! The porcelain table is one line per ref: `<flag> <old-oid> <new-oid> <local-ref>`.
//! The flag is a *single character* and is usually a space (fast-forward), so the line
//! often begins with two spaces and splitting on runs of whitespace would lose the flag
//! — the parse keys off `line[1] == ' '` instead. A line that does not fit the shape is
//! kept as a diagnostic rather than dropped or guessed at: "what did this fetch touch"
//! is only ever what the bytes show.

/// One ref a fetch named: its flag, the object names before and after, and the local
/// ref it landed in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchRefResult {
    /// The porcelain flag: `=` up to date, ` ` fast-forward, `+` forced, `-` deleted,
    /// `*` created.
    pub flag: u8,
    pub old_oid: String,
    pub new_oid: String,
    pub local_ref: String,
}

impl FetchRefResult {
    /// Did this ref actually move? `=` is "up to date", which changed nothing.
    pub fn moved(&self) -> bool {
        self.flag != b'='
    }
}

/// The whole `--porcelain` table: the refs it named, plus any line that did not fit the
/// format (kept as diagnostics rather than silently discarded).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FetchParseResult {
    pub refs: Vec<FetchRefResult>,
    pub diagnostics: Vec<String>,
}

/// A SHA-1 (40 hex) or SHA-256 (64 hex) object name, including the all-zero name Git
/// prints for a created or deleted ref's non-existent end.
fn is_oid_or_zero(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64) && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Parse `git fetch --porcelain` stdout. Byte-level: the delimiters are ASCII, and a
/// field is only a field if its bytes are exactly an object name or a `refs/` name.
pub fn parse_fetch_porcelain(bytes: &[u8]) -> FetchParseResult {
    let mut result = FetchParseResult::default();
    for mut line in bytes.split(|b| *b == b'\n') {
        if line.last() == Some(&b'\r') {
            line = &line[..line.len() - 1];
        }
        if line.is_empty() {
            continue;
        }
        // `<flag> <space> …` — the flag is one byte and the separator one space.
        if line.len() > 2 && line[1] == b' ' {
            let flag = line[0];
            let parts: Vec<&[u8]> = line[2..].split(|b| *b == b' ').collect();
            if parts.len() == 3 {
                let old_oid = std::str::from_utf8(parts[0]).unwrap_or("");
                let new_oid = std::str::from_utf8(parts[1]).unwrap_or("");
                let local_ref = std::str::from_utf8(parts[2]).unwrap_or("");
                if is_oid_or_zero(old_oid)
                    && is_oid_or_zero(new_oid)
                    && local_ref.starts_with("refs/")
                {
                    result.refs.push(FetchRefResult {
                        flag,
                        old_oid: old_oid.to_string(),
                        new_oid: new_oid.to_string(),
                        local_ref: local_ref.to_string(),
                    });
                    continue;
                }
            }
        }
        result
            .diagnostics
            .push(String::from_utf8_lossy(line).to_string());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO: &str = "0000000000000000000000000000000000000000";
    const OLD: &str = "1111111111111111111111111111111111111111";
    const NEW: &str = "2222222222222222222222222222222222222222";

    #[test]
    fn the_flag_is_one_byte_even_when_it_is_a_space() {
        // A fast-forward line starts with *two* spaces; splitting on whitespace runs
        // would eat the flag and shift every field. This is the bug the shape guards.
        let table = format!("  {OLD} {NEW} refs/remotes/origin/main\n");
        let parsed = parse_fetch_porcelain(table.as_bytes());
        assert_eq!(parsed.refs.len(), 1, "{:?}", parsed.diagnostics);
        let r = &parsed.refs[0];
        assert_eq!(r.flag, b' ', "the flag is the leading space");
        assert_eq!(r.old_oid, OLD);
        assert_eq!(r.new_oid, NEW);
        assert_eq!(r.local_ref, "refs/remotes/origin/main");
        assert!(r.moved());
    }

    #[test]
    fn each_flag_shape_parses_and_up_to_date_counts_as_unchanged() {
        let table = format!(
            "* {ZERO} {NEW} refs/tags/v1\n+ {OLD} {NEW} refs/heads/main\n- {OLD} {ZERO} refs/heads/gone\n= {OLD} {OLD} refs/heads/same\n"
        );
        let parsed = parse_fetch_porcelain(table.as_bytes());
        assert_eq!(parsed.refs.len(), 4, "{:?}", parsed.diagnostics);
        assert!(parsed.refs[0].moved(), "a created ref moved");
        assert!(parsed.refs[1].moved(), "a forced update moved");
        assert!(parsed.refs[2].moved(), "a deletion moved");
        assert!(!parsed.refs[3].moved(), "`=` is up to date: nothing moved");
    }

    #[test]
    fn a_line_that_is_not_the_shape_is_a_diagnostic_never_a_ref() {
        let table = format!(
            "From https://example.com/r\n * [new branch]      main -> origin/main\n  {OLD} {NEW} refs/remotes/origin/main\n"
        );
        let parsed = parse_fetch_porcelain(table.as_bytes());
        assert_eq!(parsed.refs.len(), 1, "only the well-formed ref line parsed");
        assert_eq!(parsed.diagnostics.len(), 2, "the other two lines are kept");
    }

    #[test]
    fn an_object_name_is_40_or_64_hex_and_nothing_else() {
        assert!(is_oid_or_zero(OLD));
        assert!(is_oid_or_zero(ZERO));
        assert!(is_oid_or_zero(&"a".repeat(64)));
        assert!(!is_oid_or_zero("abc"));
        assert!(!is_oid_or_zero(&"a".repeat(39)));
        assert!(!is_oid_or_zero(&"z".repeat(40)));
    }
}
