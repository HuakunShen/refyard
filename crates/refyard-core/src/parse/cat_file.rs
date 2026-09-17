//! `git cat-file --batch` framing, and the commit and tag objects it returns.
//!
//! The protocol is length-prefixed, which is why objects are read here rather than
//! through `git log --format=…`: a commit message may contain quotes, newlines,
//! backslashes and arbitrary bytes, and only an exact byte count frames it. One
//! object answers
//!
//! ```text
//! <oid> <type> <size>\n<exactly size bytes>\n
//! ```
//!
//! and a name Git cannot resolve answers `<input> missing\n`. The decoder is
//! incremental — a chunk may split a header, split a body, or carry several objects —
//! and a partial object is never emitted: a half-read body handed to a caller looks
//! exactly like a commit whose message was cut off, which is a wrong answer rather
//! than a short one.
//!
//! Commit headers follow Git's own continuation rule (a line beginning with a space
//! continues the previous header), which is how a multi-line `gpgsig` survives.
//! Names and messages stay bytes: an author name, an `encoding` header and a message
//! are all potentially non-UTF-8, and the host decides how to display them.

use crate::bytes::decode_ascii;
use crate::problem::CoreError;

/// The format name carried by every error from the framing layer.
const FORMAT: &str = "cat-file --batch";
const COMMIT_FORMAT: &str = "commit object";
const TAG_FORMAT: &str = "tag object";

/// Bound on one object body, in bytes.
///
/// This is `CORE_LIMITS.objectMaxBytes` from the published limits; it is duplicated
/// rather than imported because core has no contract runtime to import it from. A
/// body over the bound is refused in the header, before its bytes are awaited, so a
/// hostile or corrupt repository cannot make the host buffer unbounded memory.
pub const OBJECT_MAX_BYTES: usize = 16 * 1024 * 1024;

/// The object kind Git reported. Anything else is a parser error, not a new kind:
/// `cat-file --batch` answers with exactly these four names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatFileObjectType {
    Commit,
    Tree,
    Blob,
    Tag,
}

impl CatFileObjectType {
    /// The wire name, as Git prints it.
    pub fn as_str(self) -> &'static str {
        match self {
            CatFileObjectType::Commit => "commit",
            CatFileObjectType::Tree => "tree",
            CatFileObjectType::Blob => "blob",
            CatFileObjectType::Tag => "tag",
        }
    }

    fn from_name(name: &str) -> Option<CatFileObjectType> {
        match name {
            "commit" => Some(CatFileObjectType::Commit),
            "tree" => Some(CatFileObjectType::Tree),
            "blob" => Some(CatFileObjectType::Blob),
            "tag" => Some(CatFileObjectType::Tag),
            _ => None,
        }
    }
}

/// One decoded answer from the batch protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatFileEntry {
    /// An object Git resolved, with the body exactly as stored.
    Object {
        oid: String,
        object_type: CatFileObjectType,
        body: Vec<u8>,
    },
    /// A name Git could not resolve. It is a per-entry answer rather than a failure,
    /// so one unknown name cannot discard the rest of a batch.
    Missing { input: String },
}

impl CatFileEntry {
    /// True for [`CatFileEntry::Missing`]; the host's "name the missing objects"
    /// step branches on this.
    pub fn is_missing(&self) -> bool {
        matches!(self, CatFileEntry::Missing { .. })
    }
}

/// Incremental `cat-file --batch` decoder.
///
/// `push` returns every object that became complete; bytes that did not complete an
/// object stay buffered across calls, including a header that arrived without its
/// newline. `finish` then reports the stream that ended inside an object, because a
/// dropped trailing object would look like a commit that has no message.
#[derive(Debug, Default, Clone)]
pub struct CatFileDecoder {
    buffer: Vec<u8>,
    /// `Some(size)` once a header promised a body that has not arrived whole.
    expected_body: Option<usize>,
    /// The header bytes waiting for their body.
    header_line: Vec<u8>,
}

