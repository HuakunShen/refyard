/**
 * Retention: what may be forgotten, and what it is not allowed to forget.
 *
 * The rule from the design is one sentence — only expired **terminal** records may
 * be dropped, and if nothing can be dropped the service refuses new work rather
 * than deleting something a user might still be looking at.
 *
 * That last clause is why this is its own module with its own tests: "make room"
 * is the kind of thing that quietly becomes "delete the oldest record" under
 * pressure, and a journal that silently loses an unresolved operation is worse than
 * a service that says it is full.
 */
import type { OperationStatus } from "@refyard/git-contract";

export interface RetentionPolicy {
  /** How long a terminal record is kept, in milliseconds. */
  readonly ttlMs: number;
  /** How many records may be held. */
  readonly maxEntries: number;
  /** How many bytes the journal file may occupy. */
  readonly maxBytes: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  ttlMs: 24 * 60 * 60 * 1000,
  maxEntries: 2_000,
  maxBytes: 16 * 1024 * 1024,
};

/** A state after which nothing further will be written for that operation. */
export function isTerminalStatus(status: OperationStatus): boolean {
  return (
    status === "succeeded" ||
    status === "failed" ||
    status === "needsAttention" ||
    status === "unknown" ||
    status === "cancelled"
  );
}

/**
 * May this record be dropped now?
 *
 * `unknown` is terminal but is treated conservatively: it is the state a user has
 * to resolve by looking at their repository, so it is kept for the full TTL and is
 * never pruned early to make room.
 */
export function mayPruneRecord(
  entry: {
    readonly status: OperationStatus;
    readonly finishedAtMs: number | null;
    readonly acceptedAtMs: number;
  },
  nowMs: number,
  policy: RetentionPolicy,
): boolean {
  if (!isTerminalStatus(entry.status)) {
    return false;
  }
  const finishedAt = entry.finishedAtMs ?? entry.acceptedAtMs;
  return nowMs - finishedAt >= policy.ttlMs;
}

export interface RetentionDecision {
  readonly keep: boolean;
  readonly reason: "unfinished" | "within-ttl" | "expired-terminal";
}

export function decideRetention(
  entry: {
    readonly status: OperationStatus;
    readonly finishedAtMs: number | null;
    readonly acceptedAtMs: number;
  },
  nowMs: number,
  policy: RetentionPolicy,
): RetentionDecision {
  if (!isTerminalStatus(entry.status)) {
    return { keep: true, reason: "unfinished" };
  }
  return mayPruneRecord(entry, nowMs, policy)
    ? { keep: false, reason: "expired-terminal" }
    : { keep: true, reason: "within-ttl" };
}

/** Would this set of records exceed the entry bound? */
export function exceedsEntryBound(
  count: number,
  policy: RetentionPolicy,
): boolean {
  return count > policy.maxEntries;
}
