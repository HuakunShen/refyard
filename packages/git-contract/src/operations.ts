/**
 * The sealed mutation union: every state-changing operation the service can
 * perform, and the target kinds each one accepts.
 *
 * There is no generic `runGit` member and there never will be — an operation is
 * the *whole* description of a change, so the coordinator can validate it, journal
 * it, deduplicate it and cap it without ever seeing an argv vector from a client.
 * `OPERATION_TARGETS` is typed as a total map, so adding an operation without
 * deciding its targets does not compile, and `tests/contract` asserts the count,
 * the names, and that every operation parses a minimal valid request.
 */
import { z } from "zod";
import { objectIdSchema, worktreeIdSchema } from "./ids.js";
import {
  branchNameSchema,
  commitMessageSchema,
  fullRefNameSchema,
  pathSelectionSchema,
  plainPathSelectionSchema,
  remoteNameSchema,
  remoteUrlSchema,
  stashRefSchema,
  tagNameSchema,
} from "./names.js";
import { relativeDestinationSchema, type TargetKind } from "./targets.js";

/** Shared field for operations that can lose work; must be sent explicitly. */
const confirmedField = z.literal(true);

const worktreeReferenceSchema = z
  .union([
    z.strictObject({
      kind: z.literal("existingBranch"),
      branchName: branchNameSchema,
    }),
    z.strictObject({
      kind: z.literal("newBranch"),
      branchName: branchNameSchema,
      startOid: objectIdSchema,
    }),
    z.strictObject({
      kind: z.literal("detached"),
      oid: objectIdSchema,
    }),
  ])
  .meta({
    id: "WorktreeReference",
    description:
      "What the new worktree checks out. A branch already checked out elsewhere is refused by Git, not overridden.",
  });

/**
 * The 35 operations, in the order they are documented. Keys are the wire
 * discriminants; each schema is strict, so an unknown field is a rejection.
 */
