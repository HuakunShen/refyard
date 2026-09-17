//! Byte-level scanning for machine formats.
//!
//! Machine formats are parsed by *position*: read a fixed number of space-separated
//! ASCII fields, then take everything up to the record terminator as raw bytes.
//! Splitting on whitespace first and deciding later is how spaces, tabs and newlines
//! inside a path become corrupted state, so nothing here trims, normalises or decodes.
//!
//! This is a port of `packages/git-core/src/bytes/nul-framing.ts`. It is the oracle's
//! other half: the same bytes must produce the same values on both sides.

use crate::problem::CoreError;

/// Splits a NUL-terminated stream into frames.
///
/// Git terminates every record with NUL and never emits a trailing empty record, so a
/// trailing byte that is not a NUL means the stream was cut — and a truncated protocol
/// stream parsed as if it were complete is a wrong answer, not a short one.
pub fn split_nul_frames<'a>(bytes: &'a [u8], format: &str) -> Result<Vec<&'a [u8]>, CoreError> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes[bytes.len() - 1] != 0 {
        return Err(CoreError::output_incomplete(
            format,
            "stream does not end with NUL",
        ));
    }
    let mut frames: Vec<&[u8]> = Vec::new();
    let mut start = 0usize;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == 0 {
            frames.push(&bytes[start..index]);
            start = index + 1;
        }
    }
    // The final frame was terminated, so `start` is past the last NUL.
    Ok(frames)
}

/// Decodes strictly ASCII bytes. Anything above `0x7f` is an error rather than a
/// guess: these fields are object names, modes and status characters.
pub fn decode_ascii(bytes: &[u8], format: &str) -> Result<String, CoreError> {
    for (index, byte) in bytes.iter().enumerate() {
        if *byte > 0x7f {
            return Err(CoreError::output_unparsable(
                format,
                format!("expected an ASCII field but found byte 0x{byte:02x} at {index}"),
            ));
        }
    }
    Ok(String::from_utf8_lossy(bytes).into_owned())
}

/// True for a lowercase hexadecimal Git object name of a known length.
///
/// The length is checked against 40 and 64 rather than hardcoded to 40, because a
/// SHA-256 repository exists and a caller must not have to know that in advance.
pub fn is_object_name(bytes: &[u8]) -> bool {
    if bytes.len() != 40 && bytes.len() != 64 {
        return false;
    }
    bytes
        .iter()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

/// Reads one space-separated field from a positional cursor.
///
/// Returns the bytes before the next space and advances past it. Refuses to run past
/// the end of the record, which is what turns a malformed record into an error instead
/// of a silently shifted parse.
pub struct FrameReader<'a> {
    bytes: &'a [u8],
    format: &'static str,
    offset: usize,
}

impl<'a> FrameReader<'a> {
    pub fn new(bytes: &'a [u8], format: &'static str) -> Self {
        Self {
            bytes,
            format,
            offset: 0,
        }
    }

    pub fn offset(&self) -> usize {
        self.offset
    }