impl CatFileDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one chunk, receive the entries that became complete.
    ///
    /// A malformed header is an error for the whole stream: the framing is positional
    /// from there on, so continuing would attach one object's body to another's name.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<CatFileEntry>, CoreError> {
        self.buffer.extend_from_slice(chunk);
        let mut entries = Vec::new();

        loop {
            if let Some(expected) = self.expected_body {
                if self.buffer.len() < expected + 1 {
                    break;
                }
                let body = self.buffer[..expected].to_vec();
                if self.buffer[expected] != b'\n' {
                    return Err(CoreError::output_unparsable(
                        FORMAT,
                        format!(
                            "object body of {expected} bytes was not followed by a newline (at byte {expected})"
                        ),
                    ));
                }
                if body.len() > OBJECT_MAX_BYTES {
                    return Err(CoreError::output_unparsable(
                        FORMAT,
                        format!(
                            "object body of {} bytes exceeds the {OBJECT_MAX_BYTES} byte limit",
                            body.len()
                        ),
                    ));
                }
                let header = std::mem::take(&mut self.header_line);
                self.buffer.drain(..expected + 1);
                self.expected_body = None;
                entries.push(materialize(&header, body)?);
                continue;
            }

            let Some(line_end) = self.buffer.iter().position(|byte| *byte == b'\n') else {
                break;
            };
            // A line may be the continuation of a header split across two chunks.
            let mut line = std::mem::take(&mut self.header_line);
            line.extend_from_slice(&self.buffer[..line_end]);
            self.buffer.drain(..line_end + 1);

            match parse_header_line(&line)? {
                HeaderLine::Missing { input } => entries.push(CatFileEntry::Missing { input }),
                HeaderLine::Object { size, .. } => {
                    self.header_line = line;
                    self.expected_body = Some(size);
                }
            }
        }

        Ok(entries)
    }

    /// Fail when the stream ended inside an object or inside a header.
    pub fn finish(&self) -> Result<(), CoreError> {
        if let Some(expected) = self.expected_body {
            return Err(CoreError::output_incomplete(
                FORMAT,
                format!("stream ended after a header promising {expected} bytes"),
            ));
        }
        if !self.buffer.is_empty() {
            return Err(CoreError::output_incomplete(
                FORMAT,
                format!(
                    "stream ended with {} bytes of an unfinished header",
                    self.buffer.len()
                ),
            ));
        }
        Ok(())
    }
}

/// One parsed header line, before its body is known.
enum HeaderLine {
    Object {
        oid: String,
        object_type: CatFileObjectType,
        size: usize,
    },
    Missing {
        input: String,
    },
}

fn materialize(header: &[u8], body: Vec<u8>) -> Result<CatFileEntry, CoreError> {
    match parse_header_line(header)? {
        HeaderLine::Object {
            oid, object_type, ..
        } => Ok(CatFileEntry::Object {
            oid,
            object_type,
            body,
        }),
        // `header_line` is only ever set for an object header, so this is a bug in
        // the decoder rather than something Git printed.
        HeaderLine::Missing { .. } => Err(CoreError::output_unparsable(
            FORMAT,
            "internal: missing-object header reached materialisation",
        )),
    }
}

