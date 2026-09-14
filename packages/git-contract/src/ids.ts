/**
 * Opaque identifier and value schemas for the public contract.
 *
 * Every ID is minted by the host and carries its kind as a prefix, so an ID that
 * escapes into a log or a UI state blob is self-describing. Clients must treat
 * them as opaque: the prefix and length bound are the only guarantees, and
 * nothing is derived from a URL, a filesystem path, or a repository name.
 */
import { z } from "zod";
import { API_MAJOR } from "./version.js";

/** A prefixed, URL-safe identifier such as `repo_7f3a…`. */
function prefixedId(prefix: string, meta: { id: string; description: string }) {
  return z
    .string()
    .regex(
      new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,96}$`),
      `must be a ${prefix}_… identifier minted by the host`,
    )
    .meta(meta);
}

export const serviceInstanceIdSchema = prefixedId("srvc", {
  id: "ServiceInstanceId",
  description:
    "Identifies one running service process; changes across restarts.",
});

export const allowedRootIdSchema = prefixedId("root", {
  id: "AllowedRootId",
  description:
    "A directory the service was explicitly granted, resolved by the host.",
});

export const repositoryIdSchema = prefixedId("repo", {
  id: "RepositoryId",
  description:
    "One common Git directory. Worktrees share it; a second clone of the same project does not.",
});

export const worktreeIdSchema = prefixedId("wt", {
  id: "WorktreeId",
  description: "One worktree of a repository, with its own HEAD and index.",
});

export const pathIdSchema = prefixedId("path", {
  id: "PathId",
  description:
    "One path inside a worktree, bound to the raw bytes of that path. The only input accepted by path mutations.",
});

export const snapshotIdSchema = prefixedId("snap", {
  id: "SnapshotId",
  description:
    "A recorded read of mutable state. Mutations carry the snapshot they were planned against.",
});

export const operationIdSchema = prefixedId("op", {
  id: "OperationId",
  description:
    "A submitted mutation. Also the handle for querying its outcome.",
});

export const previewTokenSchema = prefixedId("pt", {
  id: "PreviewToken",
  description:
    "Authorises acting on one path whose content fingerprint matched when the preview was taken.",
});

export const cursorSchema = prefixedId("cur", {
  id: "Cursor",
  description: "Opaque continuation for a paged read; never parsed by clients.",
});

export const clientRequestIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    "clientRequestId must be 1–128 characters of [A-Za-z0-9._:-] and must not start with punctuation",
  )
  .meta({
    id: "ClientRequestId",
    description:
      "Client-chosen idempotency key. Reusing it with a different payload is a conflict, not a retry.",
  });

/** Git object name: 40 hex chars for SHA-1 repositories, 64 for SHA-256. */
export const objectIdSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "must be a lowercase hexadecimal Git object name",
  )
  .meta({
    id: "ObjectId",
    description:
      "Git object name. The accepted lengths are the known object formats; the repository decides which one applies.",
  });

export const objectFormatSchema = z.enum(["sha1", "sha256"]).meta({
  id: "ObjectFormat",
  description:
    "Hash format of a repository, as reported by Git, never assumed.",
});

/** UTC timestamp with millisecond precision; the only time format on the wire. */
export const timestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
    "must be an ISO-8601 UTC timestamp",
  )
  .meta({
    id: "Timestamp",
    description: "ISO-8601 UTC instant, e.g. 2026-09-14T12:00:00.000Z.",
  });

export const displayPathSchema = z.string().max(4096).meta({
  id: "DisplayPath",
  description:
    "Escaped, human-readable form of a path. For display only: never send it back as an operation input.",
});

export const apiMajorSchema = z.literal(API_MAJOR).meta({
  id: "ApiMajor",
  description:
    "Public API major version. A mismatch means the client must not call write endpoints.",
});

export type ServiceInstanceId = z.infer<typeof serviceInstanceIdSchema>;
export type AllowedRootId = z.infer<typeof allowedRootIdSchema>;
export type RepositoryId = z.infer<typeof repositoryIdSchema>;
export type WorktreeId = z.infer<typeof worktreeIdSchema>;
export type PathId = z.infer<typeof pathIdSchema>;
export type SnapshotId = z.infer<typeof snapshotIdSchema>;
export type OperationId = z.infer<typeof operationIdSchema>;
export type PreviewToken = z.infer<typeof previewTokenSchema>;
export type Cursor = z.infer<typeof cursorSchema>;
export type ClientRequestId = z.infer<typeof clientRequestIdSchema>;
export type ObjectId = z.infer<typeof objectIdSchema>;
export type ObjectFormat = z.infer<typeof objectFormatSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type DisplayPath = z.infer<typeof displayPathSchema>;
export type ApiMajor = z.infer<typeof apiMajorSchema>;

/** Known Git object-name lengths, used to validate OIDs against a repository's format. */
export const OBJECT_ID_LENGTHS: Readonly<Record<ObjectFormat, number>> = {
  sha1: 40,
  sha256: 64,
};
