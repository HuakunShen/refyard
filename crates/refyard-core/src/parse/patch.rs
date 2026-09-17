//! Unified-diff patch parser.
//!
//! A patch is the one format here that is *grammar*, not a field list: headers, hunks
//! and line prefixes all carry meaning, and the parser has to preserve what the UI
//! needs to render and what a review needs to trust:
//!
//! - line endings survive (`\r` stays in the line text),
//! - `\ No newline at end of file` is attached to the line it follows rather than
//!   dropped,
//! - a binary change is reported as binary, and a mode-only change has hunks but no
//!   content,
//! - a submodule change is reported with its three object names instead of a fake
//!   patch,
//! - and running past a size or line bound is reported as *truncated*, never as a
//!   complete patch.
//!
//! Header paths are parsed for diagnostics and cross-checking only. The identity of a
//! changed path comes from `--name-status`/`--raw` output, because a header path is
//! quoted and escaped text that cannot represent every byte path faithfully — using it
//! as the identity is how a diff ends up attached to the wrong file.
//!
//! One deliberate difference from the TypeScript reference: when a bound cuts the
//! patch inside a hunk, the hunk in progress is **dropped** rather than flushed with
//! the lines parsed so far. The reference's own contract says the same ("a hunk in
//! progress at the cut is discarded") while its code flushes it; a half hunk rendered
//! as a complete one is exactly the failure this parser exists to prevent, so the
//! documented behaviour is the one implemented here. `truncated: true` is the signal,
//! and a file whose only hunk was cut therefore carries no hunks.

use crate::bytes::is_object_name;
use crate::problem::CoreError;

const PATCH_FORMAT: &str = "diff patch";
const NO_NEWLINE_MARKER: &str = "\\ No newline at end of file";
const GITLINK_MODE: &str = "160000";

/// Bound on one file's patch, in bytes.
///
/// This is `CORE_LIMITS.patchMaxBytesPerFile` from the published limits; it is
/// duplicated rather than imported because core has no contract runtime to import it
/// from. Reaching it makes the result `truncated`, never complete.
pub const PATCH_MAX_BYTES_PER_FILE: usize = 2 * 1024 * 1024;

