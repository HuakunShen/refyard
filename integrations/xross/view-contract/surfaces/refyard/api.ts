/** Copied from Xross 9310f2b8: packages/embedded-web/src/surfaces/refyard/api.ts. */
import type {
  ApprovalResultV1,
  CursorV1,
  PageV1,
  RefyardViewErrorCodeV1,
  RemoteEndpointSummaryV1,
  RuntimeLimitsV1,
  SequencedViewEventV1,
  UInt64V1,
  UnixMillisV1,
} from "../../contracts/view-v1/types";
import type {
  MutationPreviewIdV1,
  MutationRecoveryIdV1,
  MutationRecoverySnapshotIdV1,
  PathIdV1,
  PathPreviewTokenV1,
  RefyardJobIdV1,
  RefyardSnapshotIdV1,
  RepositoryIdV1,
  ServiceInstanceIdV1,
  WorktreeIdV1,
  WorkspaceRootIdV1,
} from "../../contracts/view-v1/ids";
import type { ViewContextV1 } from "../view-context";

export const REFYARD_VIEW_METHODS_V1 = [
  "context",
  "capabilities",
  "listWorkspaceRoots",
  "listRepositories",
  "getStatus",
  "historyPage",
  "listRefs",
  "listWorktrees",
  "listStashes",
  "listSubmodules",
  "getPathPreviews",
  "readDiff",
  "previewMutation",
  "requestMutationSubmission",
  "getMutationJob",
  "listMutationRecoveries",
  "watchRepository",
  "watchMutation",
] as const;

export const REFYARD_TARGET_KINDS_V1 = ["workspace", "repository", "worktree"] as const;
export type RefyardTargetKindV1 = (typeof REFYARD_TARGET_KINDS_V1)[number];
export type RefyardOperationKindV1 =
  | "initRepository"
  | "cloneRepository"
  | "stagePaths"
  | "unstagePaths"
  | "discardTrackedPaths"
  | "commit"
  | "amendCommit"
  | "createBranch"
  | "switchBranch"
  | "renameBranch"
  | "deleteBranch"
  | "setBranchUpstream"
  | "addRemote"
  | "updateRemote"
  | "removeRemote"
  | "fetch"
  | "push"
  | "pull"
  | "createStash"
  | "applyStash"
  | "popStash"
  | "dropStash"
  | "createTag"
  | "deleteTag"
  | "pushTag"
  | "createWorktree"
  | "removeWorktree"
  | "lockWorktree"
  | "unlockWorktree"
  | "addSubmodule"
  | "updateSubmodule"
  | "syncSubmodule"
  | "merge"
  | "continueMerge"
  | "abortMerge"
  | "revertCommit"
  | "resetBranch"
  | "cherryPick"
  | "continueCherryPick"
  | "abortCherryPick"
  | "rebase"
  | "continueRebase"
  | "abortRebase"
  | "dropCommit"
  | "squashCommit";

export const REFYARD_OPERATION_TARGETS_V1 = [
  ["initRepository", "workspace"],
  ["cloneRepository", "workspace"],
  ["stagePaths", "worktree"],
  ["unstagePaths", "worktree"],
  ["discardTrackedPaths", "worktree"],
  ["commit", "worktree"],
  ["amendCommit", "worktree"],
  ["createBranch", "repository"],
  ["switchBranch", "worktree"],
  ["renameBranch", "repository"],
  ["deleteBranch", "repository"],
  ["setBranchUpstream", "repository"],
  ["addRemote", "repository"],
  ["updateRemote", "repository"],
  ["removeRemote", "repository"],
  ["fetch", "repository"],
  ["push", "repository"],
  ["pull", "worktree"],
  ["createStash", "worktree"],
  ["applyStash", "worktree"],
  ["popStash", "worktree"],
  ["dropStash", "repository"],
  ["createTag", "repository"],
  ["deleteTag", "repository"],
  ["pushTag", "repository"],
  ["createWorktree", "repository"],
  ["removeWorktree", "repository"],
  ["lockWorktree", "repository"],
  ["unlockWorktree", "repository"],
  ["addSubmodule", "worktree"],
  ["updateSubmodule", "worktree"],
  ["syncSubmodule", "worktree"],
  ["merge", "worktree"],
  ["continueMerge", "worktree"],
  ["abortMerge", "worktree"],
  ["revertCommit", "worktree"],
  ["resetBranch", "worktree"],
  ["cherryPick", "worktree"],
  ["continueCherryPick", "worktree"],
  ["abortCherryPick", "worktree"],
  ["rebase", "worktree"],
  ["continueRebase", "worktree"],
  ["abortRebase", "worktree"],
  ["dropCommit", "worktree"],
  ["squashCommit", "worktree"],
] as const satisfies readonly (readonly [RefyardOperationKindV1, RefyardTargetKindV1])[];

