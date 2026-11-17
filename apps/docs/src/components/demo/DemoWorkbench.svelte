<script lang="ts">
  /**
   * One Svelte state owner mounts the production Git UI against typed local-only
   * snapshots. Every action dispatches to a pure reducer; no API client is used.
   */
  import { CommitList, CommitDetailPanel, DiffPanel, WorkingCopyPanel } from "@refyard/git-ui";
  import { makeDemoFixture } from "../../lib/demo/fixtures.js";
  import { createDemoState, reduceDemoState, type DemoAction } from "../../lib/demo/reducer.js";
  import {
    getDemoGraph,
    getSelectedDemoCommit,
    getSelectedDemoDetail,
    getSelectedDemoDiff,
    getSelectedWorkingCopyDiff,
    getVisibleDemoCommits,
  } from "../../lib/demo/selectors.js";
  import DemoToolbar from "./DemoToolbar.svelte";

  let sandbox = $state(createDemoState(makeDemoFixture()));
  let activeView = $state<"history" | "working-copy">("history");
  let selectedDiffPathId = $state<string | null>(null);
  let draft = $state("");

  const visibleCommits = $derived(getVisibleDemoCommits(sandbox));
  const graph = $derived(getDemoGraph(sandbox));
  const selectedCommit = $derived(getSelectedDemoCommit(sandbox));
  const selectedDetail = $derived(getSelectedDemoDetail(sandbox));
  const selectedDiff = $derived(getSelectedDemoDiff(sandbox));
  const workingCopyDiff = $derived(getSelectedWorkingCopyDiff(sandbox));
  const stagedCount = $derived(sandbox.status.entries.filter((entry) => entry.indexStatus !== "." && entry.indexStatus !== "?").length);
  const pendingCount = $derived(sandbox.status.entries.length);

  function dispatch(action: DemoAction): void {
    sandbox = reduceDemoState(sandbox, action);
  }

  function reset(): void {
    dispatch({ type: "reset" });
    selectedDiffPathId = null;
    draft = "";
    activeView = "history";
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (activeView !== "history" || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const index = visibleCommits.findIndex((commit) => commit.oid === sandbox.selectedOid);
    const next = visibleCommits[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      dispatch({ type: "select-commit", oid: next.oid });
      selectedDiffPathId = null;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="demo-app">
  <DemoToolbar onReset={reset} revision={sandbox.revision} />

  <div class="demo-disclosure" role="note" data-testid="demo-safety-notice">
    <span class="demo-disclosure-icon">◇</span>
    <strong>You're in a demo workspace.</strong>
    <span>Explore freely. All commits, file changes and Git actions are simulated in your browser — no accounts or repository access.</span>
    <a href="/showcase/">About Refyard ↗</a>
  </div>

  <section class="demo-workspace" aria-label="Interactive Git workbench">
    <div class="demo-workspace-head">
      <div class="demo-repo-info">
        <span class="demo-folder-mark">⌁</span>
        <span>refyard / demo-repository</span>
        <span class="demo-branch-pill">⑂ main</span>
        <span class="demo-readonly-pill">IN-MEMORY</span>
      </div>
      <span class="demo-workspace-meta">32 example commits · {pendingCount} local changes</span>
    </div>

    <div class="demo-view-tabs" role="tablist" aria-label="Workbench view">
      <button type="button" role="tab" aria-selected={activeView === "history"} class:active={activeView === "history"} onclick={() => activeView = "history"} data-testid="demo-history-tab">⌁ Commit history <kbd>↑↓</kbd></button>
      <button type="button" role="tab" aria-selected={activeView === "working-copy"} class:active={activeView === "working-copy"} onclick={() => activeView = "working-copy"} data-testid="demo-working-tab">◫ Working copy <span class="demo-tab-count">{pendingCount}</span></button>
      <div class="demo-tab-spacer"></div>
      <span class="demo-tab-note">POWERED BY REAL REFYARD COMPONENTS</span>
    </div>

    {#if activeView === "history"}
      <div class="demo-history-layout" data-testid="demo-history-layout">
        <section class="demo-history-list" aria-label="Commit timeline">
          <div class="demo-pane-head">
            <span>HISTORY</span>
            <span>{visibleCommits.length} COMMITS</span>
          </div>
          <div class="demo-search-wrap">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Search commit history"
              placeholder="Search commits, authors, refs…"
              value={sandbox.filter}
              oninput={(event) => dispatch({ type: "filter", query: event.currentTarget.value })}
              data-testid="demo-search"
            />
            <kbd>⌘ K</kbd>
          </div>
          <div class="demo-history-scroll" data-testid="demo-commit-list">
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
              currentBranch="main"
              onSelect={(commit) => { dispatch({ type: "select-commit", oid: commit.oid }); selectedDiffPathId = null; }}
              onLoadMore={() => undefined}
            />
          </div>
        </section>

        <section class="demo-history-inspector" aria-label="Commit details and changes">
          <div class="demo-pane-head"><span>COMMIT INSPECTOR</span><span>{selectedCommit ? selectedCommit.oid.slice(0, 8) : "—"}</span></div>
          <div class="demo-commit-details"><CommitDetailPanel commit={selectedCommit} detail={selectedDetail} /></div>
          <div class="demo-pane-head demo-diff-heading"><span>CHANGED FILES &amp; PATCH</span><span>DIFF VIEWER</span></div>
          <div class="demo-diff-area">
            <DiffPanel
              diff={selectedDiff}
              selectedPathId={selectedDiffPathId ?? selectedDiff?.files[0]?.pathId ?? null}
              onSelectPath={(file) => selectedDiffPathId = file.pathId}
            />
          </div>
        </section>
      </div>
    {:else}
      <div class="demo-working-layout" data-testid="demo-working-layout">
        <section class="demo-staging-pane" aria-label="Working copy changes">
          <div class="demo-pane-head"><span>WORKING COPY</span><span>{stagedCount} STAGED</span></div>
          <div class="demo-working-inner">
            <WorkingCopyPanel
              status={sandbox.status}
              worktreeLabel="demo-repository"
              worktreePath="/sandbox/refyard/demo-repository"
              selectedPathId={sandbox.selectedPathId}
              selectedSide={sandbox.selectedSide}
              discardAvailable={false}
              amendAvailable={false}
              wholeFileOnly={true}
              onSelect={(entry, side) => dispatch({ type: "select-file", pathId: entry.pathId, side })}
              onStage={(pathIds) => dispatch({ type: "stage", pathIds })}
              onUnstage={(pathIds) => dispatch({ type: "unstage", pathIds })}
              onCommit={(message) => { dispatch({ type: "commit", message }); activeView = "history"; draft = ""; }}
              onAmend={() => undefined}
              bind:draft
            />
          </div>
        </section>
        <section class="demo-working-inspector" aria-label="Working copy file patch">
          <div class="demo-pane-head"><span>FILE PREVIEW</span><span>SAMPLE PATCH</span></div>
          <p class="demo-file-explainer">This patch is preset demo content, rendered through Refyard's actual diff viewer. Select any file on the left to inspect it.</p>
          <div class="demo-diff-area">
            <DiffPanel diff={workingCopyDiff} selectedPathId={workingCopyDiff?.files[0]?.pathId ?? null} />
          </div>
        </section>
      </div>
    {/if}
  </section>

  <div class="demo-bottom-bar">
    <span><span class="demo-status-led"></span> OFFLINE &amp; SELF-CONTAINED</span>
    <span>Try staging a file, writing a commit message, and pressing Commit.</span>
    <button type="button" onclick={() => activeView = "working-copy"}>Open working copy →</button>
  </div>
</div>
