/**
 * `git status --porcelain=v2 --branch -z` parser.
 *
 * The output is a NUL-terminated stream of records whose first field is a type
 * character. Ordinal fields are fixed in count and width (`XY`, `sub`, modes,
 * OIDs); the path is everything after the last fixed field, kept as raw bytes.
 * That is the only way a file called `line\nbreak.txt` or `tab\tname.txt` survives
 * — and the capture fixtures in `tests/fixtures/bytes.ts` contain exactly those,
 * taken from a real repository.
 *
 * Renames are the one record type with two paths, and the *second* one arrives as
 * its own NUL-terminated frame. Reading it as part of the first frame is the
 * classic way to corrupt a rename.
 *
 * Unknown `#` headers are ignored (Git adds headers over time and a new one must
 * not break a read), while an unknown record type is an error: silently skipping
 * a record type we do not understand would drop changes from the UI.
 */
import { GitOutputParseError } from "../ports.js";
import { FrameReader, splitNulFrames } from "../bytes/nul-framing.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export type StatusRecordKind =
  "ordinary" | "renamed" | "copied" | "unmerged" | "untracked" | "ignored";

export interface StatusUnmergedStage {
  readonly stage: 1 | 2 | 3;
  readonly mode: string;
  readonly oid: string;
}

export interface StatusRecord {
  readonly kind: StatusRecordKind;
  /** `X` of porcelain v2: index status. `.` means unmodified. */
  readonly indexStatus: string;
  /** `Y` of porcelain v2: worktree status. `.` means unmodified. */
  readonly worktreeStatus: string;
  /** Raw `sub` field (`N...`, `S.M.`, …), uninterpreted. */
  readonly submoduleField: string;
  readonly modes: {
    readonly head: string | null;
    readonly index: string | null;
    readonly worktree: string | null;
  };
  readonly oids: {
    readonly head: string | null;
    readonly index: string | null;
  };
  /** Raw path bytes. Never decoded, never trimmed. */
  readonly path: Uint8Array;
  /** Original path of a rename/copy, raw bytes. */
  readonly originalPath: Uint8Array | null;
  /** Similarity score of a rename/copy (`R100` → 100). */
  readonly score: number | null;
  /** Stage entries of an unmerged path, base/ours/theirs. */
  readonly stages: readonly StatusUnmergedStage[];
  /** Whether `sub` indicates a submodule whose commit changed. */
  readonly submoduleCommitChanged: boolean;
  /** Whether `sub` indicates a submodule with a modified working tree. */
  readonly submoduleModified: boolean;
  /** Whether `sub` indicates a submodule with untracked files. */
  readonly submoduleUntracked: boolean;
}

export interface StatusBranch {
  /** True when at least one `# branch.*` header was present in the output. */
  readonly seen: boolean;
  /** `(initial)` in the header means an unborn branch, not a missing field. */
  readonly initial: boolean;
  readonly detached: boolean;
  readonly oid: string | null;
  readonly head: string | null;
}

export interface StatusParseResult {
  readonly branch: StatusBranch;
  readonly upstream: string | null;
  readonly aheadBehind: {
    readonly ahead: number;
    readonly behind: number;
  } | null;
  readonly stashCount: number | null;
  readonly records: readonly StatusRecord[];
}

const FORMAT = "status --porcelain=v2 -z";

/**
 * Parse a complete status buffer.
 *
 * `branch.oid` is `(initial)` in a repository without commits, and
 * `branch.head` is `(detached)` when HEAD is detached; both are reported as flags
 * rather than as magic strings in a field the UI would have to know about.
 */
