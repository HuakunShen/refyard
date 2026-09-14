/**
 * Read queries and response DTOs.
 *
 * Query schemas describe the *typed* value of a query string: the HTTP layer
 * converts raw parameters (repeated parameters to arrays, integer strings to
 * numbers, absent to `undefined`) and then validates the result here. That keeps
 * every schema free of `transform`/`coerce`, which is what lets `z.toJSONSchema`
 * export the whole contract, and keeps the conversion rules in one tested place.
 *
 * Response schemas are the only shapes the browser sees. Anything a client would
 * have to interpret — a Git exit code, a raw path byte sequence, a human-readable
 * Git message — arrives already decided, or arrives as an explicit
 * `unrepresentable` / `unknown` marker.
 */
import { z } from "zod";
import {
  allowedRootIdSchema,
  cursorSchema,
  displayPathSchema,
  objectFormatSchema,
  objectIdSchema,
  operationIdSchema,
  pathIdSchema,
  previewTokenSchema,
  repositoryIdSchema,
  serviceInstanceIdSchema,
  snapshotIdSchema,
  timestampSchema,
  worktreeIdSchema,
} from "./ids.js";
import { LIMITS, runtimeLimitsSchema } from "./limits.js";
import {
  branchNameSchema,
  remoteNameSchema,
  stashLocatorSchema,
  tagNameSchema,
} from "./names.js";
import { MUTATION_KINDS, OPERATION_TARGET_LIST } from "./operations.js";
import {
  mutationTargetSchema,
  targetKindSchema,
  type MutationTarget,
} from "./targets.js";
import { problemSchema } from "./errors.js";
import { clientRequestIdSchema } from "./ids.js";

/* ------------------------------------------------------------------ session */

export const healthResponseSchema = z
  .strictObject({
    alive: z.literal(true),
    apiMajor: z.int(),
    serviceInstanceId: serviceInstanceIdSchema,
  })
  .meta({
    id: "HealthResponse",
    description:
      "Liveness only. A 200 here does not prove the listener is this service, so the CLI verifies identity out of band before opening a browser.",
  });

export const sessionExchangeRequestSchema = z
  .strictObject({
    ticket: z.string().min(16).max(512),
  })
  .meta({
    id: "SessionExchangeRequest",
    description:
      "Body of POST /api/v1/session/exchange. The ticket is single-use, short-lived and bound to one instance, origin, actor and resource set.",
  });

export const sessionExchangeResponseSchema = z
  .strictObject({
    token: z.string().min(16).max(2048),
    tokenType: z.literal("Bearer"),
    expiresAt: timestampSchema,
    serviceInstanceId: serviceInstanceIdSchema,
    apiMajor: z.int(),
    sessionId: z.string().min(1).max(128),
    grants: z
      .strictObject({
        allowedRootIds: z.array(allowedRootIdSchema),
        repositoryIds: z.array(repositoryIdSchema),
        scopes: z.array(z.string().min(1).max(64)),
      })
      .meta({
        id: "SessionGrants",
        description: "What this session is allowed to reach.",
      }),
  })
  .meta({
    id: "SessionExchangeResponse",
    description: "An in-memory bearer session. Never persisted client-side.",
  });

/* -------------------------------------------------------------- capabilities */

export const readKindSchema = z
  .enum([
    "capabilities",
    "repositories",
    "status",
    "history",
    "refs",
    "diff",
    "worktrees",
    "submodules",
    "stashes",
    "operations",
    "events",
  ])
  .meta({ id: "ReadKind", description: "One read the service implements." });

export const gitCapabilitiesSchema = z
  .strictObject({
    porcelainV2Status: z.boolean(),
    worktreeListZ: z.boolean(),
    catFileBatch: z.boolean(),
    pushPorcelain: z.boolean(),
    fetchPorcelain: z.boolean(),
    objectFormats: z.array(objectFormatSchema),
  })
  .meta({
    id: "GitCapabilities",
    description:
      "Machine formats probed on this machine, not inferred from a version string. A missing format removes the dependent feature from `operations`.",
  });

export const unavailableReasonSchema = z
  .strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(500),
    operations: z.array(z.enum(MUTATION_KINDS)),
  })
  .meta({
    id: "UnavailableReason",
    description: "Why some operations are absent from this build.",
  });

