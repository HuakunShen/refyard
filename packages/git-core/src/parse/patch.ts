/**
 * Unified-diff patch parser.
 *
 * A patch is the one format here that is *grammar*, not a field list: headers,
 * hunks and line prefixes all carry meaning, and the parser has to preserve what
 * the UI needs to render and what a review needs to trust:
 *
 * - line endings survive (`\r` stays in the line text),
 * - `\ No newline at end of file` is attached to the line it follows rather than
 *   dropped,
 * - a binary change is reported as binary, and a mode-only change has hunks but
 *   no content,
 * - a submodule change is reported with its three object names instead of a fake
 *   patch,
 * - and running past a size or line bound is reported as *truncated*, never as a
 *   complete patch.
 *
 * Header paths are parsed for diagnostics and cross-checking only. The identity of
 * a changed path comes from `--name-status`/`--raw` output, because a header path
 * is quoted and escaped text that cannot represent every byte path faithfully —
 * using it as the identity is how a diff ends up attached to the wrong file.
 */
import { GitOutputParseError } from "../ports.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export type PatchLineKind = "context" | "add" | "remove";

export interface PatchLine {
  readonly kind: PatchLineKind;
  /** Line content *without* the leading marker character. */
  readonly text: string;
  /** True when this line is followed by `\ No newline at end of file`. */
  readonly noNewline: boolean;
}

export interface PatchHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly PatchLine[];
}

export type FilePatchBody =
  | { readonly kind: "text"; readonly hunks: readonly PatchHunk[] }
  | { readonly kind: "binary" }
  | {
      readonly kind: "submodule";
      readonly oldOid: string | null;
      readonly newOid: string | null;
    }
  | {
      readonly kind: "modeOnly";
      readonly oldMode: string | null;
      readonly newMode: string | null;
    }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface ParsedFilePatch {
  /** Path as written in the `diff --git`/`---`/`+++` headers. Diagnostics only. */
  readonly headerPaths: {
    readonly old: string | null;
    readonly new: string | null;
  };
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly isNew: boolean;
  readonly isDeleted: boolean;
  readonly isRename: boolean;
  readonly similarity: number | null;
  readonly body: FilePatchBody;
}

export interface ParsePatchResult {
  readonly files: readonly ParsedFilePatch[];
  /** True when a bound stopped parsing early: the result is not the whole patch. */
  readonly truncated: boolean;
}

export interface ParsePatchOptions {
  readonly maxBytes?: number;
  readonly maxLines?: number;
}

interface MutableFile {
  headerPaths: { old: string | null; new: string | null };
  oldMode: string | null;
  newMode: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isRename: boolean;
  similarity: number | null;
  hunks: PatchHunk[];
  binary: boolean;
  submodule: boolean;
  recordedOid: string | null;
  indexOid: string | null;
  modeOnly: boolean;
  unavailableReason: string | null;
}

function newFile(): MutableFile {
  return {
    headerPaths: { old: null, new: null },
    oldMode: null,
    newMode: null,
    isNew: false,
    isDeleted: false,
    isRename: false,
    similarity: null,
    hunks: [],
    binary: false,
    submodule: false,
    recordedOid: null,
    indexOid: null,
    modeOnly: false,
    unavailableReason: null,
  };
}

/** Decode a line as UTF-8 with replacement; the patch text is display material. */
function decodeLine(bytes: Uint8Array): string {
  const decoder = new ByteDecoder();
  return decoder.decode(bytes);
}

/**
 * Minimal UTF-8 decoder for hex/ASCII-safe needs.
 *
 * Core has no `TextDecoder` (it is a host global), and patch text is *display*
 * material here, so this decodes well-formed UTF-8 exactly and replaces invalid
 * sequences — which is also what a terminal does.
 */
