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
  import type { CommitSummary } from "@refyard/git-contract";
  import {
    AppearanceSettings,
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
    ModeToggle,
    RefyardLogo,
    StateBanner,
    cn,
    shortOid,
    type ExecutionTargetSelection,
  } from "@refyard/git-ui";
  import { FileDiff, FolderGit2, GitBranch, RefreshCw } from "@lucide/svelte";
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
  } from "$lib/workbench/repository-tabs.js";
  import type { RecentRepository } from "$lib/workbench/repository-launcher.js";
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
  } from "$lib/storage.js";
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

  let accent = $state(browser ? readStoredAccent() : "default");
  let background = $state(browser ? readStoredBackground() : "none");
  let glass = $state(browser ? readStoredGlass() : false);

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
   * Where the next repository open runs. The page only holds the choice the launcher
   * reported and passes it back: creating and connecting the target belongs to the
   * host service, which a later milestone calls with this selection.
   */
  let executionTarget = $state<ExecutionTargetSelection | null>(null);
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

  const repository = $derived(queries.repository);
  const repositoryList = $derived(queries.repositoryList);
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
    const unseen = repositoryList
      .filter((entry) => !knownRepositoryIds.includes(entry.repositoryId))
      .map((entry) => ({
        repositoryId: entry.repositoryId,
        displayName: entry.displayName,
        displayPath: entry.displayPath,
      }));
    if (unseen.length > 0) {
      knownRepositoryIds = [
        ...knownRepositoryIds,
        ...unseen.map((entry) => entry.repositoryId),
      ];
      repositoryTabs.tabs = [...repositoryTabs.tabs, ...unseen];
      repositoryTabs.activeRepositoryId ??= unseen[0]?.repositoryId ?? null;
      repositoryTabs.revision += 1;
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
      openRepositoryTab(repositoryTabs, {
        repositoryId: entry.repositoryId,
        displayName: entry.displayName,
        displayPath: entry.displayPath,
      });
    }
  });

  function selectRegisteredRepository(repositoryId: string): void {
    const entry = repositoryList.find(
      (item) => item.repositoryId === repositoryId,
    );
    if (entry === undefined || writeController.busy) return;
    openRepositoryTab(repositoryTabs, {
      repositoryId,
      displayName: entry.displayName,
      displayPath: entry.displayPath,
    });
    handleRepositoryTab(repositoryId);
  }

  function rememberRecent(entry: RecentRepository): void {
    const next = [
      entry,
      ...recentRepositories.filter(
        (item) => item.displayPath !== entry.displayPath,
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
    if (
      entry !== undefined &&
      !recentRepositories.some(
        (item) => item.displayPath === entry.displayPath && item.available,
      )
    ) {
      rememberRecent({
        repositoryId: entry.repositoryId,
        displayName: entry.displayName,
        displayPath: entry.displayPath,
        lastOpenedAt: new Date().toISOString(),
        available: true,
        ...(executionTarget === null ? {} : { target: executionTarget }),
      });
    }
  });

  function handleOpenRepository(path: string): void {
    void writeController.registerRepository(path).then((opened) => {
      if (opened) {
        const entry = repositoryList.find(
          (item) => item.repositoryId === selection.repositoryId,
        );
        if (entry !== undefined) {
          openRepositoryTab(repositoryTabs, {
            repositoryId: entry.repositoryId,
            displayName: entry.displayName,
            displayPath: entry.displayPath,
          });
          handleRepositoryTab(entry.repositoryId);
        }
      }
    });
  }

  async function browseRepositoryPath(path: string) {
    return queries.filesystemEntries(path);
  }

  function handleRecentRepository(entry: RecentRepository): void {
    // The entry's own target is what restores a host; the launcher's default stays
    // Local, so a repository is only ever reopened on the machine it was opened with.
    executionTarget = entry.target ?? null;
    const existing = repositoryList.find(
      (item) => item.displayPath === entry.displayPath,
    );
    if (existing !== undefined) {
      launcherRequested = false;
      openRepositoryTab(repositoryTabs, {
        repositoryId: existing.repositoryId,
        displayName: existing.displayName,
        displayPath: existing.displayPath,
      });
      handleRepositoryTab(existing.repositoryId);
      return;
    }
    handleOpenRepository(entry.displayPath);
  }

  function handleNewRepositoryTab(): void {
    if (writeController.busy) return;
    launcherRequested = true;
    launcherOpen = true;
    // Opening the launcher starts on This machine: a host chosen in an earlier visit
    // is never preselected, and only a recent entry restores its own target.
    executionTarget = null;
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
    const wasActive = repositoryTabs.activeRepositoryId === repositoryId;
    closeRepositoryTab(repositoryTabs, repositoryId);
    delete tabWorktrees[repositoryId];
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

  /* ------------------------------------------------------------------ clock */

  let now = $state(Date.now());
  $effect(() => {
    const handle = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => {
      clearInterval(handle);
    };
  });

  /* --------------------------------------------------------------- helpers */

  /** True while the chosen address is still this page's own origin. */
  const baseUrlIsDefault = $derived(isDefaultSessionBaseUrl(pairing));

  /** The address the pairing form edits; shown only on the HTTP connection panel. */
  const pairingBaseUrl = $derived(pairing.baseUrl);

  const backendLabel = $derived(
    backendSession?.metadata.backendLabel ?? "no backend session",
  );
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

  <header
    class="relative z-10 flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 py-2 sm:flex-wrap sm:py-2 border-b border-border/80 bg-panel/90 px-4 backdrop-blur-md"
  >
    <div class="flex items-center gap-2">
      <RefyardLogo variant="mark" size={22} />
      <span class="text-sm font-semibold tracking-tight">refyard</span>

      {#if capabilities.data !== undefined}
        <span
          class="hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:flex"
        >
          <span class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px]"
            >git {capabilities.data.git.version}</span
          >
          <span class="text-ink-faint">·</span>
          <span
            class="font-mono text-[11px] text-ink-faint"
            title="service instance"
            >{shortOid(capabilities.data.serviceInstanceId)}</span
          >
        </span>
      {/if}
    </div>

    {#if backendSession !== null}
      <div class="order-last basis-full min-w-0 border-t border-border/60 pt-1">
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
            };
          })}
          activeRepositoryId={repositoryTabs.activeRepositoryId}
          disabled={writeController.busy}
          onSelect={handleRepositoryTab}
          onClose={closeRepository}
          onNew={handleNewRepositoryTab}
        />
      </div>
    {/if}

    {#if repository !== null}
      <div
        class="hidden items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs shadow-2xs backdrop-blur-xs md:flex"
      >
        <FolderGit2 class="size-3.5 text-primary" />
        <span
          class="max-w-44 truncate font-semibold tracking-tight text-ink lg:max-w-64"
          title={worktreePath}
        >
          {repository.displayName}
        </span>
        {#if status.data?.head?.branchName}
          <span class="text-ink-faint">·</span>
          <div
            class="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <GitBranch class="size-3 text-primary/70" />
            <span class="font-medium text-foreground"
              >{status.data.head.branchName}</span
            >
          </div>
        {/if}
      </div>
    {/if}

    {#if capabilities.data !== undefined}
      <div class="flex items-center">
        {#if capabilities.data.operations.length === 0}
          <Badge
            tone="muted"
            data-testid="build-badge"
            title="No write operations: no route, no capability, no button."
          >
            read-only build
          </Badge>
        {:else}
          <Badge
            tone="branch"
            data-testid="build-badge"
            title={`Implemented write operations: ${capabilities.data.operations
              .map((operation) => operation.kind)
              .join(", ")}`}
          >
            {capabilities.data.operations.length} write operations
          </Badge>
        {/if}
      </div>
    {/if}

    <span class="flex-1"></span>

    {#if backendSession !== null}
      <Badge
        tone={!browserOnline || negotiation.kind !== "ok"
          ? "warn"
          : streamState === "live"
            ? "branch"
            : "muted"}
        data-testid="connection-state"
        class="gap-1.5 py-0.5"
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
      <span
        class="hidden font-mono text-xs text-ink-faint 2xl:inline"
        title="backend">{backendLabel}</span
      >
      <AppearanceSettings
        {accent}
        {background}
        {glass}
        onAccentChange={(val) => (accent = val)}
        onBackgroundChange={(val) => (background = val)}
        onGlassChange={(val) => (glass = val)}
      />
      <ModeToggle />
      {#if runtime.kind === "http"}
        <Button size="sm" variant="ghost" onclick={disconnect}
          >Disconnect</Button
        >
      {/if}
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
            onBrowse={browseRepositoryPath}
            onRecent={handleRecentRepository}
            onInit={writeController.onRepositoryInit}
            onClone={writeController.onRepositoryClone}
            hostService={backendSession?.host ?? null}
            selectedTarget={executionTarget}
            onSelectTarget={(target) => (executionTarget = target)}
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
              {now}
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