    /// The remaining bytes, untouched. Used for paths, which may contain anything.
    pub fn take_rest(&mut self) -> &'a [u8] {
        let rest = &self.bytes[self.offset..];
        self.offset = self.bytes.len();
        rest
    }

    pub fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    /// Takes exactly `length` bytes.
    pub fn take_bytes(&mut self, length: usize) -> Result<&'a [u8], CoreError> {
        if self.remaining() < length {
            return Err(CoreError::output_unparsable(
                self.format,
                format!(
                    "record ended after {} bytes, expected {length} more",
                    self.offset
                ),
            ));
        }
        let slice = &self.bytes[self.offset..self.offset + length];
        self.offset += length;
        Ok(slice)
    }

    /// Takes a field terminated by a single space, leaving the cursor **on** that
    /// separator so the caller can decide whether to consume it.
    ///
    /// This mirrors the TypeScript reader exactly. Advancing past the space here would
    /// be friendlier and would silently desynchronise every ported parser that calls
    /// `expect_space()` next, which is where a one-byte difference becomes a wrong
    /// path.
    pub fn take_field(&mut self) -> Result<&'a [u8], CoreError> {
        let start = self.offset;
        let mut end = start;
        while end < self.bytes.len() && self.bytes[end] != b' ' {
            end += 1;
        }
        if end == start {
            return Err(CoreError::output_unparsable(
                self.format,
                "expected a field but found a separator",
            ));
        }
        self.offset = end;
        Ok(&self.bytes[start..end])
    }

    /// Takes a field and requires it to be ASCII.
    pub fn take_ascii_field(&mut self) -> Result<String, CoreError> {
        let field = self.take_field()?;
        decode_ascii(field, self.format)
    }

    /// The next byte without consuming it.
    pub fn peek(&self) -> Option<u8> {
        self.bytes.get(self.offset).copied()
    }

    /// Everything left, decoded as ASCII.
    ///
    /// Only safe where the format guarantees ASCII (a branch name in a header). A
    /// path must go through `take_rest` and stay bytes.
    pub fn take_rest_ascii(&mut self) -> Result<String, CoreError> {
        let rest = self.take_rest();
        decode_ascii(rest, self.format)
    }

    /// Takes a field and requires it to be an object name.
    pub fn take_oid(&mut self) -> Result<String, CoreError> {
        let field = self.take_field()?;
        if !is_object_name(field) {
            return Err(CoreError::output_unparsable(
                self.format,
                "expected a Git object name of 40 or 64 hex characters",
            ));
        }
        decode_ascii(field, self.format)
    }

    /// The single byte at the cursor, advanced past it.
    pub fn take_byte(&mut self) -> Result<u8, CoreError> {
        let byte = *self
            .bytes
            .get(self.offset)
            .ok_or_else(|| CoreError::output_unparsable(self.format, "record ended early"))?;
        self.offset += 1;
        Ok(byte)
    }

    /// Skips one space, which Git uses as the separator before a path.
    pub fn expect_space(&mut self) -> Result<(), CoreError> {
        let byte = self.take_byte()?;
        if byte != b' ' {
            return Err(CoreError::output_unparsable(
                self.format,
                "expected a space separator".to_string(),
            ));
        }
        Ok(())
    }

    /// Parses an unsigned decimal integer from a field.
    pub fn take_number(&mut self) -> Result<u64, CoreError> {
        let field = self.take_field()?;
        if field.is_empty() || !field.iter().all(u8::is_ascii_digit) {
            return Err(CoreError::output_unparsable(
                self.format,
                "expected a decimal number".to_string(),
            ));
        }
        let text = decode_ascii(field, self.format)?;
        text.parse::<u64>()
            .map_err(|_| CoreError::output_unparsable(self.format, "number out of range"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_frames_only_on_nul() {
        let frames = split_nul_frames(b"a\nb\0c\0", "test").expect("frames");
        assert_eq!(frames, vec![&b"a\nb"[..], &b"c"[..]]);
    }

    #[test]
    fn refuses_a_stream_that_does_not_end_with_nul() {
        // A cut-off stream would otherwise look like a complete record.
        assert!(split_nul_frames(b"a\0b", "test").is_err());
    }

    #[test]
    fn keeps_spaces_and_tabs_inside_a_path() {
        // One ordinary porcelain-v2 record: eight fixed fields, then the path.
        let mut reader = FrameReader::new(
            b"1 .M N... 100644 100644 100644 5b3f0e0e1a 5b3f0e0e1a a\tb c",
            "test",
        );
        for expected in [
            &b"1"[..],
            &b".M"[..],
            &b"N..."[..],
            &b"100644"[..],
            &b"100644"[..],
            &b"100644"[..],
            &b"5b3f0e0e1a"[..],
            &b"5b3f0e0e1a"[..],
        ] {
            assert_eq!(reader.take_field().unwrap(), expected);
            reader.expect_space().unwrap();
        }
        assert_eq!(reader.take_rest(), b"a\tb c");
    }

    #[test]
    fn accepts_both_object_name_lengths() {
        assert!(is_object_name("a".repeat(40).as_bytes()));
        assert!(is_object_name("0".repeat(64).as_bytes()));
        assert!(!is_object_name("a".repeat(39).as_bytes()));
        assert!(!is_object_name("A".repeat(40).as_bytes()));
        assert!(!is_object_name("g".repeat(40).as_bytes()));
    }
}
