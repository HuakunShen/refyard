/**
 * Small formatting helpers shared by the panes.
 *
 * They are pure and locale-independent on purpose. A Git UI shows two kinds of time —
 * "3 minutes ago" for scanning, and an exact instant when the user is deciding whether
 * two commits are the same — so both are produced here, the relative one from a
 * `now` argument the caller supplies (which is what makes it testable and stable in a
 * fixture) rather than from a clock read inside the function.
 */
import type { DiffFile, StatusEntry } from "@refyard/git-contract";

/** Abbreviate an object id for display; never truncate an id that is already short. */
export function shortOid(oid: string): string {
  return oid.length <= 8 ? oid : oid.slice(0, 8);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "just now" / "12 minutes ago" / "5 days ago".
 *
 * English units are fixed rather than localised: the surrounding UI has no translation
 * layer yet, and a half-translated pane is worse than an untranslated one. When
 * localisation arrives it arrives for the whole surface at once.
 */
export function relativeTime(isoTimestamp: string, now: number): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) {
    return "unknown time";
  }
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 0) {
    return "in the future";
  }
  if (seconds < 45) {
    return "just now";
  }
  const units: readonly (readonly [number, string])[] = [
    [YEAR, "year"],
    [MONTH, "month"],
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
  ];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${name}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Exact UTC instant, e.g. `2026-09-15 10:04 UTC`. */
export function absoluteTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}

/**
 * A compact absolute stamp in the viewer's own timezone, for the history table's
 * date column (GitKraken shows absolute stamps there too — a column of "3 minutes
 * ago" cannot be scanned for "when was this"). The exact UTC instant stays in the
 * hover tooltip via `absoluteTime`.
 */
export function shortAbsoluteTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Byte counts for diff stats and truncation notices. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value = value / 1024;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex] ?? "KiB"}`;
}

/**
 * Git's porcelain-v2 status characters, spelled out.
 *
 * The status letters are Git's own and are shown as-is in the list; this map exists so
 * a reader who does not have them memorised can hover a row and learn what `.M` means.
 */
const STATUS_LETTERS: Readonly<Record<string, string>> = {
  ".": "unchanged",
  M: "modified",
  T: "type changed",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "updated but unmerged",
  "?": "untracked",
  "!": "ignored",
};

export function statusLetterLabel(letter: string): string {
  return STATUS_LETTERS[letter] ?? letter;
}

export function statusEntryLabel(entry: StatusEntry): string {
  const index = statusLetterLabel(entry.indexStatus);
  const worktree = statusLetterLabel(entry.worktreeStatus);
  return `index: ${index}, working tree: ${worktree}`;
}

const CHANGE_KINDS: Readonly<Record<DiffFile["changeKind"], string>> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  typeChanged: "type changed",
  unmerged: "unmerged",
};

export function changeKindLabel(kind: DiffFile["changeKind"]): string {
  return CHANGE_KINDS[kind];
}

/** `+12 −3`, or `binary` when a diff has no line counts. */
export function diffStatLabel(file: DiffFile): string {
  if (file.isBinary) {
    return "binary";
  }
  if (file.insertions === null && file.deletions === null) {
    return "no line counts";
  }
  return `+${file.insertions ?? 0} −${file.deletions ?? 0}`;
}

/** A head state described for a human: branch name, detached id, or unborn. */
export function headLabel(head: {
  readonly kind: "born" | "unborn";
  readonly branchName: string | null;
  readonly oid: string | null;
  readonly detached: boolean;
}): string {
  if (head.kind === "unborn") {
    return "no commits yet";
  }
  if (head.detached && head.oid !== null) {
    return `detached at ${shortOid(head.oid)}`;
  }
  if (head.branchName !== null) {
    return head.branchName;
  }
  return head.oid === null ? "unknown" : shortOid(head.oid);
}
