/**
 * Host-side facts the reads need, and small conversions the contract requires.
 *
 * These are the pieces of a read that only the machine can answer:
 *
 * - **Operation markers.** Whether a merge, rebase or cherry-pick is in progress is
 *   a fact about files in the repository's Git directory. It is read from the
 *   filesystem rather than guessed from status text, and the mapping from marker to
 *   state lives in core so it is testable without a filesystem.
 * - **Per-worktree Git directories.** A linked worktree has its own Git directory
 *   inside the common one; markers must be read from the right one, and the layout
 *   read is the only honest way to find it.
 * - **URL redaction.** A remote URL may contain a credential. It is shown with the
 *   userinfo removed, and no URL ever reaches a log or a mutation argument.
 * - **Untracked patches.** Git has no diff for an untracked file, so the only way to
 *   show its content is to read the file — through the worktree's approved handle,
 *   bounded, and marked `synthesized` so a client knows it did not come from Git.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DisplayPath, TextCodec } from "@refyard/git-core";
import { readLayout, type GitEngine } from "@refyard/git-core";
import { isInsideOrEqual } from "../filesystem/handles.js";

/** Marker file names, in the order Git's own output suggests checking them. */
const MARKER_NAMES: readonly string[] = [
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "rebase-merge",
  "rebase-apply",
  "BISECT_LOG",
];

/**
 * Which operation markers exist in one Git directory.
 *
 * An unreadable directory yields no markers rather than an error: the status read
 * that follows will report the real problem, and a missing marker must never turn
 * into an invented "no operation in progress" claim about a directory nobody could
 * read. Callers treat an empty list as "nothing observed".
 */
export async function readOperationMarkers(gitDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(gitDir);
  } catch {
    return [];
  }
  const present = new Set(entries);
  return MARKER_NAMES.filter((name) => present.has(name));
}

export interface GitDirLookup {
  /** Git directory of one worktree, resolved once and remembered. */
  gitDirFor(input: {
    readonly worktreeId: string;
    readonly handle: string;
    readonly isMain: boolean;
    readonly primaryGitDir: string;
  }): Promise<string>;
  forget(worktreeId: string): void;
}

export function createGitDirLookup(engine: GitEngine): GitDirLookup {
  const cache = new Map<string, string>();
  return {
    async gitDirFor(input): Promise<string> {
      if (input.isMain) {
        cache.set(input.worktreeId, input.primaryGitDir);
        return input.primaryGitDir;
      }
      const cached = cache.get(input.worktreeId);
      if (cached !== undefined) {
        return cached;
      }
      const layout = await readLayout(engine, { cwdHandle: input.handle });
      cache.set(input.worktreeId, layout.gitDir);
      return layout.gitDir;
    },
    forget(worktreeId): void {
      cache.delete(worktreeId);
    },
  };
}

/**
 * A remote URL with any credential removed.
 *
 * `https://user:token@host/path` becomes `https://host/path`, and an SSH URL keeps
 * its user because `git@host:path` names an account, not a secret. A URL that
 * cannot be parsed is returned with everything before the last `@` removed, which
 * is the conservative direction: it can lose a host name but never leaks a token.
 */
export function redactRemoteUrl(url: string): string {
  const schemeSeparator = url.indexOf("://");
  if (schemeSeparator === -1) {
    // scp-like `user@host:path`. A bare user names an account; a colon before the
    // `@` means a password, and everything up to the `@` goes.
    const at = url.lastIndexOf("@");
    const colon = url.indexOf(":");
    if (at !== -1 && colon !== -1 && colon < at) {
      return url.slice(at + 1);
    }
    return url;
  }
  const scheme = url.slice(0, schemeSeparator);
  const rest = url.slice(schemeSeparator + 3);
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash);
  const at = authority.lastIndexOf("@");
  if (at === -1) {
    return url;
  }
  const userInfo = authority.slice(0, at);
  // A password (`user:secret@`) is always removed; a bare user name is kept only for
  // SSH-style URLs, where it selects an account rather than authenticating.
  const hasPassword = userInfo.includes(":");
  if (scheme === "ssh" && !hasPassword) {
    return url;
  }
  return `${scheme}://${authority.slice(at + 1)}${path}`;
}

export interface SynthesizedPatch {
  readonly kind: "text" | "binary" | "oversize" | "unavailable";
  readonly hunks?: readonly {
    readonly header: string;
    readonly oldStart: number;
    readonly oldLines: number;
    readonly newStart: number;
    readonly newLines: number;
    readonly lines: readonly {
      readonly kind: "context" | "add" | "remove";
      readonly text: string;
      readonly noNewline: boolean;
    }[];
  }[];
  readonly reason?: string;
}

/**
 * Build a patch for an untracked file from its bytes.
 *
 * The file is read only when the path is inside the worktree it was reported in,
 * and only up to `maxBytes`; a larger file is reported as `oversize` instead of
 * being read in full. Text that is not valid UTF-8 is reported as `binary`, because
 * showing replacement characters in a diff would misrepresent the file's content.
 */
export async function synthesizeUntrackedPatch(input: {
  readonly worktreePath: string;
  readonly relativePath: string;
  readonly maxBytes: number;
  readonly codec: TextCodec;
}): Promise<SynthesizedPatch> {
  const absolute = join(input.worktreePath, input.relativePath);
  if (!isInsideOrEqual(input.worktreePath, absolute)) {
    return { kind: "unavailable", reason: "the path is outside the worktree" };
  }
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return { kind: "unavailable", reason: "the file could not be read" };
  }
  if (!info.isFile()) {
    return { kind: "unavailable", reason: "not a regular file" };
  }
  if (info.size > input.maxBytes) {
    return { kind: "oversize", reason: `the file is ${info.size} bytes` };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(absolute));
  } catch {
    return { kind: "unavailable", reason: "the file could not be read" };
  }
  if (bytes.includes(0x00)) {
    return { kind: "binary" };
  }
  const display = input.codec.toDisplayPath(bytes);
  if (!display.representable) {
    return { kind: "binary" };
  }
  const text = display.text;
  const endsWithNewline = text.endsWith("\n");
  const body = endsWithNewline ? text.slice(0, -1) : text;
  const rawLines = body.length === 0 ? [] : body.split("\n");
  const lines = rawLines.map((line, index) => ({
    kind: "add" as const,
    text: line,
    noNewline: !endsWithNewline && index === rawLines.length - 1,
  }));
  if (lines.length === 0) {
    // An untracked empty file is a real state: it has no lines at all.
    return {
      kind: "text",
      hunks: [
        {
          header: "@@ -0,0 +1,0 @@",
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 0,
          lines: [],
        },
      ],
    };
  }
  return {
    kind: "text",
    hunks: [
      {
        header: `@@ -0,0 +1,${lines.length} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines,
      },
    ],
  };
}

/** True when a path is a regular file inside the directory; used for `.gitmodules`. */
export async function fileExistsIn(
  directory: string,
  name: string,
): Promise<boolean> {
  try {
    const info = await stat(join(directory, name));
    return info.isFile();
  } catch {
    return false;
  }
}

/** ISO-8601 UTC from Git's epoch seconds. The contract's timestamp form. */
export function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

/** Display text for a path binding, used where only a label is needed. */
export function displayLabel(display: DisplayPath): string {
  return display.text;
}
