<!--
  The single-repository workbench: the same @refyard/git-ui components the desktop app
  and the browser use, fed through the postMessage bridge instead of an HTTP client.
  Read-only slice: status, history with the graph, and the diff for whatever is selected.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DiffResponse,
    HistoryPage,
    StatusSnapshot,
  } from "@refyard/git-contract";
  import type { CommitSummary } from "@refyard/git-contract";
  import { layoutGraph, type GraphCommit } from "@refyard/git-graph";
  import { Badge, StatusList, DiffPanel, CommitList } from "@refyard/git-ui";

  interface Bridge {
    call(payload: unknown): Promise<unknown>;
  }

  let { call }: { call: (payload: unknown) => Promise<unknown> } = $props();

  type View = "working-copy" | "history";

  let view = $state<View>("working-copy");
  let snapshot = $state<StatusSnapshot | null>(null);
  let selectedPathId = $state<string | null>(null);
  let pathDiff = $state<DiffResponse | null>(null);
  let commits = $state<CommitSummary[]>([]);
  let cursor = $state<string | null>(null);
  let selectedOid = $state<string | null>(null);
  let commitDiff = $state<DiffResponse | null>(null);
  let loading = $state(true);
  let failure = $state("");
  let now = $state(Date.now());

  onMount(() => {
    void refresh();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  async function refresh(): Promise<void> {
    loading = true;
    failure = "";
    try {
      const answer = (await call({ kind: "status" })) as {
        kind: "status";
        snapshot: StatusSnapshot;
      };
      snapshot = answer.snapshot;
      await loadHistory(true);
    } catch (problem) {
      failure = problemText(problem);
    } finally {
      loading = false;
    }
  }

  async function loadHistory(reset: boolean): Promise<void> {
    const answer = (await call({
      kind: "history",
      cursor: reset ? null : cursor,
    })) as { kind: "history"; page: HistoryPage };
    commits = reset
      ? answer.page.commits
      : [...commits, ...answer.page.commits];
    cursor = answer.page.nextCursor ?? null;
  }

  async function selectPath(entry: {
    pathId: string;
    kind: string;
    worktreeStatus: string;
    indexStatus: string;
  }): Promise<void> {
    selectedPathId = entry.pathId;
    selectedOid = null;
    const diffKind =
      entry.kind === "untracked"
        ? "untracked"
        : entry.worktreeStatus.trim().length > 0
          ? "unstaged"
          : "staged";
    try {
      const answer = (await call({
        kind: "diff",
        diffKind,
        pathId: entry.pathId,
      })) as { kind: "diff"; diff: DiffResponse };
      pathDiff = answer.diff;
    } catch (problem) {
      failure = problemText(problem);
    }
  }

  async function selectCommit(commit: CommitSummary): Promise<void> {
    selectedOid = commit.oid;
    selectedPathId = null;
    try {
      const answer = (await call({
        kind: "diff",
        diffKind: "commit",
        oid: commit.oid,
      })) as { kind: "diff"; diff: DiffResponse };
      commitDiff = answer.diff;
    } catch (problem) {
      failure = problemText(problem);
    }
  }

  function problemText(problem: unknown): string {
    const shape = problem as { message?: string };
    return shape.message ?? "the read failed";
  }

  const graphCommits = $derived(
    commits.map((commit): GraphCommit => ({
      id: commit.oid,
      parentIds: commit.parents,
      refNames: commit.refNames,
    })),
  );
  const graph = $derived(layoutGraph(graphCommits));
  const hasMore = $derived(cursor !== null);

  const unstaged = $derived(
    snapshot?.unstaged ?? { entries: [], entryCount: 0, truncated: false },
  );
  const staged = $derived(
    snapshot?.staged ?? { entries: [], entryCount: 0, truncated: false },
  );
  const branchName = $derived(snapshot?.head?.branchName ?? "");
</script>

<div class="flex h-dvh min-h-0 flex-col gap-2 p-3 text-ink">
  <div class="flex items-center gap-2">
    <Badge tone="branch">{branchName || "…"}</Badge>
    <span class="text-xs text-muted-foreground">
      {view === "working-copy" ? "Working copy" : "History"}
    </span>
    <span class="flex-1"></span>
    <button
      type="button"
      class="rounded border border-border bg-panel px-2 py-0.5 text-xs hover:bg-accent/40"
      class:font-semibold={view === "working-copy"}
      onclick={() => (view = "working-copy")}
    >
      Working Copy
    </button>
    <button
      type="button"
      class="rounded border border-border bg-panel px-2 py-0.5 text-xs hover:bg-accent/40"
      class:font-semibold={view === "history"}
      onclick={() => (view = "history")}
    >
      History
    </button>
    <button
      type="button"
      class="rounded border border-border bg-panel px-2 py-0.5 text-xs hover:bg-accent/40"
      onclick={() => void refresh()}
    >
      Refresh
    </button>
  </div>

  {#if failure.length > 0}
    <div
      class="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger"
    >
      {failure}
    </div>
  {/if}

  {#if loading && snapshot === null}
    <p class="text-xs text-muted-foreground">Reading the repository…</p>
  {:else if view === "working-copy"}
    <div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
      <StatusList
        {snapshot}
        {selectedPathId}
        onSelect={(entry) => void selectPath(entry)}
      />
      <DiffPanel
        diff={pathDiff}
        {selectedPathId}
        placeholder="Select a file to see its diff."
      />
    </div>
  {:else}
    <div class="grid min-h-0 flex-1 grid-cols-2 gap-2">
      <CommitList
        rows={graph.rows}
        {commits}
        {selectedOid}
        {now}
        {hasMore}
        loadingMore={loading}
        tipsMoved={false}
        shallow={false}
        laneCount={graph.laneCount}
        onSelect={(commit) => void selectCommit(commit)}
        onLoadMore={() => void loadHistory(false)}
      />
      <DiffPanel
        diff={commitDiff}
        placeholder="Select a commit to see its changes."
      />
    </div>
  {/if}
</div>
