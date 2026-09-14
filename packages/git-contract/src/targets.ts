/**
 * Mutation targets.
 *
 * A target names *what* an operation is allowed to touch. The three kinds are the
 * only addressable things in the API: an approved root plus a destination inside
 * it, one repository (its common Git directory and refs), or one worktree (its
 * HEAD, index and working files). `expectedSnapshotId` is what makes a mutation
 * conditional: the host rejects the request when the state it was planned
 * against has moved on.
 */
import { z } from "zod";
import {
  allowedRootIdSchema,
  repositoryIdSchema,
  snapshotIdSchema,
  worktreeIdSchema,
} from "./ids.js";

export const targetKindSchema = z
  .enum(["workspace", "repository", "worktree"])
  .meta({
    id: "TargetKind",
    description: "Which kind of resource a mutation addresses.",
  });

/** A destination inside an approved root; never an absolute path from the client. */
export const relativeDestinationSchema = z.string().min(1).max(1024).meta({
  id: "RelativeDestination",
  description:
    "Path relative to an approved root. Absolute paths, `..` segments and `.git` components are rejected by validation.",
});

export const workspaceTargetSchema = z
  .strictObject({
    kind: z.literal("workspace"),
    allowedRootId: allowedRootIdSchema,
    relativeDestination: relativeDestinationSchema,
  })
  .meta({
    id: "WorkspaceTarget",
    description:
      "A location inside an approved root, for operations that create repositories.",
  });

export const repositoryTargetSchema = z
  .strictObject({
    kind: z.literal("repository"),
    repositoryId: repositoryIdSchema,
    expectedSnapshotId: snapshotIdSchema,
  })
  .meta({
    id: "RepositoryTarget",
    description:
      "A repository-level change: refs, remotes, tags, worktrees, submodule wiring.",
  });

export const worktreeTargetSchema = z
  .strictObject({
    kind: z.literal("worktree"),
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema,
    expectedSnapshotId: snapshotIdSchema,
  })
  .meta({
    id: "WorktreeTarget",
    description:
      "A worktree-level change: index, working files, HEAD, merges, stashes.",
  });

export const mutationTargetSchema = z
  .union([workspaceTargetSchema, repositoryTargetSchema, worktreeTargetSchema])
  .meta({
    id: "MutationTarget",
    description:
      "Discriminated by `kind`; an operation accepts only the kinds it declares.",
  });

export type TargetKind = z.infer<typeof targetKindSchema>;
export type RelativeDestination = z.infer<typeof relativeDestinationSchema>;
export type WorkspaceTarget = z.infer<typeof workspaceTargetSchema>;
export type RepositoryTarget = z.infer<typeof repositoryTargetSchema>;
export type WorktreeTarget = z.infer<typeof worktreeTargetSchema>;
export type MutationTarget = z.infer<typeof mutationTargetSchema>;

/** The target schema for one kind, used to build per-operation request schemas. */
export function targetSchemaFor(kinds: readonly TargetKind[]) {
  const schemas = kinds.map((kind) => {
    switch (kind) {
      case "workspace":
        return workspaceTargetSchema;
      case "repository":
        return repositoryTargetSchema;
      case "worktree":
        return worktreeTargetSchema;
    }
  });
  if (schemas.length === 1) {
    return schemas[0] as (typeof schemas)[number];
  }
  return z.union(
    schemas as [(typeof schemas)[number], ...(typeof schemas)[number][]],
  );
}