export const capabilitiesResponseSchema = z
  .strictObject({
    apiMajor: z.int(),
    contractVersion: z.string().min(1).max(32),
    serviceInstanceId: serviceInstanceIdSchema,
    host: z.strictObject({
      kind: z.literal("node"),
      version: z.string().min(1).max(64),
    }),
    git: z.strictObject({
      executableDisplay: displayPathSchema,
      version: z.string().min(1).max(128),
      features: gitCapabilitiesSchema,
    }),
    reads: z.array(readKindSchema),
    operations: z.array(
      z.strictObject({
        kind: z.enum(MUTATION_KINDS),
        targets: z.array(targetKindSchema).min(1),
      }),
    ),
    limits: runtimeLimitsSchema,
    unavailable: z.array(unavailableReasonSchema),
  })
  .meta({
    id: "CapabilitiesResponse",
    description:
      "What this build can do right now. An operation missing from `operations` is not implemented or not safe on this machine; it is never reported as available and then refused.",
  });

/* -------------------------------------------------------------- repositories */

export const headStateSchema = z
  .strictObject({
    kind: z.enum(["born", "unborn"]),
    branchName: branchNameSchema.nullable(),
    oid: objectIdSchema.nullable(),
    detached: z.boolean(),
  })
  .meta({
    id: "HeadState",
    description:
      "`unborn` is a repository with no commits yet — not an error, and not a missing branch.",
  });

export const repositorySummarySchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    allowedRootId: allowedRootIdSchema,
    displayName: z.string().min(1).max(256),
    displayPath: displayPathSchema,
    objectFormat: objectFormatSchema,
    worktreeIds: z.array(worktreeIdSchema),
    primaryWorktreeId: worktreeIdSchema,
    head: headStateSchema,
    operationInProgress: z
      .enum([
        "merge",
        "cherry-pick",
        "revert",
        "rebase",
        "bisect",
        "apply-mailbox",
        "unknown",
      ])
      .nullable(),
    lastFetchedAt: timestampSchema.nullable(),
  })
  .meta({
    id: "RepositorySummary",
    description: "One registered repository, as shown in the repository list.",
  });

export const repositoriesResponseSchema = z
  .strictObject({
    repositories: z.array(repositorySummarySchema),
    allowedRoots: z.array(
      z.strictObject({
        allowedRootId: allowedRootIdSchema,
        displayPath: displayPathSchema,
        repositoryIds: z.array(repositoryIdSchema),
      }),
    ),
  })
  .meta({
    id: "RepositoriesResponse",
    description:
      "Registered repositories and the roots they were approved under. Registration is explicit; nothing is discovered by scanning the disk.",
  });

/* -------------------------------------------------------------------- status */

export const pathEncodingSchema = z.enum(["utf8", "unrepresentable"]).meta({
  id: "PathEncoding",
  description:
    "Whether this path can be handed back for execution. `unrepresentable` paths are readable metadata only; operations mentioning them are rejected.",
});

export const submoduleStatusSchema = z
  .strictObject({
    commitChanged: z.boolean(),
    modified: z.boolean(),
    untracked: z.boolean(),
  })
  .meta({
    id: "SubmoduleStatus",
    description: "Submodule flags from porcelain v2’s `sub` field.",
  });

export const unmergedStageSchema = z
  .strictObject({
    stage: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    mode: z.string().min(1).max(16),
    oid: objectIdSchema,
  })
  .meta({
    id: "UnmergedStage",
    description: "One index stage of a conflicted path: base, ours, theirs.",
  });

export const statusEntrySchema = z
  .strictObject({
    pathId: pathIdSchema,
    displayPath: displayPathSchema,
    pathEncoding: pathEncodingSchema,
    kind: z.enum([
      "ordinary",
      "renamed",
      "copied",
      "unmerged",
      "untracked",
      "ignored",
    ]),
    indexStatus: z.string().length(1),
    worktreeStatus: z.string().length(1),
    originalPathId: pathIdSchema.nullable(),
    originalDisplayPath: displayPathSchema.nullable(),
    headOid: objectIdSchema.nullable(),
    indexOid: objectIdSchema.nullable(),
    modes: z
      .strictObject({
        head: z.string().nullable(),
        index: z.string().nullable(),
        worktree: z.string().nullable(),
      })
      .nullable(),
    submodule: submoduleStatusSchema.nullable(),
    stages: z.array(unmergedStageSchema).nullable(),
  })
  .meta({
    id: "StatusEntry",
    description:
      "One changed path. Status characters are Git’s own (`.`, `M`, `A`, `D`, `R`, `U`, …); the UI decides presentation, never re-parses them into meaning.",
  });

