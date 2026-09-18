//! Lexing SSH client configuration text into lines, without evaluating it.
//!
//! This is the half of the listing that never touches a file: text in, lines out. It
//! follows OpenSSH's own reader where the details are observable — keywords compared
//! case-insensitively, a value after `=` accepted, both `"` and `'` quoting an argument,
//! and a `#` starting a comment only when it begins a token — and it refuses text it
//! cannot read rather than guessing at it.
//!
//! Nothing here is conditional: a `Match exec "…"` line is a keyword and an argument like
//! any other. The only thing this module concludes about `Match` is that it opens a
//! conditional block, which a later line's `Host` or `Match` keyword ends; that fact is
//! carried on each line so the source walker can refuse to treat an `Include` inside a
//! match as an unconditional one.

use std::path::PathBuf;

/// One configuration line: a keyword and its unquoted arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigLine {
    /// The keyword as written, before case folding; the caller compares it
    /// case-insensitively.
    pub keyword: String,
    /// The arguments as written, with quoting removed, in order.
    pub arguments: Vec<String>,
    /// True when this line sits in a `Match` block rather than a `Host` block.
    ///
    /// `Host` and `Match` each open a block and end the other. An `Include` in a `Match`
    /// block is read by OpenSSH only when that match is evaluated, so the walker must
    /// report it rather than expand it unconditionally.
    pub in_match_block: bool,
}