const OPERATION_SCHEMAS = {
  initRepository: z
    .strictObject({
      kind: z.literal("initRepository"),
      initialBranch: branchNameSchema.nullable(),
    })
    .meta({
      id: "InitRepositoryOperation",
      description:
        "Create a repository at the workspace destination. `null` uses Git’s default branch name.",
    }),

  cloneRepository: z
    .strictObject({
      kind: z.literal("cloneRepository"),
      remoteUrl: remoteUrlSchema,
      relativeDestination: relativeDestinationSchema,
      initializeSubmodules: z.boolean(),
    })
    .meta({
      id: "CloneRepositoryOperation",
      description:
        "Clone an approved remote into an approved root. Submodules are initialised only when asked; credential helpers are the target machine’s.",
    }),

  stagePaths: z
    .strictObject({
      kind: z.literal("stagePaths"),
      pathIds: pathSelectionSchema.shape.pathIds,
      previewTokens: pathSelectionSchema.shape.previewTokens,
    })
    .meta({
      id: "StagePathsOperation",
      description:
        "Stage exactly the selected paths. Renames include whichever old and new paths are required; nothing is staged recursively.",
    }),

  unstagePaths: z
    .strictObject({
      kind: z.literal("unstagePaths"),
      pathIds: plainPathSelectionSchema.shape.pathIds,
    })
    .meta({
      id: "UnstagePathsOperation",
      description:
        "Reset the selected paths in the index only. Working-tree files are never touched.",
    }),

  discardTrackedPaths: z
    .strictObject({
      kind: z.literal("discardTrackedPaths"),
      pathIds: pathSelectionSchema.shape.pathIds,
      previewTokens: pathSelectionSchema.shape.previewTokens,
      confirmed: confirmedField,
    })
    .meta({
      id: "DiscardTrackedPathsOperation",
      description:
        "Restore selected tracked files from the index — not from HEAD — after backing up what the change would destroy. Untracked, ignored, symlink and submodule paths are refused.",
    }),

  commit: z
    .strictObject({
      kind: z.literal("commit"),
      message: commitMessageSchema,
    })
    .meta({
      id: "CommitOperation",
      description:
        "Commit the current index with the given message. Nothing is staged implicitly, no empty commit is created, and user hooks and signing settings stay in force.",
    }),

  amendCommit: z
    .strictObject({
      kind: z.literal("amendCommit"),
      message: commitMessageSchema.nullable(),
      confirmed: confirmedField,
    })
    .meta({
      id: "AmendCommitOperation",
      description:
        "Rewrite the tip commit. `null` keeps the existing message. The UI must say a rewrite happened; this version performs no follow-up force push.",
    }),

  createBranch: z
    .strictObject({
      kind: z.literal("createBranch"),
      branchName: branchNameSchema,
      startOid: objectIdSchema.nullable(),
      switchToIt: z.boolean(),
    })
    .meta({
      id: "CreateBranchOperation",
      description:
        "Create a branch, optionally at a specific commit and optionally checked out.",
    }),

  switchBranch: z
    .strictObject({
      kind: z.literal("switchBranch"),
      branchName: branchNameSchema,
    })
    .meta({
      id: "SwitchBranchOperation",
      description:
        "Check out an existing branch. Never forced: a conflict with local changes is reported, not resolved by discarding them.",
    }),

  renameBranch: z
    .strictObject({
      kind: z.literal("renameBranch"),
      branchName: branchNameSchema,
      newName: branchNameSchema,
    })
    .meta({
      id: "RenameBranchOperation",
      description: "Rename a local branch.",
    }),

  deleteBranch: z
    .strictObject({
      kind: z.literal("deleteBranch"),
      branchName: branchNameSchema,
      confirmed: confirmedField,
    })
    .meta({
      id: "DeleteBranchOperation",
      description:
        "Delete a fully merged local branch. Unmerged branches are refused; there is no force delete.",
    }),

  setBranchUpstream: z
    .strictObject({
      kind: z.literal("setBranchUpstream"),
      branchName: branchNameSchema,
      upstream: z
        .strictObject({
          remoteName: remoteNameSchema,
          branchName: branchNameSchema,
        })
        .nullable(),
    })
    .meta({
      id: "SetBranchUpstreamOperation",
      description: "Set or clear (with `null`) the upstream of a local branch.",
    }),

  addRemote: z
    .strictObject({
      kind: z.literal("addRemote"),
      remoteName: remoteNameSchema,
      fetchUrl: remoteUrlSchema,
      pushUrl: remoteUrlSchema.nullable(),
    })
    .meta({
      id: "AddRemoteOperation",
      description: "Add a remote, optionally with a separate push URL.",
    }),

  updateRemote: z
    .strictObject({
      kind: z.literal("updateRemote"),
      remoteName: remoteNameSchema,
      newName: z.string().min(1).max(64).nullable(),
      fetchUrl: remoteUrlSchema.nullable(),
      pushUrl: remoteUrlSchema.nullable(),
    })
    .meta({
      id: "UpdateRemoteOperation",
      description:
        "Rename a remote and/or change its URLs. At least one change must be present; null fields are left unchanged.",
    }),

  removeRemote: z
    .strictObject({
      kind: z.literal("removeRemote"),
      remoteName: remoteNameSchema,
      confirmed: confirmedField,
    })
    .meta({
      id: "RemoveRemoteOperation",
      description:
        "Remove a remote and its remote-tracking refs. Local branches are untouched.",
    }),

  fetch: z
    .strictObject({
      kind: z.literal("fetch"),
      remoteName: remoteNameSchema,
      prune: z.boolean(),
      tags: z.enum(["none", "following"]),
    })
    .meta({
      id: "FetchOperation",
      description:
        "Fetch one remote. Each ref’s outcome is reported separately; the result is a change to remote-tracking refs, never to local branches.",
    }),

  push: z
    .strictObject({
      kind: z.literal("push"),
      remoteName: remoteNameSchema,
      sourceRef: fullRefNameSchema,
      destinationRef: fullRefNameSchema,
      setUpstream: z.boolean(),
    })
    .meta({
      id: "PushOperation",
      description:
        "Push exactly one explicit source ref to one explicit destination ref. No mirroring, no implicit follow-tags, no force.",
    }),

  pull: z
    .strictObject({
      kind: z.literal("pull"),
      remoteName: remoteNameSchema,
      mode: z.literal("ff-only"),
    })
    .meta({
      id: "PullOperation",
      description:
        'Fast-forward the current branch from its remote. A divergence fails: this version never merges or rebases implicitly, and it separates "remote-tracking refs updated" from "working branch not moved".',
    }),

  createStash: z
    .strictObject({
      kind: z.literal("createStash"),
      message: commitMessageSchema.nullable(),
      includeUntracked: z.boolean(),
      keepIndex: z.boolean(),
    })
    .meta({
      id: "CreateStashOperation",
      description:
        "Stash working-tree changes. Ignored files are never included, and submodules are not stashed recursively.",
    }),

  applyStash: z
    .strictObject({
      kind: z.literal("applyStash"),
      stash: stashRefSchema,
      restoreIndex: z.boolean(),
    })
    .meta({
      id: "ApplyStashOperation",
      description:
        "Apply a stash and keep it. The locator must still resolve to the given object.",
    }),

  popStash: z
    .strictObject({
      kind: z.literal("popStash"),
      stash: stashRefSchema,
      restoreIndex: z.boolean(),
      confirmed: confirmedField,
    })
    .meta({
      id: "PopStashOperation",
      description:
        "Apply a stash and drop it on success only. A conflict leaves the stash in place for a human to resolve.",
    }),

  dropStash: z
    .strictObject({
      kind: z.literal("dropStash"),
      stash: stashRefSchema,
      confirmed: confirmedField,
    })
    .meta({
      id: "DropStashOperation",
      description:
        "Discard one stash entry. This is a repository-level change; it cannot be undone from the UI.",
    }),

  createTag: z
    .strictObject({
      kind: z.literal("createTag"),
      tagName: tagNameSchema,
      targetOid: objectIdSchema.nullable(),
      annotation: z.strictObject({ message: commitMessageSchema }).nullable(),
    })
    .meta({
      id: "CreateTagOperation",
      description:
        "Create a lightweight tag (`annotation: null`) or an annotated one. An existing tag is never overwritten.",
    }),

  deleteTag: z
    .strictObject({
      kind: z.literal("deleteTag"),
      tagName: tagNameSchema,
      confirmed: confirmedField,
    })
    .meta({
      id: "DeleteTagOperation",
      description: "Delete one local tag. Remote tags are never touched.",
    }),

  pushTag: z
    .strictObject({
      kind: z.literal("pushTag"),
      remoteName: remoteNameSchema,
      tagName: tagNameSchema,
    })
    .meta({
      id: "PushTagOperation",
      description:
        "Push one tag by name, without force and without deleting anything remotely.",
    }),

  createWorktree: z
    .strictObject({
      kind: z.literal("createWorktree"),
      relativeDestination: relativeDestinationSchema,
      reference: worktreeReferenceSchema,
    })
    .meta({
      id: "CreateWorktreeOperation",
      description:
        "Add a linked worktree inside an approved root. A branch already checked out elsewhere stays refused.",
    }),

  removeWorktree: z
    .strictObject({
      kind: z.literal("removeWorktree"),
      worktreeId: worktreeIdSchema,
      confirmed: confirmedField,
    })
    .meta({
      id: "RemoveWorktreeOperation",
      description:
        "Remove a clean, non-primary, unlocked worktree. Git’s own refusal is reported as-is; nothing falls back to recursive deletion.",
    }),

  lockWorktree: z
    .strictObject({
      kind: z.literal("lockWorktree"),
      worktreeId: worktreeIdSchema,
      reason: z.string().max(1024).nullable(),
    })
    .meta({
      id: "LockWorktreeOperation",
      description: "Lock a linked worktree, with an optional reason.",
    }),

  unlockWorktree: z
    .strictObject({
      kind: z.literal("unlockWorktree"),
      worktreeId: worktreeIdSchema,
    })
    .meta({
      id: "UnlockWorktreeOperation",
      description: "Unlock a worktree that was locked.",
    }),

  addSubmodule: z
    .strictObject({
      kind: z.literal("addSubmodule"),
      remoteUrl: remoteUrlSchema,
      relativePath: relativeDestinationSchema,
      branchName: branchNameSchema.nullable(),
      initialize: z.boolean(),
    })
    .meta({
      id: "AddSubmoduleOperation",
      description:
        "Add a submodule from an approved remote or local path. Arbitrary transport helpers are refused, and the destination is shown before any network connection.",
    }),

  updateSubmodule: z
    .strictObject({
      kind: z.literal("updateSubmodule"),
      pathIds: plainPathSelectionSchema.shape.pathIds,
      initialize: z.boolean(),
      recursive: z.boolean(),
    })
    .meta({
      id: "UpdateSubmoduleOperation",
      description:
        "Check out the commit the parent repository records. `--remote` and `--force` are not available, and configured update shell commands are ignored.",
    }),

  syncSubmodule: z
    .strictObject({
      kind: z.literal("syncSubmodule"),
      pathIds: plainPathSelectionSchema.shape.pathIds,
      recursive: z.boolean(),
    })
    .meta({
      id: "SyncSubmoduleOperation",
      description:
        "Copy submodule URLs from the parent repository configuration into the submodules.",
    }),

  merge: z
    .strictObject({
      kind: z.literal("merge"),
      sourceOid: objectIdSchema,
      mode: z.enum(["default", "no-ff"]),
      message: commitMessageSchema.nullable(),
    })
    .meta({
      id: "MergeOperation",
      description:
        "Merge one explicit commit into the current branch. Conflicts stop the operation with unmerged index stages shown; they are never auto-resolved.",
    }),

  continueMerge: z
    .strictObject({
      kind: z.literal("continueMerge"),
      message: commitMessageSchema.nullable(),
    })
    .meta({
      id: "ContinueMergeOperation",
      description:
        "Complete a merge after the conflicted paths were resolved outside and staged.",
    }),

  abortMerge: z
    .strictObject({
      kind: z.literal("abortMerge"),
      confirmed: confirmedField,
    })
    .meta({
      id: "AbortMergeOperation",
      description:
        "Abort the in-progress merge. When Git cannot restore the previous state, the diagnostic is reported instead of a reset fallback.",
    }),

  revertCommit: z
    .strictObject({
      kind: z.literal("revertCommit"),
      oid: objectIdSchema,
    })
    .meta({
      id: "RevertCommitOperation",
      description:
        "Create a commit that undoes one completed commit, with Git's own revert message and with the user's hooks running. A merge commit is refused: picking which parent to keep is a decision this build does not make. A conflict is aborted before it is reported, so the operation either completes or leaves nothing behind.",
    }),
} as const;

