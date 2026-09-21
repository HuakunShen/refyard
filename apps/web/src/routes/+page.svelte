<script lang="ts">
  /**
   * The workbench page.
   *
   * This is the composition root for the runtime session/connectivity controllers and the
   * query cache, and it composes
   * `@refyard/git-ui` components that take plain props. Keeping that split means the
   * components can be reused by another host, and it means the app has no business logic
   * about Git in it — only reads, selection, and the states around them.
   *
   * This page does not choose a transport, hold a bearer, or build a Git command. It asks
   * `createWorkbenchRuntime` for a session — HTTP in a browser, native IPC in the desktop
   * WebView — and passes the session's read/mutation/event services into the controllers.
   */
  import { browser } from "$app/environment";
  import { onDestroy, onMount } from "svelte";
  import type { BackendSession, ConnectionState } from "@refyard/git-service";
  import { BackendError } from "@refyard/git-service";
  import type {
    CommitSummary,
    ExecutionTargetSummary,
  } from "@refyard/git-contract";
  import {
    SettingsDialog,
    Badge,
    Button,
    CommitDetailPanel,
    CommitList,
    WorkingCopyPanel,
    WorktreeWipList,
    HistoryFilterBar,
    ConnectionPanel,
    DiffPanel,
    RepositoryLauncher,
    RepositoryTabs,
    StateBanner,
    UncertainOutcomePanel,
    cn,
    type ExecutionTargetSelection,
  } from "@refyard/git-ui";
  import {
    githubOwnerAvatarUrl,
    githubRepoFromRemote,
  } from "@refyard/git-ui/lib/avatars";
  import {
    densityMetrics,
    isRowDensity,
    type RowDensity,
  } from "@refyard/git-ui/lib/geometry";
  import {
    FileDiff,
    FolderGit2,
    GitBranch,
    RefreshCw,
    Server,
  } from "@lucide/svelte";
  import { useQueryClient } from "@tanstack/svelte-query";
  import {
    createWorkbenchSessionState,
    describeBackendProblem,
    isDefaultSessionBaseUrl,
  } from "$lib/workbench/session.js";
  import {
    createWorkbenchConnectivityState,
    observeBrowserConnectivity,
    startSessionEventStream,
  } from "$lib/workbench/connectivity.js";
  import { createWorkbenchRuntime } from "$lib/runtime/bootstrap.js";
  import {
    clearInspectableSelection,
    createWorkbenchSelectionState,
    selectCommit,
    selectDiffPath,
    selectRepository,
    selectWorktree,
    selectStatusPath,
  } from "$lib/workbench/selection.js";
  import {
    createWorkbenchQueries,
    invalidateWorkbenchBackgroundQueries,
  } from "$lib/workbench/queries.svelte.js";
  import { createWorkbenchMutations } from "$lib/workbench/mutations.svelte.js";
  import {
    closeRepositoryTab,
    createRepositoryTabs,
    selectRepositoryTab,
    openRepositoryTab,
    repositoryTabKey,
    type RepositoryTab,
  } from "$lib/workbench/repository-tabs.js";
  import {
    recentRepositoryKey,
    type RecentRepository,
  } from "$lib/workbench/repository-launcher.js";
  import {
    applyHistoryFilters,
    clearHistoryFilters,
    createHistoryFilterState,
    historyFiltersActive,
    historyFilterLabels,
  } from "$lib/workbench/history-filters.js";
  import RepositorySidebar from "$lib/components/workbench/RepositorySidebar.svelte";
  import ResizeHandle from "$lib/components/workbench/ResizeHandle.svelte";
  import {
    clampSidebarWidth,
    SIDEBAR_WIDTHS,
    storedSidebarWidth,
  } from "$lib/workbench/layout-widths.js";
  import {
    clearStoredSession,
    readStoredAccent,
    readStoredBackground,
    readStoredBaseUrl,
    readStoredGlass,
    readStoredInstance,
    readStoredToken,
    storeAccent,
    storeBackground,
    storeBaseUrl,
    storeGlass,
    storeInstance,
    storeToken,
    readStoredUpdateCheck,
    storeUpdateCheck,
    readStoredAvatars,
    storeAvatars,
    readStoredDensity,
    storeDensity,
  } from "$lib/storage.js";
  import { createDesktopUpdates } from "$lib/runtime/updates.js";
  import type { UpdateOffer, UpdatesProbe } from "@refyard/git-ui";
  import {
    blocksWrites,
    negotiateSession,
    rememberedSessionFor,
    type Negotiation,
  } from "$lib/session-negotiation.js";

  /* ------------------------------------------------------- runtime connection */

  /**
   * The HTTP pairing form's state: address, ticket, hosted password, and the phase the
   * ConnectionPanel displays. It is not the session — the session arrives from the
   * runtime below, and whether one exists is what the page renders against.
   */
  const pairing = $state(
    createWorkbenchSessionState({
      href: browser ? window.location.href : "http://127.0.0.1:47831/",
      storedBaseUrl: browser ? readStoredBaseUrl() : null,
      storedToken: browser ? readStoredToken() : null,
      storedInstance: browser ? readStoredInstance() : null,
    }),
  );

  let backendSession = $state<BackendSession | null>(null);
  let connectionState = $state<ConnectionState>({
    phase: "connecting",
    problem: null,
  });
  const connectivity = $state(createWorkbenchConnectivityState(true));
  const streamState = $derived(connectivity.streamState);
  const browserOnline = $derived(connectivity.browserOnline);

  let updatesProbe = $state<UpdatesProbe | null>(null);
  let autoCheck = $state(browser ? readStoredUpdateCheck() : false);
  let pendingUpdate = $state<UpdateOffer | null>(null);
  let appVersion = $state<string | undefined>(undefined);
  let failureBanner = $state("");

  let accent = $state(browser ? readStoredAccent() : "default");
  let background = $state(browser ? readStoredBackground() : "none");
  let glass = $state(browser ? readStoredGlass() : false);
  let avatars = $state(browser ? readStoredAvatars() : true);
  const storedDensity = browser ? readStoredDensity() : "roomy";
  let density = $state<RowDensity>(
    isRowDensity(storedDensity) ? storedDensity : "roomy",
  );
  // One value for the whole list: the virtualizer's row height and the graph's lane
  // spacing must be the same number, or a node stops sitting on its own row.
  const historyMetrics = $derived(densityMetrics(density));

  $effect(() => {
    if (!browser) {
      return;
    }
    document.documentElement.setAttribute("data-accent", accent);
    document.documentElement.setAttribute(
      "data-glass",
      glass ? "true" : "false",
    );
    storeAccent(accent);
    storeBackground(background);
    storeGlass(glass);
    storeAvatars(avatars);
    storeDensity(density);
  });

  // The updater exists only on the desktop runtime, and its code only loads there.
  $effect(() => {
    if (!browser || runtime.kind !== "tauri" || updatesProbe !== null) {
      return;
    }
    void createDesktopUpdates().then((probe) => {
      updatesProbe = probe;
      // The opt-in startup check: quiet by default, and a check the user asked for
      // turns into an offer banner, never an automatic download.
      if (readStoredUpdateCheck()) {
        void probe
          .check()
          .then((offer) => {
            pendingUpdate = offer;
          })
          .catch(() => {
            // No feed reachable yet is not a defect worth interrupting startup for.
          });
      }
    });
  });

  // The shell version for the Settings sheet: only the desktop runtime carries one,
  // and its code only loads there. A browser build simply has no Version row.
  $effect(() => {
    if (!browser || runtime.kind !== "tauri" || appVersion !== undefined) {
      return;
    }
    void import("@tauri-apps/api/app")
      .then((app) => app.getVersion())
      .then((version) => {
        appVersion = version;
      })
      .catch(() => {
        // Without a version the About section omits the row; that is the honest state.
      });
  });

  const queryClient = useQueryClient();

  /**
   * The runtime owns adapter selection and the connection lifecycle. It mutates the
   * pairing form in place and reports the session/connection through these callbacks,
   * so all reactivity stays in this component.
   */
  const runtime = createWorkbenchRuntime({
    form: pairing,
    fetch: (input, init) => fetch(input, init),
    storage: { storeToken, storeInstance, storeBaseUrl, clearStoredSession },
    currentHref: () =>
      browser ? window.location.href : `${pairing.initialBaseUrl}/`,
    replaceHref: (href) => {
      if (browser) {
        window.history.replaceState({}, "", href);
      }
    },
    onSession: (session) => {
      backendSession = session;
    },
    onConnectionState: (state) => {
      connectionState = state;
    },
  });

  onMount(() => {
    // A pairing URL is meant to work by being opened; a remembered session is reconnected
    // behind its own probe. Both paths live in the runtime, not in the template.
    void runtime.start();
    return () => {
      void runtime.dispose();
    };
  });

  async function pair(): Promise<void> {
    await runtime.pair();
  }

  async function disconnect(): Promise<void> {
    await runtime.disconnect();
    clearInspectableSelection(selection);
    queryClient.clear();
  }

  /* ------------------------------------------------------------------- reads */

  const selection = $state(createWorkbenchSelectionState());
  const selectedRepositoryId = $derived(selection.repositoryId);
  const repositoryTabs = $state(createRepositoryTabs());
  let launcherOpen = $state(true);
  let recentRepositories = $state<RecentRepository[]>([]);
  /**
   * Where the next repository open runs. The page holds the choice the launcher
   * reported and passes it back; creating and connecting the target belongs to the
   * host service, which `registerRemoteRepository` calls with this selection.
   */
  let executionTarget = $state<ExecutionTargetSelection | null>(null);
  /**
   * True while an OS drag with real paths is over the window — the desktop's
   * "drop a folder here" affordance, which a browser build never sees.
   */
  let dropPathsActive = $state(false);
  /**
   * The target the host most recently minted for that choice, once one exists. It is
   * what the launcher disables Browse with, and it is dropped the moment the choice
   * changes so one host's answer is never shown for another.
   */
  let launcherTargetSummary = $state<ExecutionTargetSummary | null>(null);
  let recentLoaded = $state(false);
  let launcherRequested = $state(false);
  let knownRepositoryIds = $state<string[]>([]);
  let tabWorktrees = $state<
    Record<string, { id: string; label: string; path: string }>
  >({});
  let leftSidebarWidth = $state(
    browser
      ? storedSidebarWidth(
          window.localStorage.getItem("refyard.layout.sidebar.left"),
          SIDEBAR_WIDTHS.left.default,
          SIDEBAR_WIDTHS.left,
        )
      : SIDEBAR_WIDTHS.left.default,
  );
  let rightSidebarWidth = $state(
    browser
      ? storedSidebarWidth(
          window.localStorage.getItem("refyard.layout.sidebar.right"),
          SIDEBAR_WIDTHS.right.default,
          SIDEBAR_WIDTHS.right,
        )
      : SIDEBAR_WIDTHS.right.default,
  );
  const historyFilterState = $state(createHistoryFilterState());
  $effect(() => {
    if (historyFilterState.repositoryId !== selectedRepositoryId)
      clearHistoryFilters(historyFilterState, selectedRepositoryId);
  });
  function applyHistorySearch(): void {
    if (applyHistoryFilters(historyFilterState)) {
      clearInspectableSelection(selection);
      selection.diffPathId = null;
    }
  }
  function clearHistorySearch(): void {
    clearHistoryFilters(historyFilterState);
    clearInspectableSelection(selection);
    selection.diffPathId = null;
  }
  const selectedOid = $derived(selection.commitOid);
  const selectedPath = $derived(selection.statusPath);
  const selectedDiffPathId = $derived(selection.diffPathId);

  function pageVisible(): boolean {
    return (
      typeof document === "undefined" || document.visibilityState !== "hidden"
    );
  }

  const queries = createWorkbenchQueries({
    service: () => backendSession?.git ?? null,
    host: () => backendSession?.host ?? null,
    cacheNamespace: () =>
      backendSession?.metadata.cacheNamespace ?? "unconnected",
    phase: () => connectionState.phase,
    selection,
    visible: pageVisible,
    historyFilters: () =>
      historyFilterState.repositoryId === selectedRepositoryId
        ? historyFilterState.applied
        : {},
    historyRevision: () => historyFilterState.revision,
  });
  const capabilities = queries.capabilities;
  const status = queries.status;
  const refs = queries.refs;
  const history = queries.history;
  const diff = queries.diff;
  const diffPatch = queries.diffPatch;
  const identity = queries.identity;

  /**
   * GitHub org avatar per remote name, from the redacted fetch URL — the icon
   * a remote badge wears instead of a generic globe. Remotes that are not
   * github.com URLs simply stay out of the map.
   */
  const remoteAvatars = $derived.by(() => {
    const map = new Map<string, string>();
    for (const remote of refs.data?.remotes ?? []) {
      const url = githubOwnerAvatarUrl(remote.fetchUrlDisplay);
      if (url !== null) {
        map.set(remote.name, url);
      }
    }
    return map;
  });

  /**
   * A GitHub remote URL for the history's "Copy GitHub Link" items.
   *
   * `origin` wins when several remotes point at GitHub, because that is the one a
   * "link to this commit" is expected to mean; a repository with no GitHub remote
   * simply does not offer the items.
   */
  const githubRemoteUrl = $derived.by(() => {
    const remotes = refs.data?.remotes ?? [];
    const github = remotes.filter(
      (remote) => githubRepoFromRemote(remote.fetchUrlDisplay) !== null,
    );
    const preferred =
      github.find((remote) => remote.name === "origin") ?? github[0];
    return preferred?.fetchUrlDisplay;
  });

  const repository = $derived(queries.repository);
  const repositoryList = $derived(queries.repositoryList);
  /** The host's name for the machine the shown repository lives on, when it is not this one. */
  const selectedTargetLabel = $derived(
    queries.targetLabelFor(repository?.targetId ?? null),
  );
  const commits = $derived(queries.commits);
  const graph = $derived(queries.graph);
  const historyNotices = $derived(queries.historyNotices);
  const selectedCommit = $derived(queries.selectedCommit);
  const detail = $derived(queries.detail);
  const diffRequest = $derived(queries.diffRequest);
  const sessionExpired = $derived(
    backendSession !== null && connectionState.phase === "failed",
  );
  const activeWorktreeId = $derived(queries.activeWorktreeId);
  const mainDiffOpen = $derived(
    selectedPath !== null || selectedDiffPathId !== null,
  );
  const worktreeLabel = $derived(
    queries.activeWorktree?.head.branchName ??
      status.data?.head.branchName ??
      "Working copy",
  );
  const worktreePath = $derived(
    queries.activeWorktree?.displayPath ?? repository?.displayPath ?? "",
  );
  const draftKey = $derived(`${selectedRepositoryId}:${activeWorktreeId}`);
  let commitDrafts = $state<Record<string, string>>({});

  function openWorktree(worktreeId: string, inNewTab = false): void {
    if (writeController.busy || repository === null) return;
    const worktree = queries.worktrees.data?.worktrees.find(
      (entry) => entry.worktreeId === worktreeId,
    );
    if (worktree === undefined || worktree.isBare || worktree.isPrunable)
      return;
    if (inNewTab) {
      openRepositoryTab(repositoryTabs, {
        repositoryId: repository.repositoryId,
        ...(repository.targetId === undefined
          ? {}
          : { targetId: repository.targetId }),
        worktreeId,
        displayName: `${repository.displayName} · ${worktree.head.branchName ?? "detached"}`,
        displayPath: worktree.displayPath,
      });
    }
    if (repositoryTabs.activeRepositoryId !== null) {
      tabWorktrees[repositoryTabs.activeRepositoryId] = {
        id: worktreeId,
        label: worktree.head.branchName ?? "detached",
        path: worktree.displayPath,
      };
    }
    selectWorktree(selection, worktreeId);
    clearHistoryFilters(historyFilterState, selectedRepositoryId);
    launcherRequested = false;
    launcherOpen = false;
  }

  let reconciledPathSnapshot = "";
  $effect(() => {
    const snapshot = status.data;
    const path = selection.statusPath;
    if (
      snapshot === undefined ||
      snapshot.worktreeId !== activeWorktreeId ||
      path === null ||
      writeController.busy
    )
      return;
    const revision = `${snapshot.snapshotId}:${path.pathId}`;
    if (revision === reconciledPathSnapshot) return;
    reconciledPathSnapshot = revision;
    const current = snapshot.entries.find(
      (entry) => entry.pathId === path.pathId,
    );
    if (current === undefined) {
      backToHistory();
    } else {
      selection.statusPath = current;
      if (
        selection.statusSide === "unstaged" &&
        current.kind !== "untracked" &&
        current.worktreeStatus === "."
      )
        selection.statusSide = "staged";
      if (selection.statusSide === "staged" && current.indexStatus === ".")
        selection.statusSide = "unstaged";
    }
  });

  function backToHistory(): void {
    clearInspectableSelection(selection);
    selection.diffPathId = null;
  }

  $effect(() => {
    if (browser && !recentLoaded) {
      recentLoaded = true;
      try {
        const stored = JSON.parse(
          window.localStorage.getItem("refyard.recent.repositories") ?? "[]",
        ) as unknown;
        if (Array.isArray(stored)) {
          recentRepositories = stored.filter(
            (entry): entry is RecentRepository =>
              typeof entry === "object" &&
              entry !== null &&
              typeof Reflect.get(entry, "displayPath") === "string" &&
              typeof Reflect.get(entry, "displayName") === "string" &&
              typeof Reflect.get(entry, "repositoryId") === "string",
          );
        }
      } catch {
        recentRepositories = [];
      }
    }
    // A repository may already have a tab when it reaches this effect: an open the user
    // just triggered adds its own tab first, and a list read that arrives afterwards
    // must not add a second one with the same identity. Svelte's keyed tab list cannot
    // render two equal keys, and the failure is a broken render, not a visible duplicate.
    const knownTabKeys = new Set(
      repositoryTabs.tabs.map((tab) => repositoryTabKey(tab)),
    );
    const candidates = repositoryList.filter(
      (entry) => !knownRepositoryIds.includes(entry.repositoryId),
    );
    // The machine is part of the tab's identity: a repository the host places on an
    // SSH target must not be adopted as if it were this machine's.
    const unseen = candidates
      .map((entry) => tabForRepository(entry))
      .filter((tab) => !knownTabKeys.has(repositoryTabKey(tab)));
    if (unseen.length > 0) {
      repositoryTabs.tabs = [...repositoryTabs.tabs, ...unseen];
      const first = unseen[0];
      repositoryTabs.activeRepositoryId ??=
        first === undefined ? null : repositoryTabKey(first);
      repositoryTabs.revision += 1;
    }
    if (candidates.length > 0) {
      knownRepositoryIds = [
        ...knownRepositoryIds,
        ...candidates.map((entry) => entry.repositoryId),
      ];
    }
    if (
      !launcherRequested &&
      repositoryList.length > 0 &&
      repositoryTabs.tabs.length > 0
    ) {
      launcherOpen = false;
      if (selection.repositoryId === null) {
        selectRepository(
          selection,
          repositoryTabs.tabs[0]?.repositoryId ?? null,
        );
      }
    }
  });

  // Repo creation and managed approvals can select a repository outside the tab bar.
  $effect(() => {
    if (launcherRequested) return;
    const entry = repositoryList.find(
      (item) => item.repositoryId === selectedRepositoryId,
    );
    const active = repositoryTabs.tabs.find(
      (tab) => repositoryTabKey(tab) === repositoryTabs.activeRepositoryId,
    );
    if (entry !== undefined && active?.repositoryId !== entry.repositoryId) {
      openRepositoryTab(repositoryTabs, tabForRepository(entry));
    }
  });

  /**
   * The tab one repository entry opens. The target is carried into the tab, so the
   * same path on two machines is two tabs, each keyed by the machine it runs on.
   */
  function tabForRepository(entry: {
    readonly repositoryId: string;
    readonly targetId?: string;
    readonly displayName: string;
    readonly displayPath: string;
  }): RepositoryTab {
    return {
      repositoryId: entry.repositoryId,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      displayName: entry.displayName,
      displayPath: entry.displayPath,
    };
  }

  function selectRegisteredRepository(repositoryId: string): void {
    const entry = repositoryList.find(
      (item) => item.repositoryId === repositoryId,
    );
    if (entry === undefined || writeController.busy) return;
    const tab = tabForRepository(entry);
    openRepositoryTab(repositoryTabs, tab);
    // The tab is identified by its key, which carries the target; the raw repository
    // id would find no tab for a repository on another machine.
    handleRepositoryTab(repositoryTabKey(tab));
  }

  function rememberRecent(entry: RecentRepository): void {
    const next = [
      entry,
      ...recentRepositories.filter(
        (item) => recentRepositoryKey(item) !== recentRepositoryKey(entry),
      ),
    ].slice(0, 30);
    recentRepositories = next;
    if (browser) {
      window.localStorage.setItem(
        "refyard.recent.repositories",
        JSON.stringify(next),
      );
    }
  }

  $effect(() => {
    const entry = repositoryList.find(
      (candidate) => candidate.repositoryId === selection.repositoryId,
    );
    if (entry === undefined) return;
    // The pending launcher choice describes where the *next* open runs, not where an
    // already selected repository lives: a local repository stays local even while a
    // host is chosen in the launcher, which is open over it. So the choice only counts
    // for a repository the host actually places on a target.
    const remoteChoice =
      executionTarget !== null && executionTarget.kind !== "local"
        ? executionTarget
        : null;
    // A recent entry is what reopens a repository, and it restores a machine with the
    // path. A repository the host places on a target, opened without a selection that
    // names that machine, would reopen on this one — the wrong repository at the same
    // path — so it is not remembered as a recent rather than remembered wrongly.
    if (entry.targetId !== undefined && remoteChoice === null) return;
    const target = entry.targetId === undefined ? null : remoteChoice;
    const remembered: RecentRepository = {
      repositoryId: entry.repositoryId,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      displayName: entry.displayName,
      displayPath: entry.displayPath,
      lastOpenedAt: new Date().toISOString(),
      available: true,
      ...(target === null ? {} : { target }),
    };
    if (
      !recentRepositories.some(
        (item) =>
          item.available &&
          recentRepositoryKey(item) === recentRepositoryKey(remembered),
      )
    ) {
      rememberRecent(remembered);
    }
  });

  /**
   * Opens a path in the place the launcher selected. A local path goes through the
   * host's own resolver; a path on an execution target goes through the target
   * sequence, because this machine's filesystem must never answer for that path.
   */
  function handleOpenRepository(path: string): void {
    const target = executionTarget;
    const remote = target !== null && target.kind !== "local";
    const opening =
      target !== null && target.kind !== "local"
        ? writeController.registerRemoteRepository(path, target)
        : writeController.registerRepository(path);
    void opening.then((entry) => {
      launcherTargetSummary = remote ? writeController.lastCreatedTarget : null;
      // The host may have minted a target (or changed one's state); the reads' gate
      // must learn that before the new repository's panels are asked for anything.
      if (remote) void queries.refreshTargets();
      if (entry === null) return;
      // The tab is built from the registration's own answer, not from the repository
      // list: the list is a derived value this callback may read before it caught up.
      const tab = tabForRepository(entry);
      openRepositoryTab(repositoryTabs, tab);
      handleRepositoryTab(repositoryTabKey(tab));
    });
  }

  /**
   * The desktop's second way in: a folder dropped onto the window arrives with the
   * one thing the OS can give and a browser cannot — its full path. It opens on this
   * machine even when an SSH target is selected, because the folder was dragged from
   * this machine's Finder; opening it "on" the remote would answer a different
   * question than the gesture asked.
   */
  function handleDroppedPaths(paths: readonly string[]): void {
    const first = paths[0];
    if (first === undefined || first.trim().length === 0) return;
    const restore = executionTarget;
    executionTarget = null;
    try {
      handleOpenRepository(first.trim());
    } finally {
      executionTarget = restore;
    }
  }

  /**
   * Registers the drag listener only when the adapter's host can see OS drags with
   * real paths (the desktop adapter); the unlistener is the effect's cleanup, so a
   * session change re-subscribes and a disposed session stops listening.
   */
  $effect(() => {
    const host = backendSession?.host;
    if (host?.onDragDropPaths === undefined) return;
    return host.onDragDropPaths((event) => {
      if (event.phase === "drop") {
        dropPathsActive = false;
        handleDroppedPaths(event.paths);
        return;
      }
      dropPathsActive = event.phase !== "leave";
    });
  });

  async function pickLocalFolderViaHost(): Promise<string | null> {
    const host = backendSession?.host;
    if (host === undefined || host === null) return null;
    return host.pickLocalDirectory();
  }

  async function browseRepositoryPath(path: string) {
    return queries.filesystemEntries(path);
  }

  function handleRecentRepository(entry: RecentRepository): void {
    // The entry's own target is what restores a host; the launcher's default stays
    // Local, so a repository is only ever reopened on the machine it was opened with.
    executionTarget = entry.target ?? null;
    launcherTargetSummary = null;
    writeController.clearTargetStatus();
    const remote = executionTarget !== null && executionTarget.kind !== "local";
    if (!remote) {
      const existing = repositoryList.find(
        (item) =>
          item.displayPath === entry.displayPath && item.targetId === undefined,
      );
      if (existing !== undefined) {
        const tab = tabForRepository(existing);
        launcherRequested = false;
        openRepositoryTab(repositoryTabs, tab);
        handleRepositoryTab(repositoryTabKey(tab));
        return;
      }
    }
    // A remote entry re-runs the whole sequence: the host decides whether the target
    // and the registration already exist, and this machine is never asked about the
    // path. Reusing a local registration for the same path would open the wrong machine.
    handleOpenRepository(entry.displayPath);
  }

  function handleNewRepositoryTab(): void {
    if (writeController.busy) return;
    launcherRequested = true;
    launcherOpen = true;
    // Opening the launcher starts on This machine: a host chosen in an earlier visit
    // is never preselected, and only a recent entry restores its own target.
    executionTarget = null;
    launcherTargetSummary = null;
    writeController.clearTargetStatus();
    selectRepository(selection, null);
  }

  function handleRepositoryTab(repositoryId: string): void {
    if (writeController.busy) return;
    launcherRequested = false;
    selectRepositoryTab(repositoryTabs, repositoryId);
    const tab = repositoryTabs.tabs.find(
      (entry) => repositoryTabKey(entry) === repositoryId,
    );
    if (tab === undefined) return;
    selectRepository(selection, tab.repositoryId);
    const worktreeId = tabWorktrees[repositoryId]?.id ?? tab.worktreeId;
    if (worktreeId !== undefined) selectWorktree(selection, worktreeId);
    selection.diffPathId = null;
    launcherOpen = false;
  }

  function closeRepository(repositoryId: string): void {
    if (writeController.busy) return;
    const closing = repositoryTabs.tabs.find(
      (tab) => repositoryTabKey(tab) === repositoryId,
    );
    const wasActive = repositoryTabs.activeRepositoryId === repositoryId;
    closeRepositoryTab(repositoryTabs, repositoryId);
    delete tabWorktrees[repositoryId];
    // The last tab on a machine ends this session's interest in it. Only that target's
    // cached reads are dropped — this machine's and another host's are keyed separately,
    // so they are neither refetched nor cleared by the disconnect.
    const targetId = closing?.targetId;
    if (
      targetId !== undefined &&
      !repositoryTabs.tabs.some((tab) => tab.targetId === targetId)
    ) {
      void writeController
        .disconnectTarget(targetId)
        .then(() => queries.refreshTargets());
    }
    if (wasActive) {
      const nextTab = repositoryTabs.tabs.find(
        (entry) =>
          repositoryTabKey(entry) === repositoryTabs.activeRepositoryId,
      );
      selectRepository(selection, nextTab?.repositoryId ?? null);
      if (nextTab !== undefined) {
        selectWorktree(
          selection,
          tabWorktrees[repositoryTabKey(nextTab)]?.id ??
            nextTab.worktreeId ??
            null,
        );
      }
      selection.diffPathId = null;
      launcherRequested = repositoryTabs.activeRepositoryId === null;
      launcherOpen = repositoryTabs.activeRepositoryId === null;
    }
  }

  function resizeLeftSidebar(delta: number): void {
    leftSidebarWidth = clampSidebarWidth(
      leftSidebarWidth + delta,
      SIDEBAR_WIDTHS.left,
    );
  }

  function resizeRightSidebar(delta: number): void {
    rightSidebarWidth = clampSidebarWidth(
      rightSidebarWidth + delta,
      SIDEBAR_WIDTHS.right,
    );
  }

  function persistSidebarWidths(): void {
    if (!browser) {
      return;
    }
    window.localStorage.setItem(
      "refyard.layout.sidebar.left",
      String(leftSidebarWidth),
    );
    window.localStorage.setItem(
      "refyard.layout.sidebar.right",
      String(rightSidebarWidth),
    );
  }

  // The DOM listener stays at the composition root; query ownership only exposes the
  // invalidation intent and never reaches for `document` itself.
  $effect(() => {
    if (!browser) {
      return;
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        invalidateWorkbenchBackgroundQueries(
          queryClient,
          backendSession?.metadata.cacheNamespace ?? "unconnected",
        );
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  });

  /* --------------------------------------------------------------- mutations */

  /**
   * What this page is allowed to do with the service it found.
   *
   * Session negotiation stays at the composition root because a different service instance
   * invalidates credentials and the whole query cache, not only mutation state.
   */
  const negotiation: Negotiation = $derived(
    identity.data === undefined
      ? { kind: "ok" }
      : negotiateSession(rememberedSessionFor(backendSession), {
          serviceInstanceId: identity.data.serviceInstanceId,
          apiMajor: identity.data.apiMajor,
          contractVersion: capabilities.data?.contractVersion ?? "unknown",
        }),
  );

  $effect(() => {
    const verdict = negotiation;
    if (verdict.kind === "ok") {
      return;
    }
    if (verdict.kind === "differentInstance" && backendSession !== null) {
      void disconnect();
      return;
    }
    if (verdict.kind === "incompatible") {
      queryClient.clear();
    }
  });

  const writeController = createWorkbenchMutations({
    reads: () => backendSession?.git ?? null,
    mutations: () => backendSession?.mutations ?? null,
    host: () => backendSession?.host ?? null,
    cacheNamespace: () =>
      backendSession?.metadata.cacheNamespace ?? "unconnected",
    browserOnline: () => browserOnline,
    negotiation: () => negotiation,
    selection,
    queries,
    queryClient,
    onCommitSucceeded: (repositoryId, worktreeId) => {
      commitDrafts[`${repositoryId}:${worktreeId}`] = "";
    },
  });

  const mutationBusy = $derived(writeController.busy);
  const branchAvailable = $derived(writeController.availability.branch);
  const tagAvailable = $derived(writeController.availability.tag);
  const onBranchCreate = writeController.onBranchCreate;
  const onTagCreate = writeController.onTagCreate;
  const onBranchSwitch = writeController.onBranchSwitch;
  const onBranchMerge = writeController.onBranchMerge;
  const onBranchDelete = writeController.onBranchDelete;
  const onTagDelete = writeController.onTagDelete;
  const onCommitRevert = writeController.onCommitRevert;
  const onCommitReset = writeController.onCommitReset;
  const onWorktreeCreate = writeController.onWorktreeCreate;

  function onCommitCreateBranch(
    commit: CommitSummary,
    branchName: string,
  ): void {
    onBranchCreate(branchName, commit.oid);
  }

  function onCommitCreateTag(
    commit: CommitSummary,
    tagName: string,
    annotation: string | null,
  ): void {
    onTagCreate(tagName, annotation, commit.oid);
  }

  function onCommitCopyOid(commit: CommitSummary): void {
    if (!browser || navigator.clipboard === undefined) {
      return;
    }
    void navigator.clipboard.writeText(commit.oid);
  }

  function onCopyText(text: string): void {
    if (!browser || navigator.clipboard === undefined) {
      return;
    }
    void navigator.clipboard.writeText(text);
  }

  /**
   * The graph's ref-label menus carry only operations that exist: each callback
   * is passed to the commit list only when its operation kind is in the
   * capabilities, so an unavailable operation is absent, not a dead item.
   */
  const graphMenuOperations = $derived(
    new Set(
      (capabilities.data?.operations ?? []).map((operation) => operation.kind),
    ),
  );
  /* ------------------------------------------------------- connection and hints */

  // Browser reachability and live updates are separate signals: navigator.onLine gates
  // writes, while the event stream only reports whether invalidation hints are arriving.
  $effect(() => {
    if (!browser) {
      return;
    }
    return observeBrowserConnectivity(connectivity, {
      isOnline: () => navigator.onLine,
      addEventListener: (type, listener) =>
        window.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        window.removeEventListener(type, listener),
    });
  });

  // Live updates arrive through the session's EventService, so this page never builds an
  // SSE URL, reads a bearer, or calls EventSource itself.
  $effect(() => {
    const session = backendSession;
    if (!browser || session === null) {
      connectivity.streamState = "offline";
      return;
    }
    return startSessionEventStream(connectivity, {
      events: session.events,
      cacheNamespace: session.metadata.cacheNamespace,
      invalidate: (queryKey) => {
        if (queryKey === undefined) {
          void queryClient.invalidateQueries();
        } else {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
    });
  });

  /* --------------------------------------------------------------- helpers */

  /** True while the chosen address is still this page's own origin. */
  const baseUrlIsDefault = $derived(isDefaultSessionBaseUrl(pairing));

  /** The address the pairing form edits; shown only on the HTTP connection panel. */
  const pairingBaseUrl = $derived(pairing.baseUrl);

  const backendLabel = $derived(
    backendSession?.metadata.backendLabel ?? "no backend session",
  );

  /**
   * The desktop shell overlays the native title bar on the page, so the top strip
   * doubles as window chrome: on macOS the traffic lights sit over the page and the
   * strip must clear them with a leading inset. The browser keeps its own edge.
   */
  const desktopChrome = $derived(
    browser && runtime.kind === "tauri" && /Mac/i.test(navigator.platform),
  );

  async function reportInstallFailure(error: unknown): Promise<void> {
    failureBanner = error instanceof Error ? error.message : String(error);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (
      event.key === "Escape" &&
      mainDiffOpen &&
      event.target instanceof HTMLElement &&
      !event.target.closest("input, textarea, [role=dialog]")
    )
      backToHistory();
  }}
/>

<div class="relative flex h-dvh min-h-0 flex-col bg-canvas text-ink">
  {#if background !== "none"}
    <div
      class="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-500"
      style="background-image: url('{background === 'mountain-mist'
        ? '/backgrounds/mountain-mist.svg'
        : background === 'aurora'
          ? '/backgrounds/aurora.svg'
          : background}'); opacity: 0.85;"
    ></div>
  {/if}

  <!-- One strip, GitKraken-style: the repository tabs are the topmost layer, and the
       machine-facing detail lives in the settings gear's sheet. In the desktop shell the
       native title bar is an overlay, so this strip is the window's entire chrome: the
       leading inset clears the traffic lights and the strip itself is the drag region. -->
  <header
    data-tauri-drag-region
    class="relative z-10 flex h-10 shrink-0 items-center gap-2 border-b border-border/80 bg-panel/90 pr-2 pl-2 backdrop-blur-md"
    class:pl-[84px]={desktopChrome}
  >
    {#if backendSession !== null}
      <div
        class="min-w-0 flex-1"
        data-tauri-drag-region
        data-testid="workbench-tabstrip"
      >
        <RepositoryTabs
          tabs={repositoryTabs.tabs.map((tab) => {
            const selected = tabWorktrees[repositoryTabKey(tab)];
            return {
              ...tab,
              repositoryId: repositoryTabKey(tab),
              displayName:
                selected === undefined || tab.worktreeId !== undefined
                  ? tab.displayName
                  : `${tab.displayName} · ${selected.label}`,
              displayPath: selected?.path ?? tab.displayPath,
              // Only a repository on another machine carries one, so two tabs for the
              // same path are told apart by the machine, not by reading the tooltip.
              targetLabel: queries.targetLabelFor(tab.targetId),
            };
          })}
          activeRepositoryId={repositoryTabs.activeRepositoryId}
          disabled={writeController.busy}
          onSelect={handleRepositoryTab}
          onClose={closeRepository}
          onNew={handleNewRepositoryTab}
        />
      </div>
    {:else}
      <span class="flex-1" data-tauri-drag-region></span>
    {/if}

    {#if repository !== null}
      <!-- Every non-interactive element in the strip carries the drag attribute, because
           Tauri starts a drag only when the exact mousedown target has it — an attributed
           parent behind unattributed children drags nothing. Text keeps its tooltip by
           carrying the attribute itself; pure decoration opt out of pointer events. -->
      <div
        class="hidden items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs shadow-2xs backdrop-blur-xs lg:flex"
        data-tauri-drag-region
      >
        <FolderGit2 class="pointer-events-none size-3.5 text-primary" />
        <span
          class="max-w-44 truncate font-semibold tracking-tight text-ink lg:max-w-64"
          title={worktreePath}
          data-tauri-drag-region
        >
          {repository.displayName}
        </span>
        {#if status.data?.head?.branchName}
          <span class="pointer-events-none text-ink-faint">·</span>
          <div
            class="flex items-center gap-1 text-[11px] text-muted-foreground"
            data-tauri-drag-region
          >
            <GitBranch class="pointer-events-none size-3 text-primary/70" />
            <span class="font-medium text-foreground" data-tauri-drag-region
              >{status.data.head.branchName}</span
            >
          </div>
        {/if}
        {#if selectedTargetLabel !== null}
          <!-- The machine is in the header for the same reason it is in the tab: the
               repository name alone cannot tell two machines apart. -->
          <span class="pointer-events-none text-ink-faint">·</span>
          <div
            class="flex items-center gap-1 text-[11px] text-muted-foreground"
            data-testid="repository-target-label"
            data-tauri-drag-region
          >
            <Server class="pointer-events-none size-3 text-primary/70" />
            <span
              class="max-w-40 truncate font-medium text-foreground"
              title={`Git runs on ${selectedTargetLabel}`}
              data-tauri-drag-region>{selectedTargetLabel}</span
            >
          </div>
        {/if}
      </div>
    {/if}

    {#if capabilities.data !== undefined}
      <div class="flex items-center" data-tauri-drag-region>
        {#if capabilities.data.operations.length === 0}
          <Badge
            tone="muted"
            data-testid="build-badge"
            data-tauri-drag-region
            title="No write operations: no route, no capability, no button."
          >
            read-only build
          </Badge>
        {:else}
          <Badge
            tone="branch"
            data-testid="build-badge"
            data-tauri-drag-region
            title={`Implemented write operations: ${capabilities.data.operations
              .map((operation) => operation.kind)
              .join(", ")}`}
          >
            {capabilities.data.operations.length} write operations
          </Badge>
        {/if}
      </div>
    {/if}

    <span class="flex-1" data-tauri-drag-region></span>

    {#if backendSession !== null}
      <Badge
        tone={!browserOnline || negotiation.kind !== "ok"
          ? "warn"
          : streamState === "live"
            ? "branch"
            : "muted"}
        data-testid="connection-state"
        class="pointer-events-none gap-1.5 py-0.5"
      >
        <span class="relative flex size-2">
          <span
            class={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              streamState === "live"
                ? "animate-ping bg-emerald-400"
                : "bg-muted-foreground",
            )}
          ></span>
          <span
            class={cn(
              "relative inline-flex size-2 rounded-full",
              streamState === "live" ? "bg-emerald-500" : "bg-muted-foreground",
            )}
          ></span>
        </span>
        {!browserOnline
          ? "not connected (offline)"
          : negotiation.kind === "incompatible"
            ? "not connected (incompatible service)"
            : negotiation.kind === "readOnlyCompatibility"
              ? "read-only (contract update available)"
              : streamState === "live"
                ? "live updates"
                : streamState === "connecting"
                  ? "connecting…"
                  : "no live updates"}
      </Badge>
      <SettingsDialog
        {accent}
        {background}
        {glass}
        {avatars}
        {density}
        onAccentChange={(val) => (accent = val)}
        onBackgroundChange={(val) => (background = val)}
        onGlassChange={(val) => (glass = val)}
        onAvatarsChange={(val) => (avatars = val)}
        onDensityChange={(val) => (density = val)}
        updates={updatesProbe ?? undefined}
        {autoCheck}
        onAutoCheckChange={(enabled) => {
          autoCheck = enabled;
          storeUpdateCheck(enabled);
        }}
        about={capabilities.data === undefined
          ? undefined
          : {
              appVersion,
              gitVersion: capabilities.data.git.version,
              serviceInstanceId: capabilities.data.serviceInstanceId,
              backendLabel,
              operations: capabilities.data.operations.length,
            }}
        onDisconnect={runtime.kind === "http" ? disconnect : undefined}
      />
    {/if}
  </header>

  {#if sessionExpired}
    <div class="border-b border-border bg-panel px-4 py-2">
      <StateBanner
        state="disconnected"
        title="The session is no longer valid"
        detail={connectionState.problem?.message ??
          "The service was restarted or the session expired. Pair again with a fresh ticket."}
      >
        {#snippet action()}
          <Button size="sm" variant="outline" onclick={disconnect}
            >Pair again</Button
          >
        {/snippet}
      </StateBanner>
    </div>
  {/if}

  {#if failureBanner.length > 0}
    <div class="relative z-10 border-b border-border bg-panel px-4 py-2">
      <StateBanner
        state="error"
        title="The update could not be installed"
        detail={failureBanner}
      />
    </div>
  {/if}

  {#if pendingUpdate !== null}
    <div class="relative z-10 border-b border-border bg-panel px-4 py-2">
      <StateBanner
        state="loading"
        title={pendingUpdate.version === null
          ? "An update is available"
          : `Update to v${pendingUpdate.version} is available`}
        detail="Download and install, then restart to run it. Nothing is installed until you say so."
      >
        {#snippet action()}
          <Button
            size="sm"
            variant="outline"
            onclick={() => {
              const offer = pendingUpdate;
              if (offer === null) return;
              pendingUpdate = null;
              void offer
                .install()
                .then(() => offer.relaunch())
                .catch((error: unknown) => {
                  void reportInstallFailure(error);
                });
            }}
          >
            Install and restart
          </Button>
        {/snippet}
      </StateBanner>
    </div>
  {/if}

  {#if backendSession === null}
    <main class="flex-1 overflow-auto p-6">
      {#if runtime.kind === "tauri"}
        <StateBanner
          state={pairing.pairPhase === "failed" ? "error" : "loading"}
          title={pairing.pairPhase === "failed"
            ? "The local service is unavailable"
            : "Starting the local service…"}
          detail={pairing.pairPhase === "failed"
            ? (pairing.pairMessage ??
              "The native host did not accept a session for this window.")
            : undefined}
        >
          {#snippet action()}
            <Button
              size="sm"
              variant="outline"
              onclick={() => void runtime.start()}>Retry</Button
            >
          {/snippet}
        </StateBanner>
      {:else}
        <ConnectionPanel
          baseUrl={pairingBaseUrl}
          ticket={pairing.ticket}
          hosted={!baseUrlIsDefault}
          password={pairing.hostedPassword}
          phase={pairing.pairPhase}
          message={pairing.pairMessage}
          {baseUrlIsDefault}
          onBaseUrl={(value) => {
            pairing.baseUrl = value;
          }}
          onTicket={(value) => {
            pairing.ticket = value;
          }}
          onPassword={(value) => {
            pairing.hostedPassword = value;
          }}
          onConnect={() => void pair()}
        />
      {/if}
    </main>
  {:else}
    <main
      class="relative z-1 flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:overflow-visible lg:grid-cols-[var(--left-sidebar-width)_minmax(0,1fr)_var(--right-sidebar-width)]"
      style={`--left-sidebar-width: ${mainDiffOpen ? 0 : leftSidebarWidth}px; --right-sidebar-width: ${rightSidebarWidth}px;`}
      data-launcher-open={launcherOpen}
      data-selected-repository={selectedRepositoryId ?? ""}
      data-repository-count={repositoryList.length}
      data-tab-count={repositoryTabs.tabs.length}
    >
      {#if launcherOpen || selectedRepositoryId === null}
        <section
          class="min-w-0 flex-1 overflow-y-auto lg:col-span-3"
          data-testid="repository-launcher-panel"
        >
          {#if queries.repositories.isError}
            <div class="p-3" data-testid="repository-list-error">
              <StateBanner
                state="error"
                title="Could not list repositories"
                detail={describeBackendProblem(queries.repositories.error)}
              />
            </div>
          {/if}
          {#if queries.capabilities.isError}
            <div class="p-3" data-testid="capabilities-error">
              <StateBanner
                state="error"
                title="Write capabilities unavailable"
                detail="the service has not reported its operations"
              />
            </div>
          {/if}
          <RepositoryLauncher
            recent={recentRepositories}
            roots={queries.workspaceRoots}
            repositoryCreationAvailable={writeController.availability
              .repositoryCreation}
            disabled={!writeController.writesAllowed}
            busy={writeController.busy}
            message={writeController.repositoryAccessMessage ??
              writeController.repositoryMessage}
            onOpen={handleOpenRepository}
            onPickLocalFolder={pickLocalFolderViaHost}
            {dropPathsActive}
            onBrowse={browseRepositoryPath}
            onRecent={handleRecentRepository}
            onInit={writeController.onRepositoryInit}
            onClone={writeController.onRepositoryClone}
            hostService={backendSession?.host ?? null}
            selectedTarget={executionTarget}
            selectedTargetSummary={launcherTargetSummary}
            targetProgress={writeController.targetProgress}
            targetError={writeController.targetMessage}
            onSelectTarget={(target) => {
              executionTarget = target;
              launcherTargetSummary = null;
              writeController.clearTargetStatus();
            }}
          />
        </section>
      {:else}
        <div
          class={mainDiffOpen
            ? "hidden min-h-0 min-w-0 overflow-hidden lg:block"
            : "flex min-h-0 min-w-0 flex-col overflow-hidden"}
        >
          <div class={mainDiffOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
            <RepositorySidebar
              {queries}
              mutations={writeController}
              {selection}
              sessionReady={backendSession !== null}
              describeProblem={describeBackendProblem}
              onRepositorySelect={selectRegisteredRepository}
              onOpenWorktree={(id) => openWorktree(id)}
              onOpenWorktreeInTab={(id) => openWorktree(id, true)}
              onWorkingCopy={backToHistory}
            />
          </div>
        </div>
        <section
          class={mainDiffOpen
            ? "hidden"
            : "flex h-[44rem] min-h-[32rem] min-w-0 shrink-0 flex-col gap-2 p-3 lg:h-auto lg:min-h-0"}
          data-testid="history-panel"
        >
          <div class="shrink-0 flex items-center gap-2">
            <h2 class="text-sm font-semibold">History</h2>
            {#if repository !== null}
              <span
                class="truncate font-mono text-xs text-ink-faint"
                title={repository.displayPath}
              >
                {repository.displayName}
              </span>
            {/if}
            <span class="flex-1"></span>
            <Button
              size="sm"
              variant="ghost"
              class="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              disabled={history.isFetching}
              onclick={() => void history.refetch()}
            >
              <RefreshCw
                class={cn("size-3.5", history.isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          </div>

          <WorktreeWipList
            worktrees={queries.worktrees.data?.worktrees ?? []}
            {activeWorktreeId}
            statuses={queries.worktreeStatuses}
            disabled={writeController.busy}
            onSelect={(id) => openWorktree(id)}
          />
          <HistoryFilterBar
            draft={historyFilterState.draft}
            appliedLabels={historyFilterLabels(historyFilterState)}
            appliedPath={historyFilterState.appliedPath}
            error={historyFilterState.error}
            onDraftChange={(draft) => (historyFilterState.draft = draft)}
            refs={[
              ...(refs.data?.branches ?? []),
              ...(refs.data?.remoteBranches ?? []),
              ...(refs.data?.tags ?? []),
            ].map((ref) => ({ fullName: ref.fullName, displayName: ref.name }))}
            paths={status.data?.entries ?? []}
            disabled={selectedRepositoryId === null}
            onApply={applyHistorySearch}
            onClear={clearHistorySearch}
          />
          {#if queries.historyTopology === "sparse"}<p
              class="shrink-0 text-xs text-muted-foreground"
            >
              Filtered history · graph hidden
            </p>{/if}

          {#if selectedRepositoryId === null}
            <StateBanner state="empty" title="No repository selected" />
          {:else if history.isPending}
            <StateBanner state="loading" title="Reading history…" />
          {:else if history.isError}
            <StateBanner
              state="error"
              title="Could not read history"
              detail={describeBackendProblem(history.error)}
            >
              {#snippet action()}
                <Button
                  size="sm"
                  variant="outline"
                  onclick={() => void history.refetch()}
                >
                  Retry
                </Button>
              {/snippet}
            </StateBanner>
          {:else}
            <CommitList
              rows={graph.rows}
              topology={queries.historyTopology}
              filtered={historyFiltersActive(historyFilterState.applied)}
              {commits}
              {selectedOid}
              hasMore={history.hasNextPage}
              loadingMore={history.isFetchingNextPage}
              tipsMoved={historyNotices.tipsMoved}
              shallow={historyNotices.shallow}
              laneCount={graph.laneCount}
              onSelect={(commit) => {
                selectCommit(selection, commit.oid);
              }}
              onLoadMore={() => void history.fetchNextPage()}
              contextDisabled={mutationBusy}
              onCreateBranchAt={branchAvailable
                ? onCommitCreateBranch
                : undefined}
              onCreateTagAt={tagAvailable ? onCommitCreateTag : undefined}
              onCopyOid={onCommitCopyOid}
              {onCopyText}
              currentBranch={status.data?.head?.branchName ?? null}
              wip={status.data?.worktreeId === activeWorktreeId &&
              (status.data?.entries.length ?? 0) > 0
                ? {
                    changedCount: status.data?.entries.length ?? 0,
                    onSelect: backToHistory,
                  }
                : null}
              onCheckoutBranch={graphMenuOperations.has("switchBranch")
                ? (branchName) => onBranchSwitch(branchName)
                : undefined}
              onMergeBranch={graphMenuOperations.has("merge")
                ? (branchName) => onBranchMerge(branchName, false)
                : undefined}
              onDeleteBranch={graphMenuOperations.has("deleteBranch")
                ? (branchName) => onBranchDelete(branchName)
                : undefined}
              onDeleteTag={graphMenuOperations.has("deleteTag")
                ? (tagName) => onTagDelete(tagName)
                : undefined}
              onRevertCommit={graphMenuOperations.has("revertCommit")
                ? (commit) => onCommitRevert(commit.oid)
                : undefined}
              onResetBranch={graphMenuOperations.has("resetBranch")
                ? (commit, mode) => onCommitReset(commit.oid, mode)
                : undefined}
              onCreateWorktreeAt={graphMenuOperations.has("createWorktree")
                ? (commit, relativeDestination, branchName) =>
                    onWorktreeCreate(relativeDestination, {
                      kind: "newBranch",
                      branchName,
                      startOid: commit.oid,
                    })
                : undefined}
              showAvatars={avatars}
              {remoteAvatars}
              metrics={historyMetrics}
              {githubRemoteUrl}
              class="min-h-0 flex-1"
            />
          {/if}
        </section>

        {#if mainDiffOpen}
          <section
            class="flex h-[44rem] min-h-0 min-w-0 flex-col lg:h-auto"
            data-testid="main-diff-panel"
          >
            <header
              class="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2"
            >
              <Button variant="ghost" size="sm" onclick={backToHistory}
                >Back to history</Button
              >
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs"
                title={selectedPath?.displayPath ?? ""}
                >{selectedPath?.displayPath ?? "Commit diff"}</span
              >
              {#if selectedPath !== null && selectedPath.kind !== "ignored" && writeController.availability.staging}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={writeController.busy ||
                    !writeController.writesAllowed ||
                    status.isError ||
                    status.data === undefined}
                  onclick={() => {
                    if (selectedPath !== null) {
                      if (selection.statusSide === "staged")
                        writeController.onUnstage([selectedPath.pathId]);
                      else writeController.onStage([selectedPath.pathId]);
                    }
                  }}
                >
                  {selection.statusSide === "staged"
                    ? "Unstage file"
                    : "Stage file"}
                </Button>
              {/if}
            </header>
            {#if diff.isPending}
              <div class="p-3">
                <StateBanner state="loading" title="Reading diff…" />
              </div>
            {:else if diff.isError || diffPatch.isError}
              <div class="p-3">
                <StateBanner
                  state="error"
                  title="Could not read diff"
                  detail={describeBackendProblem(diff.error ?? diffPatch.error)}
                />
              </div>
            {:else}
              <DiffPanel
                diff={diff.data ?? null}
                patch={diffPatch.data ?? null}
                selectedPathId={selectedDiffPathId ??
                  selectedPath?.pathId ??
                  null}
                onlySelected={true}
                onSelectPath={(file) => selectDiffPath(selection, file.pathId)}
                class="p-3"
              />
            {/if}
          </section>
        {/if}
        <section
          class="flex min-h-80 min-w-0 flex-col overflow-hidden border-l border-border bg-panel p-3 lg:min-h-0"
          data-testid="working-copy-sidebar"
        >
          {#if selectedOid !== null}
            <div
              class="flex items-center justify-between border-b border-border px-3 py-2"
            >
              <span class="text-sm font-medium">Commit details</span>
              <Button size="sm" variant="ghost" onclick={backToHistory}
                >Working copy</Button
              >
            </div>
            <CommitDetailPanel
              commit={selectedCommit}
              {detail}
              class="max-h-72 shrink-0 overflow-auto border-b border-border"
            />
            <DiffPanel
              diff={diff.data ?? null}
              selectedPathId={selectedDiffPathId}
              listingOnly={true}
              onSelectPath={(file) => selectDiffPath(selection, file.pathId)}
              class="p-3"
            />
          {/if}
          <div
            class={selectedOid === null
              ? "flex min-h-0 flex-1 flex-col"
              : "hidden"}
          >
            {#if status.isError}
              <div class="p-3">
                <StateBanner
                  state="error"
                  title="Could not read working copy"
                  detail={describeBackendProblem(status.error)}
                />
              </div>
            {/if}
            {#if writeController.uncertainBlock !== null}
              <div class="p-3 pb-0">
                <UncertainOutcomePanel
                  reason={writeController.uncertainBlock.reason}
                  operationIds={writeController.uncertainBlock.operationIds}
                  note={writeController.uncertainNote ?? undefined}
                  busy={writeController.busy}
                  onAcknowledge={() =>
                    void writeController.onAcknowledgeUncertain()}
                />
              </div>
            {/if}
            <WorkingCopyPanel
              status={status.data?.worktreeId === activeWorktreeId
                ? status.data
                : null}
              {worktreeLabel}
              {worktreePath}
              selectedPathId={selectedPath?.pathId ?? null}
              selectedSide={selection.statusSide}
              disabled={!writeController.writesAllowed ||
                status.isError ||
                status.data === undefined ||
                status.data.worktreeId !== activeWorktreeId}
              busy={writeController.busy}
              stagingAvailable={writeController.availability.staging}
              commitAvailable={writeController.availability.commit}
              stagingMessage={writeController.stagingMessage}
              commitMessage={writeController.commitResult}
              draft={commitDrafts[draftKey] ?? ""}
              onDraftChange={(text) => (commitDrafts[draftKey] = text)}
              onSelect={(entry, side) =>
                selectStatusPath(selection, entry, side)}
              onStage={writeController.onStage}
              onUnstage={writeController.onUnstage}
              onDiscard={writeController.onDiscard}
              onCommit={writeController.onCommit}
              onAmend={writeController.onAmend}
            />
          </div>
        </section>
        {#if !mainDiffOpen}
          <ResizeHandle
            side="left"
            onResize={resizeLeftSidebar}
            onResizeEnd={persistSidebarWidths}
            style={`left: ${leftSidebarWidth}px`}
          />
        {/if}
        <ResizeHandle
          side="right"
          onResize={resizeRightSidebar}
          onResizeEnd={persistSidebarWidths}
          style={`right: ${rightSidebarWidth}px`}
        />
      {/if}
    </main>
  {/if}
</div>