/// Why a configuration file could not be read.
///
/// Every variant names a condition the walker turns into either a warning or a refusal,
/// so there is one vocabulary for "the walk stopped here" instead of a second error type
/// beside the contract's `Problem`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    /// A quote opened on this line was never closed.
    #[error("line {line}: a quoted argument is not closed")]
    UnterminatedQuote { line: usize },
    /// A file the configuration names could not be read.
    #[error("{}: {}", path.display(), message)]
    UnreadableFile {
        path: PathBuf,
        kind: std::io::ErrorKind,
        message: String,
    },
    /// An `Include` chain returned to a file that is still open.
    #[error("{}: an Include chain returns to this file", path.display())]
    IncludeCycle { path: PathBuf },
    /// A walk budget ran out.
    #[error("{limit} limit of {value} exceeded")]
    LimitExceeded { limit: &'static str, value: usize },
    /// An `Include` path that cannot be enumerated by reading files.
    #[error("{path}: Include cannot be enumerated ({reason})")]
    UnenumerableInclude { path: String, reason: &'static str },
    /// A file whose bytes are not text this host can name hosts from.
    #[error("{}: not valid UTF-8", path.display())]
    NotUtf8 { path: PathBuf },
}

/// Splits configuration text into lines, each carrying the block it belongs to.
///
/// Empty lines and comments are dropped. A line whose keyword is empty (as in a stray
/// `=value`) is dropped too: it cannot be a `Host` line, and refusing the whole file over
/// it would hide candidates that are plainly there.
pub fn lines(text: &str) -> Result<Vec<ConfigLine>, ConfigError> {
    let mut parsed = Vec::new();
    let mut in_match_block = false;
    for (index, raw) in text.split('\n').enumerate() {
        let line_number = index + 1;
        // A file written on a Windows machine ends its lines with `\r\n`; the carriage
        // return is not part of any argument.
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let tokens = tokenize(raw, line_number)?;
        let Some((first, rest)) = tokens.split_first() else {
            continue;
        };
        let (keyword, attached) = split_keyword(first);
        if keyword.is_empty() {
            continue;
        }
        let mut arguments = Vec::with_capacity(rest.len() + 1);
        if let Some(attached) = attached {
            arguments.push(attached);
        }
        arguments.extend(rest.iter().cloned());
        drop_separator_equals(&mut arguments);
        if keyword.eq_ignore_ascii_case("host") {
            in_match_block = false;
        } else if keyword.eq_ignore_ascii_case("match") {
            in_match_block = true;
        }
        parsed.push(ConfigLine {
            keyword,
            arguments,
            in_match_block,
        });
    }
    Ok(parsed)
}

/// The concrete aliases the text declares, in file order, without duplicates.
///
/// A pattern is concrete when it names a machine rather than a rule: no `*` or `?`
/// wildcard, no leading `!` negation, and no `%` token that OpenSSH would expand. A line
/// may mix the two kinds — `Host prod *.corp !blocked` contributes `prod` only — and a
/// `Host` line with no options at all still names a candidate, because the person who
/// wrote it means to reach it.
pub fn concrete_aliases(text: &str) -> Result<Vec<String>, ConfigError> {
    let mut aliases = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in lines(text)? {
        if !line.keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for pattern in &line.arguments {
            let Some(alias) = concrete_pattern(pattern) else {
                continue;
            };
            if seen.insert(alias.to_string()) {
                aliases.push(alias.to_string());
            }
        }
    }
    Ok(aliases)
}

/// The pattern as a candidate name, when it is concrete.
pub(crate) fn concrete_pattern(pattern: &str) -> Option<&str> {
    if pattern.is_empty() || pattern.starts_with('!') {
        return None;
    }
    if pattern.contains(['*', '?', '%']) {
        return None;
    }
    Some(pattern)
}

/// Drops the optional `=` that may stand before the first argument.
///
/// `Host = prod` and `Host =prod` both name `prod`, as OpenSSH's reader reads them; only
/// a `=` before the first argument is a separator, so `Host prod a=b` still has `a=b` as
/// a pattern.
fn drop_separator_equals(arguments: &mut Vec<String>) {
    match arguments.first_mut() {
        Some(first) if first == "=" => {
            arguments.remove(0);
        }
        Some(first) if first.starts_with('=') && first.len() > 1 => {
            *first = first.chars().skip(1).collect();
        }
        _ => {}
    }
}

/// Splits `keyword=value`. OpenSSH accepts the value attached with an `=`, and the rest
/// of the line continues to be read as further arguments.
fn split_keyword(token: &str) -> (String, Option<String>) {
    match token.split_once('=') {
        Some((keyword, value)) => (keyword.to_string(), Some(value.to_string())),
        None => (token.to_string(), None),
    }
}

/// Splits one line into unquoted arguments.
///
/// A quote toggles quoting wherever it appears, so a quoted segment may be part of a
/// larger argument; inside quotes, a backslash escapes the quote character or another
/// backslash, and every other byte is literal. Outside quotes a backslash is a literal
/// character, because a path on a platform that separates with `\` must survive being
/// written down.
fn tokenize(line: &str, line_number: usize) -> Result<Vec<String>, ConfigError> {
    let characters: Vec<char> = line.chars().collect();
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if let Some(open) = quote {
            let escaped = character == '\\'
                && matches!(characters.get(index + 1), Some(next) if *next == open || *next == '\\');
            if escaped {
                if let Some(next) = characters.get(index + 1) {
                    current.push(*next);
                }
                index += 2;
                continue;
            }
            if character == open {
                quote = None;
            } else {
                current.push(character);
            }
            index += 1;
            continue;
        }
        // OpenSSH's reader skips a comment only when `#` begins a token. A `#` inside a
        // token is part of the value, and a configuration that uses one as a hostname
        // must be listed by that name.
        if character == '#' && current.is_empty() {
            break;
        }
        if character == '"' || character == '\'' {
            quote = Some(character);
            index += 1;
            continue;
        }
        if character.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            index += 1;
            continue;
        }
        current.push(character);
        index += 1;
    }
    if quote.is_some() {
        // The rest of the line is inside a quote that never closed, so where an argument
        // ends is not knowable from the text.
        return Err(ConfigError::UnterminatedQuote { line: line_number });
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hash_inside_a_token_is_literal_but_a_hash_at_a_token_start_is_a_comment() {
        // OpenSSH skips a comment only when `#` begins a token, so `foo#bar` is a name.
        assert_eq!(
            concrete_aliases("Host foo#bar\n").expect("lexes"),
            vec!["foo#bar"]
        );
        assert_eq!(
            concrete_aliases("Host foo #bar\n").expect("lexes"),
            vec!["foo"]
        );
        assert_eq!(
            concrete_aliases("# Host commented\n").expect("lexes"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_hash_inside_quotes_is_not_a_comment() {
        assert_eq!(
            concrete_aliases("Host \"a#b\"\n").expect("lexes"),
            vec!["a#b"]
        );
    }

    #[test]
    fn quotes_are_removed_and_may_contain_spaces() {
        assert_eq!(
            concrete_aliases("Host \"two words\" 'and more'\n").expect("lexes"),
            vec!["two words", "and more"]
        );
    }

    #[test]
    fn an_escaped_quote_does_not_end_the_argument() {
        assert_eq!(
            concrete_aliases("Host \"a\\\"b\"\n").expect("lexes"),
            vec!["a\"b"]
        );
    }

    #[test]
    fn an_unterminated_quote_is_refused() {
        // The rest of the line is inside the quote, so the argument's end is not in the
        // text; a listing that guessed would name a host the file does not name.
        assert_eq!(
            concrete_aliases("Host \"prod\n").expect_err("unterminated"),
            ConfigError::UnterminatedQuote { line: 1 }
        );
    }

    #[test]
    fn a_match_line_marks_the_lines_that_follow_it() {
        let parsed = lines("Host a\nMatch host b\n    User c\nHost d\n").expect("lexes");
        let blocks: Vec<(String, bool)> = parsed
            .iter()
            .map(|line| (line.keyword.clone(), line.in_match_block))
            .collect();
        assert_eq!(
            blocks,
            vec![
                ("Host".to_string(), false),
                ("Match".to_string(), true),
                ("User".to_string(), true),
                ("Host".to_string(), false),
            ],
            "a Host line ends a Match block, and a Match line ends a Host block"
        );
    }

    #[test]
    fn a_value_attached_with_equals_is_the_first_argument() {
        let parsed = lines("Host=left right\n").expect("lexes");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].keyword, "Host");
        assert_eq!(parsed[0].arguments, vec!["left", "right"]);
    }

    #[test]
    fn a_spaced_equals_is_a_separator_not_a_pattern() {
        // `Host = prod` and `Host =prod` both name `prod` in OpenSSH's reader; only a
        // later `=` (as in `a=b`) is part of the value.
        assert_eq!(
            concrete_aliases("Host = eqspaced\nHost =attached\nHost a=b\n").expect("lexes"),
            vec!["eqspaced", "attached", "a=b"]
        );
    }

    #[test]
    fn percent_tokens_are_not_candidates_even_when_doubled() {
        // `%%` expands to a literal `%` in OpenSSH; an alias is not a place to keep a
        // token that has to be interpreted later.
        assert!(concrete_aliases("Host %%literal\n")
            .expect("lexes")
            .is_empty());
    }
}
