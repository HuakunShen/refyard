/**
 * `git cat-file --batch` framing, and the commit/tag objects it returns.
 *
 * The protocol is length-prefixed, which is the whole reason this project uses it
 * instead of `git log --format=…`: a commit message may contain quotes, newlines,
 * backslashes and anything else, and only an exact byte count can frame it. The
 * measured shape for one object is
 *
 * ```
 * <oid> <type> <size>\n<exactly size bytes>\n
 * ```
 *
 * and for a name Git cannot resolve, `<input> missing\n`. The decoder is
 * incremental: chunks may split a header, split a body, or contain several
 * objects, and a partial object is never emitted.
 *
 * Commit headers use Git's own continuation rule — a line beginning with a space
 * continues the previous header — which is how multi-line `gpgsig` survives. Names
 * and messages stay as bytes: an author name, an encoding header and a message are
 * all potentially non-UTF-8, and the host decides how to display them.
 */
import { GitOutputParseError } from "../ports.js";
import { concatBytes } from "../bytes/nul.js";
import { CORE_LIMITS } from "../bytes/limits.js";

const FORMAT = "cat-file --batch";

export interface CatFileObject {
  /** The object name Git reported, i.e. the resolved one. */
  readonly oid: string;
  readonly type: "commit" | "tree" | "blob" | "tag";
  readonly body: Uint8Array;
}

export interface CatFileMissing {
  /** The input name that could not be resolved. */
  readonly missing: string;
}

export type CatFileEntry = CatFileObject | CatFileMissing;

export function isMissingEntry(entry: CatFileEntry): entry is CatFileMissing {
  return "missing" in entry;
}

/**
 * Incremental `cat-file --batch` decoder.
 *
 * `push(chunk)` returns every object that became complete; incomplete bytes stay
 * buffered. `finish()` reports a truncated final object rather than dropping it,
 * because a dropped object would look like a commit with no message.
 */
export class CatFileDecoder {
  #buffer: Uint8Array = new Uint8Array(0);
  #expectedBody: number | null = null;
  #headerLine: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): CatFileEntry[] {
    this.#buffer =
      this.#buffer.byteLength === 0
        ? chunk
        : concatBytes([this.#buffer, chunk]);
    const entries: CatFileEntry[] = [];

    for (;;) {
      if (this.#expectedBody !== null) {
        // Body plus its trailing newline.
        if (this.#buffer.byteLength < this.#expectedBody + 1) {
          break;
        }
        const body = this.#buffer.subarray(0, this.#expectedBody);
        const terminator = this.#buffer[this.#expectedBody];
        if (terminator !== 0x0a) {
          throw new GitOutputParseError(
            FORMAT,
            `object body of ${this.#expectedBody} bytes was not followed by a newline`,
            this.#expectedBody,
          );
        }
        if (body.byteLength > CORE_LIMITS.objectMaxBytes) {
          throw new GitOutputParseError(
            FORMAT,
            `object body of ${body.byteLength} bytes exceeds the ${CORE_LIMITS.objectMaxBytes} byte limit`,
          );
        }
        const header = this.#headerLine;
        this.#headerLine = new Uint8Array(0);
        this.#buffer = this.#buffer.subarray(this.#expectedBody + 1);
        this.#expectedBody = null;
        entries.push(this.#materialize(header, body));
        continue;
      }

      const lineEnd = indexOfNewline(this.#buffer);
      if (lineEnd === -1) {
        break;
      }
      const line = concatBytes([
        this.#headerLine,
        this.#buffer.subarray(0, lineEnd),
      ]);
      this.#headerLine = new Uint8Array(0);
      this.#buffer = this.#buffer.subarray(lineEnd + 1);
      const parsed = parseHeaderLine(line);
      if (parsed.kind === "missing") {
        entries.push({ missing: parsed.input });
        continue;
      }
      this.#headerLine = line;
      this.#expectedBody = parsed.size;
      if (parsed.size === 0) {
        // A zero-length object still has a trailing newline.
        this.#expectedBody = 0;
      }
    }

    return entries;
  }

  /** Fail when the stream ended inside an object. */
  finish(): void {
    if (this.#expectedBody !== null) {
      throw new GitOutputParseError(
        FORMAT,
        `stream ended after a header promising ${this.#expectedBody} bytes`,
      );
    }
    if (this.#buffer.byteLength > 0) {
      throw new GitOutputParseError(
        FORMAT,
        `stream ended with ${this.#buffer.byteLength} bytes of an unfinished header`,
      );
    }
  }

  #materialize(header: Uint8Array, body: Uint8Array): CatFileObject {
    const parsed = parseHeaderLine(header);
    if (parsed.kind === "missing") {
      throw new GitOutputParseError(
        FORMAT,
        "internal: missing-object header reached materialisation",
      );
    }
    return { oid: parsed.oid, type: parsed.type, body };
  }
}

type ParsedHeader =
  | {
      readonly kind: "object";
      readonly oid: string;
      readonly type: CatFileObject["type"];
      readonly size: number;
    }
  | { readonly kind: "missing"; readonly input: string };

function parseHeaderLine(line: Uint8Array): ParsedHeader {
  const text = decodeAsciiLine(line);
  const space = text.indexOf(" ");
  if (space === -1) {
    throw new GitOutputParseError(FORMAT, `unrecognised header line '${text}'`);
  }
  const first = text.slice(0, space);
  const rest = text.slice(space + 1);
  if (rest === "missing" || rest.startsWith("missing ")) {
    return { kind: "missing", input: first };
  }
  if (rest.startsWith("ambiguous")) {
    throw new GitOutputParseError(
      FORMAT,
      `object name '${first}' is ambiguous`,
    );
  }
  const parts = rest.split(" ");
  if (parts.length !== 2) {
    throw new GitOutputParseError(FORMAT, `unrecognised header line '${text}'`);
  }
  const [typeText, sizeText] = parts;
  if (typeText === undefined || sizeText === undefined) {
    throw new GitOutputParseError(FORMAT, `unrecognised header line '${text}'`);
  }
  if (!/^\d+$/.test(sizeText)) {
    throw new GitOutputParseError(
      FORMAT,
      `unrecognised object size '${sizeText}'`,
    );
  }
  let type: CatFileObject["type"];
  switch (typeText) {
    case "commit":
    case "tree":
    case "blob":
    case "tag":
      type = typeText;
      break;
    default:
      throw new GitOutputParseError(
        FORMAT,
        `unexpected object type '${typeText}'`,
      );
  }
  const size = Number.parseInt(sizeText, 10);
  if (size > CORE_LIMITS.objectMaxBytes) {
    throw new GitOutputParseError(
      FORMAT,
      `object of ${size} bytes exceeds the ${CORE_LIMITS.objectMaxBytes} byte limit`,
    );
  }
  return { kind: "object", oid: first, type, size };
}

function indexOfNewline(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) {
      return index;
    }
  }
  return -1;
}