class ByteDecoder {
  decode(bytes: Uint8Array): string {
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
      let valid = true;
      for (let offset = 1; offset <= needed; offset += 1) {
        const continuation = bytes[index + offset] ?? 0;
        if ((continuation & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (continuation & 0x3f);
      }
      if (!valid) {
        text += "\uFFFD";
        index += 1;
        continue;
      }
      text += String.fromCodePoint(codePoint);
      index += needed + 1;
    }
    return text;
  }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * Parse a full patch buffer.
 *
 * The parser stops at the first bound it hits and reports `truncated: true`. It
 * never fabricates a partial hunk: a hunk in progress at the cut is discarded, so
 * a caller that ignores `truncated` still cannot render a half-line.
 */
export function parsePatch(
  bytes: Uint8Array,
  options: ParsePatchOptions = {},
): ParsePatchResult {
  const maxBytes = options.maxBytes ?? CORE_LIMITS.patchMaxBytesPerFile;
  const maxLines = options.maxLines ?? CORE_LIMITS.patchMaxLinesPerFile;
  const files: ParsedFilePatch[] = [];
  let current: MutableFile | null = null;
  let currentHunk: {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: PatchLine[];
  } | null = null;
  let truncated = false;
  let lineCount = 0;

  const lines = splitLines(bytes);
  for (const lineBytes of lines) {
    lineCount += 1;
    if (lineCount > maxLines || lineBytes.byteLength > maxBytes) {
      truncated = true;
      break;
    }
    const line = decodeLine(lineBytes);

    if (line.startsWith("diff --git ")) {
      flushHunk();
      flushFile();
      current = newFile();
      continue;
    }
    if (current === null) {
      // Leading output that is not a diff (e.g. a warning) is ignored rather than
      // treated as a file; `git diff` prints nothing else on a clean tree.
      continue;
    }
    if (line.startsWith("index ")) {
      const match = /^index ([0-9a-f]+)\.\.([0-9a-f]+)(?: (\d+))?$/.exec(line);
      if (match !== null && match[3] !== undefined) {
        current.oldMode ??= match[3];
        current.newMode ??= match[3];
      }
      continue;
    }
    if (line.startsWith("old mode ")) {
      current.oldMode = line.slice("old mode ".length).trim();
      continue;
    }
    if (line.startsWith("new mode ")) {
      current.newMode = line.slice("new mode ".length).trim();
      continue;
    }
    if (line.startsWith("new file mode ")) {
      current.isNew = true;
      current.newMode = line.slice("new file mode ".length).trim();
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.isDeleted = true;
      current.oldMode = line.slice("deleted file mode ".length).trim();
      continue;
    }
    if (line.startsWith("similarity index ")) {
      const value = Number.parseInt(
        line.slice("similarity index ".length).replace("%", ""),
        10,
      );
      current.similarity = Number.isNaN(value) ? null : value;
      current.isRename = true;
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.isRename = true;
      current.headerPaths = {
        old: line.slice("rename from ".length),
        new: current.headerPaths.new,
      };
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.isRename = true;
      current.headerPaths = {
        old: current.headerPaths.old,
        new: line.slice("rename to ".length),
      };
      continue;
    }
    if (line.startsWith("--- ")) {
      current.headerPaths = {
        old: stripPathPrefix(line.slice(4)),
        new: current.headerPaths.new,
      };
      continue;
    }
    if (line.startsWith("+++ ")) {
      current.headerPaths = {
        old: current.headerPaths.old,
        new: stripPathPrefix(line.slice(4)),
      };
      continue;
    }
    if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("Subproject commit ")) {
      current.submodule = true;
      const oid = line.slice("Subproject commit ".length).trim();
      if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid)) {
        if (current.recordedOid === null) {
          current.recordedOid = oid;
        } else {
          current.indexOid = oid;
        }
      }
      continue;
    }
    if (line.startsWith("@@")) {
      flushHunk();
      const match = HUNK_HEADER.exec(line);
      if (match === null) {
        throw new GitOutputParseError(
          "diff patch",
          `unrecognised hunk header '${line}'`,
        );
      }
      currentHunk = {
        header: line,
        oldStart: Number.parseInt(match[1] ?? "0", 10),
        oldLines: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
        newStart: Number.parseInt(match[3] ?? "0", 10),
        newLines: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
        lines: [],
      };
      continue;
    }
    if (currentHunk !== null) {
      if (line === "\\ No newline at end of file") {
        // Applies to the line just read; annotate rather than append.
        const previous = currentHunk.lines[currentHunk.lines.length - 1];
        if (previous === undefined) {
          throw new GitOutputParseError(
            "diff patch",
            "'no newline' marker with no preceding line",
          );
        }
        currentHunk.lines[currentHunk.lines.length - 1] = {
          ...previous,
          noNewline: true,
        };
        continue;
      }
      const marker = line.slice(0, 1);
      let kind: PatchLineKind;
      if (marker === "+") {
        kind = "add";
      } else if (marker === "-") {
        kind = "remove";
      } else if (marker === " " || line.length === 0) {
        kind = "context";
      } else {
        // Anything else ends the hunk (e.g. a trailing "\ No newline" variant or
        // the next file's headers, which are handled above).
        flushHunk();
        continue;
      }
      currentHunk.lines.push({ kind, text: line.slice(1), noNewline: false });
      continue;
    }
  }

  flushHunk();
  flushFile();

  return { files, truncated };

  function flushHunk(): void {
    if (current !== null && currentHunk !== null) {
      current.hunks.push({
        header: currentHunk.header,
        oldStart: currentHunk.oldStart,
        oldLines: currentHunk.oldLines,
        newStart: currentHunk.newStart,
        newLines: currentHunk.newLines,
        lines: currentHunk.lines,
      });
    }
    currentHunk = null;
  }

  function flushFile(): void {
    if (current === null) {
      return;
    }
    files.push({
      headerPaths: current.headerPaths,
      oldMode: current.oldMode,
      newMode: current.newMode,
      isNew: current.isNew,
      isDeleted: current.isDeleted,
      isRename: current.isRename,
      similarity: current.similarity,
      body: bodyOf(current),
    });
    current = null;
  }
}

