/**
 * `git diff --numstat -z` and `git diff --name-status -z` parsers.
 *
 * Both formats put a path in a field that can itself contain the separator, so
 * both are parsed positionally: fixed ASCII fields first, then raw bytes. The
 * measured shapes (git 2.50.1, see `tests/fixtures/bytes.ts`) are:
 *
 * ```
 * numstat:      1\t1\tbase.txt\0
 *               0\t0\t\0rename-src.txt\0moved 新\tname.txt\0   (rename: two more frames)
 *               -\t-\tbin.dat\0                                (binary)
 * name-status:  M\0base.txt\0
 *               R100\0rename-src.txt\0moved 新\tname.txt\0       (old, then new)
 * ```
 *
 * A rename is the case that punishes guessing: in numstat the counts line ends
 * with an empty third field and the two paths follow as *separate NUL-terminated
 * frames*, while in name-status the score rides along in the status field. Both
 * are handled explicitly, and both are exercised by live fixtures.
 */
import { GitOutputParseError } from "../ports.js";
import { FrameReader, splitNulFrames } from "../bytes/nul.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "unmerged";

/**
 * One numstat entry. There is deliberately no change kind here: numstat reports
 * line counts only, and the caller joins it with name-status (or `--raw`) to learn
 * what happened. Inventing "modified" for every entry would hide a delete.
 */
export interface NumstatEntry {
  readonly insertions: number | null;
  readonly deletions: number | null;
  readonly path: Uint8Array;
  readonly originalPath: Uint8Array | null;
  readonly binary: boolean;
}

export interface NameStatusEntry {
  readonly changeKind: ChangeKind;
  readonly path: Uint8Array;
  readonly originalPath: Uint8Array | null;
  readonly score: number | null;
  /** The raw status token, e.g. `M`, `D`, `R100`, `U`. */
  readonly rawStatus: string;
}

const NUMSTAT_FORMAT = "diff --numstat -z";
const NAME_STATUS_FORMAT = "diff --name-status -z";

/** Map one porcelain status letter to a change kind, refusing unknown letters. */
function changeKindFromLetter(
  letter: string,
  format: string,
  offset: number,
): ChangeKind {
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typeChanged";
    case "U":
      return "unmerged";
    default:
      throw new GitOutputParseError(
        format,
        `unknown change status '${letter}'`,
        offset,
      );
  }
}

export function parseNumstat(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): NumstatEntry[] {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.refListMaxEntries;
  const frames = splitNulFrames(bytes, NUMSTAT_FORMAT);
  const entries: NumstatEntry[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined || frame.byteLength === 0) {
      continue;
    }
    if (entries.length >= maxEntries) {
      throw new GitOutputParseError(
        NUMSTAT_FORMAT,
        `numstat exceeded ${maxEntries} entries`,
      );
    }
    const reader = new FrameReader(frame, NUMSTAT_FORMAT);
    // Counts are TAB-separated and the path follows the second TAB, so the TAB
    // count is fixed and a path containing tabs keeps them.
    const insertionsField = decodeAsciiField(reader.takeUntil(0x09));
    reader.expectByte(0x09, "a tab after the insertion count");
    const deletionsField = decodeAsciiField(reader.takeUntil(0x09));
    reader.expectByte(0x09, "a tab after the deletion count");
    const pathPart = reader.takeRest();
    const binary = insertionsField === "-" && deletionsField === "-";
    const insertions = binary
      ? null
      : parseCount(insertionsField, NUMSTAT_FORMAT);
    const deletions = binary
      ? null
      : parseCount(deletionsField, NUMSTAT_FORMAT);

    if (pathPart.byteLength === 0) {
      // A rename or copy: the next two frames are the original and the new path.
      const originalPath = frames[index + 1];
      const newPath = frames[index + 2];
      if (originalPath === undefined || newPath === undefined) {
        throw new GitOutputParseError(
          NUMSTAT_FORMAT,
          "rename entry was not followed by its two path frames",
          frame.byteLength,
        );
      }
      index += 2;
      if (originalPath.byteLength === 0 || newPath.byteLength === 0) {
        throw new GitOutputParseError(
          NUMSTAT_FORMAT,
          "rename entry has an empty path",
        );
      }
      entries.push({
        insertions,
        deletions,
        path: newPath,
        originalPath,
        binary,
      });
      continue;
    }

    entries.push({
      insertions,
      deletions,
      path: pathPart,
      originalPath: null,
      binary,
    });
  }

  return entries;
}

function decodeAsciiField(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(
        NUMSTAT_FORMAT,
        "unexpected non-ASCII byte in a count field",
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}

function parseCount(field: string, format: string): number {
  for (const character of field) {
    const code = character.charCodeAt(0);
    if (code < 0x30 || code > 0x39) {
      throw new GitOutputParseError(
        format,
        `expected a line count but found '${field}'`,
      );
    }
  }
  return Number.parseInt(field, 10);
}

export function parseNameStatus(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): NameStatusEntry[] {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.refListMaxEntries;
  const frames = splitNulFrames(bytes, NAME_STATUS_FORMAT);
  const entries: NameStatusEntry[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined || frame.byteLength === 0) {
      continue;
    }
    if (entries.length >= maxEntries) {
      throw new GitOutputParseError(
        NAME_STATUS_FORMAT,
        `name-status exceeded ${maxEntries} entries`,
      );
    }
    const status = decodeAsciiFrame(frame);
    const letter = status.slice(0, 1);
    const changeKind = changeKindFromLetter(letter, NAME_STATUS_FORMAT, 0);
    const hasSecond = letter === "R" || letter === "C";
    let score: number | null = null;
    if (hasSecond) {
      const scoreText = status.slice(1);
      if (scoreText.length === 0 || !/^\d+$/.test(scoreText)) {
        throw new GitOutputParseError(
          NAME_STATUS_FORMAT,
          `rename/copy status '${status}' has no score`,
        );
      }
      score = Number.parseInt(scoreText, 10);
    } else if (status.length !== 1) {
      throw new GitOutputParseError(
        NAME_STATUS_FORMAT,
        `unexpected status token '${status}'`,
      );
    }

    if (hasSecond) {
      const originalPath = frames[index + 1];
      const newPath = frames[index + 2];
      if (originalPath === undefined || newPath === undefined) {
        throw new GitOutputParseError(
          NAME_STATUS_FORMAT,
          "rename/copy entry was not followed by its two path frames",
        );
      }
      index += 2;
      if (originalPath.byteLength === 0 || newPath.byteLength === 0) {
        throw new GitOutputParseError(
          NAME_STATUS_FORMAT,
          "rename/copy entry has an empty path",
        );
      }
      entries.push({
        changeKind,
        path: newPath,
        originalPath,
        score,
        rawStatus: status,
      });
      continue;
    }

    const path = frames[index + 1];
    if (path === undefined) {
      throw new GitOutputParseError(
        NAME_STATUS_FORMAT,
        "status entry was not followed by a path frame",
      );
    }
    index += 1;
    if (path.byteLength === 0) {
      throw new GitOutputParseError(
        NAME_STATUS_FORMAT,
        "status entry has an empty path",
      );
    }
    entries.push({
      changeKind,
      path,
      originalPath: null,
      score: null,
      rawStatus: status,
    });
  }

  return entries;
}

function decodeAsciiFrame(frame: Uint8Array): string {
  let text = "";
  for (const byte of frame) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(
        NAME_STATUS_FORMAT,
        "status token contains a non-ASCII byte",
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}