export function parseStatus(
  bytes: Uint8Array,
  options: { maxEntries?: number } = {},
): StatusParseResult {
  const maxEntries = options.maxEntries ?? CORE_LIMITS.statusMaxEntries;
  const frames = splitNulFrames(bytes, FORMAT);
  // Header fields are collected as plain locals: the two `branch.*` headers can
  // appear in either order, and reading a partially built object while building it
  // is both confusing and impossible for the type checker to follow.
  let branchSeen = false;
  let branchInitial = false;
  let branchDetached = false;
  let branchOid: string | null = null;
  let branchHead: string | null = null;
  let upstream: string | null = null;
  let aheadBehind: { ahead: number; behind: number } | null = null;
  let stashCount: number | null = null;
  const records: StatusRecord[] = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) {
      continue;
    }
    if (frame.byteLength === 0) {
      continue;
    }
    const type = frame[0];
    switch (type) {
      case 0x23: {
        // '#': a header. Recognised ones are recorded; new ones are ignored.
        const header = new FrameReader(frame.subarray(1), FORMAT);
        header.expectSpace();
        const key = header.takeField();
        switch (key) {
          case "branch.oid": {
            header.expectSpace();
            const value = header.takeRestAscii();
            branchSeen = true;
            branchInitial = value === "(initial)";
            branchOid = branchInitial ? null : value;
            break;
          }
          case "branch.head": {
            header.expectSpace();
            const value = header.takeRestAscii();
            branchSeen = true;
            branchDetached = value === "(detached)";
            branchHead = branchDetached ? null : value;
            break;
          }
          case "branch.upstream": {
            header.expectSpace();
            upstream = header.takeRestAscii();
            break;
          }
          case "branch.ab": {
            header.expectSpace();
            const ahead = readSignedCount(header.takeField(), "+");
            header.expectSpace();
            const behind = readSignedCount(header.takeField(), "-");
            aheadBehind = { ahead, behind };
            break;
          }
          case "stash": {
            header.expectSpace();
            stashCount = header.takeNumber();
            break;
          }
          default:
            break;
        }
        break;
      }
      case 0x31: {
        // '1': ordinary changed entry.
        if (records.length >= maxEntries) {
          throw new GitOutputParseError(
            FORMAT,
            `status exceeded ${maxEntries} entries`,
          );
        }
        records.push(parseOrdinary(frame));
        break;
      }
      case 0x32: {
        // '2': renamed or copied entry, with the original path in the next frame.
        if (records.length >= maxEntries) {
          throw new GitOutputParseError(
            FORMAT,
            `status exceeded ${maxEntries} entries`,
          );
        }
        const originalFrame = frames[index + 1];
        if (originalFrame === undefined) {
          throw new GitOutputParseError(
            FORMAT,
            "rename record was not followed by its original path frame",
            frame.byteLength,
          );
        }
        index += 1;
        records.push(parseRename(frame, originalFrame));
        break;
      }
      case 0x75: {
        // 'u': unmerged entry.
        if (records.length >= maxEntries) {
          throw new GitOutputParseError(
            FORMAT,
            `status exceeded ${maxEntries} entries`,
          );
        }
        records.push(parseUnmerged(frame));
        break;
      }
      case 0x3f: {
        // '?': untracked.
        records.push(parsePathOnly(frame, "untracked"));
        break;
      }
      case 0x21: {
        // '!': ignored.
        records.push(parsePathOnly(frame, "ignored"));
        break;
      }
      default:
        throw new GitOutputParseError(
          FORMAT,
          `unknown record type '${String.fromCharCode(type ?? 0x3f)}'`,
          0,
        );
    }
  }

  return {
    branch: {
      seen: branchSeen,
      initial: branchInitial,
      detached: branchDetached,
      oid: branchOid,
      head: branchHead,
    },
    upstream,
    aheadBehind,
    stashCount,
    records,
  };
}

function readSignedCount(field: string, sign: string): number {
  if (!field.startsWith(sign)) {
    throw new GitOutputParseError(
      FORMAT,
      `expected '${sign}<n>' but found '${field}'`,
    );
  }
  const digits = field.slice(1);
  for (const character of digits) {
    const code = character.charCodeAt(0);
    if (code < 0x30 || code > 0x39) {
      throw new GitOutputParseError(
        FORMAT,
        `expected a count after '${sign}' but found '${field}'`,
      );
    }
  }
  return Number.parseInt(digits, 10);
}

function parseCommonFields(reader: FrameReader): {
  indexStatus: string;
  worktreeStatus: string;
} {
  const xy = reader.takeFixedString(2);
  return { indexStatus: xy[0] ?? ".", worktreeStatus: xy[1] ?? "." };
}

function readZeroedOid(value: string): string | null {
  return /^0+$/.test(value) ? null : value;
}

function submoduleFlags(sub: string): {
  commitChanged: boolean;
  modified: boolean;
  untracked: boolean;
} {
  // `sub` is four characters: N or S, then C/M/U flags for commit, worktree,
  // untracked. `N...` means "not a submodule".
  if (sub.length !== 4 || sub[0] !== "S") {
    return { commitChanged: false, modified: false, untracked: false };
  }
  return {
    commitChanged: sub[1] === "C",
    modified: sub[2] === "M",
    untracked: sub[3] === "U",
  };
}

function parseOrdinary(frame: Uint8Array): StatusRecord {
  const reader = new FrameReader(frame.subarray(1), FORMAT);
  reader.expectSpace();
  const { indexStatus, worktreeStatus } = parseCommonFields(reader);
  reader.expectSpace();
  const sub = reader.takeFixedString(4);
  reader.expectSpace();
  const modeHead = reader.takeBytes(6);
  reader.expectSpace();
  const modeIndex = reader.takeBytes(6);
  reader.expectSpace();
  const modeWorktree = reader.takeBytes(6);
  reader.expectSpace();
  const headOid = reader.takeOid();
  reader.expectSpace();
  const indexOid = reader.takeOid();
  reader.expectSpace();
  const path = reader.takeRest();
  if (path.byteLength === 0) {
    throw new GitOutputParseError(FORMAT, "ordinary entry has an empty path");
  }
  const flags = submoduleFlags(sub);
  return {
    kind: "ordinary",
    indexStatus,
    worktreeStatus,
    submoduleField: sub,
    modes: {
      head: decodeMode(modeHead),
      index: decodeMode(modeIndex),
      worktree: decodeMode(modeWorktree),
    },
    oids: { head: readZeroedOid(headOid), index: readZeroedOid(indexOid) },
    path,
    originalPath: null,
    score: null,
    stages: [],
    submoduleCommitChanged: flags.commitChanged,
    submoduleModified: flags.modified,
    submoduleUntracked: flags.untracked,
  };
}