export type RefyardMutationTargetV1 =
  | {
      readonly kind: "workspace";
      readonly workspaceRootId: WorkspaceRootIdV1;
      readonly relativeDestination: string;
    }
  | {
      readonly kind: "repository";
      readonly repositoryId: RepositoryIdV1;
      readonly expectedSnapshotId: RefyardSnapshotIdV1;
    }
  | {
      readonly kind: "worktree";
      readonly repositoryId: RepositoryIdV1;
      readonly worktreeId: WorktreeIdV1;
      readonly expectedSnapshotId: RefyardSnapshotIdV1;
    };

type PathSelectionV1 = {
  readonly pathIds: readonly PathIdV1[];
  readonly previewTokens: readonly PathPreviewTokenV1[];
};
type PlainPathSelectionV1 = { readonly pathIds: readonly PathIdV1[] };
type BranchNameV1 = string;
type RemoteNameV1 = string;
type ObjectIdV1 = string;
type FullRefNameV1 = string;
type RemoteUrlV1 = string;
type CommitMessageV1 = string;
type DestinationV1 = string;
type StashLocatorV1 = { readonly oid: string; readonly locator: string };
type WorktreeReferenceV1 =
  | { readonly kind: "existingBranch"; readonly branchName: BranchNameV1 }
  | { readonly kind: "newBranch"; readonly branchName: BranchNameV1; readonly startOid: ObjectIdV1 }
  | { readonly kind: "detached"; readonly oid: ObjectIdV1 };