fn parse_header_line(line: &[u8]) -> Result<HeaderLine, CoreError> {
    let text = decode_ascii(line, FORMAT)?;
    let Some(space) = text.find(' ') else {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("unrecognised header line '{text}'"),
        ));
    };
    let first = &text[..space];
    let rest = &text[space + 1..];
    if rest == "missing" || rest.starts_with("missing ") {
        return Ok(HeaderLine::Missing {
            input: first.to_string(),
        });
    }
    if rest.starts_with("ambiguous") {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("object name '{first}' is ambiguous"),
        ));
    }
    let parts: Vec<&str> = rest.split(' ').collect();
    if parts.len() != 2 {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("unrecognised header line '{text}'"),
        ));
    }
    let (Some(type_text), Some(size_text)) = (parts.first().copied(), parts.get(1).copied()) else {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("unrecognised header line '{text}'"),
        ));
    };
    if size_text.is_empty() || !size_text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("unrecognised object size '{size_text}'"),
        ));
    }
    let Some(object_type) = CatFileObjectType::from_name(type_text) else {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("unexpected object type '{type_text}'"),
        ));
    };
    // A size no `usize` can hold is out of bounds by definition, so it is reported as
    // an oversized object rather than as a number too large to parse.
    let size = size_text.parse::<usize>().map_err(|_| {
        CoreError::output_unparsable(
            FORMAT,
            format!("object of {size_text} bytes exceeds the {OBJECT_MAX_BYTES} byte limit"),
        )
    })?;
    if size > OBJECT_MAX_BYTES {
        return Err(CoreError::output_unparsable(
            FORMAT,
            format!("object of {size} bytes exceeds the {OBJECT_MAX_BYTES} byte limit"),
        ));
    }
    Ok(HeaderLine::Object {
        oid: first.to_string(),
        object_type,
        size,
    })
}

/* ------------------------------------------------------------ object bodies */

/// One author/committer/tagger line, with the name and address kept as bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitIdentity {
    pub name_bytes: Vec<u8>,
    pub email_bytes: Vec<u8>,
    /// Seconds since the epoch, as Git recorded it.
    pub timestamp: i64,
    /// Timezone offset exactly as Git printed it, e.g. `+0800`.
    pub timezone_offset: String,
}

impl CommitIdentity {
    /// The name as text, for diagnostics only: the bytes are the value that must be
    /// preserved, and this is the lossy view a caller may show.
    pub fn name_lossy(&self) -> String {
        String::from_utf8_lossy(&self.name_bytes).into_owned()
    }

    /// The address as text, for diagnostics only.
    pub fn email_lossy(&self) -> String {
        String::from_utf8_lossy(&self.email_bytes).into_owned()
    }
}

/// A commit object's portable facts. `message_bytes` includes the trailing newline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitObject {
    pub tree_oid: String,
    pub parent_oids: Vec<String>,
    pub author: CommitIdentity,
    pub committer: CommitIdentity,
    /// Declared message encoding, when the commit carries one.
    pub encoding: Option<String>,
    /// True when the object carries a `gpgsig` header (a signed commit).
    pub signed: bool,
    /// Raw message bytes, including its trailing newline.
    pub message_bytes: Vec<u8>,
}

/// An annotated tag object's portable facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagObject {
    pub object_oid: String,
    pub object_type: String,
    pub tag_name: String,
    pub tagger: Option<CommitIdentity>,
    pub signed: bool,
    pub message_bytes: Vec<u8>,
}

/// Split an object body into header lines (continuations merged) and the message.
///
/// A continuation line is joined to its header with a newline kept in between, so the
/// signature bytes of a `gpgsig` header survive in order and `header_value` returns
/// them together with the first line of the header.
fn split_object_body(body: &[u8], format: &str) -> Result<(Vec<Vec<u8>>, usize), CoreError> {
    let mut headers: Vec<Vec<u8>> = Vec::new();
    let mut line_start = 0usize;
    for (index, byte) in body.iter().enumerate() {
        if *byte != b'\n' {
            continue;
        }
        let line = &body[line_start..index];
        if line.is_empty() {
            // Blank line: the headers are over and the message starts after it.
            return Ok((headers, index + 1));
        }
        if body[line_start] == b' ' && !headers.is_empty() {
            if let Some(previous) = headers.last_mut() {
                previous.push(b'\n');
                previous.extend_from_slice(line);
            }
        } else {
            headers.push(line.to_vec());
        }
        line_start = index + 1;
    }
    if line_start == body.len() {
        // Headers with neither a blank line nor a message.
        return Ok((headers, body.len()));
    }
    Err(CoreError::output_unparsable(
        format,
        "object body has a trailing header line without a newline",
    ))
}

