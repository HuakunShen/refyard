/**
 * TanStack read composition for the workbench.
 *
 * This module owns how authenticated GitService reads are keyed, polled, paged and reduced into
 * presentation models. It owns no browser DOM lifecycle and no mutations; the page remains the
 * composition root and supplies reactive getters plus the shared selection state.
 */
import { GitClientError, type GitClient } from "@refyard/git-client";
import type { DiffResponse, StashesResponse } from "@refyard/git-contract";
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

const HISTORY_PAGE_SIZE = 100;
const BACKGROUND_PREFIXES = [
  "repositories",
  "status",
  "refs",
  "stashes",
  "worktrees",
  "submodules",
  "history",
] as const;

export interface WorkbenchQueryInputs {
  readonly client: () => GitClient;
  readonly baseUrl: () => string;
  readonly token: () => string | null;
  readonly selection: WorkbenchSelectionState;
  readonly visible: () => boolean;
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
  const selectedOid = $derived(input.selection.commitOid);
  const selectedPath = $derived(input.selection.statusPath);
  const selectedDiffPathId = $derived(input.selection.diffPathId);

  const repositoryList = $derived(repositories.data?.repositories ?? []);
  const workspaceRoots = $derived(workspaceRootsFor(repositoryList));
  const repository = $derived(
    repositoryList.find(
      (entry) => entry.repositoryId === selectedRepositoryId,
    ) ?? null,
  );

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
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          input.client().status({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: repository?.primaryWorktreeId,
          }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
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

  const submodules = createQuery(() => {
    const worktreeId = repository?.primaryWorktreeId;
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
      enabled:
        enabled && selectedRepositoryId !== null && worktreeId !== undefined,
      ...polled(key),
    };
  });

  const history = createInfiniteQuery(() => {
    const key = [
      "history",
      input.baseUrl(),
      input.token(),
      selectedRepositoryId,
    ];
    return {
      queryKey: key,
      queryFn: ({ pageParam }) =>
        timedRead({
          key: [...key, pageParam],
          timer: readTimer,
          run: () =>
            input.client().history({
              repositoryId: selectedRepositoryId ?? "",
              limit: HISTORY_PAGE_SIZE,
              ...(pageParam === null ? {} : { cursor: pageParam }),
            }),
        })(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  const historyPages = $derived(history.data?.pages ?? []);
  const commits = $derived(historyPages.flatMap((page) => page.commits));
  const graph = $derived(
    layoutPages(historyPages.map((page) => page.commits.map(graphCommitFor))),
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
      selectedOid,
    ],
    queryFn: () =>
      input.client().history({
        repositoryId: selectedRepositoryId ?? "",
        detailOid: selectedOid ?? "",
        limit: 1,
      }),
    enabled: enabled && selectedRepositoryId !== null && selectedOid !== null,
  }));
  const detail = $derived(commitDetail.data?.detail ?? null);

  const diffRequest = $derived(
    diffRequestForSelection(selectedPath, selectedOid),
  );

  const diff = createQuery(() => {
    const request = diffRequest;
    return {
      queryKey: [
        "diff",
        input.baseUrl(),
        input.token(),
        selectedRepositoryId,
        request,
      ],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null) {
          throw new Error("no diff selected");
        }
        return input.client().diff({
          repositoryId: selectedRepositoryId ?? "",
          ...request,
        });
      },
      enabled: enabled && selectedRepositoryId !== null && request !== null,
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
        request,
        pathId,
      ],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null || pathId === null) {
          throw new Error("no path selected");
        }
        return input.client().diff({
          repositoryId: selectedRepositoryId ?? "",
          ...request,
          pathId,
        });
      },
      enabled:
        enabled &&
        selectedRepositoryId !== null &&
        request !== null &&
        pathId !== null &&
        request.kind !== "untracked",
    };
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
  const primaryWorktreeId = $derived(repository?.primaryWorktreeId ?? null);

  return {
    capabilities,
    repositories,
    status,
    refs,
    stashes,
    worktrees,
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
  };
}

export type WorkbenchQueries = ReturnType<typeof createWorkbenchQueries>;
