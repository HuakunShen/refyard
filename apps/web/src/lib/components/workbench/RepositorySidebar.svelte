<script lang="ts">
  /** Repository navigation and worktree selection beside the main workbench. */
  import {
    Archive,
    Boxes,
    FileDiff,
    FolderGit2,
    GitBranch,
    GitCommit,
    GitPullRequest,
    Globe,
    Layers,
    Tag,
  } from "@lucide/svelte";
  import {
    BranchPanel,
    Button,
    ConflictPanel,
    RefsPanel,
    RemotePanel,
    RepositoryAccessPanel,
    RepositoryList,
    RepositoryPanel,
    PullRequestsPanel,
    SectionCard,
    Separator,
    StashPanel,
    StateBanner,
    SubmodulePanel,
    TagPanel,
    WorkbenchNav,
    WorktreePanel,
    type WorkbenchNavItem,
  } from "@refyard/git-ui";
  import type { WorkbenchQueries } from "$lib/workbench/queries.svelte.js";
  import type { WorkbenchMutations } from "$lib/workbench/mutations.svelte.js";
  import { type WorkbenchSelectionState } from "$lib/workbench/selection.js";
  import {
    availableSidebarViews,
    createSidebarNavigationState,
    reconcileSidebarNavigation,
    selectSidebarView,
    type SidebarViewId,
  } from "$lib/workbench/sidebar-navigation.js";

  interface Props {
    queries: WorkbenchQueries;
    mutations: WorkbenchMutations;
    selection: WorkbenchSelectionState;
    /** A live backend session exists; repository management is not credential-shaped. */
    sessionReady: boolean;
    describeProblem: (error: unknown) => string;
    onRepositorySelect: (id: string) => void;
    onOpenWorktree: (id: string) => void;
    onOpenWorktreeInTab: (id: string) => void;
    onWorkingCopy: () => void;
  }

  let {
    queries,
    mutations,
    selection,
    sessionReady,
    describeProblem,
    onRepositorySelect,
    onOpenWorktree,
    onOpenWorktreeInTab,
    onWorkingCopy,
  }: Props = $props();

  const repositories = $derived(queries.repositories);
  const status = $derived(queries.status);
  const refs = $derived(queries.refs);
  const stashes = $derived(queries.stashes);
  const worktrees = $derived(queries.worktrees);
  const submodules = $derived(queries.submodules);
  const repositoryList = $derived(queries.repositoryList);
  const workspaceRoots = $derived(queries.workspaceRoots);
  const repository = $derived(queries.repository);
  const displayedStashes = $derived(queries.displayedStashes);
  const stashPanelAvailable = $derived(queries.stashPanelAvailable);
  const selectedRepositoryId = $derived(selection.repositoryId);

  const mutationBusy = $derived(mutations.busy);
  const writesAllowed = $derived(mutations.writesAllowed);
  const branchAvailable = $derived(mutations.availability.branch);
  const networkAvailable = $derived(mutations.availability.network);
  const stashAvailable = $derived(mutations.availability.stash);
  const tagAvailable = $derived(mutations.availability.tag);
  const worktreeAvailable = $derived(mutations.availability.worktree);
  const submoduleAvailable = $derived(mutations.availability.submodule);
  const providerAvailable = $derived(queries.providerAvailable);
  const mergeAvailable = $derived(mutations.availability.merge);
  const repositoryCreationAvailable = $derived(
    mutations.availability.repositoryCreation,
  );
  const operationInProgress = $derived(mutations.operationInProgress);
  const conflictedPaths = $derived(mutations.conflictedPaths);
  const branchNames = $derived(mutations.branchNames);

  const repositoryMessage = $derived(mutations.repositoryMessage);
  const repositoryAccessMessage = $derived(mutations.repositoryAccessMessage);
  const branchMessage = $derived(mutations.branchMessage);
  const remoteMessage = $derived(mutations.remoteMessage);
  const worktreeMessage = $derived(mutations.worktreeMessage);
  const submoduleMessage = $derived(mutations.submoduleMessage);
  const mergeMessage = $derived(mutations.mergeMessage);
  const stashResult = $derived(mutations.stashResult);
  const tagResult = $derived(mutations.tagResult);

  const onRepositoryInit = $derived(mutations.onRepositoryInit);
  const onRepositoryClone = $derived(mutations.onRepositoryClone);
  const registerRepository = $derived(mutations.registerRepository);
  const revokeRepository = $derived(mutations.revokeRepository);
  const onBranchCreate = $derived(mutations.onBranchCreate);
  const onBranchSwitch = $derived(mutations.onBranchSwitch);
  const onBranchRename = $derived(mutations.onBranchRename);
  const onBranchDelete = $derived(mutations.onBranchDelete);
  const onBranchSetUpstream = $derived(mutations.onBranchSetUpstream);
  const onBranchMerge = $derived(mutations.onBranchMerge);
  const onMergeContinue = $derived(mutations.onMergeContinue);
  const onMergeAbort = $derived(mutations.onMergeAbort);
  const onCherryPickContinue = $derived(mutations.onCherryPickContinue);
  const onCherryPickAbort = $derived(mutations.onCherryPickAbort);
  // The conflict panel finishes whichever sequencer operation this build has
  // open; the dispatch is on what Git reports, not on what this session ran.
  const onConflictContinue = $derived(
    operationInProgress === "cherry-pick"
      ? onCherryPickContinue
      : onMergeContinue,
  );
  const onConflictAbort = $derived(
    operationInProgress === "cherry-pick" ? onCherryPickAbort : onMergeAbort,
  );
  const onRemoteAdd = $derived(mutations.onRemoteAdd);
  const onRemoteUpdate = $derived(mutations.onRemoteUpdate);
  const onRemoteRemove = $derived(mutations.onRemoteRemove);
  const onFetch = $derived(mutations.onFetch);
  const onPush = $derived(mutations.onPush);
  const onPull = $derived(mutations.onPull);
  const onStashCreate = $derived(mutations.onStashCreate);
  const onStashApply = $derived(mutations.onStashApply);
  const onStashPop = $derived(mutations.onStashPop);
  const onStashDrop = $derived(mutations.onStashDrop);
  const onTagCreate = $derived(mutations.onTagCreate);
  const onTagDelete = $derived(mutations.onTagDelete);
  const onTagPush = $derived(mutations.onTagPush);
  const onWorktreeCreate = $derived(mutations.onWorktreeCreate);
  const onWorktreeRemove = $derived(mutations.onWorktreeRemove);
  const onWorktreeLock = $derived(mutations.onWorktreeLock);
  const onWorktreeUnlock = $derived(mutations.onWorktreeUnlock);
  const onSubmoduleAdd = $derived(mutations.onSubmoduleAdd);
  const onSubmoduleUpdate = $derived(mutations.onSubmoduleUpdate);
  const onSubmoduleSync = $derived(mutations.onSubmoduleSync);
  const onProviderConnect = $derived(mutations.connectProvider);
  const onProviderDisconnect = $derived(mutations.disconnectProvider);
  const onProviderDeviceStart = $derived(mutations.connectProviderDevice);
  const deviceState = $derived(queries.providerDeviceStatus.data);

  const sidebarViews = $derived(
    availableSidebarViews({
      hasRepository: repository !== null,
      branchAvailable,
      networkAvailable,
      stashAvailable,
      tagAvailable,
      worktreeAvailable,
      submoduleAvailable,
      pullRequestsAvailable: providerAvailable,
      repositoryCount: repositoryList.length,
      changeCount: status.data?.entries.length,
      branchCount: refs.data?.branches.length,
      remoteCount: refs.data?.remotes.length,
      stashCount: stashes.data?.stashes.length,
      tagCount: refs.data?.tags.length,
      worktreeCount: worktrees.data?.worktrees.length,
      submoduleCount: submodules.data?.submodules.length,
      refsCount:
        refs.data === undefined
          ? undefined
          : refs.data.branches.length +
            refs.data.remoteBranches.length +
            refs.data.tags.length,
    }),
  );
  const navItems: readonly WorkbenchNavItem[] = $derived(
    sidebarViews
      .filter((entry) => entry.available)
      .map(({ id, label, count }) =>
        count === undefined ? { id, label } : { id, label, count },
      ),
  );
  const navigation = $state(createSidebarNavigationState());
  const activeView = $derived(navigation.activeView);

  $effect(() => {
    reconcileSidebarNavigation(
      navigation,
      sidebarViews,
      repository !== null,
      operationInProgress !== null,
    );
  });

  function chooseView(id: string): void {
    if (id === "working-copy") onWorkingCopy();
    selectSidebarView(navigation, id as SidebarViewId, sidebarViews);
  }
