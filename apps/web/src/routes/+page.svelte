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
   * Reads, explicit approvals and submitted operations are composed here. The page does
   * not build Git commands: it sends closed contract intentions through the injected
   * clients, and capabilities decide which controls are visible.
   */
  import { browser } from "$app/environment";
  import { createGitClient } from "@refyard/git-client";
  import type { CommitSummary } from "@refyard/git-contract";
  import {
    AppearanceSettings,
    Badge,
    BranchPanel,
    Button,
    CommitDetailPanel,
    CommitList,
    CommitPanel,
    ConflictPanel,
    ConnectionPanel,
    DiffPanel,
    ModeToggle,
    RefsPanel,
    RefyardLogo,
    RepositoryAccessPanel,
    RemotePanel,
    RepositoryList,
    RepositoryPanel,
    SectionCard,
    Separator,
    StagingPanel,
    StashPanel,
    StateBanner,
    StatusList,
    SubmodulePanel,
    TagPanel,
    WorktreePanel,
    cn,
    shortOid,
  } from "@refyard/git-ui";
  import {
    Archive,
    Boxes,
    FileDiff,
    FolderGit2,
    GitBranch,
    GitCommit,
    Globe,
    Layers,
    RefreshCw,
    Tag,
  } from "@lucide/svelte";
  import { useQueryClient } from "@tanstack/svelte-query";
  import {
    clearWorkbenchCredentials,
    consumeInitialPairingUrl,
    createWorkbenchSessionState,
    describeClientProblem,
    isDefaultSessionBaseUrl,
    pairWorkbenchSession,
    type WorkbenchSessionPorts,
  } from "$lib/workbench/session.js";
  import {
    createWorkbenchConnectivityState,
    observeBrowserConnectivity,
    startWorkbenchEventStream,
  } from "$lib/workbench/connectivity.js";
  import {
    clearInspectableSelection,
    clearRepositoryIfSelected,
    createWorkbenchSelectionState,
    selectCommit,
    selectDiffPath,
    selectRepository,
    selectStatusPath,
  } from "$lib/workbench/selection.js";
  import {
    createWorkbenchQueries,
    invalidateWorkbenchBackgroundQueries,
  } from "$lib/workbench/queries.svelte.js";
  import { createWorkbenchMutations } from "$lib/workbench/mutations.svelte.js";
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
    type Negotiation,
  } from "$lib/session-negotiation.js";

  /* ------------------------------------------------------- runtime connection */

  const session = $state(
    createWorkbenchSessionState({
      href: browser ? window.location.href : "http://127.0.0.1:47831/",
      storedBaseUrl: browser ? readStoredBaseUrl() : null,
      storedToken: browser ? readStoredToken() : null,
      storedInstance: browser ? readStoredInstance() : null,
    }),
  );
  const baseUrl = $derived(session.baseUrl);
  const token = $derived(session.token);
  const pairedInstance = $derived(session.pairedInstance);
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

  // Rebuilt when the address changes: the client holds the base URL, and a stale one would
  // send every later request to the previous service.
  const client = $derived(
    createGitClient({
      baseUrl,
      fetch: (input, init) => fetch(input, init),
      token: () => token,
    }),
  );

  const sessionPorts: WorkbenchSessionPorts = {
    exchangeTicket: (value, password) => client.exchangeTicket(value, password),
    health: () => client.health(),
    storeToken,
    storeInstance,
    storeBaseUrl,
    clearStoredSession,
    currentHref: () =>
      browser ? window.location.href : `${session.initialBaseUrl}/`,
    replaceHref: (href) => {
      if (browser) {
        window.history.replaceState({}, "", href);
      }
    },
  };

  async function pair(): Promise<void> {
    await pairWorkbenchSession(session, sessionPorts);
  }

  function disconnect(): void {
    clearWorkbenchCredentials(session, sessionPorts);
    clearInspectableSelection(selection);
    queryClient.clear();
  }

  // A pairing URL is meant to work by being opened. The controller handles both the
  // current query spelling and legacy fragments, including immediate URL scrubbing.
  $effect(() => {
    if (browser) {
      void consumeInitialPairingUrl(session, sessionPorts);
    }
  });

  /* ------------------------------------------------------------------- reads */

  const selection = $state(createWorkbenchSelectionState());
  const selectedRepositoryId = $derived(selection.repositoryId);
  const selectedOid = $derived(selection.commitOid);
  const selectedPath = $derived(selection.statusPath);
  const selectedDiffPathId = $derived(selection.diffPathId);

  function pageVisible(): boolean {
    return (
      typeof document === "undefined" || document.visibilityState !== "hidden"
    );
  }

  const queries = createWorkbenchQueries({
    client: () => client,
    baseUrl: () => baseUrl,
    token: () => token,
    selection,
    visible: pageVisible,
  });
  const capabilities = queries.capabilities;
  const repositories = queries.repositories;
  const status = queries.status;
  const refs = queries.refs;
  const stashes = queries.stashes;
  const worktrees = queries.worktrees;
  const submodules = queries.submodules;
  const history = queries.history;
  const diff = queries.diff;
  const diffPatch = queries.diffPatch;
  const identity = queries.identity;

  const repositoryList = $derived(queries.repositoryList);
  const workspaceRoots = $derived(queries.workspaceRoots);
  const repository = $derived(queries.repository);
  const displayedStashes = $derived(queries.displayedStashes);
  const stashPanelAvailable = $derived(queries.stashPanelAvailable);
  const commits = $derived(queries.commits);
  const graph = $derived(queries.graph);
  const historyNotices = $derived(queries.historyNotices);
  const selectedCommit = $derived(queries.selectedCommit);
  const detail = $derived(queries.detail);
  const diffRequest = $derived(queries.diffRequest);
  const sessionExpired = $derived(queries.sessionExpired);
  const primaryWorktreeId = $derived(queries.primaryWorktreeId);

  // The DOM listener stays at the composition root; query ownership only exposes the
  // invalidation intent and never reaches for `document` itself.
  $effect(() => {
    if (!browser) {
      return;
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        invalidateWorkbenchBackgroundQueries(queryClient);
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
      : negotiateSession(
          { instanceId: pairedInstance, hasToken: token !== null },
          {
            serviceInstanceId: identity.data.serviceInstanceId,
            apiMajor: identity.data.apiMajor,
            contractVersion: capabilities.data?.contractVersion ?? "unknown",
          },
        ),
  );

  $effect(() => {
    const verdict = negotiation;
    if (verdict.kind === "ok") {
      return;
    }
    if (verdict.kind === "differentInstance" && token !== null) {
      clearWorkbenchCredentials(session, sessionPorts);
      queryClient.clear();
      return;
    }
    if (verdict.kind === "incompatible") {
      queryClient.clear();
    }
  });

  const writeController = createWorkbenchMutations({
    client: () => client,
    baseUrl: () => baseUrl,
    token: () => token,
    browserOnline: () => browserOnline,
    negotiation: () => negotiation,
    selection,
    queries,
    queryClient,
    fetch: (input, init) => fetch(input, init),
  });

  const mutationBusy = $derived(writeController.busy);
  const writesAllowed = $derived(writeController.writesAllowed);
  const stagingAvailable = $derived(writeController.availability.staging);
  const commitAvailable = $derived(writeController.availability.commit);
  const branchAvailable = $derived(writeController.availability.branch);
  const networkAvailable = $derived(writeController.availability.network);
  const stashAvailable = $derived(writeController.availability.stash);
  const tagAvailable = $derived(writeController.availability.tag);
  const worktreeAvailable = $derived(writeController.availability.worktree);
  const submoduleAvailable = $derived(writeController.availability.submodule);
  const mergeAvailable = $derived(writeController.availability.merge);
  const repositoryCreationAvailable = $derived(
    writeController.availability.repositoryCreation,
  );
  const operationInProgress = $derived(writeController.operationInProgress);
  const conflictedPaths = $derived(writeController.conflictedPaths);
  const branchNames = $derived(writeController.branchNames);

  const repositoryMessage = $derived(writeController.repositoryMessage);
  const repositoryAccessMessage = $derived(
    writeController.repositoryAccessMessage,
  );
  const stagingMessage = $derived(writeController.stagingMessage);
  const commitResult = $derived(writeController.commitResult);
  const branchMessage = $derived(writeController.branchMessage);
  const remoteMessage = $derived(writeController.remoteMessage);
  const worktreeMessage = $derived(writeController.worktreeMessage);
  const submoduleMessage = $derived(writeController.submoduleMessage);
  const mergeMessage = $derived(writeController.mergeMessage);
  const stashResult = $derived(writeController.stashResult);
  const tagResult = $derived(writeController.tagResult);

  const onRepositoryInit = writeController.onRepositoryInit;
  const onRepositoryClone = writeController.onRepositoryClone;
  const registerRepository = writeController.registerRepository;
  const revokeRepository = writeController.revokeRepository;
  const onStage = writeController.onStage;
  const onUnstage = writeController.onUnstage;
  const onDiscard = writeController.onDiscard;
  const onCommit = writeController.onCommit;
  const onAmend = writeController.onAmend;
  const onBranchCreate = writeController.onBranchCreate;
  const onBranchSwitch = writeController.onBranchSwitch;
  const onBranchRename = writeController.onBranchRename;
  const onBranchDelete = writeController.onBranchDelete;
  const onBranchSetUpstream = writeController.onBranchSetUpstream;
  const onBranchMerge = writeController.onBranchMerge;
  const onMergeContinue = writeController.onMergeContinue;
  const onMergeAbort = writeController.onMergeAbort;
  const onRemoteAdd = writeController.onRemoteAdd;
  const onRemoteUpdate = writeController.onRemoteUpdate;
  const onRemoteRemove = writeController.onRemoteRemove;
  const onFetch = writeController.onFetch;
  const onPush = writeController.onPush;
  const onPull = writeController.onPull;
  const onStashCreate = writeController.onStashCreate;
  const onStashApply = writeController.onStashApply;
  const onStashPop = writeController.onStashPop;
  const onStashDrop = writeController.onStashDrop;
  const onTagCreate = writeController.onTagCreate;
  const onTagDelete = writeController.onTagDelete;
  const onTagPush = writeController.onTagPush;

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
  const onWorktreeCreate = writeController.onWorktreeCreate;
  const onWorktreeRemove = writeController.onWorktreeRemove;
  const onWorktreeLock = writeController.onWorktreeLock;
  const onWorktreeUnlock = writeController.onWorktreeUnlock;
  const onSubmoduleAdd = writeController.onSubmoduleAdd;
  const onSubmoduleUpdate = writeController.onSubmoduleUpdate;
  const onSubmoduleSync = writeController.onSubmoduleSync;

  /* ------------------------------------------------------- connection and hints */

  // Browser reachability and SSE are separate signals: navigator.onLine gates writes,
  // while the event stream only reports whether live invalidation hints are arriving.
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

  $effect(() => {
    if (!browser) {
      connectivity.streamState = "offline";
      return;
    }
    return startWorkbenchEventStream(connectivity, {
      baseUrl,
      token: () => token,
      fetch: (input, init) => fetch(input, init),
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
  const baseUrlIsDefault = $derived(isDefaultSessionBaseUrl(session));
</script>

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
    class="relative z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-panel/90 px-4 backdrop-blur-md"
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

    {#if repository !== null}
      <div
        class="hidden items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs shadow-2xs backdrop-blur-xs md:flex"
      >
        <FolderGit2 class="size-3.5 text-primary" />
        <span
          class="max-w-44 truncate font-semibold tracking-tight text-ink lg:max-w-64"
          title={repository.displayPath}
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

    {#if token !== null}
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
        title="service address">{baseUrl}</span
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
      <Button size="sm" variant="ghost" onclick={disconnect}>Disconnect</Button>
    {/if}
  </header>

  {#if sessionExpired}
    <div class="border-b border-border bg-panel px-4 py-2">
      <StateBanner
        state="disconnected"
        title="The session is no longer valid"
        detail="The service was restarted or the session expired. Pair again with a fresh ticket."
      >
        {#snippet action()}
          <Button size="sm" variant="outline" onclick={disconnect}
            >Pair again</Button
          >
        {/snippet}
      </StateBanner>
    </div>
  {/if}

  {#if token === null}
    <main class="flex-1 overflow-auto p-6">
      <ConnectionPanel
        {baseUrl}
        ticket={session.ticket}
        hosted={!baseUrlIsDefault}
        password={session.hostedPassword}
        phase={session.pairPhase}
        message={session.pairMessage}
        {baseUrlIsDefault}
        onBaseUrl={(value) => {
          session.baseUrl = value;
        }}
        onTicket={(value) => {
          session.ticket = value;
        }}
        onPassword={(value) => {
          session.hostedPassword = value;
        }}
        onConnect={() => void pair()}
      />
    </main>
  {:else}
    <main
      class="relative z-1 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18.5rem_minmax(0,1fr)_21rem] xl:grid-cols-[21rem_minmax(0,1fr)_25rem] 2xl:grid-cols-[23rem_minmax(0,1fr)_28rem]"
    >
      <aside
        class="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r border-border/80 bg-canvas/40 p-2.5 custom-scrollbar"
      >
        <SectionCard
          title="Repositories"
          count={repositoryList.length}
          open={true}
        >
          {#snippet icon()}
            <FolderGit2 class="size-3.5 text-muted-foreground" />
          {/snippet}
          <div class="flex flex-col gap-2">
            {#if repositories.isPending}
              <StateBanner state="loading" title="Loading repositories…" />
            {:else if repositories.isError}
              <StateBanner
                state="error"
                title="Could not list repositories"
                detail={describeClientProblem(repositories.error)}
              >
                {#snippet action()}
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() => void repositories.refetch()}
                  >
                    Retry
                  </Button>
                {/snippet}
              </StateBanner>
            {:else if repositoryList.length === 0}
              <StateBanner
                state="empty"
                title="No repositories"
                detail="Start the service in a repository (refyard open <path>) to read it here."
              />
            {:else}
              <RepositoryList
                repositories={repositoryList}
                selectedId={selectedRepositoryId}
                onSelect={(repositoryId) => {
                  selectRepository(selection, repositoryId);
                }}
              />
            {/if}
            {#if token !== null}
              <Separator />
              <RepositoryPanel
                roots={workspaceRoots}
                available={repositoryCreationAvailable}
                disabled={!writesAllowed}
                busy={mutationBusy}
                message={repositoryMessage}
                onInit={onRepositoryInit}
                onClone={onRepositoryClone}
              />
              <Separator />
              <RepositoryAccessPanel
                repositories={repositoryList}
                disabled={!writesAllowed}
                busy={mutationBusy}
                message={repositoryAccessMessage}
                onRegister={(path) => void registerRepository(path)}
                onRevoke={(repositoryId) => void revokeRepository(repositoryId)}
              />
            {/if}
          </div>
        </SectionCard>

        {#if repository !== null}
          <SectionCard
            title="Changes"
            count={status.data ? status.data.entries.length : undefined}
            open={true}
          >
            {#snippet icon()}
              <FileDiff class="size-3.5 text-muted-foreground" />
            {/snippet}
            <div class="flex flex-col gap-2">
              {#if status.isPending}
                <StateBanner state="loading" title="Reading status…" />
              {:else if status.isError}
                <StateBanner
                  state="error"
                  title="Could not read status"
                  detail={describeClientProblem(status.error)}
                >
                  {#snippet action()}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() => void status.refetch()}
                    >
                      Retry
                    </Button>
                  {/snippet}
                </StateBanner>
              {:else if status.data !== undefined}
                <StatusList
                  snapshot={status.data}
                  selectedPathId={selectedPath?.pathId ?? null}
                  disabled={mutationBusy}
                  busy={mutationBusy}
                  {onStage}
                  {onUnstage}
                  {onDiscard}
                  onSelect={(entry) => {
                    selectStatusPath(selection, entry);
                  }}
                />
              {/if}
            </div>
          </SectionCard>

          {#if mergeAvailable && (operationInProgress !== null || mergeMessage !== null)}
            <ConflictPanel
              {operationInProgress}
              conflicted={conflictedPaths}
              disabled={mutationBusy}
              busy={mutationBusy}
              message={mergeMessage}
              onContinue={onMergeContinue}
              onAbort={onMergeAbort}
            />
          {/if}

          {#if stagingAvailable}
            <SectionCard
              title="Stage & commit"
              count={status.data
                ? status.data.entries.filter(
                    (entry) => entry.indexStatus !== ".",
                  ).length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitCommit class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-3">
                {#if status.isPending}
                  <StateBanner state="loading" title="Reading status…" />
                {:else if status.isError}
                  <StateBanner
                    state="error"
                    title="Could not read status"
                    detail={describeClientProblem(status.error)}
                  />
                {:else if status.data !== undefined}
                  <StagingPanel
                    entries={status.data.entries}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={stagingMessage}
                    {onStage}
                    {onUnstage}
                    {onDiscard}
                  />
                  {#if commitAvailable}
                    <Separator />
                    <CommitPanel
                      stagedCount={status.data.entries.filter(
                        (entry) => entry.indexStatus !== ".",
                      ).length}
                      disabled={mutationBusy}
                      busy={mutationBusy}
                      canAmend={status.data.head.kind === "born"}
                      message={commitResult}
                      {onCommit}
                      {onAmend}
                    />
                  {/if}
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if branchAvailable}
            <SectionCard
              title="Branches"
              count={refs.data ? refs.data.branches.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitBranch class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading branches…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <BranchPanel
                    refs={refs.data ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={branchMessage}
                    onCreate={onBranchCreate}
                    onSwitch={onBranchSwitch}
                    onRename={onBranchRename}
                    onDelete={onBranchDelete}
                    onSetUpstream={onBranchSetUpstream}
                    onMerge={onBranchMerge}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if networkAvailable}
            <SectionCard
              title="Remotes & sync"
              count={refs.data ? refs.data.remotes.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Globe class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading remotes…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <RemotePanel
                    refs={refs.data ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={remoteMessage}
                    onAdd={onRemoteAdd}
                    onUpdate={onRemoteUpdate}
                    onRemove={onRemoteRemove}
                    {onFetch}
                    {onPush}
                    {onPull}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if stashAvailable}
            <SectionCard
              title="Stashes"
              count={stashes.data ? stashes.data.stashes.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Archive class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if stashes.isPending && stashes.data === undefined}
                  <StateBanner state="loading" title="Reading stashes…" />
                {/if}
                {#if stashes.isError}
                  <StateBanner
                    state="error"
                    title="Could not read stashes"
                    detail={describeClientProblem(stashes.error)}
                  />
                {/if}
                {#if stashPanelAvailable}
                  <StashPanel
                    stashes={displayedStashes}
                    disabled={mutationBusy ||
                      stashes.isError ||
                      stashes.data === undefined}
                    busy={mutationBusy}
                    message={stashResult}
                    onCreate={onStashCreate}
                    onApply={onStashApply}
                    onPop={onStashPop}
                    onDrop={onStashDrop}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if tagAvailable}
            <SectionCard
              title="Tags"
              count={refs.data ? refs.data.tags.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Tag class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading tags…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <TagPanel
                    tags={refs.data?.tags ?? []}
                    remoteName={refs.data?.remotes[0]?.name ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={tagResult}
                    onCreate={onTagCreate}
                    onDelete={onTagDelete}
                    onPush={onTagPush}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if worktreeAvailable}
            <SectionCard
              title="Worktrees"
              count={worktrees.data
                ? worktrees.data.worktrees.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <Layers class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if worktrees.isPending}
                  <StateBanner state="loading" title="Reading worktrees…" />
                {:else if worktrees.isError}
                  <StateBanner
                    state="error"
                    title="Could not read worktrees"
                    detail={describeClientProblem(worktrees.error)}
                  />
                {:else}
                  <WorktreePanel
                    worktrees={worktrees.data?.worktrees ?? []}
                    branches={branchNames}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={worktreeMessage}
                    onCreate={onWorktreeCreate}
                    onRemove={onWorktreeRemove}
                    onLock={onWorktreeLock}
                    onUnlock={onWorktreeUnlock}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if submoduleAvailable}
            <SectionCard
              title="Submodules"
              count={submodules.data
                ? submodules.data.submodules.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <Boxes class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if submodules.isPending}
                  <StateBanner state="loading" title="Reading submodules…" />
                {:else if submodules.isError}
                  <StateBanner
                    state="error"
                    title="Could not read submodules"
                    detail={describeClientProblem(submodules.error)}
                  />
                {:else}
                  <SubmodulePanel
                    submodules={submodules.data?.submodules ?? []}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={submoduleMessage}
                    onAdd={onSubmoduleAdd}
                    onUpdate={onSubmoduleUpdate}
                    onSync={onSubmoduleSync}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if !branchAvailable}
            <SectionCard
              title="Refs"
              count={refs.data
                ? refs.data.branches.length +
                  refs.data.remoteBranches.length +
                  refs.data.tags.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitBranch class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading refs…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <RefsPanel refs={refs.data ?? null} />
                {/if}
              </div>
            </SectionCard>
          {/if}
        {/if}
      </aside>

      <section class="flex min-h-0 flex-col gap-2 p-3">
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

        {#if selectedRepositoryId === null}
          <StateBanner state="empty" title="No repository selected" />
        {:else if history.isPending}
          <StateBanner state="loading" title="Reading history…" />
        {:else if history.isError}
          <StateBanner
            state="error"
            title="Could not read history"
            detail={describeClientProblem(history.error)}
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
            {commits}
            {selectedOid}
            {now}
            hasMore={history.hasNextPage}
            loadingMore={history.isFetchingNextPage}
            truncated={historyNotices.truncated}
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

      <section
        class="flex min-h-0 flex-col border-l border-border bg-canvas/30"
      >
        {#if selectedPath !== null && selectedPath.kind === "ignored"}
          <div class="p-3">
            <StateBanner
              state="info"
              title="Ignored path"
              detail="Git does not report content for an ignored path, so there is no diff to read."
            />
          </div>
        {:else if diffRequest === null}
          <div
            class="flex flex-1 flex-col items-center justify-center p-6 text-center"
          >
            <div
              class="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground shadow-2xs border border-border/50"
            >
              <FileDiff class="size-6 text-primary/70" />
            </div>
            <h3 class="text-sm font-medium text-foreground">
              No diff selected
            </h3>
            <p class="mt-1 max-w-xs text-xs text-muted-foreground">
              Select a commit in History or a modified file in Changes to
              inspect the diff.
            </p>
            <div class="mt-4 w-full max-w-xs">
              <StateBanner
                state="empty"
                title="Nothing selected"
                detail="Choose a commit or a changed path to read its diff."
              />
            </div>
          </div>
        {:else}
          {#if selectedOid !== null}
            <CommitDetailPanel
              commit={selectedCommit}
              {detail}
              class="max-h-72 shrink-0 border-b border-border"
            />
          {/if}
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {#if diff.isPending}
              <div class="p-3">
                <StateBanner state="loading" title="Reading diff…" />
              </div>
            {:else if diff.isError}
              <div class="p-3">
                <StateBanner
                  state="error"
                  title="Could not read the diff"
                  detail={describeClientProblem(diff.error)}
                >
                  {#snippet action()}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() => void diff.refetch()}
                    >
                      Retry
                    </Button>
                  {/snippet}
                </StateBanner>
              </div>
            {:else}
              <DiffPanel
                diff={diff.data ?? null}
                patch={diffPatch.data ?? null}
                selectedPathId={selectedDiffPathId}
                onSelectPath={(file) => {
                  selectDiffPath(selection, file.pathId);
                }}
                class="p-3"
              />
            {/if}
          </div>
        {/if}

        {#if primaryWorktreeId !== null}
          <footer
            class="shrink-0 border-t border-border px-3 py-2 text-xs text-ink-faint"
          >
            worktree <span class="font-mono">{shortOid(primaryWorktreeId)}</span
            >
            {#if repository !== null}· {repository.objectFormat}{/if}
            {#if status.data !== undefined && status.data.truncated}
              · status truncated
            {/if}
            {#if refs.data !== undefined && refs.data.truncated}
              · refs truncated
            {/if}
          </footer>
        {/if}
      </section>
    </main>
  {/if}
</div>
