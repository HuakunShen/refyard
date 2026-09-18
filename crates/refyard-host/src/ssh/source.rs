//! Walking one SSH configuration source: the primary file and its unconditional Includes.
//!
//! This is a read of files and nothing else. It never runs `ssh`, never evaluates a
//! `Match`, and never executes what a configuration names — `Match exec` and
//! `ProxyCommand` are lines the lexer hands back and this walk ignores.
//!
//! Four rules decide what the candidate set means:
//!
//! - a relative `Include` path resolves against `include_base` (the user's SSH
//!   directory), not against the including file's directory: that is OpenSSH's rule, and
//!   resolving it any other way would read files OpenSSH never reads;
//! - the walk is bounded — 8 levels of Include, 128 files, 2 MiB — and a budget that runs
//!   out stops the walk and leaves a warning, because a silently short list is worse than
//!   an honest partial one;
//! - a cycle through the chain of open files stops that chain with a warning, and an
//!   `Include` that cannot be enumerated by reading files (inside a `Match`, carrying a
//!   `%` token, pointing at another user's home) is reported rather than guessed at;
//! - the revision fingerprints exactly the bytes that were read, in traversal order, so
//!   two listings agree when the files agree and disagree when one byte changes.

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use refyard_contract::host::HostWarning;
use sha2::{Digest, Sha256};

use super::config_lex::{concrete_pattern, lines, ConfigError, ConfigLine};

/// How many levels of `Include` a walk descends before it stops.
const DEFAULT_DEPTH: usize = 8;
/// How many files a walk reads before it stops.
const DEFAULT_FILES: usize = 128;
/// How many bytes of configuration a walk reads before it stops.
const DEFAULT_BYTES: usize = 2 * 1024 * 1024;
/// The longest warning message the contract's `HostWarning.message` allows.
const WARNING_MESSAGE_LIMIT: usize = 512;

/// One configuration source: the file the caller chose, and the directory relative
/// `Include` paths resolve against.
///
/// No revision here. A fingerprint describes bytes that were actually read, and this
/// struct exists before anything is read, so a `revision` field on it could only ever be
/// empty — the authoritative one is on the `SshHostList` a listing returns, where it
/// covers the whole source set including everything an `Include` pulled in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigSource {
    pub id: String,
    pub path: PathBuf,
    pub include_base: PathBuf,
}

/// The bounds one walk may spend, counted over the whole source set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IncludeLimits {
    pub depth: usize,
    pub files: usize,
    pub bytes: usize,
}

impl Default for IncludeLimits {
    fn default() -> Self {
        Self {
            depth: DEFAULT_DEPTH,
            files: DEFAULT_FILES,
            bytes: DEFAULT_BYTES,
        }
    }
}

/// What one walk of one source set produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SourceReading {
    pub aliases: Vec<String>,
    pub warnings: Vec<HostWarning>,
    pub incomplete: bool,
    pub revision: String,
}

/// Reads a source set, or reports why the primary file cannot be read at all.
///
/// A primary file that does not exist is not a failure: a machine with no SSH
/// configuration has no aliases, and saying so is the answer. Every problem below the
/// primary — an unreadable include, a cycle, a budget — is a warning inside an `Ok`
/// reading, because those leave a list that is useful and explicitly partial.
pub(crate) fn read_source(
    source: &ConfigSource,
    limits: IncludeLimits,
) -> Result<SourceReading, ConfigError> {
    let mut walk = Walk {
        include_base: &source.include_base,
        limits,
        hasher: Sha256::new(),
        aliases: Vec::new(),
        seen: HashSet::new(),
        warnings: Vec::new(),
        incomplete: false,
        files: 0,
        bytes: 0,
        chain: Vec::new(),
        stopped: false,
    };
    match std::fs::metadata(&source.path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(walk.finish()),
        Err(error) => return Err(unreadable(&source.path, &error)),
        Ok(_) => {}
    }
    walk.read_file(&source.path, 0)?;
    Ok(walk.finish())
}

/// One walk's state. Synchronous on purpose: the walk is a recursive depth-first read of
/// a few small files, and it runs on the blocking pool so a slow filesystem cannot stall
/// the async runtime.
struct Walk<'a> {
    include_base: &'a Path,
    limits: IncludeLimits,
    hasher: Sha256,
    aliases: Vec<String>,
    seen: HashSet<String>,
    warnings: Vec<HostWarning>,
    incomplete: bool,
    files: usize,
    bytes: usize,
    /// Canonical paths of the files currently open, for cycle detection.
    chain: Vec<PathBuf>,
    stopped: bool,
}