export const statusSnapshotSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema,
    readAt: timestampSchema,
    head: headStateSchema,
    upstream: z
      .strictObject({
        name: z.string().min(1).max(512),
        ahead: z.int().nonnegative(),
        behind: z.int().nonnegative(),
      })
      .nullable(),
    operationInProgress: z
      .enum([
        "merge",
        "cherry-pick",
        "revert",
        "rebase",
        "bisect",
        "apply-mailbox",
        "unknown",
      ])
      .nullable(),
    entries: z.array(statusEntrySchema),
    entryCount: z.int().nonnegative(),
    truncated: z.boolean(),
  })
  .meta({
    id: "StatusSnapshot",
    description:
      "Working-tree and index state at a point in time. `ahead`/`behind` describe local remote-tracking refs only — they are not the server’s state.",
  });

/* ------------------------------------------------------------------- history */

export const commitSummarySchema = z
  .strictObject({
    oid: objectIdSchema,
    parents: z.array(objectIdSchema),
    subject: z.string().max(4096),
    authorName: z.string().max(512),
    authorEmail: z.string().max(512),
    authoredAt: timestampSchema,
    committedAt: timestampSchema,
    refNames: z.array(z.string().min(1).max(1024)),
    signed: z.boolean(),
    boundary: z.boolean(),
    missingParents: z.array(objectIdSchema),
  })
  .meta({
    id: "CommitSummary",
    description:
      "One row of history. `boundary` marks a shallow/grafted edge and `missingParents` names parents whose objects are absent, so a UI never draws an unloaded parent as a root.",
  });

export const commitDetailSchema = z
  .strictObject({
    oid: objectIdSchema,
    parents: z.array(objectIdSchema),
    treeOid: objectIdSchema,
    authorName: z.string().max(512),
    authorEmail: z.string().max(512),
    authoredAt: timestampSchema,
    committerName: z.string().max(512),
    committerEmail: z.string().max(512),
    committedAt: timestampSchema,
    subject: z.string().max(4096),
    body: z.string().max(LIMITS.objectMaxBytes),
    encoding: z.string().max(64).nullable(),
    signed: z.boolean(),
  })
  .meta({
    id: "CommitDetail",
    description:
      "Full commit metadata and message, decoded through the host text codec.",
  });

export const historyPageSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    readAt: timestampSchema,
    objectFormat: objectFormatSchema,
    shallow: z.boolean(),
    commits: z.array(commitSummarySchema),
    nextCursor: cursorSchema.nullable(),
    tipsMoved: z.boolean(),
    truncated: z.boolean(),
    detail: commitDetailSchema.nullable(),
  })
  .meta({
    id: "HistoryPage",
    description:
      "A page of the commit graph in topological order. Paging continues from a cursor bound to the tips it started with; `tipsMoved` tells the UI the branch advanced, and the old page is still served from the old tips rather than re-interpreted.",
  });

/* ---------------------------------------------------------------------- refs */

export const refEntrySchema = z
  .strictObject({
    name: z.string().min(1).max(1024),
    fullName: z.string().min(1).max(1024),
    oid: objectIdSchema,
    isCurrent: z.boolean(),
    upstream: z
      .strictObject({
        fullName: z.string().min(1).max(1024),
        ahead: z.int().nonnegative(),
        behind: z.int().nonnegative(),
        gone: z.boolean(),
      })
      .nullable(),
  })
  .meta({
    id: "RefEntry",
    description:
      "A local branch, with its upstream state when one is configured.",
  });

export const remoteRefEntrySchema = z
  .strictObject({
    name: z.string().min(1).max(1024),
    fullName: z.string().min(1).max(1024),
    oid: objectIdSchema,
    remoteName: remoteNameSchema,
  })
  .meta({
    id: "RemoteRefEntry",
    description:
      "A remote-tracking ref, as observed locally after the last fetch.",
  });

export const tagEntrySchema = z
  .strictObject({
    name: tagNameSchema,
    fullName: z.string().min(1).max(1024),
    oid: objectIdSchema,
    annotated: z.boolean(),
    targetOid: objectIdSchema.nullable(),
  })
  .meta({
    id: "TagEntry",
    description:
      "A tag. For an annotated tag `oid` is the tag object and `targetOid` the commit it points at.",
  });

