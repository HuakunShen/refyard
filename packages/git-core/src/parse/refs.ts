/**
 * `git for-each-ref` and reflog parsers.
 *
 * Both formats are built from *our own* format strings, which is what makes them
 * reliable: `for-each-ref` separates fields with `%00` and records with a newline,
 * and the reflog format separates the same way. Free text (a commit subject, a
 * stash message) can contain anything except NUL and newline, and both are
 * guaranteed by ref/reflog semantics to have neither — a reflog message with a
 * newline is stored by Git with the newline escaped, which the live tests check
 * rather than assume.
 *
 * `for-each-ref` fields, in order:
 * `refname`, `objectname`, `objecttype`, `symref`, `upstream`, `upstream:track`,
 * `HEAD` marker (`*` for the checked-out branch, a space otherwise), and the
 * peeled `*objectname` for annotated tags.
 */
import { GitOutputParseError } from "../ports.js";
import { splitOnByte } from "../bytes/nul-framing.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export type RefObjectType = "commit" | "tag" | "tree" | "blob" | "unknown";

export interface RefRecord {
  readonly refName: string;
  readonly oid: string;
  readonly objectType: RefObjectType;
  /** The ref a symbolic ref points at, e.g. `refs/heads/main` for `HEAD`. */
  readonly symref: string | null;
  readonly upstream: string | null;
  readonly upstreamTrack: UpstreamTrack | null;
  readonly isHead: boolean;
  /** Peeled target of an annotated tag; null for every other object type. */
  readonly peeledOid: string | null;
}

export interface UpstreamTrack {
  readonly ahead: number;
  readonly behind: number;
  readonly gone: boolean;
}

const FOR_EACH_REF_FORMAT = "for-each-ref";
const REFLOG_FORMAT = "reflog";

function decodeAsciiLine(bytes: Uint8Array, format: string): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(
        format,
        "unexpected non-ASCII byte in an ASCII field",
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

/** Split a newline-terminated stream into records, refusing a truncated tail. */
function splitLines(bytes: Uint8Array, format: string): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) {
      lines.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < bytes.byteLength) {
    throw new GitOutputParseError(
      format,
      `output ended without a newline (${bytes.byteLength - start} trailing bytes)`,
    );
  }
  return lines;
}

export function parseForEachRef(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): RefRecord[] {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.refListMaxEntries;
  const records: RefRecord[] = [];
  for (const line of splitLines(bytes, FOR_EACH_REF_FORMAT)) {
    if (line.byteLength === 0) {
      continue;
    }
    if (records.length >= maxEntries) {
      throw new GitOutputParseError(
        FOR_EACH_REF_FORMAT,
        `ref list exceeded ${maxEntries} entries`,
      );
    }
    const fields = splitOnByte(line, 0x00);
    // The last field (the peeled object name) is empty for every non-annotated
    // ref. A trailing NUL means the final field is empty, and a splitter that
    // pushes on each separator never pushes a field after the last one — so seven
    // parsed fields plus a trailing separator is eight fields, not a short record.
    const complete =
      fields.length === 8 || (fields.length === 7 && endsWithNul(line));
    if (!complete) {
      throw new GitOutputParseError(
        FOR_EACH_REF_FORMAT,
        `expected 8 fields per ref but found ${fields.length}`,
      );
    }
    const [
      refName,
      oid,
      objectType,
      symref,
      upstream,
      track,
      headMarker,
      peeledField,
    ] = fields;
    const peeled = peeledField ?? new Uint8Array(0);
    if (refName === undefined || refName.byteLength === 0) {
      throw new GitOutputParseError(
        FOR_EACH_REF_FORMAT,
        "ref record has no refname",
      );
    }
    const oidText = decodeAsciiLine(
      oid ?? new Uint8Array(0),
      FOR_EACH_REF_FORMAT,
    );
    if (oidText.length > 0 && !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oidText)) {
      throw new GitOutputParseError(
        FOR_EACH_REF_FORMAT,
        `unexpected object name '${oidText}'`,
      );
    }
    records.push({
      refName: decodeAsciiLine(refName, FOR_EACH_REF_FORMAT),
      oid: oidText,
      objectType: parseObjectType(
        decodeAsciiLine(objectType ?? new Uint8Array(0), FOR_EACH_REF_FORMAT),
      ),
      symref: emptyToNull(
        decodeAsciiLine(symref ?? new Uint8Array(0), FOR_EACH_REF_FORMAT),
      ),
      upstream: emptyToNull(
        decodeAsciiLine(upstream ?? new Uint8Array(0), FOR_EACH_REF_FORMAT),
      ),
      upstreamTrack: parseUpstreamTrack(
        emptyToNull(
          decodeAsciiLine(track ?? new Uint8Array(0), FOR_EACH_REF_FORMAT),
        ),
      ),
      isHead:
        decodeAsciiLine(
          headMarker ?? new Uint8Array(0),
          FOR_EACH_REF_FORMAT,
        ) === "*",
      peeledOid: emptyToNull(
        decodeAsciiLine(peeled ?? new Uint8Array(0), FOR_EACH_REF_FORMAT),
      ),
    });
  }
  return records;
}

