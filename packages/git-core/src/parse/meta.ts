/**
 * Parsers for Git's structured metadata formats: `remote -v`, `config -z`,
 * `ls-tree -z`, and `rev-list --parents` topology.
 *
 * All four are line- or NUL-framed ASCII with one exception each — a remote URL,
 * a config value, a tree path and a commit subject can contain arbitrary bytes —
 * so the framing is done on bytes and only the fields that Git guarantees are
 * ASCII (object names, modes, status letters) are decoded.
 */
import { GitOutputParseError } from "../ports.js";
import { splitOnByte, splitNulFrames } from "../bytes/nul.js";

/* ------------------------------------------------------------------ remotes */

export interface RemoteUrlRecord {
  readonly name: string;
  readonly url: string;
  readonly kind: "fetch" | "push";
}

const REMOTE_FORMAT = "remote -v";

/**
 * Parse `remote -v`: `<name>\t<url> (<kind>)`, one line per URL.
 *
 * A remote with a separate push URL appears twice. Names are ASCII and validated
 * as such; the URL is decoded leniently because it is display data — the host
 * redacts any credentials before it is returned, and it is never used as an
 * argument.
 */
export function parseRemoteList(bytes: Uint8Array): RemoteUrlRecord[] {
  const records: RemoteUrlRecord[] = [];
  for (const line of splitOnByte(bytes, 0x0a)) {
    if (line.byteLength === 0) {
      continue;
    }
    const tabIndex = line.indexOf(0x09);
    if (tabIndex <= 0) {
      throw new GitOutputParseError(
        REMOTE_FORMAT,
        "expected <name>\\t<url> (<kind>) per line",
      );
    }
    const name = decodeAscii(line.subarray(0, tabIndex), REMOTE_FORMAT);
    const rest = line.subarray(tabIndex + 1);
    let kind: "fetch" | "push" | null = null;
    let urlEnd = rest.byteLength;
    if (endsWithAscii(rest, " (fetch)")) {
      kind = "fetch";
      urlEnd = rest.byteLength - " (fetch)".length;
    } else if (endsWithAscii(rest, " (push)")) {
      kind = "push";
      urlEnd = rest.byteLength - " (push)".length;
    }
    if (kind === null) {
      throw new GitOutputParseError(
        REMOTE_FORMAT,
        "a remote line did not end with (fetch) or (push)",
      );
    }
    records.push({
      name,
      url: decodeLenient(rest.subarray(0, urlEnd)),
      kind,
    });
  }
  return records;
}

/* ------------------------------------------------------------------- config */

export interface ConfigEntry {
  readonly key: string;
  /** Raw value bytes; a value can be a path, a URL or a command line. */
  readonly value: Uint8Array;
}

const CONFIG_FORMAT = "config -z";

/**
 * Parse `git config -z --get-regexp` output.
 *
 * Each record is `key\nvalue` (the key and value are separated by a newline, not
 * an `=`), and records are NUL-separated. Splitting on the *first* newline is what
 * makes a value containing newlines survive intact.
 */
export function parseConfigEntries(bytes: Uint8Array): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const frame of splitNulFrames(bytes, CONFIG_FORMAT)) {
    if (frame.byteLength === 0) {
      continue;
    }
    const separator = frame.indexOf(0x0a);
    if (separator <= 0) {
      throw new GitOutputParseError(
        CONFIG_FORMAT,
        "expected <key>\\n<value> per record",
      );
    }
    entries.push({
      key: decodeAscii(frame.subarray(0, separator), CONFIG_FORMAT),
      value: frame.subarray(separator + 1),
    });
  }
  return entries;
}

/* ------------------------------------------------------------------ ls-tree */

export interface TreeEntry {
  readonly mode: string;
  readonly objectType: string;
  readonly oid: string;
  readonly pathBytes: Uint8Array;
}

const LS_TREE_FORMAT = "ls-tree -z";

