/**
 * TanStack read composition for the workbench.
 *
 * This module owns how authenticated GitService reads are keyed, polled, paged and reduced into
 * presentation models. It owns no browser DOM lifecycle and no mutations; the page remains the
 * composition root and supplies reactive getters plus the shared selection state.
 */
import { GitClientError, type GitClient } from "@refyard/git-client";
import type {
  DiffResponse,
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
import {
  reconcileRepositorySelection,
  type WorkbenchSelectionState,
} from "./selection.js";
import {
  diffRequestForSelection,
  graphCommitFor,
  historyNoticesFor,
  workspaceRootsFor,
} from "./query-model.js";

import {
  historyPageQuery,
  historyTopologyFor,
  type AppliedHistoryFilters,
} from "./history-filters.js";

const HISTORY_PAGE_SIZE = 100;
const WORKTREE_STATUS_CONCURRENCY = 3;
const BACKGROUND_PREFIXES = [
  "repositories",
  "status",
  "refs",
  "stashes",
  "worktrees",
  "worktree-statuses",
  "submodules",
  "history",
] as const;

export interface WorkbenchQueryInputs {
  readonly client: () => GitClient;
  readonly baseUrl: () => string;
  readonly token: () => string | null;
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

export function invalidateWorkbenchBackgroundQueries(
  queryClient: QueryClient,
): void {
  for (const prefix of BACKGROUND_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [prefix] });
  }
}

