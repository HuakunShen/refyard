/**
 * TanStack read composition for the workbench.
 *
 * This module owns how transport-neutral GitService reads are keyed, gated, polled, paged and
 * reduced into presentation models. It owns no browser DOM lifecycle and no mutations; the page
 * remains the composition root and supplies the injected read service, the session's cache
 * namespace, the connection phase, and the shared selection state.
 *
 * Two rules live here rather than in each panel:
 *
 * - **`queryState` decides whether a read may run and poll.** A ready session, a read the
 *   service reports as implemented, and a valid selection — the token the old page checked
 *   does not exist for a native session, and a service that omits a read must not be asked
 *   for it on a timer.
 * - **A repository on a machine that is not ready is not read.** Repositories the host
 *   places on an execution target are read only once that target reports `ready`; a
 *   target that is connecting, unavailable, or not yet listed leaves its reads disabled
 *   instead of issued, so an answer that cannot be this repository's is never cached as
 *   it. Repositories without a target are this machine's, ready whenever the session is,
 *   which is what keeps a service that has never heard of targets unchanged.
 * - **Cache keys are `cacheNamespace + query identity`.** The namespace changes with the
 *   session and the authorization round, so results from a previous session cannot be read
 *   as this one's, and no credential is ever part of a key. Repository-scoped keys are
 *   `[namespace, targetId|null, path, read, …]`: the target stays a separate element, so
 *   the same path on two machines cannot share cached reads, and `[namespace, targetId]`
 *   can be invalidated for one target without touching another machine's data or this one's.
 */
import type {
  GitReadService,
  HostService,
  ProviderBackendService,
} from "@refyard/git-service";
import { BackendError, type ConnectionPhase } from "@refyard/git-service";
import type {
  DiffResponse,
  ExecutionTargetSummary,
  ReadKind,
  StatusSnapshot,
  StashesResponse,
  WorktreeSummary,
} from "@refyard/git-contract";
import { layoutPages } from "@refyard/git-graph";
import {
  createInfiniteQuery,
  createQuery,
  type QueryClient,
} from "@tanstack/svelte-query";
import {
  backgroundRead,
  createReadTimer,
  timedRead,
} from "../background-poll.js";
import { cacheKeyFor, queryState, type QueryState } from "./query-state.js";
import { repositoryCacheKey } from "./repository-tabs.js";
import {
  reconcileRepositorySelection,
  type WorkbenchSelectionState,
} from "./selection.js";
import {
  diffRequestForSelection,
  graphCommitFor,
  historyNoticesFor,
  laneColorFor,
  workspaceRootsFor,
} from "./query-model.js";
import { describeBackendProblem } from "./session.js";
import {
  historyPageQuery,
  historyTopologyFor,
  type AppliedHistoryFilters,
} from "./history-filters.js";

const HISTORY_PAGE_SIZE = 100;
const WORKTREE_STATUS_CONCURRENCY = 3;

export interface WorkbenchQueryInputs {
  /** The session's read service; null until an adapter session exists. */
  readonly service: () => GitReadService | null;
  /**
   * The session's host service, used for the one read this controller does not own:
   * which execution targets exist and whether they are ready. A session without one
   * simply has no targeted repositories to gate.
   */
  readonly host: () => HostService | null;
  /**
   * The session's forge-connection surface; null when the adapter or the host
   * lacks the provider module, which is what keeps the panel from mounting.
   */
  readonly provider?: () => ProviderBackendService | null;
  /** Changes with the session and authorization round; never a credential. */
  readonly cacheNamespace: () => string;
  readonly phase: () => ConnectionPhase;
  readonly selection: WorkbenchSelectionState;
  readonly visible: () => boolean;
  readonly historyFilters: () => AppliedHistoryFilters;
  readonly historyRevision: () => number;
}

export interface WorktreeStatusSummary {
  readonly worktreeId: string;
  readonly status: StatusSnapshot | null;
  readonly error: string | null;
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  run: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: (R | undefined)[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value === undefined) {
        throw new Error("bounded worktree read lost its input");
      }
      results[index] = await run(value);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.map((result) => {
    if (result === undefined) {
      throw new Error("bounded worktree read did not produce a result");
    }
    return result;
  });
}

/**
 * Refreshes every read this session has cached, after the page was hidden long enough
 * that its data may be stale.
 *
 * The namespace is the only prefix that covers all of them: a repository-scoped key
 * starts with the namespace and then its target and path, so no fixed read-kind prefix
 * would reach every repository. Session-level reads (capabilities, the repository list,
 * identity) are refetched with them, which is what a returning tab wants anyway; nothing
 * outside this session's namespace is touched.
 */