impl Walk<'_> {
    fn read_file(&mut self, path: &Path, depth: usize) -> Result<(), ConfigError> {
        if self.stopped {
            return Ok(());
        }
        if self.files >= self.limits.files {
            return Err(ConfigError::LimitExceeded {
                limit: "files",
                value: self.limits.files,
            });
        }
        // Stat before reading, so a file over the remaining budget is never brought into
        // memory at all; the check after the read covers a file that grew in between.
        let length = std::fs::metadata(path)
            .map(|metadata| metadata.len() as usize)
            .unwrap_or(0);
        if self.bytes.saturating_add(length) > self.limits.bytes {
            return Err(ConfigError::LimitExceeded {
                limit: "bytes",
                value: self.limits.bytes,
            });
        }
        let bytes = std::fs::read(path).map_err(|error| unreadable(path, &error))?;
        if self.bytes.saturating_add(bytes.len()) > self.limits.bytes {
            return Err(ConfigError::LimitExceeded {
                limit: "bytes",
                value: self.limits.bytes,
            });
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| ConfigError::NotUtf8 {
            path: path.to_path_buf(),
        })?;
        self.files += 1;
        self.bytes += bytes.len();
        self.hasher.update(&bytes);
        self.chain.push(canonical(path));
        match lines(text) {
            Err(error) => self.note(&error, false),
            Ok(parsed) => {
                for line in parsed {
                    if self.stopped {
                        break;
                    }
                    self.consume(line, depth);
                }
            }
        }
        self.chain.pop();
        Ok(())
    }

    /// Applies one line: a `Host` line contributes candidates, an unconditional `Include`
    /// recurses, and everything else is configuration this walk does not evaluate.
    fn consume(&mut self, line: ConfigLine, depth: usize) {
        if line.keyword.eq_ignore_ascii_case("host") {
            for pattern in &line.arguments {
                let Some(alias) = concrete_pattern(pattern) else {
                    continue;
                };
                if self.seen.insert(alias.to_string()) {
                    self.aliases.push(alias.to_string());
                }
            }
            return;
        }
        if !line.keyword.eq_ignore_ascii_case("include") {
            return;
        }
        if line.in_match_block {
            // OpenSSH reads this Include only when it evaluates the enclosing match, and
            // evaluating it is exactly what a listing may not do.
            self.note_unenumerable(&line.arguments.join(" "), "inside a Match block");
            return;
        }
        for argument in &line.arguments {
            if self.stopped {
                return;
            }
            self.include(argument, depth);
        }
    }

    fn include(&mut self, argument: &str, depth: usize) {
        let target = match resolve_include(argument, self.include_base) {
            Ok(target) => target,
            Err((path, reason)) => {
                self.note_unenumerable(&path, reason);
                return;
            }
        };
        let targets = if has_glob_magic(target.as_os_str()) {
            expand_glob(&target, self)
        } else {
            vec![target]
        };
        for path in targets {
            if self.stopped {
                return;
            }
            if depth + 1 > self.limits.depth {
                self.note(
                    &ConfigError::LimitExceeded {
                        limit: "depth",
                        value: self.limits.depth,
                    },
                    true,
                );
                return;
            }
            if self.chain.contains(&canonical(&path)) {
                // The file is already open above this one: reading it again would not
                // terminate, and not reading it leaves a list that says so.
                self.note(&ConfigError::IncludeCycle { path: path.clone() }, false);
                continue;
            }
            if let Err(error) = self.read_file(&path, depth + 1) {
                let stops_walk = matches!(error, ConfigError::LimitExceeded { .. });
                self.note(&error, stops_walk);
            }
        }
    }

    /// Records a condition the listing could not account for, and stops the walk when the
    /// condition is a budget: a walk that kept going past its bound would be claiming
    /// more than it read.
    fn note(&mut self, error: &ConfigError, stops_walk: bool) {
        self.incomplete = true;
        self.warnings.push(HostWarning {
            code: warning_code(error).to_string(),
            message: bounded(error.to_string()),
        });
        if stops_walk {
            self.stopped = true;
        }
    }

    fn note_unenumerable(&mut self, path: &str, reason: &'static str) {
        self.note(
            &ConfigError::UnenumerableInclude {
                path: path.to_string(),
                reason,
            },
            false,
        );
    }

    fn finish(self) -> SourceReading {
        let digest = self.hasher.finalize();
        SourceReading {
            aliases: self.aliases,
            warnings: self.warnings,
            incomplete: self.incomplete,
            revision: format!("sha256-{}", digest_hex(digest.as_slice(), 64)),
        }
    }
}