export const refsSnapshotSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    readAt: timestampSchema,
    objectFormat: objectFormatSchema,
    head: headStateSchema,
    branches: z.array(refEntrySchema),
    remoteBranches: z.array(remoteRefEntrySchema),
    tags: z.array(tagEntrySchema),
    remotes: z.array(
      z.strictObject({
        name: remoteNameSchema,
        fetchUrlDisplay: z.string().max(2048),
        pushUrlDisplay: z.string().max(2048).nullable(),
      }),
    ),
    otherRefs: z.array(
      z.strictObject({
        fullName: z.string().min(1).max(1024),
        oid: objectIdSchema,
        kind: z.enum(["stash", "notes", "replace", "other"]),
      }),
    ),
    truncated: z.boolean(),
  })
  .meta({
    id: "RefsSnapshot",
    description:
      "Branches, remote-tracking refs, tags and remotes in one read. URLs are redacted for display; the host never returns a credential.",
  });

/* ---------------------------------------------------------------------- diff */

export const patchLineSchema = z
  .strictObject({
    kind: z.enum(["context", "add", "remove"]),
    text: z.string(),
    noNewline: z.boolean(),
  })
  .meta({
    id: "PatchLine",
    description:
      "One patch line without its leading marker; `noNewline` carries the end-of-file marker.",
  });

export const patchHunkSchema = z
  .strictObject({
    header: z.string().max(512),
    oldStart: z.int(),
    oldLines: z.int(),
    newStart: z.int(),
    newLines: z.int(),
    lines: z.array(patchLineSchema),
  })
  .meta({
    id: "PatchHunk",
    description:
      "A parsed hunk, so the UI renders lines without re-parsing patch grammar.",
  });

export const filePatchSchema = z
  .union([
    z.strictObject({
      kind: z.literal("text"),
      hunks: z.array(patchHunkSchema),
      synthesized: z.boolean(),
    }),
    z.strictObject({ kind: z.literal("binary") }),
    z.strictObject({
      kind: z.literal("oversize"),
      reason: z.string().min(1).max(256),
    }),
    z.strictObject({
      kind: z.literal("unavailable"),
      reason: z.string().min(1).max(256),
    }),
    z.strictObject({
      kind: z.literal("submodule"),
      recordedOid: objectIdSchema.nullable(),
      indexOid: objectIdSchema.nullable(),
      actualOid: objectIdSchema.nullable(),
    }),
  ])
  .meta({
    id: "FilePatch",
    description:
      "Text patches are bounded and parsed; a synthesized patch means the file is untracked and its content came from an authorised read, not from Git.",
  });

export const diffFileSchema = z
  .strictObject({
    pathId: pathIdSchema,
    displayPath: displayPathSchema,
    oldPathId: pathIdSchema.nullable(),
    oldDisplayPath: displayPathSchema.nullable(),
    changeKind: z.enum([
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "typeChanged",
      "unmerged",
    ]),
    isBinary: z.boolean(),
    isSubmodule: z.boolean(),
    insertions: z.int().nonnegative().nullable(),
    deletions: z.int().nonnegative().nullable(),
    modes: z
      .strictObject({ old: z.string().nullable(), new: z.string().nullable() })
      .nullable(),
    patch: filePatchSchema,
  })
  .meta({
    id: "DiffFile",
    description: "One changed file with its bounded patch.",
  });

export const diffResponseSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema.nullable(),
    readAt: timestampSchema,
    request: z.strictObject({
      kind: z.enum(["unstaged", "staged", "untracked", "commit", "range"]),
      oid: objectIdSchema.nullable(),
      from: objectIdSchema.nullable(),
      to: objectIdSchema.nullable(),
      pathId: pathIdSchema.nullable(),
    }),
    files: z.array(diffFileSchema),
    stats: z.strictObject({
      filesChanged: z.int().nonnegative(),
      insertions: z.int().nonnegative(),
      deletions: z.int().nonnegative(),
      binaryFiles: z.int().nonnegative(),
    }),
    truncated: z.boolean(),
  })
  .meta({
    id: "DiffResponse",
    description:
      "A bounded diff read: selected paths, one commit, or a two-point range.",
  });

/* ----------------------------------------------------------------- worktrees */