</script>

<aside
  class="flex h-[28rem] shrink-0 flex-col border-r border-border/80 bg-canvas/40 lg:h-auto lg:min-h-0"
  data-testid="repository-sidebar"
>
  <div class="shrink-0 p-2.5 pb-2">
    <WorkbenchNav items={navItems} activeId={activeView} onSelect={chooseView}>
      {#snippet icon(item)}
        {#if item.id === "repositories"}
          <FolderGit2 class="size-3.5" />
        {:else if item.id === "working-copy"}
          <FileDiff class="size-3.5" />
        {:else if item.id === "branches" || item.id === "refs"}
          <GitBranch class="size-3.5" />
        {:else if item.id === "remotes"}
          <Globe class="size-3.5" />
        {:else if item.id === "stashes"}
          <Archive class="size-3.5" />
        {:else if item.id === "tags"}
          <Tag class="size-3.5" />
        {:else if item.id === "worktrees"}
          <Layers class="size-3.5" />
        {:else if item.id === "submodules"}
          <Boxes class="size-3.5" />
        {:else if item.id === "pull-requests"}
          <GitPullRequest class="size-3.5" />
        {/if}
      {/snippet}
    </WorkbenchNav>
  </div>
  <Separator />
  <div
    class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5 custom-scrollbar"
    data-testid={`sidebar-view-${activeView}`}
  >
    <SectionCard
      title="Repositories"
      class={activeView !== "repositories" ? "hidden" : ""}
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
            detail={describeProblem(repositories.error)}
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
              onRepositorySelect(repositoryId);
            }}
          />
        {/if}
        {#if sessionReady}
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
      {#if activeView === "working-copy"}
        <div class="px-2 py-3 text-xs text-muted-foreground">
          Select a worktree below. Its changed files and commit message are on
          the right.
        </div>
      {/if}
      {#if mergeAvailable && (operationInProgress !== null || mergeMessage !== null)}
        <ConflictPanel
          class={activeView !== "working-copy" ? "hidden" : ""}
          {operationInProgress}
          conflicted={conflictedPaths}
          disabled={mutationBusy}
          busy={mutationBusy}
          message={mergeMessage}
          onContinue={onConflictContinue}
          onAbort={onConflictAbort}
        />
      {/if}

      {#if branchAvailable}
        <SectionCard
          title="Branches"
          class={activeView !== "branches" ? "hidden" : ""}
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
                detail={describeProblem(refs.error)}
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
          class={activeView !== "remotes" ? "hidden" : ""}
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
                detail={describeProblem(refs.error)}
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
          class={activeView !== "stashes" ? "hidden" : ""}
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
                detail={describeProblem(stashes.error)}
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
          class={activeView !== "tags" ? "hidden" : ""}
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
                detail={describeProblem(refs.error)}
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
          class={activeView !== "worktrees" && activeView !== "working-copy"
            ? "hidden"
            : ""}
          count={worktrees.data ? worktrees.data.worktrees.length : undefined}
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
                detail={describeProblem(worktrees.error)}
              />
            {:else}
              <WorktreePanel
                worktrees={worktrees.data?.worktrees ?? []}
                branches={branchNames}
                activeWorktreeId={queries.activeWorktreeId}
                {onOpenWorktree}
                {onOpenWorktreeInTab}
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
          class={activeView !== "submodules" ? "hidden" : ""}
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
                detail={describeProblem(submodules.error)}
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

      {#if providerAvailable}
        <SectionCard
          title="Pull Requests"
          class={activeView !== "pull-requests" ? "hidden" : ""}
          open={true}
        >
          {#snippet icon()}
            <GitPullRequest class="size-3.5 text-muted-foreground" />
          {/snippet}
          <PullRequestsPanel
            connections={queries.providerConnection.data?.connections ?? []}
            pullRequests={queries.providerPullRequests.data?.pullRequests}
            source={queries.providerPullRequests.data?.source}
            cachedAt={queries.providerPullRequests.data?.cachedAt}
            loading={queries.providerPullRequests.isPending}
            busy={mutationBusy}
            error={
              queries.providerConnection.isError
                ? describeProblem(queries.providerConnection.error)
                : queries.providerPullRequests.isError
                  ? describeProblem(queries.providerPullRequests.error)
                  : null
            }
            deviceState={deviceState}
            onStartDeviceConnect={() => void onProviderDeviceStart()}
            onConnect={onProviderConnect}
            onDisconnect={() => void onProviderDisconnect()}
            onRefresh={() => void queries.providerPullRequests.refetch()}
          />
        </SectionCard>
      {/if}

      {#if !branchAvailable}
        <SectionCard
          title="Refs"
          class={activeView !== "refs" ? "hidden" : ""}
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
                detail={describeProblem(refs.error)}
              />
            {:else}
              <RefsPanel refs={refs.data ?? null} />
            {/if}
          </div>
        </SectionCard>
      {/if}
    {/if}
  </div>
</aside>
