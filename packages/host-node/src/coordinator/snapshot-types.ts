/**
 * The cursor and snapshot shapes, in their own module so the store and the read
 * service can both name them without importing each other.
 */

export type SnapshotKind =
  | "status"
  | "history"
  | "refs"
  | "diff"
  | "worktrees"
  | "submodules"
  | "stashes";

/** What a cursor continues. Stored server-side; the client only holds the id. */
export interface CursorPayload {
  readonly snapshotId: string;
  readonly skip: number;
  readonly limit: number;
  readonly kind: SnapshotKind;
  readonly repositoryId: string;
  readonly worktreeId: string | null;
}

/** Server-owned resolved history semantics; never exposed by a cursor. */
export interface NormalizedHistoryIntent {
  readonly firstParentOnly: boolean;
  readonly message: string | null;
  readonly author: string | null;
  readonly resolvedRefOid: string | null;
  readonly committedAfterSeconds: number | null;
  readonly committedBeforeSeconds: number | null;
  readonly resolvedPathText: string | null;
  readonly oid: string | null;
  /** Distinguishes an unmatched locator from an ordinary unrestricted walk. */
  readonly oidLookup: boolean;
  readonly topology: "continuous" | "sparse";
}