export const worktreeSummarySchema = z
  .strictObject({
    worktreeId: worktreeIdSchema,
    displayPath: displayPathSchema,
    head: headStateSchema,
    isMain: z.boolean(),
    isBare: z.boolean(),
    isDetached: z.boolean(),
    isLocked: z.boolean(),
    lockReason: z.string().max(1024).nullable(),
    isPrunable: z.boolean(),
  })
  .meta({
    id: "WorktreeSummary",
    description:
      "Worktrees of one repository share its refs but have independent HEAD, index and files.",
  });

export const worktreesResponseSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    readAt: timestampSchema,
    worktrees: z.array(worktreeSummarySchema),
  })
  .meta({
    id: "WorktreesResponse",
    description: "All worktrees of a repository, including the primary one.",
  });

/* --------------------------------------------------------------- submodules */

export const submoduleSummarySchema = z
  .strictObject({
    name: z.string().min(1).max(1024),
    pathId: pathIdSchema,
    displayPath: displayPathSchema,
    recordedOid: objectIdSchema.nullable(),
    indexOid: objectIdSchema.nullable(),
    actualOid: objectIdSchema.nullable(),
    state: z.enum([
      "uninitialized",
      "initialized",
      "outOfSync",
      "dirty",
      "unknown",
    ]),
    urlDisplay: z.string().max(2048),
    branchName: z.string().max(255).nullable(),
    submoduleRepositoryId: repositoryIdSchema.nullable(),
  })
  .meta({
    id: "SubmoduleSummary",
    description:
      'Three object names, never one "up to date" flag: what the parent commit records, what the parent index has, and what the submodule actually checked out.',
  });

export const submodulesResponseSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema,
    readAt: timestampSchema,
    submodules: z.array(submoduleSummarySchema),
    truncated: z.boolean(),
  })
  .meta({
    id: "SubmodulesResponse",
    description: "Submodule state as seen from one worktree.",
  });

/* ------------------------------------------------------------------ stashes */

export const stashEntrySchema = z
  .strictObject({
    oid: objectIdSchema,
    locator: stashLocatorSchema,
    message: z.string().max(4096),
    createdAt: timestampSchema,
    branchDisplay: z.string().max(1024).nullable(),
  })
  .meta({
    id: "StashEntry",
    description:
      "A stash entry. The locator is where it currently sits in the reflog and moves as stashes are added or dropped, so writes always carry the OID too.",
  });

export const stashesResponseSchema = z
  .strictObject({
    snapshotId: snapshotIdSchema,
    repositoryId: repositoryIdSchema,
    readAt: timestampSchema,
    stashes: z.array(stashEntrySchema),
    truncated: z.boolean(),
  })
  .meta({ id: "StashesResponse", description: "Stash entries, newest first." });

/* --------------------------------------------------------------- operations */

export const operationStatusSchema = z
  .enum([
    "accepted",
    "running",
    "succeeded",
    "failed",
    "needsAttention",
    "unknown",
    "cancelled",
  ])
  .meta({
    id: "OperationStatus",
    description:
      "Terminal states are `succeeded`, `failed`, `needsAttention`, `unknown` and `cancelled`. `unknown` means Git may have changed things and the service will not guess or retry.",
  });

export const operationResultSchema = z
  .strictObject({
    summary: z.string().min(1).max(2000),
    changedRefs: z.array(z.string().min(1).max(1024)),
    changedPaths: z.int().nonnegative().nullable(),
    snapshotInvalidated: z.boolean(),
    newHeadOid: objectIdSchema.nullable(),
  })
  .meta({
    id: "OperationResult",
    description:
      "What a finished operation reports: re-read facts and the invalidation the UI must act on, not Git’s stdout text.",
  });

export const operationRecordSchema = z
  .strictObject({
    operationId: operationIdSchema,
    clientRequestId: clientRequestIdSchema,
    kind: z.enum(MUTATION_KINDS),
    target: mutationTargetSchema,
    status: operationStatusSchema,
    sequence: z.int().nonnegative(),
    acceptedAt: timestampSchema,
    startedAt: timestampSchema.nullable(),
    finishedAt: timestampSchema.nullable(),
    result: operationResultSchema.nullable(),
    problem: problemSchema.nullable(),
  })
  .meta({
    id: "OperationRecord",
    description:
      "A journal entry as the client sees it. The journal itself stores metadata and payload digests, never diffs, messages, tokens or credentials.",
  });