/// How a condition is named on the wire. The codes are stable: a client branching on one
/// must not have to match an English message.
fn warning_code(error: &ConfigError) -> &'static str {
    match error {
        ConfigError::UnterminatedQuote { .. } | ConfigError::NotUtf8 { .. } => "config-unparsable",
        ConfigError::UnreadableFile { kind, .. } => {
            if *kind == ErrorKind::NotFound {
                "include-missing"
            } else {
                "include-unreadable"
            }
        }
        ConfigError::IncludeCycle { .. } => "include-cycle",
        ConfigError::LimitExceeded { limit, .. } => match *limit {
            "depth" => "include-depth-limit",
            "files" => "include-file-limit",
            _ => "include-bytes-limit",
        },
        ConfigError::UnenumerableInclude { .. } => "include-unenumerable",
    }
}

fn unreadable(path: &Path, error: &std::io::Error) -> ConfigError {
    ConfigError::UnreadableFile {
        path: path.to_path_buf(),
        kind: error.kind(),
        message: error.to_string(),
    }
}

/// The canonical path when the filesystem can answer, and the path as given otherwise.
///
/// Cycle detection compares these, so two spellings of one file — a symlink and its
/// target — are the same file.
fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Expands the two things OpenSSH's reader expands in an `Include` path that can still be
/// resolved by reading files: a leading `~` against the SSH directory's parent, and a
/// relative path against `include_base`.
fn resolve_include(argument: &str, include_base: &Path) -> Result<PathBuf, (String, &'static str)> {
    if argument.is_empty() {
        return Err((argument.to_string(), "empty path"));
    }
    if argument.contains('%') {
        return Err((
            argument.to_string(),
            "the path contains a % token OpenSSH expands",
        ));
    }
    let expanded = if argument == "~" || argument.starts_with("~/") {
        let Some(home) = include_base.parent() else {
            return Err((
                argument.to_string(),
                "there is no home directory above the SSH directory",
            ));
        };
        match argument.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => home.to_path_buf(),
        }
    } else if argument.starts_with('~') {
        return Err((
            argument.to_string(),
            "another user's home directory cannot be resolved here",
        ));
    } else {
        PathBuf::from(argument)
    };
    Ok(if expanded.is_absolute() {
        expanded
    } else {
        include_base.join(expanded)
    })
}

/// Expands a glob pattern the way glob(3) does: `*` and `?` within one path component,
/// `[...]` classes, `\` escaping the next pattern character, a leading `.` matched only by
/// a pattern that starts with one, and results in lexicographic order.
///
/// A glob that matches nothing is not a failure: there was nothing there to read. A
/// directory that could not be listed is a warning, because files may exist behind it.
fn expand_glob(pattern: &Path, walk: &mut Walk<'_>) -> Vec<PathBuf> {
    let (root, names) = split_components(pattern);
    let mut matches = Vec::new();
    collect_matches(root, &names, 0, &mut matches, walk);
    matches.retain(|path| {
        std::fs::metadata(path)
            .map(|metadata| !metadata.is_dir())
            .unwrap_or(true)
    });
    matches.sort();
    matches
}

fn split_components(pattern: &Path) -> (PathBuf, Vec<OsString>) {
    let mut root = PathBuf::new();
    let mut names = Vec::new();
    for component in pattern.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => root.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => names.push(OsString::from("..")),
            Component::Normal(name) => names.push(name.to_os_string()),
        }
    }
    (root, names)
}

fn collect_matches(
    directory: PathBuf,
    names: &[OsString],
    index: usize,
    matches: &mut Vec<PathBuf>,
    walk: &mut Walk<'_>,
) {
    let Some(name) = names.get(index) else {
        matches.push(directory);
        return;
    };
    if has_glob_magic(name) {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                walk.note(&unreadable(&directory, &error), false);
                return;
            }
        };
        let text = name.to_string_lossy();
        for entry in entries.flatten() {
            let entry_name = entry.file_name();
            let entry_bytes = entry_name.as_encoded_bytes();
            if entry_bytes.starts_with(b".") && !text.starts_with('.') {
                continue;
            }
            if !wildcard_match(text.as_bytes(), entry_bytes) {
                continue;
            }
            descend(directory.join(&entry_name), names, index, matches, walk);
        }
    } else {
        descend(directory.join(name), names, index, matches, walk);
    }
}

