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
