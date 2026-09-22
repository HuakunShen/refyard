/**
 * Mutation application layer for the workbench.
 *
 * Panels emit semantic intent. This controller turns that intent into the closed Refyard mutation
 * contract, re-reads fresh snapshots, follows accepted operations to terminal state through the
 * injected `MutationService`, and refreshes the read model. It deliberately owns no layout, no
 * credential lifecycle, and no transport: whether the write travels over HTTP or native IPC is
 * decided by the adapter behind these interfaces.
 */
import {
  BackendError,
  isBackendError,
  type GitReadService,
  type HostService,
  type MutationService,
  type ProviderBackendService,
} from "@refyard/git-service";
import type {
  ExecutionTargetSummary,
  ParsedMutationRequest,
  RepositorySummary,
} from "@refyard/git-contract";
import type { QueryClient } from "@tanstack/svelte-query";
import type { ExecutionTargetSelection } from "@refyard/git-ui/lib/execution-targets";
import { followOperation } from "../operation-follow.js";
import type { Negotiation } from "../session-negotiation.js";
import { createTargetRequestFor } from "./repository-launcher.js";
import { describeBackendProblem } from "./session.js";
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

/** How long a created target may take to become ready before the open is reported failed. */
const TARGET_READY_TIMEOUT_MS = 15_000;
const TARGET_READY_POLL_MS = 200;