/** All 45 pinned Refyard operation variants; no ad-hoc method/payload escape hatch. */
export type RefyardMutationOperationV1 =
  | { readonly kind: "initRepository"; readonly initialBranch: BranchNameV1 | null }
  | { readonly kind: "cloneRepository"; readonly remoteUrl: RemoteUrlV1; readonly relativeDestination: DestinationV1; readonly initializeSubmodules: boolean }
  | ({ readonly kind: "stagePaths" } & PathSelectionV1)
  | ({ readonly kind: "unstagePaths" } & PlainPathSelectionV1)
  | ({ readonly kind: "discardTrackedPaths"; readonly confirmed: true } & PathSelectionV1)
  | { readonly kind: "commit"; readonly message: CommitMessageV1 }
  | { readonly kind: "amendCommit"; readonly message: CommitMessageV1 | null; readonly confirmed: true }
  | { readonly kind: "createBranch"; readonly branchName: BranchNameV1; readonly startOid: ObjectIdV1 | null; readonly switchToIt: boolean }
  | { readonly kind: "switchBranch"; readonly branchName: BranchNameV1 }
  | { readonly kind: "renameBranch"; readonly branchName: BranchNameV1; readonly newName: BranchNameV1 }
  | { readonly kind: "deleteBranch"; readonly branchName: BranchNameV1; readonly confirmed: true }
  | { readonly kind: "setBranchUpstream"; readonly branchName: BranchNameV1; readonly upstream: { readonly remoteName: RemoteNameV1; readonly branchName: BranchNameV1 } | null }
  | { readonly kind: "addRemote"; readonly remoteName: RemoteNameV1; readonly fetchUrl: RemoteUrlV1; readonly pushUrl: RemoteUrlV1 | null }
  | { readonly kind: "updateRemote"; readonly remoteName: RemoteNameV1; readonly newName: string | null; readonly fetchUrl: RemoteUrlV1 | null; readonly pushUrl: RemoteUrlV1 | null }
  | { readonly kind: "removeRemote"; readonly remoteName: RemoteNameV1; readonly confirmed: true }
  | { readonly kind: "fetch"; readonly remoteName: RemoteNameV1; readonly prune: boolean; readonly tags: "none" | "following" }
  | { readonly kind: "push"; readonly remoteName: RemoteNameV1; readonly sourceRef: FullRefNameV1; readonly destinationRef: FullRefNameV1; readonly setUpstream: boolean }
  | { readonly kind: "pull"; readonly remoteName: RemoteNameV1; readonly mode: "ff-only" }
  | { readonly kind: "createStash"; readonly message: CommitMessageV1 | null; readonly includeUntracked: boolean; readonly keepIndex: boolean }
  | { readonly kind: "applyStash"; readonly stash: StashLocatorV1; readonly restoreIndex: boolean }
  | { readonly kind: "popStash"; readonly stash: StashLocatorV1; readonly restoreIndex: boolean; readonly confirmed: true }
  | { readonly kind: "dropStash"; readonly stash: StashLocatorV1; readonly confirmed: true }
  | { readonly kind: "createTag"; readonly tagName: string; readonly targetOid: ObjectIdV1 | null; readonly annotation: { readonly message: CommitMessageV1 } | null }
  | { readonly kind: "deleteTag"; readonly tagName: string; readonly confirmed: true }
  | { readonly kind: "pushTag"; readonly remoteName: RemoteNameV1; readonly tagName: string }
  | { readonly kind: "createWorktree"; readonly relativeDestination: DestinationV1; readonly reference: WorktreeReferenceV1 }
  | { readonly kind: "removeWorktree"; readonly worktreeId: WorktreeIdV1; readonly confirmed: true }
  | { readonly kind: "lockWorktree"; readonly worktreeId: WorktreeIdV1; readonly reason: string | null }
  | { readonly kind: "unlockWorktree"; readonly worktreeId: WorktreeIdV1 }
  | { readonly kind: "addSubmodule"; readonly remoteUrl: RemoteUrlV1; readonly relativePath: DestinationV1; readonly branchName: BranchNameV1 | null; readonly initialize: boolean }
  | ({ readonly kind: "updateSubmodule"; readonly initialize: boolean; readonly recursive: boolean } & PlainPathSelectionV1)
  | ({ readonly kind: "syncSubmodule"; readonly recursive: boolean } & PlainPathSelectionV1)
  | { readonly kind: "merge"; readonly sourceOid: ObjectIdV1; readonly mode: "default" | "no-ff"; readonly message: CommitMessageV1 | null }
  | { readonly kind: "continueMerge"; readonly message: CommitMessageV1 | null }
  | { readonly kind: "abortMerge"; readonly confirmed: true }
  | { readonly kind: "revertCommit"; readonly oid: ObjectIdV1 }
  | { readonly kind: "resetBranch"; readonly oid: ObjectIdV1; readonly mode: "soft" | "mixed" }
  | { readonly kind: "cherryPick"; readonly oid: ObjectIdV1 }
  | { readonly kind: "continueCherryPick" }
  | { readonly kind: "abortCherryPick"; readonly confirmed: true }
  | { readonly kind: "rebase"; readonly upstreamOid: ObjectIdV1 }
  | { readonly kind: "continueRebase" }
  | { readonly kind: "abortRebase"; readonly confirmed: true }
  | { readonly kind: "dropCommit"; readonly oid: ObjectIdV1; readonly confirmed: true }
  | { readonly kind: "squashCommit"; readonly message: CommitMessageV1 | null };

export type GitObjectFormatV1 = "sha1" | "sha256";
export type GitOperationInProgressV1 = "merge" | "cherry-pick" | "revert" | "rebase" | "bisect" | "apply-mailbox" | "unknown";
export interface HeadStateV1 {
  readonly kind: "born" | "unborn";
  readonly branchName: string | null;
  readonly oid: ObjectIdV1 | null;
  readonly detached: boolean;
}