fn descend(
    path: PathBuf,
    names: &[OsString],
    index: usize,
    matches: &mut Vec<PathBuf>,
    walk: &mut Walk<'_>,
) {
    if index + 1 == names.len() {
        matches.push(path);
        return;
    }
    let is_directory = std::fs::metadata(&path)
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false);
    if is_directory {
        collect_matches(path, names, index + 1, matches, walk);
    }
}

/// True when this component has to be expanded rather than opened.
fn has_glob_magic(name: &OsStr) -> bool {
    name.as_encoded_bytes()
        .iter()
        .any(|byte| matches!(byte, b'*' | b'?' | b'['))
}

/// Matches one path component against a glob pattern.
///
/// Components are matched separately, so `*` never crosses a `/`; the pattern is scanned
/// with a single backtracking point, which keeps the worst case linear in the name length
/// rather than exponential in the number of stars.
fn wildcard_match(pattern: &[u8], name: &[u8]) -> bool {
    let mut pattern_index = 0;
    let mut name_index = 0;
    let mut star_pattern: Option<usize> = None;
    let mut star_name = 0;
    while name_index < name.len() {
        if pattern_index < pattern.len() {
            if pattern[pattern_index] == b'*' {
                star_pattern = Some(pattern_index + 1);
                star_name = name_index;
                pattern_index += 1;
                continue;
            }
            if let Some(next) = match_character(pattern, pattern_index, name[name_index]) {
                pattern_index = next;
                name_index += 1;
                continue;
            }
        }
        // No match here: let the most recent `*` consume one more character, unless the
        // next character is a `/` — a wildcard never crosses a component boundary, so
        // there is nothing further to try.
        match star_pattern {
            Some(after_star) => {
                if star_name >= name.len() || name[star_name] == b'/' {
                    return false;
                }
                star_name += 1;
                pattern_index = after_star;
                name_index = star_name;
            }
            None => return false,
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

/// Where the pattern continues after consuming `name_byte` at `pattern_index`, or `None`
/// when it does not match there.
fn match_character(pattern: &[u8], pattern_index: usize, name_byte: u8) -> Option<usize> {
    match pattern[pattern_index] {
        b'?' => (name_byte != b'/').then_some(pattern_index + 1),
        b'[' => match character_class(pattern, pattern_index, name_byte) {
            Some((next, true)) => Some(next),
            Some((_, false)) => None,
            // glob(3) treats a `[` that does not open a class as a literal.
            None => (name_byte == b'[').then_some(pattern_index + 1),
        },
        b'\\' if pattern_index + 1 < pattern.len() => {
            (pattern[pattern_index + 1] == name_byte).then_some(pattern_index + 2)
        }
        literal => (literal == name_byte).then_some(pattern_index + 1),
    }
}

/// Matches a `[...]` class starting at `start`. Returns the index after the closing `]`
/// and whether `name_byte` is in the class, or `None` when the class never closes.
fn character_class(pattern: &[u8], start: usize, name_byte: u8) -> Option<(usize, bool)> {
    let mut index = start + 1;
    let mut negated = false;
    if matches!(pattern.get(index), Some(b'!') | Some(b'^')) {
        negated = true;
        index += 1;
    }
    let mut matched = false;
    let mut first = true;
    while index < pattern.len() {
        let byte = pattern[index];
        // A `]` immediately after `[` or `[!` is a literal member, not the end.
        if byte == b']' && !first {
            return Some((index + 1, matched != negated));
        }
        first = false;
        if byte == b'\\' && index + 1 < pattern.len() {
            index += 1;
            if pattern[index] == name_byte {
                matched = true;
            }
            index += 1;
            continue;
        }
        if index + 2 < pattern.len() && pattern[index + 1] == b'-' && pattern[index + 2] != b']' {
            if pattern[index] <= name_byte && name_byte <= pattern[index + 2] {
                matched = true;
            }
            index += 3;
            continue;
        }
        if byte == name_byte {
            matched = true;
        }
        index += 1;
    }
    None
}

/// The hex of a digest, cut to `characters` so an id has a fixed, readable shape.
pub(crate) fn digest_hex(bytes: &[u8], characters: usize) -> String {
    let mut rendered = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        rendered.push_str(&format!("{byte:02x}"));
    }
    rendered.truncate(characters);
    rendered
}

/// A warning message bounded to what the contract allows on the wire.
fn bounded(message: String) -> String {
    if message.chars().count() <= WARNING_MESSAGE_LIMIT {
        message
    } else {
        message.chars().take(WARNING_MESSAGE_LIMIT).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_include_resolves_against_the_base_and_an_absolute_one_does_not() {
        let base = Path::new("/home/u/.ssh");
        assert_eq!(
            resolve_include("sibling.conf", base).expect("resolves"),
            PathBuf::from("/home/u/.ssh/sibling.conf")
        );
        assert_eq!(
            resolve_include("/etc/ssh/other.conf", base).expect("resolves"),
            PathBuf::from("/etc/ssh/other.conf")
        );
        assert_eq!(
            resolve_include("~/elsewhere.conf", base).expect("resolves"),
            PathBuf::from("/home/u/elsewhere.conf")
        );
    }

    #[test]
    fn an_unenumerable_include_is_reported_with_its_reason() {
        let base = Path::new("/home/u/.ssh");
        for argument in ["%d/config", "~other/.ssh/config", ""] {
            let (path, reason) = resolve_include(argument, base).expect_err("not enumerable");
            assert_eq!(path, argument);
            assert!(!reason.is_empty());
        }
    }

    #[test]
    fn glob_matching_never_crosses_a_component_boundary() {
        assert!(wildcard_match(b"*.conf", b"a.conf"));
        assert!(!wildcard_match(b"*.conf", b"a/b.conf"));
        assert!(wildcard_match(b"a?c", b"abc"));
        assert!(!wildcard_match(b"a?c", b"ac"));
        assert!(wildcard_match(b"*", b"anything at all"));
        assert!(wildcard_match(b"[am]*.conf", b"a.conf"));
        assert!(!wildcard_match(b"[am]*.conf", b"z.conf"));
        assert!(!wildcard_match(b"[!am]*", b"a.conf"));
        assert!(wildcard_match(b"[!am]*", b"z.conf"));
        assert!(wildcard_match(b"a\\*b", b"a*b"));
        assert!(!wildcard_match(b"a\\*b", b"axb"));
        // An unmatched `[` is a literal, as glob(3) treats it.
        assert!(wildcard_match(b"[abc", b"[abc"));
    }

    #[test]
    fn only_the_patterns_whose_expansion_is_uncertain_have_magic() {
        assert!(has_glob_magic(OsStr::new("conf.d/*.conf")));
        assert!(has_glob_magic(OsStr::new("conf.d/a?.conf")));
        assert!(has_glob_magic(OsStr::new("conf.d/[am].conf")));
        assert!(!has_glob_magic(OsStr::new("conf.d/plain.conf")));
    }

    #[test]
    fn an_absent_source_has_the_revision_of_nothing_read() {
        let source = ConfigSource {
            id: "source_test".to_string(),
            path: PathBuf::from("/nonexistent/config"),
            include_base: PathBuf::from("/nonexistent/.ssh"),
        };
        let reading =
            read_source(&source, IncludeLimits::default()).expect("an absent file is fine");

        // The revision of nothing read is still a revision — the SHA-256 of the empty
        // input — so a caller comparing two listings of an absent file gets an answer
        // rather than an empty string.
        assert!(reading.aliases.is_empty());
        assert!(reading.warnings.is_empty());
        assert!(!reading.incomplete);
        assert_eq!(
            reading.revision,
            "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn every_budget_names_itself_in_the_warning_code() {
        assert_eq!(
            warning_code(&ConfigError::LimitExceeded {
                limit: "depth",
                value: 8
            }),
            "include-depth-limit"
        );
        assert_eq!(
            warning_code(&ConfigError::LimitExceeded {
                limit: "files",
                value: 128
            }),
            "include-file-limit"
        );
        assert_eq!(
            warning_code(&ConfigError::LimitExceeded {
                limit: "bytes",
                value: 2 * 1024 * 1024
            }),
            "include-bytes-limit"
        );
        assert_eq!(
            warning_code(&ConfigError::UnreadableFile {
                path: PathBuf::from("/gone"),
                kind: ErrorKind::NotFound,
                message: "not found".to_string()
            }),
            "include-missing"
        );
        assert_eq!(
            warning_code(&ConfigError::UnreadableFile {
                path: PathBuf::from("/locked"),
                kind: ErrorKind::PermissionDenied,
                message: "denied".to_string()
            }),
            "include-unreadable"
        );
    }
}