/// The value of the first header named `key`, if it is present.
fn header_value<'a>(headers: &'a [Vec<u8>], key: &str) -> Option<&'a [u8]> {
    headers
        .iter()
        .find_map(|header| header_body_after_key(header, key))
}

/// Every header named `key`, in order: a commit with several parents has one
/// `parent` header each.
fn header_values<'a>(headers: &'a [Vec<u8>], key: &str) -> Vec<&'a [u8]> {
    headers
        .iter()
        .filter_map(|header| header_body_after_key(header, key))
        .collect()
}

/// The bytes after `"<key> "` when the header starts with that exact prefix.
fn header_body_after_key<'a>(header: &'a [u8], key: &str) -> Option<&'a [u8]> {
    let key = key.as_bytes();
    if header.len() <= key.len() || !header.starts_with(key) || header[key.len()] != b' ' {
        return None;
    }
    Some(&header[key.len() + 1..])
}

fn has_header(headers: &[Vec<u8>], key: &str) -> bool {
    header_value(headers, key).is_some()
}

fn parse_identity(bytes: &[u8], format: &str) -> Result<CommitIdentity, CoreError> {
    let Some(gt) = bytes.iter().rposition(|byte| *byte == b'>') else {
        return Err(CoreError::output_unparsable(
            format,
            "identity line has no '>'",
        ));
    };
    let Some(lt) = bytes[..gt].iter().rposition(|byte| *byte == b'<') else {
        return Err(CoreError::output_unparsable(
            format,
            "identity line has no '<' before its '>'",
        ));
    };
    // Git writes `Name <addr>`; a name that already ends in a space would otherwise
    // keep it, so the single separator space is removed.
    let name_end = if lt > 0 && bytes[lt - 1] == b' ' {
        lt - 1
    } else {
        lt
    };
    let rest = decode_ascii(&bytes[gt + 1..], format)?;
    let (timestamp, timezone_offset) = parse_identity_tail(&rest, format)?;
    Ok(CommitIdentity {
        name_bytes: bytes[..name_end].to_vec(),
        email_bytes: bytes[lt + 1..gt].to_vec(),
        timestamp,
        timezone_offset,
    })
}

/// Parse `" <seconds> <±hhmm>"`, Git's identity tail.
///
/// A timestamp no `i64` can hold is refused rather than turned into a float, which is
/// the one place this port is stricter than the TypeScript, where the value would
/// silently become an imprecise `number`.
fn parse_identity_tail(text: &str, format: &str) -> Result<(i64, String), CoreError> {
    let unrecognised =
        || CoreError::output_unparsable(format, format!("unrecognised identity tail '{text}'"));
    let rest = text.strip_prefix(' ').ok_or_else(unrecognised)?;
    let Some((seconds, offset)) = rest.split_once(' ') else {
        return Err(unrecognised());
    };
    if seconds.is_empty() || !seconds.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(unrecognised());
    }
    let offset_bytes = offset.as_bytes();
    if offset_bytes.len() != 5
        || !matches!(offset_bytes[0], b'+' | b'-')
        || !offset_bytes[1..].iter().all(|byte| byte.is_ascii_digit())
    {
        return Err(unrecognised());
    }
    let timestamp = seconds.parse::<i64>().map_err(|_| unrecognised())?;
    Ok((timestamp, offset.to_string()))
}