export interface WorkspaceRootSummaryV1 {
  readonly workspaceRootId: WorkspaceRootIdV1;
  readonly displayLabel: string;
  readonly policyRevision: UInt64V1;
}
export interface RepositorySummaryV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly workspaceRootId: WorkspaceRootIdV1;
  readonly displayName: string;
  readonly rootRelativeDisplayPath?: string;
  readonly objectFormat: GitObjectFormatV1;
  readonly worktreeIds: readonly WorktreeIdV1[];
  readonly primaryWorktreeId: WorktreeIdV1;
  readonly head: HeadStateV1;
  readonly operationInProgress: GitOperationInProgressV1 | null;
  readonly lastFetchedAt?: UnixMillisV1;
}

export type RefyardReadKindV1 = "capabilities" | "filesystem" | "repositories" | "status" | "history" | "refs" | "diff" | "worktrees" | "submodules" | "stashes" | "operations" | "events";
export type RefyardUnavailableReasonKeyV1 = "notImplemented" | "gitFeatureMissing" | "unsupportedTarget" | "unknown";
export interface RefyardCapabilitiesV1 {
  readonly apiMajor: number;
  readonly contractVersion: string;
  readonly serviceInstanceId: ServiceInstanceIdV1;
  readonly host: { readonly kind: "macos" | "linux" | "windows" | "unknown"; readonly version: string };
  readonly git: { readonly version: string; readonly features: { readonly porcelainV2Status: boolean; readonly worktreeListZ: boolean; readonly catFileBatch: boolean; readonly pushPorcelain: boolean; readonly fetchPorcelain: boolean; readonly objectFormats: readonly GitObjectFormatV1[] } };
  readonly reads: readonly RefyardReadKindV1[];
  readonly providers?: readonly string[];
  readonly operations: readonly { readonly operationKind: RefyardOperationKindV1; readonly targets: readonly RefyardTargetKindV1[] }[];
  readonly limits: RuntimeLimitsV1;
  readonly unavailable: readonly { readonly reasonKey: RefyardUnavailableReasonKeyV1; readonly operationIds: readonly RefyardOperationKindV1[] }[];
}

export interface RefyardListQueryV1 { readonly cursor?: CursorV1; readonly limit: number }
export interface StatusQueryV1 { readonly worktreeId?: WorktreeIdV1; readonly cursor?: CursorV1; readonly limit: number }
export interface StatusEntryV1 {
  readonly pathId: PathIdV1;
  readonly displayPath: string;
  readonly pathEncoding: "utf8" | "base64";
  readonly kind: "ordinary" | "renamed" | "copied" | "unmerged" | "untracked" | "ignored";
  readonly indexStatus: string;
  readonly worktreeStatus: string;
  readonly originalPathId: PathIdV1 | null;
  readonly originalDisplayPath: string | null;
  readonly headOid: ObjectIdV1 | null;
  readonly indexOid: ObjectIdV1 | null;
  readonly headMode: string | null;
  readonly indexMode: string | null;
  readonly worktreeMode: string | null;
  readonly submodule: { readonly commitChanged: boolean; readonly modified: boolean; readonly untracked: boolean } | null;
  readonly unmergedStages: readonly { readonly stage: number; readonly mode: string | null; readonly oid: ObjectIdV1 | null }[] | null;
}
export interface StatusPageV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly worktreeId: WorktreeIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly head: HeadStateV1;
  readonly upstream: { readonly name: string; readonly ahead: number; readonly behind: number } | null;
  readonly operationInProgress: GitOperationInProgressV1 | null;
  readonly entries: readonly StatusEntryV1[];
  readonly entryCount: number;
  readonly truncated: boolean;
  readonly nextCursor: CursorV1 | null;
}