export { OPERATION_SCHEMAS };

/**
 * The single source for "which operation may address what", in the documented
 * order. The runtime request schemas, the coordinator's pairing check and the
 * generated contract artifact all read this list, so a pairing cannot be
 * declared in one place and enforced from another.
 */
export const OPERATION_TARGET_LIST = [
  ["initRepository", ["workspace"]],
  ["cloneRepository", ["workspace"]],
  ["stagePaths", ["worktree"]],
  ["unstagePaths", ["worktree"]],
  ["discardTrackedPaths", ["worktree"]],
  ["commit", ["worktree"]],
  ["amendCommit", ["worktree"]],
  ["createBranch", ["repository"]],
  ["switchBranch", ["worktree"]],
  ["renameBranch", ["repository"]],
  ["deleteBranch", ["repository"]],
  ["setBranchUpstream", ["repository"]],
  ["addRemote", ["repository"]],
  ["updateRemote", ["repository"]],
  ["removeRemote", ["repository"]],
  ["fetch", ["repository"]],
  ["push", ["repository"]],
  ["pull", ["worktree"]],
  ["createStash", ["worktree"]],
  ["applyStash", ["worktree"]],
  ["popStash", ["worktree"]],
  ["dropStash", ["repository"]],
  ["createTag", ["repository"]],
  ["deleteTag", ["repository"]],
  ["pushTag", ["repository"]],
  ["createWorktree", ["repository"]],
  ["removeWorktree", ["repository"]],
  ["lockWorktree", ["repository"]],
  ["unlockWorktree", ["repository"]],
  ["addSubmodule", ["worktree"]],
  ["updateSubmodule", ["worktree"]],
  ["syncSubmodule", ["worktree"]],
  ["merge", ["worktree"]],
  ["continueMerge", ["worktree"]],
  ["abortMerge", ["worktree"]],
  ["revertCommit", ["worktree"]],
] as const;

