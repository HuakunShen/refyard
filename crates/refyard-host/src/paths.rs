//! Path bytes, display text, and the binding between them.
//!
//! Git reports paths as bytes because a POSIX path is not necessarily UTF-8, and the
//! service must be able to *show* such a path without ever letting it be used as an
//! operation input. Two independent answers, exactly as the TypeScript codec does:
//!
//! - `to_display_path` always produces something printable (invalid sequences become
//!   `\xNN` escapes) and marks whether the original bytes were valid UTF-8;
//! - a `pathId` is the only thing an operation may name, and it is bound here to the
//!   exact bytes it was minted for, in one worktree and on one build of its target.
//!
//! The second rule is what makes "the browser cannot ask to stage a file it was not
//! shown" checkable: text never travels back in as a path, and an id minted before a
//! target was rebuilt is refused for the new build.

use std::collections::HashMap;
use std::sync::Mutex;

/// Bytes and their printable form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayPath {
    pub text: String,
    /// False when the bytes are not valid UTF-8 and the text contains escapes.
    pub representable: bool,
}

impl DisplayPath {
    /// The wire value for `pathEncoding`.
    pub fn encoding(&self) -> &'static str {
        if self.representable {
            "utf8"
        } else {
            "unrepresentable"
        }
    }
}

/// Prints path bytes, escaping any byte that is not part of a valid UTF-8 sequence.
///
/// A user still has to be able to tell two such files apart, so the readable parts are
/// kept rather than the whole path being replaced by a placeholder.
pub fn to_display_path(bytes: &[u8]) -> DisplayPath {
    match std::str::from_utf8(bytes) {
        Ok(text) => DisplayPath {
            text: text.to_string(),
            representable: true,
        },
        Err(_) => DisplayPath {
            text: escape_invalid_bytes(bytes),
            representable: false,
        },
    }
}

fn escape_invalid_bytes(bytes: &[u8]) -> String {
    let mut text = String::new();
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte < 0x80 {
            text.push(char::from(byte));
            index += 1;
            continue;
        }
        // The same lead-byte classification the TypeScript codec uses: only a byte
        // that starts a sequence may begin a multi-byte decode.
        let length = match byte {
            0xc0..=0xdf => 2,
            0xe0..=0xef => 3,
            0xf0..=0xf7 => 4,
            _ => 0,
        };
        let decoded = if length == 0 || index + length > bytes.len() {
            None
        } else {
            std::str::from_utf8(&bytes[index..index + length])
                .ok()
                // A sequence must decode to exactly one code point, or a prefix of a
                // longer sequence would be accepted as a character.
                .filter(|candidate| candidate.chars().count() == 1)
        };
        match decoded {
            Some(sequence) => {
                text.push_str(sequence);
                index += length;
            }
            None => {
                text.push_str(&format!("\\x{byte:02x}"));
                index += 1;
            }
        }
    }
    text
}

/// Decodes bytes for human-readable prose (a commit message), replacing what is not
/// valid UTF-8 rather than escaping it: a replacement character inside a message is
/// what a terminal would show too.
pub fn decode_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Refuses to turn display text back into an execution path.
///
/// Two refusals, for two different reasons: a NUL cannot travel through argv at all,
/// and text matching the escape form `\xNN` is ambiguous — it is either a path this
/// codec escaped for display or a genuine file whose name contains a backslash, and
/// the two are indistinguishable here. Guessing would mean acting on a path the user
/// was never shown, so this fails closed.
pub fn encode_execution_path(text: &str) -> Option<Vec<u8>> {
    if text.contains('\u{0}') {
        return None;
    }
    if contains_escape_form(text) {
        return None;
    }
    Some(text.as_bytes().to_vec())
}

fn contains_escape_form(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0usize;
    while index + 3 < bytes.len() {
        if bytes[index] == b'\\'
            && bytes[index + 1] == b'x'
            && bytes[index + 2].is_ascii_hexdigit()
            && bytes[index + 3].is_ascii_hexdigit()
        {
            return true;
        }
        index += 1;
    }
    false
}

/// Binds opaque ids to the exact path bytes they were minted for.
///
/// The key includes the worktree, so the same bytes in two worktrees are two
/// different ids: an id from one worktree must never stage a file in another. It also
/// includes the target **generation**, so an id minted before a target was rebuilt is
/// refused for the new build instead of naming bytes that only existed in the old one.
#[derive(Debug, Default)]
pub struct PathRegistry {
    inner: Mutex<PathRegistryState>,
}

#[derive(Debug, Default)]
struct PathRegistryState {
    next: u64,
    id_by_key: HashMap<Vec<u8>, String>,
    bytes_by_id: HashMap<String, Vec<u8>>,
    generation_by_id: HashMap<String, String>,
}