function decodeAsciiLine(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(
        FORMAT,
        "unexpected non-ASCII byte in a header",
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

/* ------------------------------------------------------------ object bodies */

export interface CommitIdentity {
  readonly nameBytes: Uint8Array;
  readonly emailBytes: Uint8Array;
  /** Seconds since the epoch, as Git recorded it. */
  readonly timestamp: number;
  /** Timezone offset exactly as Git printed it, e.g. `+0800`. */
  readonly timezoneOffset: string;
}

export interface CommitObject {
  readonly treeOid: string;
  readonly parentOids: readonly string[];
  readonly author: CommitIdentity;
  readonly committer: CommitIdentity;
  /** Declared message encoding, when the commit carries one. */
  readonly encoding: string | null;
  /** True when the object carries a `gpgsig` header (a signed commit). */
  readonly signed: boolean;
  /** Raw message bytes, including its trailing newline. */
  readonly messageBytes: Uint8Array;
}

export interface TagObject {
  readonly objectOid: string;
  readonly objectType: string;
  readonly tagName: string;
  readonly tagger: CommitIdentity | null;
  readonly signed: boolean;
  readonly messageBytes: Uint8Array;
}

/** Split an object body into header lines (with continuations) and the message. */
function splitObjectBody(
  body: Uint8Array,
  format: string,
): { headers: Uint8Array[]; messageOffset: number } {
  const headers: Uint8Array[] = [];
  let lineStart = 0;
  for (let index = 0; index < body.byteLength; index += 1) {
    if (body[index] !== 0x0a) {
      continue;
    }
    const line = body.subarray(lineStart, index);
    if (line.byteLength === 0) {
      // Blank line: headers are over, the rest is the message.
      return { headers, messageOffset: index + 1 };
    }
    if (body[lineStart] === 0x20 && headers.length > 0) {
      // Continuation of the previous header (gpgsig, mergetag).
      const previous = headers[headers.length - 1];
      if (previous !== undefined) {
        headers[headers.length - 1] = concatBytes([
          previous,
          new Uint8Array([0x0a]),
          line,
        ]);
      }
    } else {
      headers.push(line);
    }
    lineStart = index + 1;
  }
  if (lineStart === body.byteLength) {
    // Headers but no blank line and no message.
    return { headers, messageOffset: body.byteLength };
  }
  throw new GitOutputParseError(
    format,
    "object body has a trailing header line without a newline",
  );
}

function headerValue(
  headers: readonly Uint8Array[],
  key: string,
): Uint8Array | null {
  const prefix = `${key} `;
  for (const header of headers) {
    const text = header.subarray(0, Math.min(header.byteLength, prefix.length));
    let matches = true;
    for (let index = 0; index < prefix.length; index += 1) {
      if (text[index] !== prefix.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return header.subarray(prefix.length);
    }
  }
  return null;
}

function headerValues(
  headers: readonly Uint8Array[],
  key: string,
): Uint8Array[] {
  const values: Uint8Array[] = [];
  const prefix = `${key} `;
  for (const header of headers) {
    if (header.byteLength < prefix.length) {
      continue;
    }
    let matches = true;
    for (let index = 0; index < prefix.length; index += 1) {
      if (header[index] !== prefix.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      values.push(header.subarray(prefix.length));
    }
  }
  return values;
}

/** True when a header is present, with or without a value (`gpgsig` has one). */
function hasHeader(headers: readonly Uint8Array[], key: string): boolean {
  return headerValue(headers, key) !== null;
}

function parseIdentity(bytes: Uint8Array, format: string): CommitIdentity {
  const gt = lastIndexOfByte(bytes, 0x3e);
  if (gt === -1) {
    throw new GitOutputParseError(format, "identity line has no '>'");
  }
  const lt = lastIndexOfByte(bytes, 0x3c, gt);
  if (lt === -1) {
    throw new GitOutputParseError(
      format,
      "identity line has no '<' before its '>'",
    );
  }
  const nameEnd = lt > 0 && bytes[lt - 1] === 0x20 ? lt - 1 : lt;
  const nameBytes = bytes.subarray(0, nameEnd);
  const emailBytes = bytes.subarray(lt + 1, gt);
  const restText = decodeAsciiLine(bytes.subarray(gt + 1));
  const match = /^ (\d+) ([+-]\d{4})$/.exec(restText);
  if (match === null) {
    throw new GitOutputParseError(
      format,
      `unrecognised identity tail '${restText}'`,
    );
  }
  return {
    nameBytes,
    emailBytes,
    timestamp: Number.parseInt(match[1] ?? "0", 10),
    timezoneOffset: match[2] ?? "+0000",
  };
}

function lastIndexOfByte(
  bytes: Uint8Array,
  byte: number,
  before = bytes.byteLength,
): number {
  for (
    let index = Math.min(before, bytes.byteLength) - 1;
    index >= 0;
    index -= 1
  ) {
    if (bytes[index] === byte) {
      return index;
    }
  }
  return -1;
}

export function parseCommitObject(body: Uint8Array): CommitObject {
  const { headers, messageOffset } = splitObjectBody(body, "commit object");
  const tree = headerValue(headers, "tree");
  if (tree === null) {
    throw new GitOutputParseError("commit object", "commit has no tree header");
  }
  const author = headerValue(headers, "author");
  const committer = headerValue(headers, "committer");
  if (author === null || committer === null) {
    throw new GitOutputParseError(
      "commit object",
      "commit has no author or committer header",
    );
  }
  const encoding = headerValue(headers, "encoding");
  const parents = headerValues(headers, "parent").map((bytes) => {
    const text = decodeAsciiLine(bytes);
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(text)) {
      throw new GitOutputParseError(
        "commit object",
        `unexpected parent object name '${text}'`,
      );
    }
    return text;
  });
  const treeText = decodeAsciiLine(tree);
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(treeText)) {
    throw new GitOutputParseError(
      "commit object",
      `unexpected tree object name '${treeText}'`,
    );
  }
  return {
    treeOid: treeText,
    parentOids: parents,
    author: parseIdentity(author, "commit object"),
    committer: parseIdentity(committer, "commit object"),
    encoding: encoding === null ? null : decodeAsciiLine(encoding),
    signed: hasHeader(headers, "gpgsig"),
    messageBytes: body.subarray(messageOffset),
  };
}

export function parseTagObject(body: Uint8Array): TagObject {
  const { headers, messageOffset } = splitObjectBody(body, "tag object");
  const objectOid = headerValue(headers, "object");
  const objectType = headerValue(headers, "type");
  const tagName = headerValue(headers, "tag");
  if (objectOid === null || objectType === null || tagName === null) {
    throw new GitOutputParseError(
      "tag object",
      "annotated tag is missing object, type or tag",
    );
  }
  const taggerBytes = headerValue(headers, "tagger");
  const oidText = decodeAsciiLine(objectOid);
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oidText)) {
    throw new GitOutputParseError(
      "tag object",
      `unexpected target object name '${oidText}'`,
    );
  }
  return {
    objectOid: oidText,
    objectType: decodeAsciiLine(objectType),
    tagName: decodeAsciiLine(tagName),
    tagger:
      taggerBytes === null ? null : parseIdentity(taggerBytes, "tag object"),
    signed: hasHeader(headers, "gpgsig"),
    messageBytes: body.subarray(messageOffset),
  };
}

/** The first line of a message, as bytes, for display as a subject. */
export function firstLineBytes(messageBytes: Uint8Array): Uint8Array {
  for (let index = 0; index < messageBytes.byteLength; index += 1) {
    if (messageBytes[index] === 0x0a) {
      return messageBytes.subarray(0, index);
    }
  }
  return messageBytes;
}