export type MutationKind = (typeof OPERATION_TARGET_LIST)[number][0];

/** Target kinds one operation accepts, preserved as literals for type-level pairing. */
export type TargetKindsOf<K extends MutationKind> = Extract<
  (typeof OPERATION_TARGET_LIST)[number],
  readonly [K, ...unknown[]]
>[1];

/** Canonical order of the mutation union. */
export const MUTATION_KINDS: readonly MutationKind[] =
  OPERATION_TARGET_LIST.map(([kind]) => kind);

/**
 * Target kinds an operation may address. Read from the list rather than a second
 * table, so the pairing cannot be declared twice and disagree.
 */
export function targetKindsOf(kind: MutationKind): readonly TargetKind[] {
  const entry = OPERATION_TARGET_LIST.find(([candidate]) => candidate === kind);
  if (entry === undefined) {
    throw new Error(`unknown operation kind: ${kind}`);
  }
  return entry[1];
}

/** Mapped form of `OPERATION_SCHEMAS`, for `z.infer` lookups by kind. */
export type OperationFor<K extends MutationKind> = z.infer<
  (typeof OPERATION_SCHEMAS)[K]
>;

export type MutationOperation = {
  [K in MutationKind]: OperationFor<K>;
}[MutationKind];

/**
 * Compile-time proof that the schema object and the target list describe the same
 * set of operations. `Equal` is the standard invariance check; if a kind is added
 * to one and not the other, this line stops compiling.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _SchemasMatchTargetList = Expect<
  Equal<keyof typeof OPERATION_SCHEMAS, MutationKind>
>;
/** The documented union has exactly 36 members; a list edit that changes that stops compiling. */
export type _MutationCount = Expect<
  Equal<(typeof OPERATION_TARGET_LIST)["length"], 36>
>;

/** Operations that can destroy work and therefore require explicit confirmation. */
export const CONFIRMATION_REQUIRED_KINDS: readonly MutationKind[] =
  MUTATION_KINDS.filter((kind) => "confirmed" in OPERATION_SCHEMAS[kind].shape);