impl PathRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// The id for these bytes in this worktree on this build of the target, minting one
    /// on first use.
    pub fn bind(&self, worktree_id: &str, target_generation: &str, bytes: &[u8]) -> String {
        let key = binding_key(worktree_id, bytes);
        let mut state = self.inner.lock().expect("path registry lock");
        if let Some(existing) = state.id_by_key.get(&key) {
            // A binding that survives a rebuild would let an id outlive the build it was
            // shown on; the new build gets a new id for the same bytes.
            if state
                .generation_by_id
                .get(existing)
                .is_some_and(|generation| generation == target_generation)
            {
                return existing.clone();
            }
        }
        state.next += 1;
        let id = format!("path_{}", base36(state.next));
        state.id_by_key.insert(key, id.clone());
        state.bytes_by_id.insert(id.clone(), bytes.to_vec());
        state
            .generation_by_id
            .insert(id.clone(), target_generation.to_string());
        id
    }

    /// The bytes an id was bound to on this build of the target, or `None` for an id this
    /// registry never minted or minted for a different build.
    pub fn resolve(&self, target_generation: &str, path_id: &str) -> Option<Vec<u8>> {
        let state = self.inner.lock().expect("path registry lock");
        if !state
            .generation_by_id
            .get(path_id)
            .is_some_and(|generation| generation == target_generation)
        {
            return None;
        }
        state.bytes_by_id.get(path_id).cloned()
    }

    /// The bytes an id was bound to, whichever build minted it.
    ///
    /// Exposed for the fixture driver, which resolves a display path to an id the way a
    /// client does. A read that acts on a path uses [`Self::resolve`], which cannot see
    /// across a rebuild.
    pub fn resolve_any(&self, path_id: &str) -> Option<Vec<u8>> {
        let state = self.inner.lock().expect("path registry lock");
        state.bytes_by_id.get(path_id).cloned()
    }
}

fn binding_key(worktree_id: &str, bytes: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(worktree_id.len() + bytes.len() + 2);
    key.extend_from_slice(worktree_id.as_bytes());
    key.push(0);
    key.extend_from_slice(bytes);
    key
}

/// Matches the TypeScript id minting so both implementations produce `path_1`,
/// `path_2`, … in the same order for the same input.
pub fn base36(mut value: u64) -> String {
    if value == 0 {
        return "0".to_string();
    }
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut buffer = Vec::new();
    while value > 0 {
        buffer.push(digits[(value % 36) as usize]);
        value /= 36;
    }
    buffer.reverse();
    String::from_utf8_lossy(&buffer).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_valid_utf8_unchanged() {
        let display = to_display_path("plain/name.txt".as_bytes());
        assert_eq!(display.text, "plain/name.txt");
        assert!(display.representable);
        assert_eq!(display.encoding(), "utf8");
    }

    #[test]
    fn keeps_a_space_and_a_newline_in_a_path() {
        let display = to_display_path(b"a\nb c.txt");
        assert_eq!(display.text, "a\nb c.txt");
        assert!(display.representable);
    }

    #[test]
    fn escapes_only_the_bytes_that_are_not_utf8() {
        // The readable part has to survive, or two such files become
        // indistinguishable in the UI.
        let bytes = b"caf\xe9.txt";
        let display = to_display_path(bytes);
        assert_eq!(display.text, "caf\\xe9.txt");
        assert!(!display.representable);
        assert_eq!(display.encoding(), "unrepresentable");
    }

    #[test]
    fn keeps_a_valid_multibyte_character_whole() {
        let bytes = "名.txt".as_bytes();
        let display = to_display_path(bytes);
        assert_eq!(display.text, "名.txt");
        assert!(display.representable);
    }

    #[test]
    fn decodes_a_commit_message_with_replacement_instead_of_escapes() {
        // A message is prose: a replacement character is what a terminal shows, and
        // an escape sequence there would be noise.
        assert_eq!(decode_text(b"caf\xe9 commit"), "caf\u{fffd} commit");
    }

    #[test]
    fn binds_the_same_bytes_in_two_worktrees_to_two_ids() {
        // An id from one worktree must never address a file in another.
        let registry = PathRegistry::new();
        let first = registry.bind("wt_1", "gen_1", b"a.txt");
        let second = registry.bind("wt_2", "gen_1", b"a.txt");
        assert_ne!(first, second);
        assert_eq!(
            registry.resolve("gen_1", &first).as_deref(),
            Some(&b"a.txt"[..])
        );
    }

    #[test]
    fn keeps_an_id_stable_for_the_same_bytes() {
        let registry = PathRegistry::new();
        assert_eq!(
            registry.bind("wt_1", "gen_1", b"a.txt"),
            registry.bind("wt_1", "gen_1", b"a.txt")
        );
    }

    #[test]
    fn refuses_an_id_that_was_minted_on_another_build_of_the_target() {
        // A path id is an authorisation to act on bytes that were shown: after the target
        // was rebuilt, the same bytes may belong to a different repository.
        let registry = PathRegistry::new();
        let before = registry.bind("wt_1", "gen_1", b"a.txt");
        let after = registry.bind("wt_1", "gen_2", b"a.txt");
        assert_ne!(before, after, "a rebuild mints a new id for the same bytes");
        assert_eq!(registry.resolve("gen_2", &before), None);
        assert_eq!(registry.resolve("gen_1", &before), Some(b"a.txt".to_vec()));
        assert_eq!(registry.resolve("gen_2", &after), Some(b"a.txt".to_vec()));
        // The fixture driver's own lookup is the only reader that ignores a generation.
        assert_eq!(registry.resolve_any(&before), Some(b"a.txt".to_vec()));
    }

    #[test]
    fn refuses_to_turn_an_escaped_display_string_back_into_a_path() {
        // `\xe9` is either an escape this codec produced or a literal file name; the
        // two are indistinguishable, so acting on either would be a guess.
        assert_eq!(encode_execution_path("caf\\xe9.txt"), None);
        assert_eq!(encode_execution_path("a\u{0}b"), None);
        assert_eq!(
            encode_execution_path("plain.txt"),
            Some(b"plain.txt".to_vec())
        );
    }

    #[test]
    fn mints_ids_in_the_same_spelling_as_the_reference_implementation() {
        let registry = PathRegistry::new();
        assert_eq!(registry.bind("wt_1", "gen_1", b"a"), "path_1");
        assert_eq!(registry.bind("wt_1", "gen_1", b"b"), "path_2");
        assert_eq!(base36(35), "z");
        assert_eq!(base36(36), "10");
    }
}