export interface HistoryQueryV1 {
  readonly worktreeId?: WorktreeIdV1;
  readonly cursor?: CursorV1;
  readonly limit?: number;
  readonly detailOid?: ObjectIdV1;
  readonly firstParentOnly?: boolean;
  readonly message?: string;
  readonly author?: string;
  readonly oidPrefix?: string;
  readonly refFullName?: string;
  readonly committedAfter?: UnixMillisV1;
  readonly committedBefore?: UnixMillisV1;
  readonly pathId?: PathIdV1;
}
export interface CommitSummaryV1 {
  readonly oid: ObjectIdV1;
  readonly parents: readonly ObjectIdV1[];
  readonly subject: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAtUnixMs: UnixMillisV1;
  readonly committedAtUnixMs: UnixMillisV1;
  readonly refNames: readonly string[];
  readonly signed: boolean;
  readonly boundary: boolean;
  readonly missingParents: readonly ObjectIdV1[];
}
export interface CommitDetailV1 {
  readonly oid: ObjectIdV1;
  readonly tree: ObjectIdV1;
  readonly parents: readonly ObjectIdV1[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAtUnixMs: UnixMillisV1;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly committedAtUnixMs: UnixMillisV1;
  readonly subject: string;
  readonly body: string;
  readonly encoding: string | null;
  readonly signatureState: "unsigned" | "valid" | "invalid" | "unknown";
}
export interface HistoryPageV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly objectFormat: GitObjectFormatV1;
  readonly shallow: boolean;
  readonly topology: "continuous" | "sparse";
  readonly commits: readonly CommitSummaryV1[];
  readonly nextCursor: CursorV1 | null;
  readonly tipsMoved: boolean;
  readonly truncated: boolean;
  readonly detail: CommitDetailV1 | null;
}

export type RefEntryV1 =
  | { readonly kind: "localBranch"; readonly name: string; readonly fullName: string; readonly oid: ObjectIdV1; readonly isCurrent: boolean; readonly upstream: { readonly fullName: string; readonly ahead: number; readonly behind: number; readonly gone: boolean } | null }
  | { readonly kind: "remoteTracking"; readonly name: string; readonly fullName: string; readonly oid: ObjectIdV1; readonly remoteName: string }
  | { readonly kind: "tag"; readonly name: string; readonly fullName: string; readonly oid: ObjectIdV1; readonly annotated: boolean; readonly targetOid: ObjectIdV1 | null }
  | { readonly kind: "remote"; readonly name: string; readonly fetchEndpoint: RemoteEndpointSummaryV1; readonly pushEndpoint: RemoteEndpointSummaryV1 | null }
  | { readonly kind: "other"; readonly fullName: string; readonly oid: ObjectIdV1; readonly category: "stash" | "notes" | "replace" | "other" };
export interface RefsPageV1 {
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly repositoryId: RepositoryIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly objectFormat: GitObjectFormatV1;
  readonly head: HeadStateV1;
  readonly truncated: boolean;
  readonly items: readonly RefEntryV1[];
  readonly nextCursor: CursorV1 | null;
}

export interface WorktreeSummaryV1 {
  readonly worktreeId: WorktreeIdV1;
  readonly rootRelativeDisplayPath: string;
  readonly head: HeadStateV1;
  readonly main: boolean;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockReason: string | null;
  readonly prunable: boolean;
}
export interface WorktreesSnapshotV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly worktrees: readonly WorktreeSummaryV1[];
}
export interface StashEntryV1 {
  readonly oid: ObjectIdV1;
  readonly locator: string;
  readonly message: string;
  readonly createdAtUnixMs: UnixMillisV1;
  readonly branchDisplay: string | null;
}
export interface StashesPageV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly truncated: boolean;
  readonly items: readonly StashEntryV1[];
  readonly nextCursor: CursorV1 | null;
}
export interface SubmoduleSummaryV1 {
  readonly worktreeId: WorktreeIdV1;
  readonly pathId: PathIdV1;
  readonly displayPath: string;
  readonly recordedOid: ObjectIdV1 | null;
  readonly indexOid: ObjectIdV1 | null;
  readonly actualOid: ObjectIdV1 | null;
  readonly state: "initialized" | "uninitialized" | "conflicted" | "unknown";
  readonly urlEndpoint: RemoteEndpointSummaryV1;
  readonly branchDisplay: string | null;
  readonly repositoryId: RepositoryIdV1 | null;
}
export interface SubmodulesPageV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly worktreeId: WorktreeIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly truncated: boolean;
  readonly items: readonly SubmoduleSummaryV1[];
  readonly nextCursor: CursorV1 | null;
}

export interface PathPreviewV1 {
  readonly pathId: PathIdV1;
  readonly previewToken: string;
  readonly sizeBytes: UInt64V1 | null;
  readonly contentKind: "text" | "binary" | "unrepresentable";
  readonly algorithm: "sha256";
  readonly expiresAtUnixMs: UnixMillisV1;
}
export interface PathPreviewsV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly worktreeId: WorktreeIdV1;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly tokens: readonly PathPreviewV1[];
}