export interface WorkbenchMutationInputs {
  /** The session's read side: snapshots and previews are reads, not writes. */
  readonly reads: () => GitReadService | null;
  readonly mutations: () => MutationService | null;
  /**
   * The session's host service: creating, waiting for and releasing execution targets.
   * Null when the adapter has no host surface, which is what makes every target
   * affordance fail closed rather than falling back to this machine.
   */
  readonly host: () => HostService | null;
  /** The session's forge-connection surface; null when the module is absent. */
  readonly provider?: () => ProviderBackendService | null;
  /** Part of every invalidation key; never a credential. */
  readonly cacheNamespace: () => string;
  readonly browserOnline: () => boolean;
  readonly negotiation: () => Negotiation;
  readonly selection: WorkbenchSelectionState;
  readonly queries: ReturnType<typeof createWorkbenchQueries>;
  readonly queryClient: QueryClient;
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
  /**
   * For a new branch: the commit it starts at. Absent means the worktree's
   * current HEAD, which is what the worktree panel's form wants; the commit
   * menu's "create worktree from here" passes the clicked commit instead.
   */
  readonly startOid?: string;
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

/**
 * A refusal is a policy answer, not a crash, and it must reach the user verbatim.
 * Wrapping it in a `BackendError` keeps the display honest: the panel renders problem
 * codes and messages, never a raw `Error.message`.
 */
function refusalError(message: string): BackendError {
  return new BackendError({
    code: "Unavailable",
    message,
    retryable: false,
  });
}

export function createWorkbenchMutations(input: WorkbenchMutationInputs) {
  /** A write may only be attempted behind its gate, so the session is present. */
  function requireMutations(): MutationService {
    const service = input.mutations();
    if (service === null) {
      throw new BackendError({
        code: "InvalidRequest",
        message: "no backend session is connected",
        retryable: false,
      });
    }
    return service;
  }

  function requireReads(): GitReadService {
    const service = input.reads();
    if (service === null) {
      throw new BackendError({
        code: "InvalidRequest",
        message: "no backend session is connected",
        retryable: false,
      });
    }
    return service;
  }

  let busy = $state(false);
  let repositoryMessage = $state<string | null>(null);
  let repositoryAccessMessage = $state<string | null>(null);
  /**
   * The remote-open state: which step is running (progress) and, when a step failed,
   * the failure in the host's own words. They are separate so a failure is never shown
   * as if it were still progress.
   */
  let targetProgress = $state<string | null>(null);
  let targetMessage = $state<string | null>(null);
  /** The target the host minted for the most recent open attempt, if one was minted. */
  let lastCreatedTarget = $state<ExecutionTargetSummary | null>(null);
  let stagingMessage = $state<ScopedMessage | null>(null);
  let commitResult = $state<ScopedMessage | null>(null);
  let branchMessage = $state<string | null>(null);
  let remoteMessage = $state<string | null>(null);
  let worktreeMessage = $state<string | null>(null);
  let submoduleMessage = $state<string | null>(null);
  let mergeMessage = $state<string | null>(null);
  let stashResult = $state<string | null>(null);
  let tagResult = $state<string | null>(null);
  /**
   * The write block an uncertain operation left on one repository: the service refuses
   * every new write there until a person confirms the state. Scoped to the repository,
   * not the worktree — the service blocks by repository write key.
   */
  let uncertainBlock = $state<{
    repositoryId: string;
    reason: string;
    operationIds: string[];
  } | null>(null);
  /** What the acknowledgement answered, for the panel that asked for it. */
  let uncertainNote = $state<string | null>(null);

  const availability = $derived(
    mutationAvailabilityFor(input.queries.capabilities.data?.operations),
  );
  const writesAllowed = $derived(
    writeRefusalMessage({
      browserOnline: input.browserOnline(),
      sessionReady: input.mutations() !== null,
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

  /**
   * A write refused with `UncertainOutcome` is not just a failure to report — it is
   * the service naming the block and the operations involved, which is exactly what
   * the acknowledgement panel needs. Anything else clears the stale panel: the block
   * may have been lifted elsewhere, and a panel that outlives its refusal lies.
   */
  function noteUncertainOutcome(
    error: unknown,
    context: MutationContext | null,
  ): void {
    if (
      !isBackendError(error) ||
      error.code !== "UncertainOutcome" ||
      context === null
    ) {
      return;
    }
    const operations = error.details["operations"];
    const ids =
      typeof operations === "string" && operations.length > 0
        ? operations.split(",")
        : [];
    uncertainBlock = {
      repositoryId: context.repositoryId,
      reason: error.message,
      operationIds: ids,
    };
    uncertainNote = null;
  }

  /**
   * The person's answer to the block: re-read the repository for a fresh snapshot,
   * then acknowledge every uncertain operation against it. The record that comes back
   * stays `unknown` — this call records a confirmation, it never rewrites history.
   */
  async function onAcknowledgeUncertain(): Promise<void> {
    const block = uncertainBlock;
    if (block === null) {
      return;
    }
    busy = true;
    uncertainNote = null;
    try {
      const snapshot = await requireReads().status({
        repositoryId: block.repositoryId,
      });
      const host = input.host();
      if (host === null) {
        throw new BackendError({
          code: "UnsupportedOperation",
          message:
            "this session has no host surface, so the block cannot be acknowledged here",
          retryable: false,
        });
      }
      for (const operationId of block.operationIds) {
        const record = await host.acknowledgeUncertainOperation({
          operationId,
          confirmedSnapshotId: snapshot.snapshotId,
          confirmed: true,
        });
        if (record.status !== "unknown") {
          throw new BackendError({
            code: "InternalError",
            message: `acknowledging ${operationId} answered ${record.status}; the outcome must stay unknown, so this answer is not trusted`,
            retryable: false,
          });
        }
      }
      uncertainBlock = null;
      uncertainNote = `confirmed against snapshot ${snapshot.snapshotId}; the operation${block.operationIds.length === 1 ? "" : "s"} remain${block.operationIds.length === 1 ? "s" : ""} recorded as unknown`;
      await invalidateRepositoryReads(block.repositoryId);
    } catch (error) {
      uncertainNote = describeBackendProblem(error);
    } finally {
      busy = false;
    }
  }

  /**
   * Every read of one repository, by the key it was cached under. The key names the
   * machine as well as the repository, so a write on a host cannot mark this machine's
   * data stale (or the reverse).
   *
   * Status is refreshed first, and on its own: it is what the workbench's controls are
   * enabled against and what the user is looking at while the write lands, and a batch
   * that starts every read at once lets the one read the user needs finish behind the
   * others. The rest follow as one invalidation, by the same prefix.
   */
  async function invalidateRepositoryReads(
    repositoryId: string,
  ): Promise<void> {
    const prefix = input.queries.repositoryCachePrefixFor(repositoryId);
    await input.queryClient.invalidateQueries({
      queryKey: [...prefix, "status"],
    });
    await input.queryClient.invalidateQueries({ queryKey: prefix });
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
        sessionReady: input.mutations() !== null,
        negotiation: input.negotiation(),
        action: "write",
      });
      if (refusal !== null) {
        throw refusalError(refusal);
      }
      // Capture the target before any preview/status await. A user can switch worktrees while a
      // request is in flight; the operation must finish against the target the user confirmed.
      const targetContext = context;
      if (targetContext === null) {
        throw new BackendError({
          code: "InvalidRequest",
          message: "no repository selected",
          retryable: false,
        });
      }
      const operation = await buildOperation(targetContext);
      const target =
        targetKind === "worktree"
          ? await (async () => {
              const snapshot = await requireReads().status({
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
              const snapshot = await requireReads().refs({
                repositoryId: targetContext.repositoryId,
              });
              return {
                kind: "repository" as const,
                repositoryId: snapshot.repositoryId,
                expectedSnapshotId: snapshot.snapshotId,
              };
            })();
      const mutations = requireMutations();
      const submitted = await mutations.submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target,
        operation,
      });
      const operationId = operationIdFromSubmission(submitted);
      reportForContext(await followOperation(mutations, operationId));
      if (onSucceeded !== undefined) {
        const finalRecord = await mutations.get(operationId);
        if (finalRecord.status === "succeeded") {
          onSucceeded(targetContext);
        }
      }
      if (
        uncertainBlock !== null &&
        uncertainBlock.repositoryId === targetContext.repositoryId
      ) {
        uncertainBlock = null;
      }
      await invalidateRepositoryReads(targetContext.repositoryId);
    } catch (error) {
      noteUncertainOutcome(error, context);
      reportForContext(describeBackendProblem(error));
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
        sessionReady: input.mutations() !== null,
        negotiation: input.negotiation(),
        action: "write",
      });
      if (refusal !== null) {
        throw refusalError(refusal);
      }
      const submitted = await requireMutations().submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target: { kind: "workspace", allowedRootId, relativeDestination },
        operation,
      });
      repositoryMessage = await followOperation(
        requireMutations(),
        operationIdFromSubmission(submitted),
      );

      const refreshed = await input.queries.repositories.refetch();
      const created = (refreshed.data?.repositories ?? []).find((entry) =>
        entry.displayPath.endsWith(relativeDestination),
      );
      if (created !== undefined) {
        selectRepository(input.selection, created.repositoryId);
        await invalidateRepositoryReads(created.repositoryId);
      }
    } catch (error) {
      repositoryMessage = describeBackendProblem(error);
    } finally {
      busy = false;
    }
  }

  /**
   * Connect a forge account. The token is handed to the host once; on any
   * refusal the message says what the provider said and nothing is stored.
   */
  async function connectProvider(token: string): Promise<void> {
    const provider = input.provider?.();
    if (provider === null || provider === undefined) {
      return;
    }
    busy = true;
    try {
      await provider.connect("github", token);
      for (const prefix of input.queries.providerCachePrefixes()) {
        await input.queryClient.invalidateQueries({ queryKey: [...prefix] });
      }
    } catch (error) {
      repositoryMessage = describeBackendProblem(error);
    } finally {
      busy = false;
    }
  }

  async function disconnectProvider(): Promise<void> {
    const provider = input.provider?.();
    if (provider === null || provider === undefined) {
      return;
    }
    busy = true;
    try {
      await provider.disconnect("github");
      for (const prefix of input.queries.providerCachePrefixes()) {
        await input.queryClient.invalidateQueries({ queryKey: [...prefix] });
      }
    } catch (error) {
      repositoryMessage = describeBackendProblem(error);
    } finally {
      busy = false;
    }
  }

  /**
   * Start the device-flow exchange. The browser only shows the returned code;
   * the host polls GitHub and flips the connection when the user finishes.
   */
  async function connectProviderDevice(): Promise<void> {
    const provider = input.provider?.();
    if (provider === null || provider === undefined) {
      return;
    }
    busy = true;
    try {
      await provider.deviceStart("github");
      await input.queryClient.invalidateQueries({
        queryKey: [...input.queries.providerDeviceStatusKey()],
      });
    } catch (error) {
      repositoryMessage = describeBackendProblem(error);
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

  /**
   * Approves and selects a path on this machine, returning the repository that was
   * registered so the caller opens a tab from the answer it just received rather than
   * from a list that may not have propagated yet. Null means nothing was registered.
   */
  async function registerRepository(
    path: string,
  ): Promise<RepositorySummary | null> {
    busy = true;
    repositoryAccessMessage = null;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        sessionReady: input.mutations() !== null,
        negotiation: input.negotiation(),
        action: "repositoryAccess",
      });
      if (refusal !== null) {
        throw refusalError(refusal);
      }
      // Resolve home shorthand and symlinks using the host, which owns filesystem paths.
      const directory = await requireReads().filesystemEntries({ path });
      const current = await input.queries.repositories.refetch();
      const existing = current.data?.repositories.find(
        (entry) => entry.displayPath === directory.path,
      );
      if (existing !== undefined) {
        selectRepository(input.selection, existing.repositoryId);
        return existing;
      }
      const result = await requireReads().registerRepository(directory.path);
      repositoryAccessMessage = `approved ${path}`;
      await input.queries.repositories.refetch();
      const added = result.repositories.find(
        (entry) => entry.displayPath === directory.path,
      );
      if (added !== undefined) {
        selectRepository(input.selection, added.repositoryId);
      }
      return added ?? null;
    } catch (error) {
      repositoryAccessMessage = describeBackendProblem(error);
      return null;
    } finally {
      busy = false;
    }
  }

  /**
   * Opens a repository on an execution target, in the order the host publishes:
   * create the target, wait until the host reports it ready, then register the typed
   * path on it. There is no fallback: if any step fails, nothing is registered — in
   * particular never on this machine, whose filesystem was never asked about the path.
   *
   * A path on another machine is not browsable, so the read that resolves a local
   * shorthand (`filesystemEntries`) is deliberately absent here: sending the remote
   * path to it would ask this machine about a path it does not own.
   */
  async function registerRemoteRepository(
    path: string,
    target: ExecutionTargetSelection,
  ): Promise<RepositorySummary | null> {
    busy = true;
    targetMessage = null;
    targetProgress = `connecting to ${target.label}`;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        sessionReady: input.mutations() !== null,
        negotiation: input.negotiation(),
        action: "repositoryAccess",
      });
      if (refusal !== null) {
        throw refusalError(refusal);
      }
      const host = input.host();
      if (host === null) {
        // Fail closed: without a host there is no way to create a target, and
        // registering the path locally would silently open the wrong machine.
        throw refusalError(
          "this session has no host connection, so a remote target cannot be created",
        );
      }
      const plan = createTargetRequestFor(target);
      if (plan.kind === "refused") {
        throw refusalError(plan.message);
      }
      let summary = await host.createTarget(plan.request);
      lastCreatedTarget = summary;
      const deadline = Date.now() + TARGET_READY_TIMEOUT_MS;
      while (summary.state !== "ready") {
        if (summary.state === "unavailable") {
          throw refusalError(
            `the host reports the target for ${target.label} is unavailable`,
          );
        }
        if (Date.now() > deadline) {
          throw refusalError(
            `the target for ${target.label} did not become ready within ${Math.round(
              TARGET_READY_TIMEOUT_MS / 1000,
            )} seconds`,
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, TARGET_READY_POLL_MS),
        );
        // The host owns readiness; it is asked again rather than assumed from the
        // create answer, which describes the moment the target was minted.
        const listed = await host.targets();
        const current = listed.find(
          (entry) => entry.targetId === summary.targetId,
        );
        if (current !== undefined) summary = current;
      }
      // The reads' gate must know the machine is ready before the repository that
      // lives on it becomes selected, or its first panels are asked while disabled.
      await input.queries.refreshTargets();
      targetProgress = `opening ${path} on ${target.label}`;
      const result = await requireReads().registerRepository(path, {
        targetId: summary.targetId,
      });
      targetProgress = null;
      // The registered repository may already have been listed (the host did not need
      // to mint a new one), so the refetched list is preferred and the register
      // response is the fallback.
      const refreshed = await input.queries.repositories.refetch();
      const added = (refreshed.data?.repositories ?? result.repositories).find(
        (entry) =>
          entry.displayPath === path && entry.targetId === summary.targetId,
      );
      if (added !== undefined) {
        selectRepository(input.selection, added.repositoryId);
      }
      return added ?? null;
    } catch (error) {
      targetProgress = null;
      targetMessage = describeBackendProblem(error);
      return null;
    } finally {
      busy = false;
    }
  }

  /**
   * Releases one target this session owns, and drops only that target's cached reads.
   * Another target's data, and this machine's, are untouched: the invalidation key is
   * namespaced by the target, so a disconnect cannot clear a different machine's view.
   */
  async function disconnectTarget(targetId: string): Promise<void> {
    const host = input.host();
    if (host === null) return;
    try {
      await host.disconnectTarget(targetId);
    } catch (error) {
      targetMessage = describeBackendProblem(error);
    } finally {
      await input.queries.refreshTargets();
      await input.queryClient.invalidateQueries({
        queryKey: input.queries.targetCachePrefixFor(targetId),
      });
    }
  }

  /** Forgets the previous choice's target state, so a new choice starts clean. */
  function clearTargetStatus(): void {
    targetProgress = null;
    targetMessage = null;
    lastCreatedTarget = null;
  }

  async function revokeRepository(repositoryId: string): Promise<void> {
    busy = true;
    repositoryAccessMessage = null;
    try {
      const refusal = writeRefusalMessage({
        browserOnline: input.browserOnline(),
        sessionReady: input.mutations() !== null,
        negotiation: input.negotiation(),
        action: "repositoryAccess",
      });
      if (refusal !== null) {
        throw refusalError(refusal);
      }
      await requireReads().revokeRepository(repositoryId);
      repositoryAccessMessage = `revoked ${repositoryId}`;
      clearRepositoryIfSelected(input.selection, repositoryId);
      await input.queries.repositories.refetch();
    } catch (error) {
      repositoryAccessMessage = describeBackendProblem(error);
    } finally {
      busy = false;
    }
  }

  async function previewTokensFor(
    repositoryId: string,
    worktreeId: string,
    pathIds: readonly string[],
  ): Promise<readonly string[]> {
    const previews = await requireReads().previews({
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
        throw new BackendError({
          code: "InternalError",
          message: "the host issued no preview token for a selected path",
          retryable: false,
        });
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

  /**
   * Check a remote-tracking branch out into a new local branch of the same
   * name, created at the commit the remote ref points at and checked out
   * immediately — one createBranch with switchToIt.
   */
  function onRemoteBranchCheckout(branchName: string, startOid: string): void {
    void performWrite(
      "remote-branch-checkout",
      () => branchCreateOperation(branchName, startOid, true),
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

  /**
   * Apply one commit's change onto the checked-out branch. A conflict stops
   * into the same resolve-and-continue state a merge uses; the sidebar's
   * conflict panel takes over from there.
   */
  function onCommitCherryPick(oid: string): void {
    void performWrite(
      "commit-cherry-pick",
      () => ({ kind: "cherryPick", oid }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
      },
      "worktree",
    );
  }

  function onCherryPickContinue(): void {
    void performWrite(
      "continue-cherry-pick",
      () => ({ kind: "continueCherryPick" }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onCherryPickAbort(): void {
    void performWrite(
      "abort-cherry-pick",
      () => ({ kind: "abortCherryPick", confirmed: true }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  /**
   * Replay the checked-out branch's own commits onto another commit. A
   * conflict stops into the resolve-and-continue state the sidebar's conflict
   * panel finishes; a replayed commit keeps its original message.
   */
  function onBranchRebase(upstreamOid: string): void {
    void performWrite(
      "branch-rebase",
      () => ({ kind: "rebase", upstreamOid }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
      },
      "worktree",
    );
  }

  function onRebaseContinue(): void {
    void performWrite(
      "continue-rebase",
      () => ({ kind: "continueRebase" }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onRebaseAbort(): void {
    void performWrite(
      "abort-rebase",
      () => ({ kind: "abortRebase", confirmed: true }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  /**
   * Remove one commit from the checked-out branch by replaying its
   * descendants onto its parent. The host refuses merges, the branch root,
   * and off-branch commits; a conflict stops into the state the sidebar's
   * conflict panel finishes.
   */
  function onCommitDrop(oid: string): void {
    void performWrite(
      "commit-drop",
      () => ({ kind: "dropCommit", oid, confirmed: true }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
      },
      "worktree",
    );
  }

  /**
   * Fold the checked-out branch's top commit into the one below it. A null
   * message keeps the parent's message.
   */
  function onCommitSquash(message: string | null): void {
    void performWrite(
      "commit-squash",
      () => ({ kind: "squashCommit", message }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
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

  /**
   * Revert one completed commit: a new commit applying the inverse patch, with
   * Git's own message and the user's hooks. The host aborts a conflicted revert
   * before reporting, so a refusal here leaves the branch exactly as it was.
   */
  function onCommitRevert(oid: string): void {
    void performWrite(
      "commit-revert",
      () => ({ kind: "revertCommit", oid }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
      },
      "worktree",
    );
  }

  /**
   * Move the checked-out branch to a commit, soft or mixed — the only two
   * modes that cannot lose content. The working tree is untouched either way.
   */
  function onCommitReset(oid: string, mode: "soft" | "mixed"): void {
    void performWrite(
      "commit-reset",
      () => ({ kind: "resetBranch", oid, mode }),
      (message, context) => {
        stagingMessage =
          message === null || context === null ? null : { context, message };
      },
      "worktree",
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
    if (reference.startOid !== undefined && reference.startOid !== "") {
      return {
        kind: "newBranch",
        branchName: reference.branchName ?? "",
        startOid: reference.startOid,
      };
    }
    const snapshot = await requireReads().status({
      repositoryId,
      worktreeId,
    });
    const head = snapshot.head;
    if (head.kind !== "born" || head.oid === null) {
      throw new BackendError({
        code: "InvalidOperationPayload",
        message:
          "this repository has no commit yet, so a new worktree has nothing to start from",
        retryable: false,
      });
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

  // A device exchange that just completed means fresh connection data on the
  // host: invalidate everything provider-shaped and consume the terminal state
  // so the panel's polling stops.
  $effect(() => {
    if (input.queries.providerDeviceStatus.data?.state !== "connected") {
      return;
    }
    void (async () => {
      for (const prefix of input.queries.providerCachePrefixes()) {
        await input.queryClient.invalidateQueries({ queryKey: [...prefix] });
      }
      input.queryClient.setQueryData([...input.queries.providerDeviceStatusKey()], {
        state: "idle",
      });
    })();
  });

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
    get targetProgress() {
      return targetProgress;
    },
    get targetMessage() {
      return targetMessage;
    },
    get lastCreatedTarget() {
      return lastCreatedTarget;
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
    /**
     * The uncertain-outcome block for the *selected* repository, or null: a panel for
     * a repository the user has navigated away from would be an alarm that lies.
     */
    get uncertainBlock() {
      const repositoryId = input.selection.repositoryId;
      return uncertainBlock !== null &&
        uncertainBlock.repositoryId === repositoryId
        ? uncertainBlock
        : null;
    },
    get uncertainNote() {
      return uncertainNote;
    },
    onAcknowledgeUncertain,
    onRepositoryInit,
    connectProvider,
    disconnectProvider,
    connectProviderDevice,
    onRepositoryClone,
    registerRepository,
    registerRemoteRepository,
    disconnectTarget,
    clearTargetStatus,
    revokeRepository,
    onStage,
    onUnstage,
    onDiscard,
    onCommit,
    onAmend,
    onBranchCreate,
    onBranchSwitch,
    onRemoteBranchCheckout,
    onBranchRename,
    onBranchDelete,
    onBranchSetUpstream,
    onBranchMerge,
    onMergeContinue,
    onMergeAbort,
    onCommitCherryPick,
    onCherryPickContinue,
    onCherryPickAbort,
    onBranchRebase,
    onRebaseContinue,
    onRebaseAbort,
    onCommitDrop,
    onCommitSquash,
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
    onCommitRevert,
    onCommitReset,
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