/// Parse the body of a commit object.
pub fn parse_commit_object(body: &[u8]) -> Result<CommitObject, CoreError> {
    let (headers, message_offset) = split_object_body(body, COMMIT_FORMAT)?;
    let Some(tree) = header_value(&headers, "tree") else {
        return Err(CoreError::output_unparsable(
            COMMIT_FORMAT,
            "commit has no tree header",
        ));
    };
    let Some(author) = header_value(&headers, "author") else {
        return Err(CoreError::output_unparsable(
            COMMIT_FORMAT,
            "commit has no author or committer header",
        ));
    };
    let Some(committer) = header_value(&headers, "committer") else {
        return Err(CoreError::output_unparsable(
            COMMIT_FORMAT,
            "commit has no author or committer header",
        ));
    };
    let tree_oid = parse_object_name(tree, COMMIT_FORMAT, "tree")?;
    let mut parent_oids = Vec::new();
    for parent in header_values(&headers, "parent") {
        parent_oids.push(parse_object_name(parent, COMMIT_FORMAT, "parent")?);
    }
    let encoding = match header_value(&headers, "encoding") {
        Some(bytes) => Some(decode_ascii(bytes, COMMIT_FORMAT)?),
        None => None,
    };
    Ok(CommitObject {
        tree_oid,
        parent_oids,
        author: parse_identity(author, COMMIT_FORMAT)?,
        committer: parse_identity(committer, COMMIT_FORMAT)?,
        encoding,
        signed: has_header(&headers, "gpgsig"),
        message_bytes: body[message_offset..].to_vec(),
    })
}

/// Parse the body of an annotated tag object.
pub fn parse_tag_object(body: &[u8]) -> Result<TagObject, CoreError> {
    let (headers, message_offset) = split_object_body(body, TAG_FORMAT)?;
    let (Some(object), Some(object_type), Some(tag_name)) = (
        header_value(&headers, "object"),
        header_value(&headers, "type"),
        header_value(&headers, "tag"),
    ) else {
        return Err(CoreError::output_unparsable(
            TAG_FORMAT,
            "annotated tag is missing object, type or tag",
        ));
    };
    let tagger = match header_value(&headers, "tagger") {
        Some(bytes) => Some(parse_identity(bytes, TAG_FORMAT)?),
        None => None,
    };
    Ok(TagObject {
        object_oid: parse_object_name(object, TAG_FORMAT, "target")?,
        object_type: decode_ascii(object_type, TAG_FORMAT)?,
        tag_name: decode_ascii(tag_name, TAG_FORMAT)?,
        tagger,
        signed: has_header(&headers, "gpgsig"),
        message_bytes: body[message_offset..].to_vec(),
    })
}

/// Validate a name that must be a full object name, naming what it was.
fn parse_object_name(bytes: &[u8], format: &str, what: &str) -> Result<String, CoreError> {
    let text = decode_ascii(bytes, format)?;
    if !crate::bytes::is_object_name(text.as_bytes()) {
        let detail = match what {
            "tree" => format!("unexpected tree object name '{text}'"),
            "parent" => format!("unexpected parent object name '{text}'"),
            _ => format!("unexpected target object name '{text}'"),
        };
        return Err(CoreError::output_unparsable(format, detail));
    }
    Ok(text)
}