export interface DiffQueryV1 {
  readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
  readonly worktreeId?: WorktreeIdV1;
  readonly oid?: ObjectIdV1;
  readonly fromOid?: ObjectIdV1;
  readonly toOid?: ObjectIdV1;
  readonly pathId?: PathIdV1;
  readonly cursor?: CursorV1;
  readonly limit: number;
}
export type PatchLineV1 = { readonly kind: "context" | "addition" | "deletion"; readonly oldLine: number | null; readonly newLine: number | null; readonly text: string };
export interface PatchHunkV1 { readonly oldStart: number; readonly oldLines: number; readonly newStart: number; readonly newLines: number; readonly header: string; readonly lines: readonly PatchLineV1[] }
export type FilePatchV1 =
  | { readonly kind: "text"; readonly hunks: readonly PatchHunkV1[]; readonly synthesized: boolean }
  | { readonly kind: "binary" }
  | { readonly kind: "oversize"; readonly reason: "byteLimit" | "lineLimit" }
  | { readonly kind: "unavailable"; readonly reason: "pathUnrepresentable" | "objectMissing" | "unsupported" }
  | { readonly kind: "submodule"; readonly oldOid: ObjectIdV1 | null; readonly newOid: ObjectIdV1 | null };
export interface DiffFileV1 {
  readonly pathId: PathIdV1;
  readonly displayPath: string;
  readonly oldPathId: PathIdV1 | null;
  readonly oldDisplayPath: string | null;
  readonly changeKind: "added" | "modified" | "deleted" | "renamed" | "copied" | "typeChanged" | "unmerged" | "unknown";
  readonly binary: boolean;
  readonly submodule: boolean;
  readonly insertions: number | null;
  readonly deletions: number | null;
  readonly oldMode: string | null;
  readonly newMode: string | null;
  readonly patch: FilePatchV1;
}
export interface DiffPageV1 {
  readonly repositoryId: RepositoryIdV1;
  readonly worktreeId: WorktreeIdV1 | null;
  readonly snapshotId: RefyardSnapshotIdV1;
  readonly readAtUnixMs: UnixMillisV1;
  readonly query: DiffQueryV1;
  readonly files: readonly DiffFileV1[];
  readonly stats: { readonly filesChanged: number; readonly insertions: number; readonly deletions: number; readonly binaryFiles: number };
  readonly truncated: boolean;
  readonly nextCursor: CursorV1 | null;
}

export interface MutationPreviewV1 {
  readonly previewId: MutationPreviewIdV1;
  /** Output-only correlation with a later native-owned recovery row; grants no authority. */
  readonly recoveryId: MutationRecoveryIdV1;
  readonly targetKind: RefyardTargetKindV1;
  readonly resourceLabel: string;
  readonly snapshotId?: RefyardSnapshotIdV1;
  readonly operationKind: RefyardOperationKindV1;
  readonly summaryKey: string;
  readonly displayPaths: readonly string[];
  readonly requiresNativeApproval: boolean;
  readonly expiresAtUnixMs: UnixMillisV1;
}
export interface RefyardMutationIntentV1 {
  readonly target: RefyardMutationTargetV1;
  readonly operation: RefyardMutationOperationV1;
}
export interface MutationJobV1 {
  readonly jobId: RefyardJobIdV1;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "needsAttention" | "unknown" | "cancelled";
  readonly sequence: UInt64V1;
  readonly createdAtUnixMs: UnixMillisV1;
  readonly updatedAtUnixMs: UnixMillisV1;
  readonly problemCode: RefyardViewErrorCodeV1 | null;
}
export type MutationRecoveryStateV1 =
  | { readonly kind: "found"; readonly job: MutationJobV1 }
  | { readonly kind: "unknown" }
  | { readonly kind: "notAccepted" }
  | { readonly kind: "reconciled" }
  | { readonly kind: "ownerAcceptedUnknown" };
