/**
 * Mutation application layer for the workbench.
 *
 * Panels emit semantic intent. This controller turns that intent into the closed Refyard mutation
 * contract, re-reads fresh snapshots, follows accepted operations to terminal state, and refreshes
 * the read model. It deliberately owns no layout and no session credential invalidation.
 */
import { createMutationClient, type GitClient } from "@refyard/git-client";
import type { ParsedMutationRequest } from "@refyard/git-contract";
import type { QueryClient } from "@tanstack/svelte-query";
import { followOperation } from "../operation-follow.js";
import type { Negotiation } from "../session-negotiation.js";
import { describeClientProblem } from "./session.js";
import {
  clearRepositoryIfSelected,
  selectRepository,
  type WorkbenchSelectionState,
} from "./selection.js";
import type { createWorkbenchQueries } from "./queries.svelte.js";
import {
  branchCreateOperation,
  mutationAvailabilityFor,
  operationIdFromSubmission,
  tagCreateOperation,
  writeRefusalMessage,
} from "./mutation-model.js";

export interface WorkbenchMutationInputs {
  readonly client: () => GitClient;
  readonly baseUrl: () => string;
  readonly token: () => string | null;
  readonly browserOnline: () => boolean;
  readonly negotiation: () => Negotiation;
  readonly selection: WorkbenchSelectionState;
  readonly queries: ReturnType<typeof createWorkbenchQueries>;
  readonly queryClient: QueryClient;
  readonly fetch: typeof fetch;
  /** Called only after a commit/amend operation is confirmed terminal-successful. */
  readonly onCommitSucceeded?: (
    repositoryId: string,
    worktreeId: string,
  ) => void;
}

export interface RepositoryInitInput {
  readonly allowedRootId: string;
  readonly relativeDestination: string;
  readonly initialBranch: string | null;
}

export interface RepositoryCloneInput {
  readonly allowedRootId: string;
  readonly relativeDestination: string;
  readonly remoteUrl: string;
  readonly initializeSubmodules: boolean;
}

export interface WorktreeReferenceInput {
  readonly kind: "newBranch" | "existingBranch" | "detached";
  readonly branchName?: string;
  readonly oid?: string;
}

interface MutationContext {
  readonly repositoryId: string;
  readonly worktreeId: string;
}

interface ScopedMessage {
  readonly context: MutationContext;
  readonly message: string;
}

type MutationReport = (
  message: string | null,
  context: MutationContext | null,
) => void;

function sameMutationContext(
  left: MutationContext,
  right: MutationContext | null,
): boolean {
  return (
    right !== null &&
    left.repositoryId === right.repositoryId &&
    left.worktreeId === right.worktreeId
  );
}