function decodeMode(bytes: Uint8Array): string | null {
  let text = "";
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return /^0+$/.test(text) ? null : text;
}

function parseRename(
  frame: Uint8Array,
  originalFrame: Uint8Array,
): StatusRecord {
  const reader = new FrameReader(frame.subarray(1), FORMAT);
  reader.expectSpace();
  const { indexStatus, worktreeStatus } = parseCommonFields(reader);
  reader.expectSpace();
  const sub = reader.takeFixedString(4);
  reader.expectSpace();
  const modeHead = reader.takeBytes(6);
  reader.expectSpace();
  const modeIndex = reader.takeBytes(6);
  reader.expectSpace();
  const modeWorktree = reader.takeBytes(6);
  reader.expectSpace();
  const headOid = reader.takeOid();
  reader.expectSpace();
  const indexOid = reader.takeOid();
  reader.expectSpace();
  // The score field is a single character (`R` or `C`) followed by a number with
  // no separator before the path.
  const scoreKind = reader.takeFixedString(1);
  let scoreText = "";
  for (;;) {
    const next = reader.rest()[0];
    if (next === undefined || next === 0x20) {
      break;
    }
    scoreText += String.fromCharCode(next);
    reader.takeBytes(1);
  }
  if (scoreText.length === 0) {
    throw new GitOutputParseError(
      FORMAT,
      "rename/copy entry has no similarity score",
    );
  }
  reader.expectSpace();
  const path = reader.takeRest();
  if (path.byteLength === 0) {
    throw new GitOutputParseError(
      FORMAT,
      "rename/copy entry has an empty path",
    );
  }
  if (originalFrame.byteLength === 0) {
    throw new GitOutputParseError(
      FORMAT,
      "rename/copy entry has an empty original path",
    );
  }
  const flags = submoduleFlags(sub);
  return {
    kind: scoreKind === "C" ? "copied" : "renamed",
    indexStatus,
    worktreeStatus,
    submoduleField: sub,
    modes: {
      head: decodeMode(modeHead),
      index: decodeMode(modeIndex),
      worktree: decodeMode(modeWorktree),
    },
    oids: { head: readZeroedOid(headOid), index: readZeroedOid(indexOid) },
    path,
    originalPath: originalFrame,
    score: Number.parseInt(scoreText, 10),
    stages: [],
    submoduleCommitChanged: flags.commitChanged,
    submoduleModified: flags.modified,
    submoduleUntracked: flags.untracked,
  };
}

function parseUnmerged(frame: Uint8Array): StatusRecord {
  const reader = new FrameReader(frame.subarray(1), FORMAT);
  reader.expectSpace();
  const { indexStatus, worktreeStatus } = parseCommonFields(reader);
  reader.expectSpace();
  const sub = reader.takeFixedString(4);
  reader.expectSpace();
  // Four modes: stages 1–3 and the working tree, each six octal digits.
  const stageModes: string[] = [];
  for (let stage = 0; stage < 3; stage += 1) {
    stageModes.push(decodeMode(reader.takeBytes(6)) ?? "000000");
    reader.expectSpace();
  }
  const worktreeMode = reader.takeBytes(6);
  reader.expectSpace();
  const oids: string[] = [];
  for (let stage = 0; stage < 3; stage += 1) {
    oids.push(reader.takeOid());
    reader.expectSpace();
  }
  const path = reader.takeRest();
  if (path.byteLength === 0) {
    throw new GitOutputParseError(FORMAT, "unmerged entry has an empty path");
  }
  const stages: StatusUnmergedStage[] = [];
  for (let index = 0; index < 3; index += 1) {
    const mode = stageModes[index];
    const oid = oids[index];
    if (mode === undefined || oid === undefined || mode === "000000") {
      continue;
    }
    stages.push({ stage: (index + 1) as 1 | 2 | 3, mode, oid });
  }
  return {
    kind: "unmerged",
    indexStatus,
    worktreeStatus,
    submoduleField: sub,
    modes: { head: null, index: null, worktree: decodeMode(worktreeMode) },
    oids: { head: null, index: null },
    path,
    originalPath: null,
    score: null,
    stages,
    submoduleCommitChanged: false,
    submoduleModified: false,
    submoduleUntracked: false,
  };
}

function parsePathOnly(
  frame: Uint8Array,
  kind: "untracked" | "ignored",
): StatusRecord {
  const reader = new FrameReader(frame.subarray(1), FORMAT);
  reader.expectSpace();
  const path = reader.takeRest();
  if (path.byteLength === 0) {
    throw new GitOutputParseError(FORMAT, `${kind} entry has an empty path`);
  }
  return {
    kind,
    indexStatus: kind === "untracked" ? "?" : "!",
    worktreeStatus: kind === "untracked" ? "?" : "!",
    submoduleField: "N...",
    modes: { head: null, index: null, worktree: null },
    oids: { head: null, index: null },
    path,
    originalPath: null,
    score: null,
    stages: [],
    submoduleCommitChanged: false,
    submoduleModified: false,
    submoduleUntracked: false,
  };
}