export interface MutationRecoveryV1 {
  readonly recoveryId: MutationRecoveryIdV1;
  readonly operationKind: RefyardOperationKindV1;
  readonly resourceLabel: string;
  readonly summaryKey: string;
  readonly createdAtUnixMs: UnixMillisV1;
  readonly updatedAtUnixMs: UnixMillisV1;
  readonly state: MutationRecoveryStateV1;
  /** Native-computed disposition for the exact resource, after all local rows and fresh target state are checked. Display only; native preview admission remains authoritative. */
  readonly writeFence: "blocked" | "released";
}
export interface MutationRecoveryPageV1 {
  readonly snapshotId: MutationRecoverySnapshotIdV1;
  readonly items: readonly MutationRecoveryV1[];
  readonly nextCursor: CursorV1 | null;
}
export type RepositoryWatchEventV1 = { readonly kind: "snapshotChanged"; readonly snapshotId: RefyardSnapshotIdV1 };
export type MutationWatchEventV1 = MutationJobV1;

export interface RefyardViewApiV1 {
  context(): Promise<ViewContextV1>;
  capabilities(): Promise<RefyardCapabilitiesV1>;
  listWorkspaceRoots(request: { readonly query: RefyardListQueryV1 }): Promise<PageV1<WorkspaceRootSummaryV1>>;
  listRepositories(request: { readonly query: RefyardListQueryV1 }): Promise<PageV1<RepositorySummaryV1>>;
  getStatus(request: { readonly repositoryId: RepositoryIdV1; readonly query: StatusQueryV1 }): Promise<StatusPageV1>;
  historyPage(request: { readonly repositoryId: RepositoryIdV1; readonly query: HistoryQueryV1 }): Promise<HistoryPageV1>;
  listRefs(request: { readonly repositoryId: RepositoryIdV1; readonly query: RefyardListQueryV1 }): Promise<RefsPageV1>;
  listWorktrees(request: { readonly repositoryId: RepositoryIdV1 }): Promise<WorktreesSnapshotV1>;
  listStashes(request: { readonly repositoryId: RepositoryIdV1; readonly query: RefyardListQueryV1 }): Promise<StashesPageV1>;
  listSubmodules(request: { readonly repositoryId: RepositoryIdV1; readonly worktreeId: WorktreeIdV1; readonly query: RefyardListQueryV1 }): Promise<SubmodulesPageV1>;
  getPathPreviews(request: { readonly repositoryId: RepositoryIdV1; readonly worktreeId: WorktreeIdV1; readonly expectedSnapshotId: RefyardSnapshotIdV1; readonly pathIds: readonly PathIdV1[] }): Promise<PathPreviewsV1>;
  readDiff(request: { readonly repositoryId: RepositoryIdV1; readonly query: DiffQueryV1 }): Promise<DiffPageV1>;
  previewMutation(request: { readonly intent: RefyardMutationIntentV1 }): Promise<MutationPreviewV1>;
  requestMutationSubmission(request: { readonly previewId: MutationPreviewIdV1 }): Promise<ApprovalResultV1<MutationJobV1>>;
  getMutationJob(request: { readonly jobId: RefyardJobIdV1 }): Promise<MutationJobV1>;
  listMutationRecoveries(request: { readonly query: RefyardListQueryV1 }): Promise<MutationRecoveryPageV1>;
  watchRepository(request: { readonly repositoryId: RepositoryIdV1; readonly sinceSequence?: UInt64V1 }): AsyncIterable<SequencedViewEventV1<RepositoryWatchEventV1>>;
  watchMutation(request: { readonly jobId: RefyardJobIdV1; readonly sinceSequence?: UInt64V1 }): AsyncIterable<SequencedViewEventV1<MutationWatchEventV1>>;
}

type RefyardApiMethodNameV1 = (typeof REFYARD_VIEW_METHODS_V1)[number];
type RefyardMethodListIsExactV1 = Exclude<keyof RefyardViewApiV1, RefyardApiMethodNameV1> extends never
  ? Exclude<RefyardApiMethodNameV1, keyof RefyardViewApiV1> extends never
    ? true
    : false
  : false;
const _refyardMethodListIsExact: RefyardMethodListIsExactV1 = true;
void _refyardMethodListIsExact;