/** True when the record ended with its NUL separator, i.e. the last field is empty. */
function endsWithNul(bytes: Uint8Array): boolean {
  return bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x00;
}

function parseObjectType(text: string): RefObjectType {
  switch (text) {
    case "commit":
    case "tag":
    case "tree":
    case "blob":
      return text;
    default:
      // A future object type must not fail a ref listing; it is reported as
      // unknown so a caller can refuse the operation that needed it.
      return "unknown";
  }
}

function emptyToNull(text: string): string | null {
  return text.length === 0 ? null : text;
}

/**
 * Parse `%(upstream:track)`, whose possible values are `[ahead 1]`,
 * `[behind 2]`, `[ahead 1, behind 2]`, `[gone]` and empty.
 */
export function parseUpstreamTrack(text: string | null): UpstreamTrack | null {
  if (text === null) {
    return null;
  }
  if (text === "[gone]") {
    return { ahead: 0, behind: 0, gone: true };
  }
  const match = /^\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]$/.exec(text);
  if (match === null) {
    throw new GitOutputParseError(
      FOR_EACH_REF_FORMAT,
      `unexpected upstream track value '${text}'`,
    );
  }
  const ahead = match[1] === undefined ? 0 : Number.parseInt(match[1], 10);
  const behind = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  return { ahead, behind, gone: false };
}

export interface ReflogRecord {
  /** Locator as Git printed it, e.g. `stash@{0}` or `HEAD@{3}`. */
  readonly locator: string;
  readonly oid: string;
  /**
   * Reflog subject bytes, e.g. `On main: stash message`. Kept as bytes: a stash
   * message is user text and may be non-UTF-8, and decoding for display is the
   * host's job (see `TextCodec`).
   */
  readonly subjectBytes: Uint8Array;
  /** Committer timestamp of the entry, epoch seconds. */
  readonly timestamp: number;
}

/**
 * Parse reflog output produced with `--format=%gd%x00%H%x00%gs%x00%ct`.
 *
 * The locator is where an entry currently sits and it *moves* when entries are
 * added or dropped, which is why callers must pair it with the object name and
 * re-check before any write.
 */
export function parseReflog(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): ReflogRecord[] {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.stashListMaxEntries;
  const records: ReflogRecord[] = [];
  for (const line of splitLines(bytes, REFLOG_FORMAT)) {
    if (line.byteLength === 0) {
      continue;
    }
    if (records.length >= maxEntries) {
      throw new GitOutputParseError(
        REFLOG_FORMAT,
        `reflog exceeded ${maxEntries} entries`,
      );
    }
    const fields = splitOnByte(line, 0x00);
    if (fields.length !== 4) {
      throw new GitOutputParseError(
        REFLOG_FORMAT,
        `expected 4 fields per reflog entry but found ${fields.length}`,
      );
    }
    const [locator, oid, subject, timestamp] = fields;
    if (locator === undefined || locator.byteLength === 0) {
      throw new GitOutputParseError(
        REFLOG_FORMAT,
        "reflog entry has no locator",
      );
    }
    const timestampText = decodeAsciiLine(
      timestamp ?? new Uint8Array(0),
      REFLOG_FORMAT,
    );
    if (!/^\d+$/.test(timestampText)) {
      throw new GitOutputParseError(
        REFLOG_FORMAT,
        `unexpected timestamp '${timestampText}'`,
      );
    }
    records.push({
      locator: decodeAsciiLine(locator, REFLOG_FORMAT),
      oid: decodeAsciiLine(oid ?? new Uint8Array(0), REFLOG_FORMAT),
      subjectBytes: subject ?? new Uint8Array(0),
      timestamp: Number.parseInt(timestampText, 10),
    });
  }
  return records;
}
