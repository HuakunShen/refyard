/**
 * Read snapshots and paging cursors.
 *
 * A snapshot records what a read *was*: the Head it saw, the tips a history page
 * started from, and when it was taken. The reason it exists is the failure it
 * prevents — a page of history that re-interprets `HEAD` on every request will
 * silently interleave commits when the branch moves, and a UI showing an old page
 * would then mis-attribute rows to a ref that no longer points there.
 *
 * A cursor is a short, opaque, server-resolved handle:
 *
 * - the client receives a random `cur_…` id and exact zero information about the
 *   page it continues;
 * - the server keeps the state (snapshot, offset, page size, repository, worktree),
 *   so a cursor cannot be forged, cannot be re-pointed at another repository, and
 *   cannot be extended past its lifetime;
 * - an unknown cursor is refused rather than interpreted, and a cursor whose
 *   snapshot has been pruned is reported as stale so the UI reloads instead of
 *   guessing.
 *
 * Snapshots and cursors are bounded and never persisted: their whole lifetime is a
 * few pages of scrolling in one browser session, and a restart should invalidate
 * them rather than resume a read against state nobody recorded.
 */
import { randomBytes } from "node:crypto";
import type {
  CursorPayload,
  SnapshotKind,
  NormalizedHistoryIntent,
} from "./snapshot-types.js";

export type {
  CursorPayload,
  SnapshotKind,
  NormalizedHistoryIntent,
} from "./snapshot-types.js";

export interface SnapshotRecord {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly repositoryId: string;
  readonly worktreeId: string | null;
  readonly createdAtMs: number;
  /** Object names this read was taken from; history pages are served from these. */
  readonly tips: readonly string[];
  readonly headOid: string | null;
  /** Fixed-size complete-ref/HEAD fingerprint, independent of bounded/scoped walk tips. */
  readonly observedRefsFingerprint: string | null;
  readonly historyIntent: NormalizedHistoryIntent | null;
  /**
   * Fingerprint of the index as this snapshot saw it, or null when the read did not
   * observe the index.
   *
   * A mutation carries the snapshot it was planned against; comparing this value
   * with a fresh read is what detects "the user confirmed a state that has since
   * changed" without hashing the whole repository.
   */
  readonly indexKey: string | null;
}

export type CursorResult =
  | { readonly ok: true; readonly payload: CursorPayload }
  | {
      readonly ok: false;
      readonly reason: "malformed" | "unknown" | "expired";
    };

export interface SnapshotStoreOptions {
  readonly nextSnapshotId: () => string;
  readonly now?: () => number;
  readonly maxEntries?: number;
  /** Seconds a cursor stays usable; defaults to the snapshot lifetime. */
  readonly cursorTtlSeconds?: number;
}

export interface SnapshotStore {
  create(input: {
    readonly kind: SnapshotKind;
    readonly repositoryId: string;
    readonly worktreeId: string | null;
    readonly tips?: readonly string[];
    readonly headOid?: string | null;
    readonly indexKey?: string | null;
    readonly observedRefsFingerprint?: string | null;
    readonly historyIntent?: NormalizedHistoryIntent;
  }): SnapshotRecord;
  get(snapshotId: string): SnapshotRecord | null;
  /** Mint a cursor for a page; the id returned is the only thing the client sees. */
  createCursor(payload: CursorPayload): string;
  resolveCursor(cursor: string): CursorResult;
  prune(): void;
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 4096;
/** A snapshot older than this is not worth keeping a browser tab's cursor alive for. */
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

interface CursorRecord {
  readonly payload: CursorPayload;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function createSnapshotStore(
  options: SnapshotStoreOptions,
): SnapshotStore {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const records = new Map<string, SnapshotRecord>();
  const cursors = new Map<string, CursorRecord>();
  const cursorTtlMs =
    (options.cursorTtlSeconds ?? SNAPSHOT_TTL_MS / 1000) * 1000;

  function prune(): void {
    const current = now();
    for (const [id, record] of records) {
      if (record.createdAtMs < current - SNAPSHOT_TTL_MS) {
        records.delete(id);
      }
    }
    for (const [id, cursor] of cursors) {
      if (cursor.expiresAtMs <= current) {
        cursors.delete(id);
      }
    }
    trimOldest(records, maxEntries, (record) => record.createdAtMs);
    trimOldest(cursors, maxEntries, (cursor) => cursor.createdAtMs);
  }

  return {
    create(input): SnapshotRecord {
      prune();
      const record: SnapshotRecord = {
        snapshotId: options.nextSnapshotId(),
        kind: input.kind,
        repositoryId: input.repositoryId,
        worktreeId: input.worktreeId,
        createdAtMs: now(),
        tips: Object.freeze([...(input.tips ?? [])]),
        observedRefsFingerprint: input.observedRefsFingerprint ?? null,
        historyIntent:
          input.historyIntent === undefined
            ? null
            : Object.freeze({ ...input.historyIntent }),
        headOid: input.headOid ?? null,
        indexKey: input.indexKey ?? null,
      };
      records.set(record.snapshotId, record);
      return record;
    },

    get(snapshotId): SnapshotRecord | null {
      return records.get(snapshotId) ?? null;
    },

    createCursor(payload): string {
      prune();
      // Random and unguessable, and stored server-side: the client cannot read the
      // page it continues, cannot change it, and cannot point it elsewhere.
      const cursorId = `cur_${randomBytes(18).toString("base64url")}`;
      const createdAtMs = now();
      cursors.set(cursorId, {
        payload,
        createdAtMs,
        expiresAtMs: createdAtMs + cursorTtlMs,
      });
      return cursorId;
    },

    resolveCursor(cursor): CursorResult {
      if (!/^cur_[A-Za-z0-9_-]{1,96}$/.test(cursor)) {
        return { ok: false, reason: "malformed" };
      }
      const found = cursors.get(cursor);
      if (found === undefined) {
        return { ok: false, reason: "unknown" };
      }
      if (found.expiresAtMs <= now()) {
        cursors.delete(cursor);
        return { ok: false, reason: "expired" };
      }
      return { ok: true, payload: found.payload };
    },

    prune,

    size(): number {
      return records.size;
    },
  };
}

function trimOldest<T extends { readonly createdAtMs: number }>(
  map: Map<string, T>,
  maxEntries: number,
  createdAt: (value: T) => number,
): void {
  if (map.size <= maxEntries) {
    return;
  }
  const byAge = [...map.entries()].sort(
    (a, b) => createdAt(a[1]) - createdAt(b[1]),
  );
  for (const [id] of byAge.slice(0, map.size - maxEntries)) {
    map.delete(id);
  }
}