export function createWorkbenchQueries(input: WorkbenchQueryInputs) {
  const enabled = $derived(input.token() !== null);
  const readTimer = createReadTimer();
  const polled = (key: readonly unknown[]) =>
    backgroundRead({ key, timer: readTimer, visible: input.visible });

  const capabilities = createQuery(() => ({
    queryKey: ["capabilities", input.baseUrl(), input.token()],
    queryFn: () => input.client().capabilities(),
    enabled,
  }));

  const repositories = createQuery(() => {
    const key = ["repositories", input.baseUrl(), input.token()];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => input.client().repositories(),
      }),
      enabled,
      ...polled(key),
    };
  });

  const selectedRepositoryId = $derived(input.selection.repositoryId);
  const selectedWorktreeId = $derived(input.selection.worktreeId);
  const selectedOid = $derived(input.selection.commitOid);
  const selectedPath = $derived(input.selection.statusPath);
  const selectedStatusSide = $derived(input.selection.statusSide);
  const selectedDiffPathId = $derived(input.selection.diffPathId);

  const repositoryList = $derived(repositories.data?.repositories ?? []);
  const workspaceRoots = $derived(workspaceRootsFor(repositoryList));
  const repository = $derived(
    repositoryList.find(
      (entry) => entry.repositoryId === selectedRepositoryId,
    ) ?? null,
  );

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
    const key = [
      "status",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
      activeWorktreeId,
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input.client().status({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: activeWorktreeId ?? "",
          }),
      }),
      enabled:
        enabled && selectedRepositoryId !== null && activeWorktreeId !== null,
      ...polled(key),
    };
  });

  const refs = createQuery(() => {
    const key = ["refs", input.baseUrl(), input.token(), selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input.client().refs({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  const stashes = createQuery(() => {
    const key = [
      "stashes",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input.client().stashes({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
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
    const key = [
      "worktrees",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input
            .client()
            .worktrees({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
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
    const key = [
      "worktree-statuses",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
      worktreeIds,
    ];
    return {
      queryKey: key,
      queryFn: async (): Promise<WorktreeStatusSummary[]> => {
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
              const worktreeKey = [...key, worktreeId];
              return {
                worktreeId,
                status: await timedRead({
                  key: worktreeKey,
                  timer: readTimer,
                  run: () =>
                    input.client().status({
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
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        );
        return results;
      },
      enabled:
        enabled && selectedRepositoryId !== null && worktreeIds.length > 0,
      ...polled(key),
    };
  });

  const worktreeStatuses = $derived(
    worktreeList.map((entry: WorktreeSummary): WorktreeStatusSummary => {
      if (entry.worktreeId === activeWorktreeId) {
        if (status.error !== null && status.error !== undefined) {
          return {
            worktreeId: entry.worktreeId,
            status: null,
            error:
              status.error instanceof Error
                ? status.error.message
                : String(status.error),
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
    const key = [
      "submodules",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
      worktreeId,
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input.client().submodules({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: worktreeId ?? "",
          }),
      }),
      enabled: enabled && selectedRepositoryId !== null && worktreeId !== null,
      ...polled(key),
    };
  });

  const history = createInfiniteQuery(() => {
    const filters = input.historyFilters();
    const key = [
      "history",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
      activeWorktreeId,
      filters,
      input.historyRevision(),
    ];
    return {
      queryKey: key,
      queryFn: ({ pageParam }) =>
        timedRead({
          key: [...key, pageParam],
          timer: readTimer,
          run: () =>
            input
              .client()
              .history(
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
      enabled:
        enabled && selectedRepositoryId !== null && activeWorktreeId !== null,
      ...polled(key),
    };
  });

  const historyPages = $derived(history.data?.pages ?? []);
  const commits = $derived(historyPages.flatMap((page) => page.commits));
  const historyTopology = $derived(historyTopologyFor(historyPages));
  const graph = $derived(
    historyTopology === "sparse"
      ? { rows: [], laneCount: 1 }
      : layoutPages(
          historyPages.map((page) => page.commits.map(graphCommitFor)),
        ),
  );
  const historyNotices = $derived(historyNoticesFor(historyPages));
  const selectedCommit = $derived(
    commits.find((commit) => commit.oid === selectedOid) ?? null,
  );

  const commitDetail = createQuery(() => ({
    queryKey: [
      "commit",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
      activeWorktreeId,
      selectedOid,
    ],
    queryFn: () =>
      input.client().history({
        repositoryId: selectedRepositoryId ?? "",
        worktreeId: activeWorktreeId ?? "",
        detailOid: selectedOid ?? "",
        limit: 1,
      }),
    enabled:
      enabled &&
      selectedRepositoryId !== null &&
      activeWorktreeId !== null &&
      selectedOid !== null,
  }));
  const detail = $derived(commitDetail.data?.detail ?? null);

  const diffRequest = $derived(
    diffRequestForSelection(selectedPath, selectedOid, selectedStatusSide),
  );

  const diff = createQuery(() => {
    const request = diffRequest;
    return {
      queryKey: [
        "diff",
        input.baseUrl(),
        input.token(),
        selectedRepositoryId,
        activeWorktreeId,
        request,
      ],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null) {
          throw new Error("no diff selected");
        }
        return input.client().diff({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: activeWorktreeId ?? "",
          ...request,
        });
      },
      enabled:
        enabled &&
        selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        request !== null,
    };
  });

  const diffPatch = createQuery(() => {
    const request = diffRequest;
    const pathId = selectedDiffPathId;
    return {
      queryKey: [
        "diff-patch",
        input.baseUrl(),
        input.token(),
        selectedRepositoryId,
        activeWorktreeId,
        request,
        pathId,
      ],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null || pathId === null) {
          throw new Error("no path selected");
        }
        return input.client().diff({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: activeWorktreeId ?? "",
          ...request,
          pathId,
        });
      },
      enabled:
        enabled &&
        selectedRepositoryId !== null &&
        activeWorktreeId !== null &&
        request !== null &&
        pathId !== null &&
        request.kind !== "untracked",
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

  const identity = createQuery(() => ({
    queryKey: ["identity", input.baseUrl()],
    queryFn: () => input.client().health(),
    enabled,
  }));

  const sessionExpired = $derived(
    [
      repositories.error,
      capabilities.error,
      status.error,
      refs.error,
      history.error,
    ].some(
      (error) =>
        error instanceof GitClientError && error.code === "Unauthenticated",
    ),
  );
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
    get enabled() {
      return enabled;
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
    get sessionExpired() {
      return sessionExpired;
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
