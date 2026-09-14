/**
 * `git push --porcelain` and `git fetch --porcelain` parsers.
 *
 * These are two different formats that happen to share a name — the design calls
 * this out, and the measured output confirms it:
 *
 * ```
 * push:  To <url>\n*\trefs/heads/main:refs/heads/main\t[new branch]\nDone\n
 *        \trefs/heads/main:refs/heads/main\t49f6bed..5fe8bd1
 *        !\trefs/heads/main:refs/heads/main\t[rejected] (non-fast-forward)
 *        +\trefs/heads/main:refs/heads/main\t5fe8bd1...7c46aef (forced update)
 *        =\trefs/heads/main:refs/heads/main\t[up to date]
 *
 * fetch: <flag> <old-oid> <new-oid> <local-ref>\n    (one line per updated ref)
 *        (empty output when nothing moved)
 * ```
 *
 * Both parsers are tolerant about *extra* lines: a remote may print `remote: …`
 * progress, and a rejected push exits non-zero with the reason on stderr. The
 * per-ref records are what the workflow reports, and unparsed lines are kept as
 * diagnostics so nothing is silently dropped.
 */
import { GitOutputParseError } from "../ports.js";

export type PushRefStatus =
  "upToDate" | "new" | "fastForward" | "forced" | "deleted" | "rejected";

export interface PushRefResult {
  readonly from: string;
  readonly to: string;
  readonly status: PushRefStatus;
  /** Summary as Git printed it: `[new branch]`, `old..new (forced update)`, … */
  readonly summary: string;
}

export interface PushParseResult {
  /** The remote URL/name as Git echoed it, redacted by the host for display. */
  readonly remote: string | null;
  readonly refs: readonly PushRefResult[];
  /** True when Git reported there was nothing to push at all. */
  readonly everythingUpToDate: boolean;
  readonly diagnostics: readonly string[];
}

export interface FetchRefResult {
  readonly flag: string;
  readonly oldOid: string;
  readonly newOid: string;
  /** The local ref that moved, e.g. `refs/remotes/origin/main`. */
  readonly localRef: string;
}

export interface FetchParseResult {
  readonly refs: readonly FetchRefResult[];
  readonly diagnostics: readonly string[];
}

const PUSH_FORMAT = "push --porcelain";

function splitLines(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x0a) {
      lines.push(bytes.subarray(start, index));
      start = index + 1;
    }
  }
  if (start < bytes.byteLength) {
    lines.push(bytes.subarray(start));
  }
  return lines;
}

/**
 * Patch text and porcelain progress are display material, so this decodes as
 * UTF-8 with replacement. It never feeds an execution argument — that is why
 * paths elsewhere stay as bytes.
 */
function decode(bytes: Uint8Array): string {
  let text = "";
  let index = 0;
  while (index < bytes.byteLength) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      text += String.fromCharCode(first);
      index += 1;
      continue;
    }
    let needed = 0;
    let codePoint = 0;
    if ((first & 0xe0) === 0xc0) {
      needed = 1;
      codePoint = first & 0x1f;
    } else if ((first & 0xf0) === 0xe0) {
      needed = 2;
      codePoint = first & 0x0f;
    } else if ((first & 0xf8) === 0xf0) {
      needed = 3;
      codePoint = first & 0x07;
    } else {
      text += "\uFFFD";
      index += 1;
      continue;
    }
    if (index + needed >= bytes.byteLength) {
      text += "\uFFFD";
      break;
    }
    for (let offset = 1; offset <= needed; offset += 1) {
      const continuation = bytes[index + offset] ?? 0;
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    text += String.fromCodePoint(codePoint);
    index += needed + 1;
  }
  return text;
}

export function parsePushPorcelain(bytes: Uint8Array): PushParseResult {
  const refs: PushRefResult[] = [];
  const diagnostics: string[] = [];
  let remote: string | null = null;
  let everythingUpToDate = false;

  for (const lineBytes of splitLines(bytes)) {
    const line = decode(lineBytes);
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("To ")) {
      remote = line.slice(3);
      continue;
    }
    if (line === "Done") {
      continue;
    }
    if (line.startsWith("Everything up-to-date")) {
      everythingUpToDate = true;
      continue;
    }
    // A ref line is `FLAG TAB from:to TAB summary`, where FLAG is one character
    // and may be a space. Splitting on the first tab in the whole line would take
    // the flag for the refspec, so the position is fixed instead.
    if (line.length > 2 && line[1] === "\t") {
      const flag = line[0] ?? "?";
      const [refspec, summaryPart] = splitOnce(line.slice(2), "\t");
      const [from, to] = splitOnce(refspec, ":");
      if (to.length === 0) {
        throw new GitOutputParseError(
          PUSH_FORMAT,
          `ref line '${line}' has no destination ref`,
        );
      }
      refs.push({
        from,
        to,
        status: pushStatusFromFlag(flag, summaryPart),
        summary: summaryPart,
      });
      continue;
    }
    // Anything else (remote: messages, hints) is diagnostic material.
    diagnostics.push(line);
  }

  return { remote, refs, everythingUpToDate, diagnostics };
}

function pushStatusFromFlag(flag: string, summary: string): PushRefStatus {
  if (summary.startsWith("[rejected]")) {
    return "rejected";
  }
  switch (flag) {
    case " ":
      return "fastForward";
    case "+":
      return "forced";
    case "-":
      return "deleted";
    case "*":
      return "new";
    case "=":
      return "upToDate";
    case "!":
      return "rejected";
    default:
      throw new GitOutputParseError(
        PUSH_FORMAT,
        `unknown push status flag '${flag}'`,
      );
  }
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  if (index === -1) {
    return [value, ""];
  }
  return [value.slice(0, index), value.slice(index + separator.length)];
}

/**
 * Parse `fetch --porcelain`.
 *
 * One line per updated ref: a flag character, then space-separated old object
 * name, new object name and the local ref. Git documents this output as not yet
 * stable, so the parser is strict about the shape it accepts and the test suite
 * regenerates it against the pinned Git version rather than trusting this comment.
 */
export function parseFetchPorcelain(bytes: Uint8Array): FetchParseResult {
  const refs: FetchRefResult[] = [];
  const diagnostics: string[] = [];

  for (const lineBytes of splitLines(bytes)) {
    const line = decode(lineBytes);
    if (line.length === 0) {
      continue;
    }
    // The line is `<flag> <old-oid> <new-oid> <local-ref>` with a single-character
    // flag, which is usually a space — so the line often begins with two spaces and
    // splitting on runs of whitespace would lose the flag.
    if (line.length > 2 && line[1] === " ") {
      const flag = line[0] ?? "?";
      const parts = line.slice(2).split(" ");
      const [oldOid, newOid, localRef] = parts;
      if (
        parts.length === 3 &&
        oldOid !== undefined &&
        newOid !== undefined &&
        localRef !== undefined &&
        isOidOrZero(oldOid) &&
        isOidOrZero(newOid) &&
        localRef.startsWith("refs/")
      ) {
        refs.push({ flag, oldOid, newOid, localRef });
        continue;
      }
    }
    diagnostics.push(line);
  }

  return { refs, diagnostics };
}

function isOidOrZero(value: string): boolean {
  return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(value);
}