export const operationsListResponseSchema = z
  .strictObject({
    operations: z.array(operationRecordSchema),
    // Capped by LIMITS.idempotencyMaxEntries / retention, restated here for the client.
    truncated: z.boolean(),
  })
  .meta({
    id: "OperationsListResponse",
    description: "Recent operations for the requesting actor.",
  });

export const cancelOperationRequestSchema = z
  .strictObject({ operationId: operationIdSchema })
  .meta({
    id: "CancelOperationRequest",
    description:
      "Cancel an operation that has not started. A running mutation is not cancellable in this version.",
  });

export const previewsRequestSchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema,
    pathIds: z.array(pathIdSchema).min(1).max(LIMITS.pathSelectionMaxEntries),
  })
  .meta({
    id: "PreviewsRequest",
    description:
      "Ask for content fingerprints of selected paths before a stage or discard.",
  });

export const previewsResponseSchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema,
    snapshotId: snapshotIdSchema,
    readAt: timestampSchema,
    tokens: z.array(
      z.strictObject({
        pathId: pathIdSchema,
        previewToken: previewTokenSchema,
        sizeBytes: z.int().nonnegative().nullable(),
        contentKind: z.enum(["text", "binary", "unrepresentable"]),
        fingerprintAlgorithm: z.literal("sha256"),
        expiresAt: timestampSchema,
      }),
    ),
  })
  .meta({
    id: "PreviewsResponse",
    description:
      "Content fingerprints bound to paths. The tokens expire, and a token whose file changed is stale rather than silently still valid.",
  });

/* ------------------------------------------------------------------- events */

export const eventPayloadSchema = z
  .union([
    z.strictObject({
      kind: z.literal("operation"),
      operation: operationRecordSchema,
    }),
    z.strictObject({
      kind: z.literal("repositoryChanged"),
      repositoryId: repositoryIdSchema,
      worktreeIds: z.array(worktreeIdSchema),
      snapshotInvalidated: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal("eventGap"),
      fromSequence: z.int().nonnegative(),
      toSequence: z.int().nonnegative(),
    }),
    z.strictObject({ kind: z.literal("session"), expiresAt: timestampSchema }),
  ])
  .meta({
    id: "EventPayload",
    description:
      "SSE payload. Events are hints that invalidate cached reads; they are never the only source of truth.",
  });

export const eventEnvelopeSchema = z
  .strictObject({
    sequence: z.int().nonnegative(),
    emittedAt: timestampSchema,
    payload: eventPayloadSchema,
  })
  .meta({
    id: "EventEnvelope",
    description:
      "One event with its monotonic sequence number, so a client can detect a gap and re-read.",
  });

/* ------------------------------------------------------------------ queries */

export const capabilitiesQuerySchema = z
  .strictObject({})
  .meta({ id: "CapabilitiesQuery" });
export const repositoriesQuerySchema = z
  .strictObject({})
  .meta({ id: "RepositoriesQuery" });

export const repositoryQuerySchema = z
  .strictObject({ repositoryId: repositoryIdSchema })
  .meta({
    id: "RepositoryQuery",
    description:
      "Queries that address a repository — its refs, remotes, tags, worktree list.",
  });

export const worktreeQuerySchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema.optional(),
  })
  .meta({
    id: "WorktreeQuery",
    description:
      "Queries that address a worktree. Omitting `worktreeId` selects the primary worktree.",
  });

export const historyQuerySchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema.optional(),
    cursor: cursorSchema.optional(),
    limit: z.int().positive().max(LIMITS.historyMaxPageSize).optional(),
    detailOid: objectIdSchema.optional(),
    firstParentOnly: z.boolean().optional(),
  })
  .meta({
    id: "HistoryQuery",
    description:
      "History page request. `cursor` continues a page from the tips it started with; `detailOid` additionally returns one full commit message.",
  });

export const diffQuerySchema = z
  .strictObject({
    repositoryId: repositoryIdSchema,
    worktreeId: worktreeIdSchema.optional(),
    kind: z.enum(["unstaged", "staged", "untracked", "commit", "range"]),
    oid: objectIdSchema.optional(),
    from: objectIdSchema.optional(),
    to: objectIdSchema.optional(),
    pathId: pathIdSchema.optional(),
    maxBytes: z.int().positive().max(LIMITS.patchMaxBytesPerFile).optional(),
  })
  .meta({
    id: "DiffQuery",
    description:
      "A diff is always bounded and always scoped: worktree-vs-index, index-vs-HEAD, one commit, or a two-point range. `pathId` restricts it to one path.",
  });