export function invalidateWorkbenchBackgroundQueries(
  queryClient: QueryClient,
  cacheNamespace: string,
): void {
  void queryClient.invalidateQueries({ queryKey: [cacheNamespace] });
}

export function createWorkbenchQueries(input: WorkbenchQueryInputs) {
  const readTimer = createReadTimer();
  const polled = (key: readonly unknown[]) =>
    backgroundRead({ key, timer: readTimer, visible: input.visible });

  /** A query function may only run behind its gate, so the service is present. */
  function requireService(): GitReadService {
    const service = input.service();
    if (service === null) {
      throw new BackendError({
        code: "InternalError",
        message: "no backend session is connected",
        retryable: false,
      });
    }
    return service;
  }

  const capabilities = createQuery(() => {
    const gate = queryState({
      phase: input.phase(),
      supportsRead: true,
      hasSelection: true,
    });
    return {
      queryKey: cacheKeyFor(input.cacheNamespace(), "capabilities"),
      queryFn: () => requireService().capabilities(),
      enabled: gate.enabled,
    };
  });

  /**
   * Whether the service implements a read. Unknown until capabilities arrive, and an
   * unknown answer must not hold back the first reads: the alternative would serialize
   * the workbench behind one query, and a failed capabilities read would leave every
   * panel empty instead of showing its own error.
   */
  function supportsRead(kind: ReadKind): boolean {
    const reported = capabilities.data?.reads;
    return reported === undefined || reported.includes(kind);
  }

  function gate(supports: boolean, hasSelection: boolean): QueryState {
    return queryState({
      phase: input.phase(),
      supportsRead: supports,
      hasSelection,
    });
  }

  /** The polling options a query carries only while its gate allows a refetch. */
  function cadence(key: readonly unknown[], state: QueryState) {
    return state.poll ? polled(key) : {};
  }

  const repositories = createQuery(() => {
    const key = cacheKeyFor(input.cacheNamespace(), "repositories");
    const state = gate(supportsRead("repositories"), true);
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => requireService().repositories(),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const selectedRepositoryId = $derived(input.selection.repositoryId);
  const selectedWorktreeId = $derived(input.selection.worktreeId);
  const selectedOid = $derived(input.selection.commitOid);
  const selectedPath = $derived(input.selection.statusPath);
  const selectedStatusSide = $derived(input.selection.statusSide);
  const selectedDiffPathId = $derived(input.selection.diffPathId);

  /* ------------------------------------------------- provider axis reads */

  /** Forge integrations the host reports; unknown until capabilities arrive. */
  const providerAvailable = $derived(
    capabilities.data?.providers?.includes("github") ?? false,
  );

  function requireProvider(): ProviderBackendService {
    const provider = input.provider?.();
    if (provider === null || provider === undefined) {
      throw new BackendError({
        code: "UnsupportedOperation",
        message: "this host has no forge integration module",
        retryable: false,
      });
    }
    return provider;
  }

  const providerConnection = createQuery(() => {
    const key = cacheKeyFor(input.cacheNamespace(), "provider-connection");
    const state = gate(providerAvailable, true);
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => requireProvider().status(),
      }),
      enabled: state.enabled,
      // Connection state changes only by user act; invalidation drives refresh.
      staleTime: Number.POSITIVE_INFINITY,
    };
  });

  const providerDeviceStatus = createQuery(() => {
    const key = cacheKeyFor(input.cacheNamespace(), "provider-device-status");
    const state = gate(providerAvailable, true);
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => requireProvider().deviceStatus("github"),
      }),
      enabled: state.enabled,
      // While an exchange is in flight the panel is waiting on a human at
      // github.com; this poll is bounded to exactly that window.
      refetchInterval: (query) =>
        query.state.data?.state === "awaiting-user" ? 3000 : false,
    };
  });

  const providerPullRequests = createQuery(() => {
    const key = [
      ...cacheKeyFor(input.cacheNamespace(), "provider-pull-requests"),
      selectedRepositoryId,
    ];
    const state = gate(
      providerAvailable,
      selectedRepositoryId !== null && targetReadyFor(selectedRepositoryId),
    );
    const repositoryId = selectedRepositoryId;
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => {
          if (repositoryId === null) {
            throw new BackendError({
              code: "InvalidRequest",
              message: "no repository is selected",
              retryable: false,
            });
          }
          return requireProvider().pullRequests(repositoryId);
        },
      }),
      enabled: state.enabled,
      // The host serves its own 60 s cache; the browser adds a smaller one so
      // panel remounts do not re-enter the provider path at all. Deliberately
      // absent from background polling — a forge read is not a cheap read.
      staleTime: 30_000,
    };
  });

  /** The exact key of the device-status query, so a terminal state can be consumed. */
  function providerDeviceStatusKey(): readonly unknown[] {
    return cacheKeyFor(input.cacheNamespace(), "provider-device-status");
  }

  /** The keys a connect/disconnect must invalidate, all repositories included. */
  function providerCachePrefixes(): readonly (readonly unknown[])[] {
    return [
      cacheKeyFor(input.cacheNamespace(), "provider-connection"),
      cacheKeyFor(input.cacheNamespace(), "provider-pull-requests"),
    ];
  }


  const repositoryList = $derived(repositories.data?.repositories ?? []);
  const workspaceRoots = $derived(workspaceRootsFor(repositoryList));
  const repository = $derived(
    repositoryList.find(
      (entry) => entry.repositoryId === selectedRepositoryId,
    ) ?? null,
  );

  /**
   * Which machines this session can run Git on, and whether they are ready.
   *
   * Held as plain state rather than a cache entry: the host's own list is the session's
   * fact, not a repository read, and it is never stale in the sense a cached answer is —
   * a target that lost its connection must gate its repositories off immediately, not
   * after a cache expires.
   *
   * The read itself happens only when the repository list places a repository elsewhere
   * than this machine. A service that has never heard of execution targets lists none, so
   * it is never asked for a target list it would refuse, and its reads behave exactly as
   * before. On failure the list stays empty, which fails closed: no target is known ready,
   * so none of its repositories is read.
   */
  let targets = $state<readonly ExecutionTargetSummary[]>([]);
  let targetsReadFor = "";

  async function refreshTargets(): Promise<void> {
    const host = input.host();
    if (host === null) {
      targets = [];
      return;
    }
    try {
      targets = [...(await host.targets())];
    } catch {
      targets = [];
    }
  }

  $effect(() => {
    const host = input.host();
    const firstTarget = repositoryList.find(
      (entry) => entry.targetId !== undefined,
    )?.targetId;
    if (host === null || firstTarget === undefined) {
      targetsReadFor = "";
      return;
    }
    const key = `${input.cacheNamespace()}/${firstTarget}`;
    if (targetsReadFor === key) return;
    targetsReadFor = key;
    void refreshTargets();
  });

  function repositoryEntry(repositoryId: string | null) {
    if (repositoryId === null) return null;
    return (
      repositoryList.find((entry) => entry.repositoryId === repositoryId) ??
      null
    );
  }

  /**
   * Whether the machine a repository lives on may be read from.
   *
   * A repository the list does not place on a target is this machine's and is ready
   * whenever the session is — that is what keeps a service without execution targets
   * unchanged. A targeted repository is readable only while its target reports `ready`:
   * connecting, unavailable, and not-yet-listed all leave the read disabled, because an
   * answer taken before the machine is ready is not this repository's answer.
   */
  function targetReadyFor(repositoryId: string | null): boolean {
    const entry = repositoryEntry(repositoryId);
    if (entry === null || entry.targetId === undefined) return true;
    return (
      targets.find((summary) => summary.targetId === entry.targetId)?.state ===
      "ready"
    );
  }

  /** The host's label for a target, or null when the list does not name it. */
  function targetLabelFor(targetId: string | null | undefined): string | null {
    if (targetId === null || targetId === undefined) return null;
    return (
      targets.find((summary) => summary.targetId === targetId)?.label ?? null
    );
  }

  /**
   * Whether the named target is this machine, for a UI that shows an icon rather than
   * the label's two words. A host may place this machine's own repositories under a
   * target id — the desktop one does — so "has a target id" is not "is elsewhere": the
   * kind is read from the same list the label is. An id the list does not name answers
   * null, which renders no machine marker at all instead of a wrong one.
   */
  function targetKindFor(
    targetId: string | null | undefined,
  ): "local" | "remote" | undefined {
    if (targetId === null || targetId === undefined) return undefined;
    const target = targets.find((summary) => summary.targetId === targetId);
    if (target === undefined) return undefined;
    return target.kind === "local" ? "local" : "remote";
  }

  /**
   * The prefix every read of one repository is cached under, from the target it lives on
   * and its path. A repository the list no longer contains maps to the repository id in
   * the path slot, which cannot equal a real path: a late invalidation for a revoked
   * repository must not match a live one's keys.
   */
  function repositoryCachePrefixFor(
    repositoryId: string | null,
  ): readonly unknown[] {
    const entry = repositoryEntry(repositoryId);
    return repositoryCacheKey(
      input.cacheNamespace(),
      entry?.targetId,
      entry?.displayPath ?? repositoryId ?? "",
    );
  }

  function repositoryQueryKey(
    kind: string,
    repositoryId: string | null,
    ...tail: readonly unknown[]
  ): readonly unknown[] {
    return [...repositoryCachePrefixFor(repositoryId), kind, ...tail];
  }

  /** The prefix that covers one target's reads and nothing on another machine. */
  function targetCachePrefixFor(targetId: string): readonly unknown[] {
    return [input.cacheNamespace(), targetId];
  }

  /** The explicit selection wins; null means the repository's actual primary worktree. */
  const primaryWorktreeId = $derived(repository?.primaryWorktreeId ?? null);
  const activeWorktreeId = $derived(selectedWorktreeId ?? primaryWorktreeId);

  $effect(() => {
    reconcileRepositorySelection(
      input.selection,
      repositoryList.map((entry) => entry.repositoryId),
    );
  });

  const status = createQuery(() => {
    const key = repositoryQueryKey(
      "status",
      selectedRepositoryId,
      activeWorktreeId,
    );
    const state = gate(
      supportsRead("status"),
      selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          requireService().status({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: activeWorktreeId ?? "",
          }),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const refs = createQuery(() => {
    const key = repositoryQueryKey("refs", selectedRepositoryId);
    const state = gate(
      supportsRead("refs"),
      selectedRepositoryId !== null && targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          requireService().refs({
            repositoryId: selectedRepositoryId ?? "",
          }),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const stashes = createQuery(() => {
    const key = repositoryQueryKey("stashes", selectedRepositoryId);
    const state = gate(
      supportsRead("stashes"),
      selectedRepositoryId !== null && targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          requireService().stashes({
            repositoryId: selectedRepositoryId ?? "",
          }),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  let lastStashesRepositoryId = $state<string | null>(null);
  let lastStashes = $state<StashesResponse["stashes"]>([]);
  $effect(() => {
    const data = stashes.data;
    const repositoryId = selectedRepositoryId;
    if (data === undefined || repositoryId === null) {
      return;
    }
    lastStashesRepositoryId = repositoryId;
    lastStashes = data.stashes;
  });
  const displayedStashes = $derived(
    lastStashesRepositoryId === selectedRepositoryId
      ? lastStashes
      : (stashes.data?.stashes ?? []),
  );
  const stashPanelAvailable = $derived(
    stashes.data !== undefined ||
      lastStashesRepositoryId === selectedRepositoryId,
  );

  const worktrees = createQuery(() => {
    const key = repositoryQueryKey("worktrees", selectedRepositoryId);
    const state = gate(
      supportsRead("worktrees"),
      selectedRepositoryId !== null && targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          requireService().worktrees({
            repositoryId: selectedRepositoryId ?? "",
          }),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const worktreeList = $derived(worktrees.data?.worktrees ?? []);
  const activeWorktree = $derived(
    worktreeList.find((entry) => entry.worktreeId === activeWorktreeId) ?? null,
  );

  /**
   * Keep an explicit worktree selection valid after a remove/refresh. The null override always
   * remains valid because it resolves to the repository's primary worktree.
   */
  $effect(() => {
    if (
      selectedWorktreeId !== null &&
      worktrees.data !== undefined &&
      !worktreeList.some((entry) => entry.worktreeId === selectedWorktreeId)
    ) {
      input.selection.worktreeId = null;
      input.selection.commitOid = null;
      input.selection.statusPath = null;
      input.selection.statusSide = null;
      input.selection.diffPathId = null;
    }
  });

  const worktreeStatusesQuery = createQuery(() => {
    const worktreeIds = worktreeList.map((entry) => entry.worktreeId);
    const key = repositoryQueryKey(
      "worktree-statuses",
      selectedRepositoryId,
      worktreeIds,
    );
    const state = gate(
      supportsRead("status"),
      selectedRepositoryId !== null &&
        worktreeIds.length > 0 &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: async (): Promise<WorktreeStatusSummary[]> => {
        const service = requireService();
        const repositoryId = selectedRepositoryId;
        if (repositoryId === null) {
          return [];
        }
        const results = await mapBounded(
          worktreeIds,
          WORKTREE_STATUS_CONCURRENCY,
          async (worktreeId): Promise<WorktreeStatusSummary> => {
            if (
              worktreeId === activeWorktreeId &&
              (status.error === null || status.error === undefined) &&
              status.data?.worktreeId === worktreeId
            ) {
              return { worktreeId, status: status.data, error: null };
            }
            try {
              // The read-duration key for one worktree extends the query key; the timer
              // only compares keys, so extending the array is all it needs.
              const worktreeKey = [...key, worktreeId];
              return {
                worktreeId,
                status: await timedRead({
                  key: worktreeKey,
                  timer: readTimer,
                  run: () =>
                    service.status({
                      repositoryId,
                      worktreeId,
                    }),
                })(),
                error: null,
              };
            } catch (error) {
              return {
                worktreeId,
                status: null,
                error: describeBackendProblem(error),
              };
            }
          },
        );
        return results;
      },
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const worktreeStatuses = $derived(
    worktreeList.map((entry: WorktreeSummary): WorktreeStatusSummary => {
      if (entry.worktreeId === activeWorktreeId) {
        if (status.error !== null && status.error !== undefined) {
          return {
            worktreeId: entry.worktreeId,
            status: null,
            error: describeBackendProblem(status.error),
          };
        }
        if (status.data?.worktreeId === entry.worktreeId) {
          return {
            worktreeId: entry.worktreeId,
            status: status.data,
            error: null,
          };
        }
        return {
          worktreeId: entry.worktreeId,
          status: null,
          error: null,
        };
      }
      return (
        worktreeStatusesQuery.data?.find(
          (candidate) => candidate.worktreeId === entry.worktreeId,
        ) ?? {
          worktreeId: entry.worktreeId,
          status: null,
          error: null,
        }
      );
    }),
  );

  const submodules = createQuery(() => {
    const worktreeId = activeWorktreeId;
    const key = repositoryQueryKey(
      "submodules",
      selectedRepositoryId,
      worktreeId,
    );
    const state = gate(
      supportsRead("submodules"),
      selectedRepositoryId !== null &&
        worktreeId !== null &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          requireService().submodules({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: worktreeId ?? "",
          }),
      }),
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const history = createInfiniteQuery(() => {
    const filters = input.historyFilters();
    const key = repositoryQueryKey(
      "history",
      selectedRepositoryId,
      activeWorktreeId,
      filters,
      input.historyRevision(),
    );
    const state = gate(
      supportsRead("history"),
      selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: key,
      queryFn: ({ pageParam }) =>
        timedRead({
          // One page of history has its own read duration; the timer only compares keys.
          key: [...key, pageParam],
          timer: readTimer,
          run: () =>
            requireService().history(
              historyPageQuery(
                selectedRepositoryId ?? "",
                activeWorktreeId,
                filters,
                pageParam,
                HISTORY_PAGE_SIZE,
              ),
            ),
        })(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: state.enabled,
      ...cadence(key, state),
    };
  });

  const historyPages = $derived(history.data?.pages ?? []);
  const commits = $derived(historyPages.flatMap((page) => page.commits));
  const historyTopology = $derived(historyTopologyFor(historyPages));
  const currentBranchName = $derived(status.data?.head?.branchName ?? null);
  const graph = $derived(
    historyTopology === "sparse"
      ? { rows: [], laneCount: 1 }
      : layoutPages(
          historyPages.map((page) => page.commits.map(graphCommitFor)),
          {
            colorForRef: (commit) =>
              laneColorFor(currentBranchName, commit.refNames ?? []),
          },
        ),
  );
  const historyNotices = $derived(historyNoticesFor(historyPages));
  const selectedCommit = $derived(
    commits.find((commit) => commit.oid === selectedOid) ?? null,
  );

  const commitDetail = createQuery(() => {
    const state = gate(
      supportsRead("history"),
      selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        selectedOid !== null &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: repositoryQueryKey(
        "commit",
        selectedRepositoryId,
        activeWorktreeId,
        selectedOid,
      ),
      queryFn: () =>
        requireService().history({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: activeWorktreeId ?? "",
          detailOid: selectedOid ?? "",
          limit: 1,
        }),
      enabled: state.enabled,
    };
  });
  const detail = $derived(commitDetail.data?.detail ?? null);

  const diffRequest = $derived(
    diffRequestForSelection(selectedPath, selectedOid, selectedStatusSide),
  );

  const diff = createQuery(() => {
    const request = diffRequest;
    const state = gate(
      supportsRead("diff"),
      selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        request !== null &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: repositoryQueryKey(
        "diff",
        selectedRepositoryId,
        activeWorktreeId,
        request,
      ),
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null) {
          throw new Error("no diff selected");
        }
        return requireService().diff({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: activeWorktreeId ?? "",
          ...request,
        });
      },
      enabled: state.enabled,
    };
  });

  const diffPatch = createQuery(() => {
    const request = diffRequest;
    const pathId = selectedDiffPathId;
    const state = gate(
      supportsRead("diff"),
      selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        request !== null &&
        pathId !== null &&
        request.kind !== "untracked" &&
        targetReadyFor(selectedRepositoryId),
    );
    return {
      queryKey: repositoryQueryKey(
        "diff-patch",
        selectedRepositoryId,
        activeWorktreeId,
        request,
        pathId,
      ),
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null || pathId === null) {
          throw new Error("no path selected");
        }
        return requireService().diff({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: activeWorktreeId ?? "",
          ...request,
          pathId,
        });
      },
      enabled: state.enabled,
    };
  });

  let lastDiffStatusSnapshotId = $state<string | null>(null);
  $effect(() => {
    const snapshotId = status.data?.snapshotId ?? null;
    const request = diffRequest;
    if (snapshotId === null) {
      return;
    }
    const changed =
      lastDiffStatusSnapshotId !== null &&
      lastDiffStatusSnapshotId !== snapshotId;
    lastDiffStatusSnapshotId = snapshotId;
    if (!changed || request === null || request.kind === "commit") {
      return;
    }
    void diff.refetch();
    if (selectedDiffPathId !== null) {
      void diffPatch.refetch();
    }
  });

  const identity = createQuery(() => {
    const state = gate(true, true);
    return {
      queryKey: cacheKeyFor(input.cacheNamespace(), "identity"),
      queryFn: () => requireService().health(),
      enabled: state.enabled,
    };
  });

  /** A directory browse is a read, but not a cached one: the user asked for this path now. */
  async function filesystemEntries(path: string) {
    return requireService().filesystemEntries({ path });
  }

  return {
    capabilities,
    repositories,
    status,
    refs,
    stashes,
    worktrees,
    worktreeStatusesQuery,
    submodules,
    history,
    commitDetail,
    diff,
    diffPatch,
    identity,
    filesystemEntries,
    /** The key prefix one repository's reads are cached under, for invalidation. */
    repositoryCachePrefixFor,
    /** The key prefix one execution target's reads are cached under, for invalidation. */
    targetCachePrefixFor,
    targetLabelFor,
    targetKindFor,
    /** Whether a repository's machine may currently be read from. */
    targetReadyFor,
    /** Re-reads the target list; the page calls it after creating or releasing one. */
    refreshTargets,
    get targets() {
      return targets;
    },
    get repositoryList() {
      return repositoryList;
    },
    get workspaceRoots() {
      return workspaceRoots;
    },
    get repository() {
      return repository;
    },
    get displayedStashes() {
      return displayedStashes;
    },
    get stashPanelAvailable() {
      return stashPanelAvailable;
    },
    get providerAvailable() {
      return providerAvailable;
    },
    get providerConnection() {
      return providerConnection;
    },
    get providerPullRequests() {
      return providerPullRequests;
    },
    get providerDeviceStatus() {
      return providerDeviceStatus;
    },
    providerDeviceStatusKey,
    providerCachePrefixes,
    get commits() {
      return commits;
    },
    get graph() {
      return graph;
    },
    get historyTopology() {
      return historyTopology;
    },
    get historyNotices() {
      return historyNotices;
    },
    get selectedCommit() {
      return selectedCommit;
    },
    get detail() {
      return detail;
    },
    get diffRequest() {
      return diffRequest;
    },
    get primaryWorktreeId() {
      return primaryWorktreeId;
    },
    get activeWorktreeId() {
      return activeWorktreeId;
    },
    get activeWorktree() {
      return activeWorktree;
    },
    get worktreeStatuses() {
      return worktreeStatuses;
    },
  };
}

export type WorkbenchQueries = ReturnType<typeof createWorkbenchQueries>;