/// The first line of a message, as bytes, for display as a subject.
///
/// A subject is display data: a message whose first line is not UTF-8 must still
/// produce a subject, so this never decodes.
pub fn first_line_bytes(message_bytes: &[u8]) -> &[u8] {
    match message_bytes.iter().position(|byte| *byte == b'\n') {
        Some(index) => &message_bytes[..index],
        None => message_bytes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "fef12e3705ae5eb4037d164d06a78a9dda8392c2";
    const TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
    const PARENT: &str = "d21595332413c62dbd2bc0b53bd88575d5a61a1b";

    fn framed(oid: &str, object_type: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!("{oid} {object_type} {}\n", body.len()).into_bytes();
        out.extend_from_slice(body);
        out.push(b'\n');
        out
    }

    fn simple_commit_body() -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "tree {TREE}\n\
                 parent {PARENT}\n\
                 author Fixture Author <author@refyard.invalid> 1767225600 +0000\n\
                 committer Fixture Author <author@refyard.invalid> 1767225600 +0000\n\
                 \n\
                 main side\n"
            )
            .as_bytes(),
        );
        body
    }

    #[test]
    fn reads_one_object_and_leaves_nothing_buffered() {
        let mut decoder = CatFileDecoder::new();
        let entries = decoder.push(&framed(OID, "blob", b"hello")).expect("push");
        assert_eq!(
            entries,
            vec![CatFileEntry::Object {
                oid: OID.to_string(),
                object_type: CatFileObjectType::Blob,
                body: b"hello".to_vec(),
            }]
        );
        assert!(decoder.finish().is_ok());
    }

    #[test]
    fn answers_a_missing_name_without_failing_the_batch() {
        // One unknown tip must not discard the objects that were found; the caller
        // reports it as a missing object rather than as a parse failure.
        let mut decoder = CatFileDecoder::new();
        let mut stream = vec![b'0'; 40];
        stream.extend_from_slice(b" missing\n");
        stream.extend_from_slice(&framed(OID, "blob", b"x"));
        let entries = decoder.push(&stream).expect("push");
        assert_eq!(
            entries,
            vec![
                CatFileEntry::Missing {
                    input: "0".repeat(40)
                },
                CatFileEntry::Object {
                    oid: OID.to_string(),
                    object_type: CatFileObjectType::Blob,
                    body: b"x".to_vec(),
                },
            ]
        );
        decoder.finish().expect("finish");
    }

    #[test]
    fn refuses_an_ambiguous_name() {
        // An ambiguous name means the caller's input matched several objects; that
        // must be reported, not resolved by picking the first.
        let mut decoder = CatFileDecoder::new();
        let error = decoder
            .push(b"deadbeef ambiguous\n")
            .expect_err("ambiguous");
        assert!(error.to_string().contains("ambiguous"));
    }

    #[test]
    fn refuses_a_header_whose_type_is_unknown() {
        // A new object type would silently change the meaning of every later byte.
        let mut decoder = CatFileDecoder::new();
        assert!(decoder.push(b"aaaa blobx 2\nab\n").is_err());
    }

    #[test]
    fn refuses_an_object_body_larger_than_the_limit() {
        // The limit is checked from the header alone, before the bytes are buffered.
        let mut decoder = CatFileDecoder::new();
        let header = format!("{OID} blob {}\n", OBJECT_MAX_BYTES + 1);
        let error = decoder.push(header.as_bytes()).expect_err("too large");
        assert!(error.to_string().contains("exceeds"));
    }

    #[test]
    fn reassembles_an_object_split_across_two_pushes() {
        // A chunk boundary can fall anywhere, including inside the header line; a
        // decoder that emits what it has would return a commit with a cut message.
        let stream = framed(OID, "commit", &simple_commit_body());
        for cut in [1usize, 7, 40, 41, 120, stream.len() - 1] {
            let mut decoder = CatFileDecoder::new();
            let mut entries = decoder.push(&stream[..cut]).expect("first push");
            assert!(entries.is_empty(), "emitted early at cut {cut}");
            entries.extend(decoder.push(&stream[cut..]).expect("second push"));
            decoder.finish().expect("finish");
            assert_eq!(entries.len(), 1, "split at {cut}");
        }
    }

    #[test]
    fn decodes_several_objects_from_one_chunk() {
        let mut stream = framed(OID, "blob", b"ab");
        stream.extend_from_slice(&framed(TREE, "blob", b"c"));
        let mut decoder = CatFileDecoder::new();
        let entries = decoder.push(&stream).expect("push");
        assert_eq!(entries.len(), 2);
        decoder.finish().expect("finish");
    }

    #[test]
    fn accepts_a_zero_length_body() {
        let mut decoder = CatFileDecoder::new();
        let entries = decoder
            .push(format!("{OID} blob 0\n\n").as_bytes())
            .expect("push");
        assert_eq!(
            entries,
            vec![CatFileEntry::Object {
                oid: OID.to_string(),
                object_type: CatFileObjectType::Blob,
                body: Vec::new(),
            }]
        );
    }

    #[test]
    fn refuses_a_body_that_is_not_followed_by_a_newline() {
        // The trailing newline is part of the protocol: without it the next object's
        // header would be read one byte early and every later object would shift.
        let mut decoder = CatFileDecoder::new();
        let error = decoder
            .push(format!("{OID} blob 2\nabX").as_bytes())
            .expect_err("missing newline");
        assert!(error.to_string().contains("not followed by a newline"));
    }

    #[test]
    fn reports_a_stream_that_ends_inside_an_object_body() {
        let stream = framed(OID, "commit", &simple_commit_body());
        let mut decoder = CatFileDecoder::new();
        decoder.push(&stream[..stream.len() - 5]).expect("partial");
        let error = decoder.finish().expect_err("truncated");
        assert!(error.to_string().contains("header promising"));
        assert!(matches!(error, CoreError::OutputIncomplete { .. }));
    }

    #[test]
    fn reports_a_stream_that_ends_inside_a_header() {
        let mut decoder = CatFileDecoder::new();
        decoder
            .push(format!("{OID} blob 2").as_bytes())
            .expect("partial");
        assert!(decoder.finish().is_err());
    }

    #[test]
    fn parses_a_commit_object() {
        let commit = parse_commit_object(&simple_commit_body()).expect("commit");
        assert_eq!(commit.tree_oid, TREE);
        assert_eq!(commit.parent_oids, vec![PARENT.to_string()]);
        assert_eq!(commit.author.name_lossy(), "Fixture Author");
        assert_eq!(commit.author.email_lossy(), "author@refyard.invalid");
        assert_eq!(commit.author.timestamp, 1767225600);
        assert_eq!(commit.author.timezone_offset, "+0000");
        assert_eq!(commit.encoding, None);
        assert!(!commit.signed);
        assert_eq!(commit.message_bytes, b"main side\n".to_vec());
        assert_eq!(
            first_line_bytes(&commit.message_bytes),
            b"main side".as_slice()
        );
    }

    #[test]
    fn keeps_a_multi_line_gpgsig_and_marks_the_commit_signed() {
        // A signed commit's `gpgsig` header continues on lines that begin with a
        // space. A parser that reads one line per header would cut the signature and
        // report an unsigned commit.
        let body = [
            format!("tree {TREE}"),
            format!("parent {PARENT}"),
            "author Person <person@example.invalid> 1767225600 +0000".to_string(),
            "committer Person <person@example.invalid> 1767225600 +0000".to_string(),
            "gpgsig -----BEGIN PGP SIGNATURE-----".to_string(),
            " ".to_string(),
            " iQIzBAABCAAdFiEEexample".to_string(),
            " -----END PGP SIGNATURE-----".to_string(),
            String::new(),
            "signed subject".to_string(),
            String::new(),
        ]
        .join("\n");
        let commit = parse_commit_object(body.as_bytes()).expect("signed commit");
        assert!(commit.signed);
        assert_eq!(commit.parent_oids, vec![PARENT.to_string()]);
        assert_eq!(
            first_line_bytes(&commit.message_bytes),
            b"signed subject".as_slice()
        );
    }

    #[test]
    fn reads_an_encoding_header_as_text() {
        let body = [
            format!("tree {TREE}"),
            "author A <a@b> 1 +0000".to_string(),
            "committer A <a@b> 1 +0000".to_string(),
            "encoding ISO-8859-1".to_string(),
            String::new(),
            "m".to_string(),
        ]
        .join("\n");
        let commit = parse_commit_object(body.as_bytes()).expect("commit");
        assert_eq!(commit.encoding.as_deref(), Some("ISO-8859-1"));
    }

    #[test]
    fn keeps_a_non_utf8_author_name_as_bytes() {
        // Git does not require UTF-8 in a name; decoding it here would either fail or
        // rewrite bytes the differential oracle must be able to compare.
        let mut body = format!("tree {TREE}\nauthor Jos\u{e9}").into_bytes();
        body.extend_from_slice(b" <j@example.invalid> 1 +0000\ncommitter A <a@b> 1 +0000\n\nm\n");
        let commit = parse_commit_object(&body).expect("commit");
        assert_eq!(commit.author.name_bytes, b"Jos\xc3\xa9".to_vec());
    }

    #[test]
    fn refuses_a_commit_without_a_tree() {
        let body = b"author A <a@b> 1 +0000\ncommitter A <a@b> 1 +0000\n\nm\n";
        let error = parse_commit_object(body).expect_err("no tree");
        assert!(error.to_string().contains("no tree header"));
    }

    #[test]
    fn refuses_a_commit_without_an_author_or_committer() {
        let body = format!("tree {TREE}\n\nm\n");
        let error = parse_commit_object(body.as_bytes()).expect_err("no identity");
        assert!(error.to_string().contains("no author or committer header"));
    }

    #[test]
    fn refuses_a_trailing_header_line_without_a_newline() {
        // A body cut mid-header must not be read as a complete header.
        let body = format!("tree {TREE}\nfoo");
        let error = parse_commit_object(body.as_bytes()).expect_err("cut header");
        assert!(error
            .to_string()
            .contains("trailing header line without a newline"));
    }

    #[test]
    fn refuses_a_parent_that_is_not_an_object_name() {
        let body = format!(
            "tree {TREE}\nparent not-a-hash\nauthor A <a@b> 1 +0000\ncommitter A <a@b> 1 +0000\n\nm\n"
        );
        let error = parse_commit_object(body.as_bytes()).expect_err("bad parent");
        assert!(error
            .to_string()
            .contains("unexpected parent object name 'not-a-hash'"));
    }

    #[test]
    fn refuses_an_identity_without_an_address() {
        let body = format!("tree {TREE}\nauthor nobody\ncommitter A <a@b> 1 +0000\n\nm\n");
        assert!(parse_commit_object(body.as_bytes()).is_err());
    }

    #[test]
    fn refuses_an_identity_tail_that_is_not_seconds_and_an_offset() {
        let body = format!("tree {TREE}\nauthor A <a@b> soon\ncommitter A <a@b> 1 +0000\n\nm\n");
        let error = parse_commit_object(body.as_bytes()).expect_err("bad tail");
        assert!(error.to_string().contains("unrecognised identity tail"));
    }

    #[test]
    fn reads_an_annotated_tag_object() {
        let body = [
            "object 0123456789abcdef0123456789abcdef01234567".to_string(),
            "type commit".to_string(),
            "tag v1.0.0".to_string(),
            "tagger Person <person@example.invalid> 1767225600 +0800".to_string(),
            String::new(),
            "release notes".to_string(),
            String::new(),
        ]
        .join("\n");
        let tag = parse_tag_object(body.as_bytes()).expect("tag");
        assert_eq!(tag.object_oid, "0123456789abcdef0123456789abcdef01234567");
        assert_eq!(tag.object_type, "commit");
        assert_eq!(tag.tag_name, "v1.0.0");
        assert!(!tag.signed);
        let tagger = tag.tagger.expect("tagger");
        assert_eq!(tagger.timezone_offset, "+0800");
        assert_eq!(
            first_line_bytes(&tag.message_bytes),
            b"release notes".as_slice()
        );
    }

    #[test]
    fn accepts_a_tag_without_a_tagger() {
        let body = format!("object {OID}\ntype blob\ntag t\n\nm\n");
        let tag = parse_tag_object(body.as_bytes()).expect("tag");
        assert!(tag.tagger.is_none());
    }

    #[test]
    fn refuses_a_tag_that_is_missing_a_header_it_needs() {
        let body = format!("object {OID}\ntype commit\n\nm\n");
        let error = parse_tag_object(body.as_bytes()).expect_err("no tag name");
        assert!(error.to_string().contains("missing object, type or tag"));
    }

    #[test]
    fn refuses_a_tag_whose_target_is_not_an_object_name() {
        let body = "object deadbeef\ntype commit\ntag t\n\nm\n";
        assert!(parse_tag_object(body.as_bytes()).is_err());
    }

    #[test]
    fn first_line_of_a_message_without_a_newline_is_the_whole_message() {
        assert_eq!(first_line_bytes(b"single"), b"single".as_slice());
        assert_eq!(first_line_bytes(b""), b"".as_slice());
    }
}
