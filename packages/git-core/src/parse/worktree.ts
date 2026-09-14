/**
 * `git worktree list --porcelain -z` parser.
 *
 * Measured shape (git 2.50.1):
 *
 * ```
 * worktree /path/to/repo\0HEAD 20ba62dd…\0branch refs/heads/main\0\0
 * ```
 *
 * Attributes are NUL-terminated within a block and an extra NUL separates blocks.
 * `worktree`, `HEAD`, `branch` carry a value after one space; `bare`, `detached`,
 * `locked` and `prunable` are flags, and the last two may carry a reason that
 * itself contains spaces or newlines — so the reason is taken as raw bytes after
 * the first space rather than as a token.
 *
 * The path is bytes. A worktree path can be a POSIX byte path that is not valid
 * UTF-8, and it is the one field a later write would address, so it is never
 * decoded here.
 */
import { GitOutputParseError } from "../ports.js";
import { splitNulFrames } from "../bytes/nul.js";

export interface WorktreeRecord {
  /** Raw path bytes of the worktree. */
  readonly pathBytes: Uint8Array;
  readonly headOid: string | null;
  /** Full ref name when a branch is checked out, e.g. `refs/heads/main`. */
  readonly branchRef: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockReasonBytes: Uint8Array | null;
  readonly prunable: boolean;
  readonly pruneReasonBytes: Uint8Array | null;
}

const FORMAT = "worktree list --porcelain -z";

export function parseWorktreeList(bytes: Uint8Array): WorktreeRecord[] {
  // Blocks are separated by an empty frame, so an empty frame starts a new block.
  const frames = splitNulFrames(bytes, FORMAT);
  const worktrees: WorktreeRecord[] = [];
  let current: {
    pathBytes?: Uint8Array;
    headOid?: string | null;
    branchRef?: string | null;
    bare?: boolean;
    detached?: boolean;
    locked?: boolean;
    lockReasonBytes?: Uint8Array | null;
    prunable?: boolean;
    pruneReasonBytes?: Uint8Array | null;
  } | null = null;

  const flush = (): void => {
    if (current === null) {
      return;
    }
    if (current.pathBytes === undefined) {
      throw new GitOutputParseError(
        FORMAT,
        "worktree block has no `worktree` attribute",
      );
    }
    worktrees.push({
      pathBytes: current.pathBytes,
      headOid: current.headOid ?? null,
      branchRef: current.branchRef ?? null,
      bare: current.bare ?? false,
      detached: current.detached ?? false,
      locked: current.locked ?? false,
      lockReasonBytes: current.lockReasonBytes ?? null,
      prunable: current.prunable ?? false,
      pruneReasonBytes: current.pruneReasonBytes ?? null,
    });
    current = null;
  };

  for (const frame of frames) {
    if (frame.byteLength === 0) {
      flush();
      continue;
    }
    current ??= {};
    const spaceIndex = indexOfSpace(frame);
    const keyword = decodeAscii(
      frame.subarray(0, spaceIndex === -1 ? frame.byteLength : spaceIndex),
    );
    const value = spaceIndex === -1 ? null : frame.subarray(spaceIndex + 1);
    switch (keyword) {
      case "worktree":
        if (value === null || value.byteLength === 0) {
          throw new GitOutputParseError(
            FORMAT,
            "worktree attribute has no path",
          );
        }
        current.pathBytes = value;
        break;
      case "HEAD": {
        if (value === null) {
          throw new GitOutputParseError(
            FORMAT,
            "HEAD attribute has no object name",
          );
        }
        const oid = decodeAscii(value);
        if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid)) {
          throw new GitOutputParseError(
            FORMAT,
            `unexpected HEAD object name '${oid}'`,
          );
        }
        current.headOid = oid;
        break;
      }
      case "branch": {
        if (value === null) {
          throw new GitOutputParseError(FORMAT, "branch attribute has no ref");
        }
        current.branchRef = decodeAscii(value);
        break;
      }
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      case "locked":
        current.locked = true;
        current.lockReasonBytes = value;
        break;
      case "prunable":
        current.prunable = true;
        current.pruneReasonBytes = value;
        break;
      default:
        // Unknown attributes are ignored so a newer Git does not break a read.
        break;
    }
  }
  flush();

  return worktrees;
}

function indexOfSpace(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 0x20) {
      return index;
    }
  }
  return -1;
}

function decodeAscii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte > 0x7f) {
      throw new GitOutputParseError(
        FORMAT,
        "unexpected non-ASCII byte in an ASCII attribute",
      );
    }
    text += String.fromCharCode(byte);
  }
  return text;
}