/** Parse `ls-tree -z`: `<mode> <type> <oid>\t<path>` records, NUL-terminated. */
export function parseLsTree(bytes: Uint8Array): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const frame of splitNulFrames(bytes, LS_TREE_FORMAT)) {
    if (frame.byteLength === 0) {
      continue;
    }
    const tabIndex = frame.indexOf(0x09);
    if (tabIndex <= 0) {
      throw new GitOutputParseError(
        LS_TREE_FORMAT,
        "expected <mode> <type> <oid>\\t<path> per record",
      );
    }
    const header = decodeAscii(frame.subarray(0, tabIndex), LS_TREE_FORMAT);
    const fields = header.split(" ");
    if (fields.length !== 3) {
      throw new GitOutputParseError(
        LS_TREE_FORMAT,
        "expected exactly three space-separated header fields",
      );
    }
    const [mode, objectType, oid] = fields;
    if (mode === undefined || objectType === undefined || oid === undefined) {
      throw new GitOutputParseError(LS_TREE_FORMAT, "incomplete tree entry");
    }
    entries.push({
      mode,
      objectType,
      oid,
      pathBytes: frame.subarray(tabIndex + 1),
    });
  }
  return entries;
}

/* ---------------------------------------------------------------- topology */

export interface TopologyEntry {
  readonly oid: string;
  readonly parentOids: readonly string[];
  /** True when Git marked this commit as a boundary (`-` prefix). */
  readonly boundary: boolean;
}

const TOPOLOGY_FORMAT = "rev-list --topo-order --parents";

/**
 * Parse `rev-list --parents` output: `<oid> <parent>…` per line.
 *
 * Only object names and single spaces appear, so this is the one history read that
 * never touches a message: bodies come from `cat-file --batch` separately, which is
 * what keeps a commit message containing a newline from looking like a new row.
 */
export function parseRevListTopology(bytes: Uint8Array): TopologyEntry[] {
  const entries: TopologyEntry[] = [];
  for (const line of splitOnByte(bytes, 0x0a)) {
    if (line.byteLength === 0) {
      continue;
    }
    let text = decodeAscii(line, TOPOLOGY_FORMAT);
    let boundary = false;
    if (text.startsWith("-")) {
      boundary = true;
      text = text.slice(1);
    }
    const fields = text.split(" ");
    const [oid, ...parents] = fields;
    if (oid === undefined || oid.length === 0) {
      throw new GitOutputParseError(
        TOPOLOGY_FORMAT,
        "a row had no object name",
      );
    }
    for (const parent of parents) {
      if (parent.length === 0) {
        throw new GitOutputParseError(
          TOPOLOGY_FORMAT,
          "a row contained an empty parent field",
        );
      }
    }
    entries.push({ oid, parentOids: parents, boundary });
  }
  return entries;
}

/**
 * Parse `cat-file --batch-check=%(objectname)` output.
 *
 * A present object prints its own name; a missing one prints
 * `<input> missing`. The answer is presence only — no body is transferred.
 */
export function parseObjectPresence(
  bytes: Uint8Array,
  requested: readonly string[],
): {
  readonly present: readonly string[];
  readonly missing: readonly string[];
} {
  const present: string[] = [];
  const missing: string[] = [];
  const lines = splitOnByte(bytes, 0x0a).filter((line) => line.byteLength > 0);
  for (const [index, line] of lines.entries()) {
    const text = decodeAscii(line, "cat-file --batch-check");
    if (text.endsWith(" missing")) {
      missing.push(text.slice(0, -" missing".length));
      continue;
    }
    const oid = text.split(" ")[0];
    present.push(oid ?? requested[index] ?? "");
  }
  return { present, missing };
}

/* ----------------------------------------------------------------- helpers */

function decodeAscii(bytes: Uint8Array, format: string): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(format, "unexpected non-ASCII byte");
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function decodeLenient(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return text;
}

function endsWithAscii(bytes: Uint8Array, suffix: string): boolean {
  if (bytes.byteLength < suffix.length) {
    return false;
  }
  const start = bytes.byteLength - suffix.length;
  for (let index = 0; index < suffix.length; index += 1) {
    if (bytes[start + index] !== suffix.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}
