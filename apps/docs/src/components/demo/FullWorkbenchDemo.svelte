<script lang="ts">
  /** A complete workbench UI over a closed, deterministic, in-memory Git simulation. */
  import { CommitList, CommitDetailPanel, DiffPanel, RepositoryTabs, WorkbenchToolbar, WorkingCopyPanel } from "@refyard/git-ui";
  import { getActiveDemoState, createDemoWorkspace, reduceDemoWorkspace, type DemoWorkspaceAction } from "../../lib/demo/workspace.js";
  import {
    getDemoGraph, getVisibleDemoCommits, getSelectedDemoCommit, getSelectedDemoDetail,
    getSelectedDemoDiff, getSelectedWorkingCopyDiff,
  } from "../../lib/demo/selectors.js";
  import type { DemoAction } from "../../lib/demo/reducer.js";
  import DemoNavigation from "./DemoNavigation.svelte";

  interface Props { mode?: "embedded" | "full" }
  let { mode = "embedded" }: Props = $props();

  let workspace = $state(createDemoWorkspace());
  let inspector = $state<"commit" | "file" | null>(null);
  let selectedDiffPathId = $state<string | null>(null);
  let showCatalogue = $state(false);
  let draft = $state("");
  let graphSurface: HTMLDivElement;

  const sandbox = $derived(getActiveDemoState(workspace));
  const repo = $derived(workspace.repositories.find((entry) => entry.id === workspace.activeRepositoryId)!);
  const graph = $derived(getDemoGraph(sandbox));
  const visibleCommits = $derived(getVisibleDemoCommits(sandbox));
  const selectedCommit = $derived(getSelectedDemoCommit(sandbox));
  const selectedDetail = $derived(getSelectedDemoDetail(sandbox));
  const selectedDiff = $derived(getSelectedDemoDiff(sandbox));
  const selectedWorkingCopyDiff = $derived(getSelectedWorkingCopyDiff(sandbox));
  const stagedCount = $derived(sandbox.status.entries.filter((entry) => entry.indexStatus !== "." && entry.indexStatus !== "?").length);
  const pendingCount = $derived(sandbox.status.entries.length);
  const eligibleCount = $derived(sandbox.status.entries.filter((entry) => entry.kind === "untracked" ||
    (entry.kind === "ordinary" && entry.indexStatus === "." && entry.worktreeStatus !== ".")).length);
  const tabs = $derived(workspace.openRepositoryIds.flatMap((id) => {
    const entry = workspace.repositories.find((item) => item.id === id);
    return entry ? [{ repositoryId: id, displayName: entry.name, displayPath: entry.path, targetLabel: "This machine · preset", targetKind: "local" as const }] : [];
  }));

  function dispatch(action: DemoWorkspaceAction): void {
    workspace = reduceDemoWorkspace(workspace, action);
  }
  function dispatchRepo(action: DemoAction): void {
    dispatch({ type: "repo", action });
  }
  function selectRepository(repositoryId: string): void {
    dispatch(workspace.openRepositoryIds.includes(repositoryId)
      ? { type: "select-repository", repositoryId } : { type: "open-tab", repositoryId });
    inspector = null;
    selectedDiffPathId = null;
  }
  function closeRepository(repositoryId: string): void {
    dispatch({ type: "close-tab", repositoryId });
    inspector = null;
    selectedDiffPathId = null;
  }
  function reset(): void {
    dispatch({ type: "reset" });
    draft = "";
    inspector = null;
    selectedDiffPathId = null;
    showCatalogue = false;
  }
  function onCommit(message: string): void {
    const current = workspace.statesById[workspace.activeRepositoryId];
    dispatchRepo({ type: "commit", message });
    if (workspace.statesById[workspace.activeRepositoryId]?.revision !== current?.revision) {
      draft = "";
      inspector = "commit";
    }
  }
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && inspector !== null) { inspector = null; return; }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // The marketing page must retain native arrow-key scrolling everywhere
    // except the focused commit timeline. Search and editor controls own keys.
    if (!graphSurface?.contains(event.target as Node)) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const index = visibleCommits.findIndex((entry) => entry.oid === sandbox.selectedOid);
    const next = visibleCommits[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      dispatchRepo({ type: "select-commit", oid: next.oid });
      selectedDiffPathId = null;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class:full-demo-embedded={mode === "embedded"} class="full-demo" data-testid="full-workbench-demo">
  {#if mode === "full"}
    <div class="full-demo-external-nav">
      <a href="/" class="demo-brand"><img class="showcase-mark" src="/refyard-mark.svg" alt="" width="38" height="38" /> refyard<span class="demo-brand-dot">.</span></a>
      <div class="full-demo-external-links"><a href="/docs/">Documentation</a><a href="https://github.com/HuakunShen/refyard">GitHub ↗</a></div>
    </div>
  {/if}

  <div class="full-demo-status" role="note" data-testid="demo-safety-notice">
    <div><span class="demo-status-led"></span><strong>LIVE SANDBOX</strong><span>Every commit, file and Git action is simulated. No repository access or network connection.</span></div>
    <button type="button" class="full-demo-reset" onclick={reset} data-testid="demo-reset">↺ Reset demo</button>
  </div>

  <section class="full-demo-shell" aria-label="Interactive Git workbench">
    <header class="full-demo-tabs-row">
      <div class="full-demo-window-dots" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="full-demo-tabs-area">
        <RepositoryTabs
          {tabs}
          activeRepositoryId={workspace.activeRepositoryId}
          onSelect={selectRepository}
          onClose={closeRepository}
          onNew={() => showCatalogue = !showCatalogue}
        />
      </div>
      <span class="full-demo-machine">◫ THIS MACHINE · PRESET</span>
      {#if showCatalogue}
        <div class="full-demo-catalogue" aria-label="Demo repositories">
          <div>OPEN SAMPLE REPOSITORY</div>
          {#each workspace.repositories as option (option.id)}
            <button type="button" onclick={() => { selectRepository(option.id); showCatalogue = false; }}>{option.name} <span>⑂ {option.branch}</span></button>
          {/each}
        </div>
      {/if}
    </header>

    <div class="full-demo-actions" aria-label="Demo Git toolbar">
      <WorkbenchToolbar
        visible={true}
        changedCount={eligibleCount}
        onStageAll={() => dispatch({ type: "stage-all" })}
        onStash={null}
        onPopStash={null}
        onFetch={null}
        onPull={null}
        onPush={null}
        onToggleTerminal={null}
      />
      <div class="full-demo-remote-actions" aria-label="Unavailable network operations">
        <button disabled title="Requires a connected Git host">↯ Fetch</button>
        <button disabled title="Requires a connected Git host">↓ Pull</button>
        <button disabled title="Requires a connected Git host">↑ Push</button>
        <button disabled title="Terminal unavailable in the static sandbox">⌘ Terminal</button>
      </div>
      <div class="full-demo-action-meta"><span>⑂ {repo.branch}</span><span>{pendingCount} changed</span></div>
    </div>

    <div class="full-demo-grid">
      <DemoNavigation
        activeRepositoryId={workspace.activeRepositoryId}
        repositories={workspace.repositories}
        changedCount={pendingCount}
        commitCount={sandbox.commits.length}
        onSelect={selectRepository}
        onFocusHistory={() => document.querySelector<HTMLElement>(".full-demo-history-search")?.focus()}
        onFocusChanges={() => document.querySelector<HTMLElement>(".full-demo-working-copy")?.focus()}
      />

      <section class="full-demo-history" aria-label="Commit timeline">
        <div class="full-demo-pane-heading"><div><strong>History</strong><span>{repo.name}</span></div><small>{visibleCommits.length} commits</small></div>
        <div class="full-demo-preset-badges"><span class="full-demo-head-badge">⑂ {repo.branch}</span><span>WORKTREE</span><span>LOCAL CHANGES</span></div>
        <label class="full-demo-search"><span>⌕</span><input
          type="search"
          class="full-demo-history-search"
          aria-label="Search commit history"
          placeholder="Search commit messages…"
          value={sandbox.filter}
          oninput={(event) => dispatchRepo({ type: "filter", query: event.currentTarget.value })}
        /><kbd>⌘ K</kbd></label>
        <div class="full-demo-graph-legend"><span>BRANCH / TAG</span><span>GRAPH</span><span>COMMIT MESSAGE</span></div>
        <div class="full-demo-history-scroll" bind:this={graphSurface} data-testid="demo-commit-list">
          {#if visibleCommits.length > 0}
            <CommitList
              rows={graph.rows}
              commits={visibleCommits}
              selectedOid={sandbox.selectedOid}
              hasMore={false}
              loadingMore={false}
              tipsMoved={false}
              shallow={false}
              laneCount={graph.laneCount}
              showAvatars={false}
              contextDisabled={true}
              currentBranch={repo.branch}
              onSelect={(commit) => { dispatchRepo({ type: "select-commit", oid: commit.oid }); inspector = "commit"; selectedDiffPathId = null; }}
              onLoadMore={() => undefined}
            />
          {:else}
            <p class="full-demo-empty">No matching commits. Try another search.</p>
          {/if}
        </div>
        <div class="full-demo-pane-foot"><span><span class="demo-status-led"></span> BRANCH GRAPH</span><button type="button" onclick={() => inspector = "commit"}>Inspect selected commit ↗</button></div>
      </section>

      <section class="full-demo-working-copy" tabindex="-1" aria-label="Working copy changes">
        <div class="full-demo-pane-heading"><div><strong>{repo.branch}</strong><span>{repo.path}</span></div><small>{pendingCount} changed</small></div>
        <div class="full-demo-wc-content">
          <WorkingCopyPanel
            status={sandbox.status}
            worktreeLabel={repo.name}
            worktreePath={repo.path}
            selectedPathId={sandbox.selectedPathId}
            selectedSide={sandbox.selectedSide}
            discardAvailable={false}
            amendAvailable={false}
            wholeFileOnly={true}
            onSelect={(entry, side) => { dispatchRepo({ type: "select-file", pathId: entry.pathId, side }); inspector = "file"; }}
            onStage={(pathIds) => dispatchRepo({ type: "stage", pathIds })}
            onUnstage={(pathIds) => dispatchRepo({ type: "unstage", pathIds })}
            onCommit={onCommit}
            onAmend={() => undefined}
            bind:draft
          />
        </div>
        <div class="full-demo-pane-foot"><span>{stagedCount} STAGED · {pendingCount} CHANGED</span><button type="button" onclick={() => inspector = "file"}>Preview file patch ↗</button></div>
      </section>
    </div>

    {#if inspector !== null}
      <div class="full-demo-inspector-backdrop" role="presentation" onclick={() => inspector = null} onkeydown={(event) => { if (event.key === "Escape") inspector = null; }}></div>
      <section class="full-demo-inspector" aria-label={inspector === "commit" ? "Commit inspector" : "Working copy patch inspector"} data-testid="demo-inspector">
        <div class="full-demo-inspector-head"><div><strong>{inspector === "commit" ? "Commit inspector" : "Working copy patch"}</strong><span>REAL REFYARD DIFF VIEWER</span></div><button type="button" onclick={() => inspector = null} aria-label="Close inspector">✕</button></div>
        {#if inspector === "commit"}
          <div class="full-demo-inspector-detail"><CommitDetailPanel commit={selectedCommit} detail={selectedDetail} /></div>
          <div class="full-demo-inspector-diff"><DiffPanel diff={selectedDiff} selectedPathId={selectedDiffPathId ?? selectedDiff?.files[0]?.pathId ?? null} onSelectPath={(file) => selectedDiffPathId = file.pathId} /></div>
        {:else}
          <div class="full-demo-inspector-diff"><DiffPanel diff={selectedWorkingCopyDiff} selectedPathId={selectedWorkingCopyDiff?.files[0]?.pathId ?? null} /></div>
        {/if}
      </section>
    {/if}
  </section>
  <div class="full-demo-caption"><span><span class="demo-status-led"></span> DEMONSTRATION MODE</span><span>Real production UI · fictional commits · reset anytime</span><a href={mode === "embedded" ? "/demo/" : "/docs/"}>{mode === "embedded" ? "Open fullscreen ↗" : "Read the docs ↗"}</a></div>
</div>