/// Bound on one file's patch, in lines. This is `CORE_LIMITS.patchMaxLinesPerFile`.
pub const PATCH_MAX_LINES_PER_FILE: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatchLineKind {
    Context,
    Add,
    Remove,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchLine {
    pub kind: PatchLineKind,
    /// Line content *without* the leading marker character.
    pub text: String,
    /// True when this line is followed by `\ No newline at end of file`.
    pub no_newline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunk {
    pub header: String,
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<PatchLine>,
}

/// The body of one file's patch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilePatchBody {
    Text {
        hunks: Vec<PatchHunk>,
    },
    Binary,
    Submodule {
        old_oid: Option<String>,
        new_oid: Option<String>,
    },
    ModeOnly {
        old_mode: Option<String>,
        new_mode: Option<String>,
    },
    /// A body the producer refused to render textually. `parse_patch` never creates
    /// this: it is the shape a caller uses for a body it cannot produce, so that
    /// "unknown" cannot be misread as "empty".
    Unavailable {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HeaderPaths {
    pub old: Option<String>,
    pub new: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedFilePatch {
    /// Path as written in the `diff --git`/`---`/`+++` headers. Diagnostics only.
    pub header_paths: HeaderPaths,
    pub old_mode: Option<String>,
    pub new_mode: Option<String>,
    pub is_new: bool,
    pub is_deleted: bool,
    pub is_rename: bool,
    pub similarity: Option<u64>,
    pub body: FilePatchBody,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsePatchResult {
    pub files: Vec<ParsedFilePatch>,
    /// True when a bound stopped parsing early: the result is not the whole patch.
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ParsePatchOptions {
    pub max_bytes: Option<usize>,
    pub max_lines: Option<usize>,
}

/// Work-in-progress state for one file. Mirrors the reference's mutable record; the
/// `modeOnly` flag the reference carries is never read there, so it is not carried
/// here.
#[derive(Debug, Default)]
struct MutableFile {
    header_paths: HeaderPaths,
    old_mode: Option<String>,
    new_mode: Option<String>,
    is_new: bool,
    is_deleted: bool,
    is_rename: bool,
    similarity: Option<u64>,
    hunks: Vec<PatchHunk>,
    binary: bool,
    submodule: bool,
    recorded_oid: Option<String>,
    index_oid: Option<String>,
    unavailable_reason: Option<String>,
}

/// Parse a full patch buffer.
pub fn parse_patch(
    bytes: &[u8],
    options: ParsePatchOptions,
) -> Result<ParsePatchResult, CoreError> {
    let max_bytes = options.max_bytes.unwrap_or(PATCH_MAX_BYTES_PER_FILE);
    let max_lines = options.max_lines.unwrap_or(PATCH_MAX_LINES_PER_FILE);
    let mut files: Vec<ParsedFilePatch> = Vec::new();
    let mut current: Option<MutableFile> = None;
    let mut current_hunk: Option<PatchHunk> = None;
    let mut truncated = false;
    let mut line_count = 0usize;

    for line_bytes in split_lines(bytes) {
        line_count += 1;
        if line_count > max_lines || line_bytes.len() > max_bytes {
            truncated = true;
            break;
        }
        let line = decode_line(line_bytes);

        if line.starts_with("diff --git ") {
            flush_hunk(&mut current, &mut current_hunk);
            flush_file(&mut files, current.take());
            current = Some(MutableFile::default());
            continue;
        }
        let Some(file) = current.as_mut() else {
            // Leading output that is not a diff (a warning, say) is ignored rather
            // than treated as a file; `git diff` prints nothing else on a clean tree.
            continue;
        };

        if line.starts_with("index ") {
            if let Some(mode) = parse_index_mode(&line) {
                if file.old_mode.is_none() {
                    file.old_mode = Some(mode.to_string());
                }
                if file.new_mode.is_none() {
                    file.new_mode = Some(mode.to_string());
                }
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("old mode ") {
            file.old_mode = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("new mode ") {
            file.new_mode = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("new file mode ") {
            file.is_new = true;
            file.new_mode = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("deleted file mode ") {
            file.is_deleted = true;
            file.old_mode = Some(value.trim().to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("similarity index ") {
            file.similarity = value.replacen('%', "", 1).trim().parse::<u64>().ok();
            file.is_rename = true;
            continue;
        }
        if let Some(value) = line.strip_prefix("rename from ") {
            file.is_rename = true;
            file.header_paths.old = Some(value.to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("rename to ") {
            file.is_rename = true;
            file.header_paths.new = Some(value.to_string());
            continue;
        }
        if let Some(value) = line.strip_prefix("--- ") {
            file.header_paths.old = Some(strip_path_prefix(value));
            continue;
        }
        if let Some(value) = line.strip_prefix("+++ ") {
            file.header_paths.new = Some(strip_path_prefix(value));
            continue;
        }
        if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            file.binary = true;
            continue;
        }
        if let Some(value) = line.strip_prefix("Subproject commit ") {
            file.submodule = true;
            let oid = value.trim();
            if is_object_name(oid.as_bytes()) {
                if file.recorded_oid.is_none() {
                    file.recorded_oid = Some(oid.to_string());
                } else {
                    file.index_oid = Some(oid.to_string());
                }
            }
            continue;
        }
        if line.starts_with("@@") {
            flush_hunk(&mut current, &mut current_hunk);
            let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(&line)
            else {
                return Err(CoreError::output_unparsable(
                    PATCH_FORMAT,
                    format!("unrecognised hunk header '{line}'"),
                ));
            };
            current_hunk = Some(PatchHunk {
                header: line,
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
            continue;
        }

        if current_hunk.is_some() {
            if line == NO_NEWLINE_MARKER {
                // The marker applies to the line just read, so it annotates that line
                // instead of becoming one of its own.
                if let Some(hunk) = current_hunk.as_mut() {
                    let Some(previous) = hunk.lines.last_mut() else {
                        return Err(CoreError::output_unparsable(
                            PATCH_FORMAT,
                            "'no newline' marker with no preceding line",
                        ));
                    };
                    previous.no_newline = true;
                }
                continue;
            }
            let kind = match line.as_bytes().first().copied() {
                Some(b'+') => Some(PatchLineKind::Add),
                Some(b'-') => Some(PatchLineKind::Remove),
                Some(b' ') | None => Some(PatchLineKind::Context),
                Some(_) => None,
            };
            match kind {
                Some(kind) => {
                    let text = if line.is_empty() {
                        String::new()
                    } else {
                        line[1..].to_string()
                    };
                    if let Some(hunk) = current_hunk.as_mut() {
                        hunk.lines.push(PatchLine {
                            kind,
                            text,
                            no_newline: false,
                        });
                    }
                }
                // Anything else ends the hunk; the reference drops such a line rather
                // than guessing a kind for it, and the lines after it are handled by
                // the branches above.
                None => flush_hunk(&mut current, &mut current_hunk),
            }
            continue;
        }
    }

    if !truncated {
        flush_hunk(&mut current, &mut current_hunk);
    }
    // When the bound cut the patch, the hunk in progress is simply not flushed and is
    // dropped with this frame; see the module documentation.
    flush_file(&mut files, current.take());

    Ok(ParsePatchResult { files, truncated })
}

/// Push the hunk in progress onto its file, if both exist.
fn flush_hunk(current: &mut Option<MutableFile>, current_hunk: &mut Option<PatchHunk>) {
    if let Some(hunk) = current_hunk.take() {
        if let Some(file) = current.as_mut() {
            file.hunks.push(hunk);
        }
    }
}

/// Close the file in progress.
fn flush_file(files: &mut Vec<ParsedFilePatch>, current: Option<MutableFile>) {
    let Some(file) = current else {
        return;
    };
    files.push(into_patch(file));
}

fn into_patch(file: MutableFile) -> ParsedFilePatch {
    // A gitlink change is a hunk whose content is the submodule's commit line. Git
    // renders it as a one-line text hunk, which is exactly the shape that would be
    // shown to a user as a fake file edit if it were not recognised as a submodule.
    let is_submodule = file.submodule
        || file.old_mode.as_deref() == Some(GITLINK_MODE)
        || file.new_mode.as_deref() == Some(GITLINK_MODE);
    let body = if file.binary {
        FilePatchBody::Binary
    } else if is_submodule {
        let mut old_oid = file.recorded_oid;
        let mut new_oid = file.index_oid;
        for hunk in &file.hunks {
            for line in &hunk.lines {
                let Some(oid) = line
                    .text
                    .strip_prefix("Subproject commit ")
                    .filter(|text| is_object_name(text.as_bytes()))
                else {
                    continue;
                };
                match line.kind {
                    PatchLineKind::Remove => {
                        if old_oid.is_none() {
                            old_oid = Some(oid.to_string());
                        }
                    }
                    PatchLineKind::Add => {
                        if new_oid.is_none() {
                            new_oid = Some(oid.to_string());
                        }
                    }
                    PatchLineKind::Context => {}
                }
            }
        }
        FilePatchBody::Submodule { old_oid, new_oid }
    } else if let Some(reason) = file.unavailable_reason {
        FilePatchBody::Unavailable { reason }
    } else if file.hunks.is_empty() {
        FilePatchBody::ModeOnly {
            old_mode: file.old_mode.clone(),
            new_mode: file.new_mode.clone(),
        }
    } else {
        FilePatchBody::Text { hunks: file.hunks }
    };

    ParsedFilePatch {
        header_paths: file.header_paths,
        old_mode: file.old_mode,
        new_mode: file.new_mode,
        is_new: file.is_new,
        is_deleted: file.is_deleted,
        is_rename: file.is_rename,
        similarity: file.similarity,
        body,
    }
}

/// `index <old>..<new>[ <mode>]`, returning the mode when Git printed one.
///
/// The mode from an index line is only a fallback: `old mode`/`new mode` lines, when
/// present, describe the change more precisely and are applied later in the stream.
fn parse_index_mode(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("index ")?;
    let (hashes, mode) = match rest.split_once(' ') {
        Some((hashes, mode)) => (hashes, Some(mode)),
        None => (rest, None),
    };
    let (old, new) = hashes.split_once("..")?;
    if !is_lower_hex(old) || !is_lower_hex(new) {
        return None;
    }
    let mode = mode?;
    if mode.is_empty() || !mode.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(mode)
}

fn is_lower_hex(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// `@@ -<oldStart>[,<oldLines>] +<newStart>[,<newLines>] @@<text>`.
///
/// A count that is absent means one line. That is Git's own rule and not a default
/// chosen here: `@@ -5 +6 @@` describes a single-line hunk on both sides.
fn parse_hunk_header(line: &str) -> Option<(usize, usize, usize, usize)> {
    let bytes = line.as_bytes();
    let mut index = 0usize;

    fn expect(bytes: &[u8], index: &mut usize, literal: &[u8]) -> bool {
        if bytes.len() < index.saturating_add(literal.len())
            || &bytes[*index..*index + literal.len()] != literal
        {
            return false;
        }
        *index += literal.len();
        true
    }

    fn number(bytes: &[u8], index: &mut usize) -> Option<usize> {
        let start = *index;
        let mut value: usize = 0;
        while *index < bytes.len() && bytes[*index].is_ascii_digit() {
            value = value
                .checked_mul(10)?
                .checked_add(usize::from(bytes[*index] - b'0'))?;
            *index += 1;
        }
        if *index == start {
            return None;
        }
        Some(value)
    }

    if !expect(bytes, &mut index, b"@@ -") {
        return None;
    }
    let old_start = number(bytes, &mut index)?;
    let old_lines = if expect(bytes, &mut index, b",") {
        number(bytes, &mut index)?
    } else {
        1
    };
    if !expect(bytes, &mut index, b" +") {
        return None;
    }
    let new_start = number(bytes, &mut index)?;
    let new_lines = if expect(bytes, &mut index, b",") {
        number(bytes, &mut index)?
    } else {
        1
    };
    if !expect(bytes, &mut index, b" @@") {
        return None;
    }
    Some((old_start, old_lines, new_start, new_lines))
}

/// Split on newlines, keeping `\r` (so CRLF content is not silently rewritten) and
/// dropping only the final empty element after a trailing newline.
fn split_lines(bytes: &[u8]) -> Vec<&[u8]> {
    let mut lines = Vec::new();
    let mut start = 0usize;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            lines.push(&bytes[start..index]);
            start = index + 1;
        }
    }
    if start < bytes.len() {
        lines.push(&bytes[start..]);
    }
    lines
}

/// Decode a line as UTF-8 with replacement; patch text is display material.
///
/// Core has no `TextDecoder` (it is a host global), so this decodes well-formed UTF-8
/// exactly and replaces invalid sequences — which is also what a terminal does.
/// Lone surrogates and code points beyond Unicode are replaced too; they have no Rust
/// string to be stored in, and no diff viewer would show them anyway.
fn decode_line(bytes: &[u8]) -> String {
    let mut text = String::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        let first = bytes[index];
        if first < 0x80 {
            text.push(char::from(first));
            index += 1;
            continue;
        }
        let (needed, mut code_point) = if (first & 0xe0) == 0xc0 {
            (1usize, u32::from(first & 0x1f))
        } else if (first & 0xf0) == 0xe0 {
            (2, u32::from(first & 0x0f))
        } else if (first & 0xf8) == 0xf0 {
            (3, u32::from(first & 0x07))
        } else {
            text.push('\u{FFFD}');
            index += 1;
            continue;
        };
        if index + needed >= bytes.len() {
            text.push('\u{FFFD}');
            break;
        }
        let mut valid = true;
        for offset in 1..=needed {
            let continuation = bytes[index + offset];
            if (continuation & 0xc0) != 0x80 {
                valid = false;
                break;
            }
            code_point = (code_point << 6) | u32::from(continuation & 0x3f);
        }
        if !valid {
            text.push('\u{FFFD}');
            index += 1;
            continue;
        }
        text.push(char::from_u32(code_point).unwrap_or('\u{FFFD}'));
        index += needed + 1;
    }
    text
}

/// Strip the `a/`/`b/` prefix and surrounding quotes git prints for odd paths.
///
/// A quoted token is unquoted first and the prefix is only recognised on an unquoted
/// one, which mirrors the reference exactly: for `+++ "b/odd name"` the header path
/// keeps its `b/`, and that is acceptable because the header path is diagnostics only.
fn strip_path_prefix(value: &str) -> String {
    if value == "/dev/null" {
        return value.to_string();
    }
    let without_prefix = match value
        .strip_prefix("a/")
        .or_else(|| value.strip_prefix("b/"))
    {
        Some(rest) => rest,
        None => value,
    };
    if without_prefix.len() > 1 && without_prefix.starts_with('"') && without_prefix.ends_with('"')
    {
        without_prefix[1..without_prefix.len() - 1].to_string()
    } else {
        without_prefix.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ParsePatchOptions {
        ParsePatchOptions::default()
    }

    fn text_hunks(body: &FilePatchBody) -> &[PatchHunk] {
        match body {
            FilePatchBody::Text { hunks } => hunks,
            other => panic!("expected a text body, found {other:?}"),
        }
    }

    #[test]
    fn parses_hunks_line_kinds_and_line_text() {
        let patch = [
            "diff --git a/base.txt b/base.txt",
            "index df967b9..07d44e5 100644",
            "--- a/base.txt",
            "+++ b/base.txt",
            "@@ -1 +1 @@",
            "-base",
            "+staged change",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        assert!(!result.truncated);
        assert_eq!(result.files.len(), 1);
        let file = &result.files[0];
        assert_eq!(file.old_mode.as_deref(), Some("100644"));
        assert_eq!(file.new_mode.as_deref(), Some("100644"));
        assert_eq!(file.header_paths.old.as_deref(), Some("base.txt"));
        assert_eq!(file.header_paths.new.as_deref(), Some("base.txt"));
        let hunks = text_hunks(&file.body);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 1);
        assert_eq!(
            hunks[0]
                .lines
                .iter()
                .map(|line| line.kind)
                .collect::<Vec<_>>(),
            vec![PatchLineKind::Remove, PatchLineKind::Add]
        );
        assert_eq!(hunks[0].lines[0].text, "base");
    }

    #[test]
    fn keeps_the_carriage_return_of_a_crlf_line() {
        // Rewriting a CRLF line to LF would make the displayed patch differ from the
        // file the user is about to commit.
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -1 +1 @@",
            "-a\r",
            "+b\r",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let lines = &text_hunks(&result.files[0].body)[0].lines;
        assert_eq!(lines[0].text, "a\r");
        assert_eq!(lines[1].text, "b\r");
    }

    #[test]
    fn attaches_the_no_newline_marker_to_the_line_it_follows() {
        // The marker describes the previous line. Appending it as a line of its own
        // would render one extra line that is not in either version of the file.
        let patch = [
            "diff --git a/f.txt b/f.txt",
            "index 1111111..2222222 100644",
            "--- a/f.txt",
            "+++ b/f.txt",
            "@@ -1 +1 @@",
            "-old",
            "\\ No newline at end of file",
            "+new",
            "\\ No newline at end of file",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let lines = &text_hunks(&result.files[0].body)[0].lines;
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines.iter().map(|line| line.no_newline).collect::<Vec<_>>(),
            vec![true, true]
        );
        assert_eq!(lines[0].text, "old");
    }

    #[test]
    fn marks_only_the_line_the_marker_follows() {
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -1,2 +1,2 @@",
            "-old",
            "\\ No newline at end of file",
            "+new",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let lines = &text_hunks(&result.files[0].body)[0].lines;
        assert_eq!(
            lines.iter().map(|line| line.no_newline).collect::<Vec<_>>(),
            vec![true, false]
        );
    }

    #[test]
    fn refuses_a_no_newline_marker_with_no_preceding_line() {
        // A marker before any line means the patch structure is not what it claims;
        // attaching it to nothing would lose the fact that a line is missing.
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -1 +1 @@",
            "\\ No newline at end of file",
            "",
        ]
        .join("\n");
        let error = parse_patch(patch.as_bytes(), options()).expect_err("stray marker");
        assert!(error.to_string().contains("no preceding line"));
    }

    #[test]
    fn reports_a_binary_change_as_binary_with_modes_but_no_hunks() {
        let patch = [
            "diff --git a/bin.dat b/bin.dat",
            "index 1111111..2222222 100644",
            "Binary files a/bin.dat and b/bin.dat differ",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        assert_eq!(result.files[0].body, FilePatchBody::Binary);
        assert_eq!(result.files[0].old_mode.as_deref(), Some("100644"));
    }

    #[test]
    fn reports_a_mode_only_change_as_mode_only_rather_than_as_an_empty_patch() {
        let patch = "diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n";
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        assert_eq!(
            result.files[0].body,
            FilePatchBody::ModeOnly {
                old_mode: Some("100644".to_string()),
                new_mode: Some("100755".to_string()),
            }
        );
    }

    #[test]
    fn reports_a_rename_without_content_as_a_mode_only_body_and_keeps_the_rename_flag() {
        // A 100% rename has no hunks; the caller needs `is_rename` and the header paths
        // to describe it, and must not read the empty body as "nothing changed".
        let patch = [
            "diff --git a/old b/new",
            "similarity index 100%",
            "rename from old",
            "rename to new",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let file = &result.files[0];
        assert!(file.is_rename);
        assert_eq!(file.similarity, Some(100));
        assert_eq!(file.header_paths.old.as_deref(), Some("old"));
        assert_eq!(file.header_paths.new.as_deref(), Some("new"));
        assert_eq!(
            file.body,
            FilePatchBody::ModeOnly {
                old_mode: None,
                new_mode: None
            }
        );
    }

    #[test]
    fn reports_a_submodule_change_with_its_object_names_instead_of_a_fake_patch() {
        let patch = [
            "diff --git a/vendor/sub b/vendor/sub",
            "index 1111111..2222222 160000",
            "--- a/vendor/sub",
            "+++ b/vendor/sub",
            "@@ -1 +1 @@",
            "-Subproject commit 0123456789abcdef0123456789abcdef01234567",
            "+Subproject commit 89abcdef0123456789abcdef0123456789abcdef",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        assert_eq!(
            result.files[0].body,
            FilePatchBody::Submodule {
                old_oid: Some("0123456789abcdef0123456789abcdef01234567".to_string()),
                new_oid: Some("89abcdef0123456789abcdef0123456789abcdef".to_string()),
            }
        );
    }

    #[test]
    fn refuses_an_unrecognised_hunk_header() {
        // A header this parser cannot read means the hunk line count is unknown, so
        // the lines after it must not be guessed into a hunk.
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ nonsense",
            "",
        ]
        .join("\n");
        let error = parse_patch(patch.as_bytes(), options()).expect_err("bad hunk header");
        assert!(error.to_string().contains("unrecognised hunk header"));
    }

    #[test]
    fn defaults_the_hunk_counts_to_one_when_git_omits_them() {
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -5 +6 @@ func",
            "-a",
            "+b",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let hunk = &text_hunks(&result.files[0].body)[0];
        assert_eq!((hunk.old_start, hunk.old_lines), (5, 1));
        assert_eq!((hunk.new_start, hunk.new_lines), (6, 1));
        assert_eq!(hunk.header, "@@ -5 +6 @@ func");
    }

    #[test]
    fn reports_truncation_and_drops_the_hunk_that_was_cut() {
        // A hunk with some of its lines is not a shorter hunk: rendering it would show
        // a diff that does not match any file. The cut hunk is dropped and the result
        // says `truncated`.
        let patch = [
            "diff --git a/f.txt b/f.txt",
            "index 1111111..2222222 100644",
            "--- a/f.txt",
            "+++ b/f.txt",
            "@@ -1,3 +1,3 @@",
            " one",
            "-two",
            "+TWO",
            " three",
            "",
        ]
        .join("\n");
        let result = parse_patch(
            patch.as_bytes(),
            ParsePatchOptions {
                max_lines: Some(6),
                ..ParsePatchOptions::default()
            },
        )
        .expect("patch");
        assert!(result.truncated);
        assert_eq!(result.files.len(), 1);
        assert_eq!(
            result.files[0].body,
            FilePatchBody::ModeOnly {
                old_mode: Some("100644".to_string()),
                new_mode: Some("100644".to_string()),
            }
        );
    }

    #[test]
    fn keeps_the_files_that_were_complete_before_the_bound_was_hit() {
        // Files before the cut are complete diffs and stay; only the one in progress
        // loses its unfinished hunk.
        let patch = [
            "diff --git a/a.txt b/a.txt",
            "--- a/a.txt",
            "+++ b/a.txt",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "diff --git a/b.txt b/b.txt",
            "--- a/b.txt",
            "+++ b/b.txt",
            "@@ -1,2 +1,2 @@",
            " keep",
            "-gone",
            "+GONE",
            "",
        ]
        .join("\n");
        let result = parse_patch(
            patch.as_bytes(),
            ParsePatchOptions {
                max_lines: Some(12),
                ..ParsePatchOptions::default()
            },
        )
        .expect("patch");
        assert!(result.truncated);
        assert_eq!(result.files.len(), 2);
        let first = &text_hunks(&result.files[0].body)[0];
        assert_eq!(
            first
                .lines
                .iter()
                .map(|line| &line.text)
                .collect::<Vec<_>>(),
            vec!["old", "new"]
        );
        assert_eq!(
            result.files[1].body,
            FilePatchBody::ModeOnly {
                old_mode: None,
                new_mode: None
            }
        );
    }

    #[test]
    fn reports_truncation_when_a_single_line_exceeds_the_byte_bound() {
        let long_line = "x".repeat(64);
        let patch = [
            "diff --git a/f b/f".to_string(),
            "--- a/f".to_string(),
            "+++ b/f".to_string(),
            "@@ -1 +1 @@".to_string(),
            format!("+{long_line}"),
            String::new(),
        ]
        .join("\n");
        let result = parse_patch(
            patch.as_bytes(),
            ParsePatchOptions {
                max_bytes: Some(32),
                ..ParsePatchOptions::default()
            },
        )
        .expect("patch");
        assert!(result.truncated);
    }

    #[test]
    fn a_stray_line_inside_a_hunk_ends_the_hunk_without_becoming_a_line() {
        // The reference ends the hunk at a line it cannot classify; inventing a kind
        // would put text into the patch that is not in either version.
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -1,2 +1,2 @@",
            " one",
            "ZARD",
            "-two",
            "+TWO",
            " three",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let hunks = text_hunks(&result.files[0].body);
        assert_eq!(hunks.len(), 1);
        assert_eq!(
            hunks[0]
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["one"]
        );
    }

    #[test]
    fn ignores_output_before_the_first_diff_header() {
        let result = parse_patch(b"warning: something\n", options()).expect("patch");
        assert!(result.files.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn an_empty_patch_is_a_complete_empty_answer() {
        let result = parse_patch(b"", options()).expect("patch");
        assert!(result.files.is_empty());
        assert!(!result.truncated);
    }

    #[test]
    fn keeps_the_dev_null_path_and_strips_an_unquoted_prefix() {
        let patch = [
            "diff --git a/f b/f",
            "new file mode 100644",
            "index 0000000..1111111",
            "--- /dev/null",
            "+++ b/f",
            "@@ -0,0 +1 @@",
            "+x",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let file = &result.files[0];
        assert!(file.is_new);
        assert_eq!(file.header_paths.old.as_deref(), Some("/dev/null"));
        assert_eq!(file.header_paths.new.as_deref(), Some("f"));
    }

    #[test]
    fn a_quoted_header_path_is_unquoted_but_keeps_its_prefix() {
        // Git quotes the whole token for a path with an awkward byte, and the reference
        // only strips the prefix when it is outside the quotes; the header path is
        // diagnostics, so this is preserved rather than "fixed".
        let patch = [
            "diff --git \"a/odd name\" \"b/odd name\"",
            "--- \"a/odd name\"",
            "+++ \"b/odd name\"",
            "@@ -1 +1 @@",
            "-a",
            "+b",
            "",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        assert_eq!(
            result.files[0].header_paths.new.as_deref(),
            Some("b/odd name")
        );
    }

    #[test]
    fn an_empty_line_inside_a_hunk_is_context_with_empty_text() {
        let patch = [
            "diff --git a/f b/f",
            "--- a/f",
            "+++ b/f",
            "@@ -1,2 +1,2 @@",
            "-a",
            "+b",
            "",
            " tail",
        ]
        .join("\n");
        let result = parse_patch(patch.as_bytes(), options()).expect("patch");
        let lines = &text_hunks(&result.files[0].body)[0].lines;
        assert_eq!(lines[2].kind, PatchLineKind::Context);
        assert_eq!(lines[2].text, "");
    }
}