export function createWorkbenchMutations(input: WorkbenchMutationInputs) {
  const mutationClient = $derived(
    createMutationClient({
      baseUrl: input.baseUrl(),
      fetch: input.fetch,
      token: input.token,
    }),
  );

  let busy = $state(false);
  let repositoryMessage = $state<string | null>(null);
  let repositoryAccessMessage = $state<string | null>(null);
  let stagingMessage = $state<ScopedMessage | null>(null);
  let commitResult = $state<ScopedMessage | null>(null);
  let branchMessage = $state<string | null>(null);
  let remoteMessage = $state<string | null>(null);
  let worktreeMessage = $state<string | null>(null);
  let submoduleMessage = $state<string | null>(null);
  let mergeMessage = $state<string | null>(null);
  let stashResult = $state<string | null>(null);
  let tagResult = $state<string | null>(null);

  const availability = $derived(
    mutationAvailabilityFor(input.queries.capabilities.data?.operations),
  );
  const writesAllowed = $derived(
    writeRefusalMessage({
      browserOnline: input.browserOnline(),
      hasToken: input.token() !== null,
      negotiation: input.negotiation(),
      action: "write",
    }) === null,
  );
  const operationInProgress = $derived(
    input.queries.status.data?.operationInProgress ?? null,
  );
  const conflictedPaths = $derived(
    (input.queries.status.data?.entries ?? []).filter(
      (entry) => entry.kind === "unmerged",
    ),
  );
  const branchNames = $derived(
    (input.queries.refs.data?.branches ?? []).map((branch) => branch.name),
  );

  function visibleMessage(message: ScopedMessage | null): string | null {
    const repositoryId = input.selection.repositoryId;
    const worktreeId = input.queries.activeWorktreeId;
    if (repositoryId === null || worktreeId === null || message === null) {
      return null;
    }
    return sameMutationContext(message.context, { repositoryId, worktreeId })
      ? message.message
      : null;
  }

  async function invalidateRepositoryReads(
    repositoryId: string,
  ): Promise<void> {
    for (const prefix of [
      "status",
      "refs",
      "stashes",
      "history",
      "worktrees",
      "worktree-statuses",
      "submodules",
      "diff",
      "diff-patch",
    ] as const) {
      await input.queryClient.invalidateQueries({
        queryKey: [prefix, input.baseUrl(), input.token(), repositoryId],
      });
    }
  }

  async function performWrite(
    label: string,
    buildOperation: (context: {
      readonly repositoryId: string;
      readonly worktreeId: string;
    }) =>
      | ParsedMutationRequest["operation"]
      | Promise<ParsedMutationRequest["operation"]>,
    report: MutationReport = (message, context) => {
      stagingMessage =
        message === null || context === null ? null : { context, message };
    },
    targetKind: "worktree" | "repository" = "worktree",
    onSucceeded?: (context: MutationContext) => void,
  ): Promise<void> {
    busy = true;
    const repositoryId = input.selection.repositoryId;
    const worktreeId = input.queries.activeWorktreeId;
    const context =
      repositoryId === null || worktreeId === null
        ? null
        : { repositoryId, worktreeId };
    const reportForContext = (message: string | null): void => {
      if (context === null) {
        report(message, null);
        return;
      }
      const current: MutationContext | null =
        input.selection.repositoryId === context.repositoryId &&
        input.queries.activeWorktreeId === context.worktreeId
          ? context
          : null;
      if (current !== null && sameMutationContext(context, current)) {
        report(message, current);
      }
    };
    reportForContext(null);
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        hasToken: input.token() !== null,
        negotiation: input.negotiation(),
        action: "write",
      });
      if (refusal !== null) {
        throw new Error(refusal);
      }
      // Capture the target before any preview/status await. A user can switch worktrees while a
      // request is in flight; the operation must finish against the target the user confirmed.
      const targetContext = context;
      if (targetContext === null) {
        throw new Error("no repository selected");
      }
      const operation = await buildOperation(targetContext);
      const target =
        targetKind === "worktree"
          ? await (async () => {
              const snapshot = await input.client().status({
                repositoryId: targetContext.repositoryId,
                worktreeId: targetContext.worktreeId,
              });
              return {
                kind: "worktree" as const,
                repositoryId: snapshot.repositoryId,
                worktreeId: snapshot.worktreeId,
                expectedSnapshotId: snapshot.snapshotId,
              };
            })()
          : await (async () => {
              const snapshot = await input.client().refs({
                repositoryId: targetContext.repositoryId,
              });
              return {
                kind: "repository" as const,
                repositoryId: snapshot.repositoryId,
                expectedSnapshotId: snapshot.snapshotId,
              };
            })();
      const submitted = await mutationClient.submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target,
        operation,
      });
      const operationId = operationIdFromSubmission(submitted);
      reportForContext(await followOperation(mutationClient, operationId));
      if (onSucceeded !== undefined) {
        const finalRecord = await mutationClient.get(operationId);
        if (finalRecord.status === "succeeded") {
          onSucceeded(targetContext);
        }
      }
      await invalidateRepositoryReads(targetContext.repositoryId);
    } catch (error) {
      reportForContext(describeClientProblem(error));
    } finally {
      busy = false;
    }
  }

  async function createRepository(
    label: string,
    operation: ParsedMutationRequest["operation"],
    allowedRootId: string,
    relativeDestination: string,
  ): Promise<void> {
    busy = true;
    repositoryMessage = null;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        hasToken: input.token() !== null,
        negotiation: input.negotiation(),
        action: "write",
      });
      if (refusal !== null) {
        throw new Error(refusal);
      }
      const submitted = await mutationClient.submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target: { kind: "workspace", allowedRootId, relativeDestination },
        operation,
      });
      repositoryMessage = await followOperation(
        mutationClient,
        operationIdFromSubmission(submitted),
      );

      const refreshed = await input.queries.repositories.refetch();
      const created = (refreshed.data?.repositories ?? []).find((entry) =>
        entry.displayPath.endsWith(relativeDestination),
      );
      if (created !== undefined) {
        selectRepository(input.selection, created.repositoryId);
        await input.queryClient.invalidateQueries({ queryKey: ["status"] });
        await input.queryClient.invalidateQueries({ queryKey: ["refs"] });
      }
    } catch (error) {
      repositoryMessage = describeClientProblem(error);
    } finally {
      busy = false;
    }
  }

  function onRepositoryInit(request: RepositoryInitInput): void {
    void createRepository(
      "init-repository",
      { kind: "initRepository", initialBranch: request.initialBranch },
      request.allowedRootId,
      request.relativeDestination,
    );
  }

  function onRepositoryClone(request: RepositoryCloneInput): void {
    void createRepository(
      "clone-repository",
      {
        kind: "cloneRepository",
        remoteUrl: request.remoteUrl,
        relativeDestination: request.relativeDestination,
        initializeSubmodules: request.initializeSubmodules,
      },
      request.allowedRootId,
      request.relativeDestination,
    );
  }

  async function registerRepository(path: string): Promise<boolean> {
    busy = true;
    repositoryAccessMessage = null;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        hasToken: input.token() !== null,
        negotiation: input.negotiation(),
        action: "repositoryAccess",
      });
      if (refusal !== null) {
        throw new Error(refusal);
      }
      // Resolve home shorthand and symlinks using the host, which owns filesystem paths.
      const directory = await input.client().filesystemEntries({ path });
      const current = await input.queries.repositories.refetch();
      const existing = current.data?.repositories.find(
        (entry) => entry.displayPath === directory.path,
      );
      if (existing !== undefined) {
        selectRepository(input.selection, existing.repositoryId);
        return true;
      }
      const result = await input.client().registerRepository(directory.path);
      repositoryAccessMessage = `approved ${path}`;
      await input.queries.repositories.refetch();
      const added = result.repositories.find(
        (entry) => entry.displayPath === directory.path,
      );
      if (added !== undefined) {
        selectRepository(input.selection, added.repositoryId);
      }
      return added !== undefined;
    } catch (error) {
      repositoryAccessMessage = describeClientProblem(error);
      return false;
    } finally {
      busy = false;
    }
  }

  async function revokeRepository(repositoryId: string): Promise<void> {
    busy = true;
    repositoryAccessMessage = null;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        hasToken: input.token() !== null,
        negotiation: input.negotiation(),
        action: "repositoryAccess",
      });
      if (refusal !== null) {
        throw new Error(refusal);
      }
      await input.client().revokeRepository(repositoryId);
      repositoryAccessMessage = `revoked ${repositoryId}`;
      clearRepositoryIfSelected(input.selection, repositoryId);
      await input.queries.repositories.refetch();
    } catch (error) {
      repositoryAccessMessage = describeClientProblem(error);
    } finally {
      busy = false;
    }
  }

  async function previewTokensFor(
    repositoryId: string,
    worktreeId: string,
    pathIds: readonly string[],
  ): Promise<readonly string[]> {
    const previews = await input.client().previews({
      repositoryId,
      worktreeId,
      pathIds: [...pathIds],
    });
    const byPath = new Map(
      previews.tokens.map((token) => [token.pathId, token.previewToken]),
    );
    return pathIds.map((pathId) => {
      const previewToken = byPath.get(pathId);
      if (previewToken === undefined) {
        throw new Error("the host issued no preview token for a selected path");
      }
      return previewToken;
    });
  }

  function onStage(pathIds: readonly string[]): void {
    void performWrite("stage", async ({ repositoryId, worktreeId }) => {
      return {
        kind: "stagePaths" as const,
        pathIds: [...pathIds],
        previewTokens: [
          ...(await previewTokensFor(repositoryId, worktreeId, pathIds)),
        ],
      };
    });
  }

  function onUnstage(pathIds: readonly string[]): void {
    void performWrite("unstage", () => ({
      kind: "unstagePaths",
      pathIds: [...pathIds],
    }));
  }

  function onDiscard(pathIds: readonly string[]): void {
    void performWrite("discard", async ({ repositoryId, worktreeId }) => {
      return {
        kind: "discardTrackedPaths" as const,
        pathIds: [...pathIds],
        previewTokens: [
          ...(await previewTokensFor(repositoryId, worktreeId, pathIds)),
        ],
        confirmed: true,
      };
    });
  }

  function onCommit(message: string): void {
    void performWrite(
      "commit",
      () => ({ kind: "commit", message }),
      (result, context) => {
        commitResult =
          result === null || context === null
            ? null
            : { context, message: result };
      },
      "worktree",
      ({ repositoryId, worktreeId }) =>
        input.onCommitSucceeded?.(repositoryId, worktreeId),
    );
  }

  function onAmend(message: string | null): void {
    void performWrite(
      "amend",
      () => ({ kind: "amendCommit", message, confirmed: true }),
      (result, context) => {
        commitResult =
          result === null || context === null
            ? null
            : { context, message: result };
      },
      "worktree",
      ({ repositoryId, worktreeId }) =>
        input.onCommitSucceeded?.(repositoryId, worktreeId),
    );
  }

  function onBranchCreate(
    branchName: string,
    startOid: string | null = null,
  ): void {
    void performWrite(
      "create-branch",
      () => branchCreateOperation(branchName, startOid),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchSwitch(branchName: string): void {
    void performWrite(
      "switch-branch",
      () => ({ kind: "switchBranch", branchName }),
      (result) => {
        branchMessage = result;
      },
      "worktree",
    );
  }

  function onBranchRename(branchName: string, newName: string): void {
    void performWrite(
      "rename-branch",
      () => ({ kind: "renameBranch", branchName, newName }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchDelete(branchName: string): void {
    void performWrite(
      "delete-branch",
      () => ({ kind: "deleteBranch", branchName, confirmed: true }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchSetUpstream(
    branchName: string,
    upstream: {
      readonly remoteName: string;
      readonly branchName: string;
    } | null,
  ): void {
    void performWrite(
      "set-branch-upstream",
      () => ({ kind: "setBranchUpstream", branchName, upstream }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchMerge(branchName: string, noFf: boolean): void {
    const branch = (input.queries.refs.data?.branches ?? []).find(
      (entry) => entry.name === branchName,
    );
    if (branch === undefined) {
      mergeMessage = `no branch named ${branchName} is on screen; refresh and retry`;
      return;
    }
    void performWrite(
      "merge",
      () => ({
        kind: "merge",
        sourceOid: branch.oid,
        mode: noFf ? ("no-ff" as const) : ("default" as const),
        message: null,
      }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onMergeContinue(): void {
    void performWrite(
      "continue-merge",
      () => ({ kind: "continueMerge", message: null }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onMergeAbort(): void {
    void performWrite(
      "abort-merge",
      () => ({ kind: "abortMerge", confirmed: true }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onRemoteAdd(remoteName: string, fetchUrl: string): void {
    void performWrite(
      "add-remote",
      () => ({ kind: "addRemote", remoteName, fetchUrl, pushUrl: null }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onRemoteUpdate(
    remoteName: string,
    changes: {
      readonly newName: string | null;
      readonly fetchUrl: string | null;
      readonly pushUrl: string | null;
    },
  ): void {
    void performWrite(
      "update-remote",
      () => ({ kind: "updateRemote", remoteName, ...changes }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onRemoteRemove(remoteName: string): void {
    void performWrite(
      "remove-remote",
      () => ({ kind: "removeRemote", remoteName, confirmed: true }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onFetch(remoteName: string): void {
    void performWrite(
      "fetch",
      () => ({ kind: "fetch", remoteName, prune: false, tags: "none" }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onPush(remoteName: string, branchName: string): void {
    void performWrite(
      "push",
      () => ({
        kind: "push",
        remoteName,
        sourceRef: `refs/heads/${branchName}`,
        destinationRef: `refs/heads/${branchName}`,
        setUpstream: false,
      }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onPull(remoteName: string): void {
    void performWrite(
      "pull",
      () => ({ kind: "pull", remoteName, mode: "ff-only" }),
      (result) => {
        remoteMessage = result;
      },
      "worktree",
    );
  }

  function onStashCreate(
    stashMessage: string,
    includeUntracked: boolean,
  ): void {
    void performWrite(
      "stash-create",
      () => ({
        kind: "createStash",
        message: stashMessage.trim().length === 0 ? null : stashMessage,
        includeUntracked,
        keepIndex: false,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashApply(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-apply",
      () => ({
        kind: "applyStash",
        stash: { oid: stash.oid, locator: stash.locator },
        restoreIndex: false,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashPop(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-pop",
      () => ({
        kind: "popStash",
        stash: { oid: stash.oid, locator: stash.locator },
        restoreIndex: false,
        confirmed: true,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashDrop(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-drop",
      () => ({
        kind: "dropStash",
        stash: { oid: stash.oid, locator: stash.locator },
        confirmed: true,
      }),
      (result) => {
        stashResult = result;
      },
      "repository",
    );
  }

  function onTagCreate(
    tagName: string,
    annotation: string | null,
    targetOid: string | null = null,
  ): void {
    void performWrite(
      "tag-create",
      () => tagCreateOperation(tagName, annotation, targetOid),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  function onTagDelete(tagName: string): void {
    void performWrite(
      "tag-delete",
      () => ({ kind: "deleteTag", tagName, confirmed: true }),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  function onTagPush(tagName: string): void {
    const remote = input.queries.refs.data?.remotes[0]?.name ?? null;
    if (remote === null) {
      tagResult = "no remote to push to";
      return;
    }
    void performWrite(
      "tag-push",
      () => ({ kind: "pushTag", remoteName: remote, tagName }),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  async function worktreeReference(
    reference: WorktreeReferenceInput,
    repositoryId: string,
    worktreeId: string,
  ): Promise<
    | {
        readonly kind: "newBranch";
        readonly branchName: string;
        readonly startOid: string;
      }
    | { readonly kind: "existingBranch"; readonly branchName: string }
    | { readonly kind: "detached"; readonly oid: string }
  > {
    if (reference.kind === "detached") {
      return { kind: "detached", oid: reference.oid ?? "" };
    }
    if (reference.kind === "existingBranch") {
      return { kind: "existingBranch", branchName: reference.branchName ?? "" };
    }
    const snapshot = await input.client().status({
      repositoryId,
      worktreeId,
    });
    const head = snapshot.head;
    if (head.kind !== "born" || head.oid === null) {
      throw new Error(
        "this repository has no commit yet, so a new worktree has nothing to start from",
      );
    }
    return {
      kind: "newBranch",
      branchName: reference.branchName ?? "",
      startOid: head.oid,
    };
  }

  function onWorktreeCreate(
    relativeDestination: string,
    reference: WorktreeReferenceInput,
  ): void {
    void performWrite(
      "create-worktree",
      async ({ repositoryId, worktreeId }) => ({
        kind: "createWorktree",
        relativeDestination,
        reference: await worktreeReference(reference, repositoryId, worktreeId),
      }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeRemove(worktreeId: string): void {
    void performWrite(
      "remove-worktree",
      () => ({ kind: "removeWorktree", worktreeId, confirmed: true }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeLock(worktreeId: string, reason: string | null): void {
    void performWrite(
      "lock-worktree",
      () => ({ kind: "lockWorktree", worktreeId, reason }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeUnlock(worktreeId: string): void {
    void performWrite(
      "unlock-worktree",
      () => ({ kind: "unlockWorktree", worktreeId }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onSubmoduleAdd(submodule: {
    readonly remoteUrl: string;
    readonly relativePath: string;
    readonly branchName: string | null;
  }): void {
    void performWrite(
      "add-submodule",
      () => ({
        kind: "addSubmodule",
        remoteUrl: submodule.remoteUrl,
        relativePath: submodule.relativePath,
        branchName: submodule.branchName,
        initialize: true,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  function onSubmoduleUpdate(
    pathIds: readonly string[],
    recursive: boolean,
  ): void {
    void performWrite(
      "update-submodule",
      () => ({
        kind: "updateSubmodule",
        pathIds: [...pathIds],
        initialize: true,
        recursive,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  function onSubmoduleSync(
    pathIds: readonly string[],
    recursive: boolean,
  ): void {
    void performWrite(
      "sync-submodule",
      () => ({
        kind: "syncSubmodule",
        pathIds: [...pathIds],
        recursive,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  return {
    get busy() {
      return busy;
    },
    get writesAllowed() {
      return writesAllowed;
    },
    get availability() {
      return availability;
    },
    get operationInProgress() {
      return operationInProgress;
    },
    get conflictedPaths() {
      return conflictedPaths;
    },
    get branchNames() {
      return branchNames;
    },
    get repositoryMessage() {
      return repositoryMessage;
    },
    get repositoryAccessMessage() {
      return repositoryAccessMessage;
    },
    get stagingMessage() {
      return visibleMessage(stagingMessage);
    },
    get commitResult() {
      return visibleMessage(commitResult);
    },
    get branchMessage() {
      return branchMessage;
    },
    get remoteMessage() {
      return remoteMessage;
    },
    get worktreeMessage() {
      return worktreeMessage;
    },
    get submoduleMessage() {
      return submoduleMessage;
    },
    get mergeMessage() {
      return mergeMessage;
    },
    get stashResult() {
      return stashResult;
    },
    get tagResult() {
      return tagResult;
    },
    onRepositoryInit,
    onRepositoryClone,
    registerRepository,
    revokeRepository,
    onStage,
    onUnstage,
    onDiscard,
    onCommit,
    onAmend,
    onBranchCreate,
    onBranchSwitch,
    onBranchRename,
    onBranchDelete,
    onBranchSetUpstream,
    onBranchMerge,
    onMergeContinue,
    onMergeAbort,
    onRemoteAdd,
    onRemoteUpdate,
    onRemoteRemove,
    onFetch,
    onPush,
    onPull,
    onStashCreate,
    onStashApply,
    onStashPop,
    onStashDrop,
    onTagCreate,
    onTagDelete,
    onTagPush,
    onWorktreeCreate,
    onWorktreeRemove,
    onWorktreeLock,
    onWorktreeUnlock,
    onSubmoduleAdd,
    onSubmoduleUpdate,
    onSubmoduleSync,
  };
}

export type WorkbenchMutations = ReturnType<typeof createWorkbenchMutations>;