export const operationQuerySchema = z
  .strictObject({ operationId: operationIdSchema })
  .meta({
    id: "OperationQuery",
    description: "Look up one submitted operation.",
  });

export const eventsQuerySchema = z
  .strictObject({ since: z.int().nonnegative().optional() })
  .meta({
    id: "EventsQuery",
    description:
      "Event stream. `since` resumes after a sequence number; if the ring no longer holds that point, the stream starts with an `eventGap`.",
  });

/** All query schemas by read, for the router’s whitelist. */
export const QUERY_SCHEMAS = {
  capabilities: capabilitiesQuerySchema,
  repositories: repositoriesQuerySchema,
  status: worktreeQuerySchema,
  history: historyQuerySchema,
  refs: repositoryQuerySchema,
  diff: diffQuerySchema,
  worktrees: repositoryQuerySchema,
  submodules: worktreeQuerySchema,
  stashes: repositoryQuerySchema,
  operations: operationQuerySchema,
  events: eventsQuerySchema,
} as const;

/** Operations with the targets they accept, as published in capabilities. */
export type OperationCapability = {
  readonly kind: (typeof OPERATION_TARGET_LIST)[number][0];
  readonly targets: readonly MutationTarget["kind"][];
};

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type SessionExchangeRequest = z.infer<
  typeof sessionExchangeRequestSchema
>;
export type SessionExchangeResponse = z.infer<
  typeof sessionExchangeResponseSchema
>;
export type ReadKind = z.infer<typeof readKindSchema>;
export type GitCapabilities = z.infer<typeof gitCapabilitiesSchema>;
export type UnavailableReason = z.infer<typeof unavailableReasonSchema>;
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;
export type HeadState = z.infer<typeof headStateSchema>;
export type RepositorySummary = z.infer<typeof repositorySummarySchema>;
export type RepositoriesResponse = z.infer<typeof repositoriesResponseSchema>;
export type PathEncoding = z.infer<typeof pathEncodingSchema>;
export type SubmoduleStatus = z.infer<typeof submoduleStatusSchema>;
export type UnmergedStage = z.infer<typeof unmergedStageSchema>;
export type StatusEntry = z.infer<typeof statusEntrySchema>;
export type StatusSnapshot = z.infer<typeof statusSnapshotSchema>;
export type CommitSummary = z.infer<typeof commitSummarySchema>;
export type CommitDetail = z.infer<typeof commitDetailSchema>;
export type HistoryPage = z.infer<typeof historyPageSchema>;
export type RefEntry = z.infer<typeof refEntrySchema>;
export type RemoteRefEntry = z.infer<typeof remoteRefEntrySchema>;
export type TagEntry = z.infer<typeof tagEntrySchema>;
export type RefsSnapshot = z.infer<typeof refsSnapshotSchema>;
export type PatchLine = z.infer<typeof patchLineSchema>;
export type PatchHunk = z.infer<typeof patchHunkSchema>;
export type FilePatch = z.infer<typeof filePatchSchema>;
export type DiffFile = z.infer<typeof diffFileSchema>;
export type DiffResponse = z.infer<typeof diffResponseSchema>;
export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>;
export type WorktreesResponse = z.infer<typeof worktreesResponseSchema>;
export type SubmoduleSummary = z.infer<typeof submoduleSummarySchema>;
export type SubmodulesResponse = z.infer<typeof submodulesResponseSchema>;
export type StashEntry = z.infer<typeof stashEntrySchema>;
export type StashesResponse = z.infer<typeof stashesResponseSchema>;
export type OperationStatus = z.infer<typeof operationStatusSchema>;
export type OperationResult = z.infer<typeof operationResultSchema>;
export type OperationRecord = z.infer<typeof operationRecordSchema>;
export type OperationsListResponse = z.infer<
  typeof operationsListResponseSchema
>;
export type CancelOperationRequest = z.infer<
  typeof cancelOperationRequestSchema
>;
export type PreviewsRequest = z.infer<typeof previewsRequestSchema>;
export type PreviewsResponse = z.infer<typeof previewsResponseSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