function bodyOf(file: MutableFile): FilePatchBody {
  if (file.binary) {
    return { kind: "binary" };
  }
  // A gitlink change is a hunk whose content is the submodule's commit line. Git
  // renders it as a one-line text hunk, which is exactly the shape that would be
  // shown to a user as a fake file edit if it were not recognised as a submodule.
  if (
    file.submodule ||
    file.oldMode === "160000" ||
    file.newMode === "160000"
  ) {
    let oldOid = file.recordedOid;
    let newOid = file.indexOid;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const match = /^Subproject commit ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(
          line.text,
        );
        if (match === null) {
          continue;
        }
        if (line.kind === "remove") {
          oldOid ??= match[1] ?? null;
        } else if (line.kind === "add") {
          newOid ??= match[1] ?? null;
        }
      }
    }
    return { kind: "submodule", oldOid, newOid };
  }
  if (file.unavailableReason !== null) {
    return { kind: "unavailable", reason: file.unavailableReason };
  }
  if (file.hunks.length === 0) {
    return { kind: "modeOnly", oldMode: file.oldMode, newMode: file.newMode };
  }
  return { kind: "text", hunks: file.hunks };
}

/**
 * Split on newlines, keeping `\r` (so CRLF content is not silently rewritten) and
 * dropping only the final empty element after a trailing newline.
 */
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

/** Strip the `a/`/`b/` prefix and surrounding quotes git prints for odd paths. */
function stripPathPrefix(value: string): string {
  if (value === "/dev/null") {
    return value;
  }
  const withoutPrefix =
    value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
  return withoutPrefix.startsWith('"') &&
    withoutPrefix.endsWith('"') &&
    withoutPrefix.length > 1
    ? withoutPrefix.slice(1, -1)
    : withoutPrefix;
}
