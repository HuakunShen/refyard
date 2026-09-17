<script lang="ts">
  /**
   * The commit list: one fixed row height shared by the graph gutter and the rows.
   *
   * The list is virtualized because a repository's history is effectively unbounded, and
   * the graph is drawn *outside* the virtualizer — a single SVG column whose contents are
   * the visible rows only — so a merge line stays continuous while the rows scroll
   * independently of it. The row height is a parameter, not a constant in two places:
   * `metrics.rowHeight` is what the virtualizer estimates with and what the geometry uses
   * to place circles, which is the only reason the two can be trusted to agree.
   *
   * Paging is explicit. `load more` asks the caller for the next page; the caller must
   * continue the layout from the previous page's lanes (`layoutPages` in `@refyard/git-graph`)
   * or the graph would restart at lane 0 mid-history. `tipsMoved` and `truncated` are shown
   * rather than swallowed: a page served from the tips it started with is not a stale bug,
   * it is the guarantee, and the reader deserves to know the branch has moved on.
   */
  import {
    createVirtualizer,
    type SvelteVirtualizer,
  } from "@tanstack/svelte-virtual";
  import { onDestroy } from "svelte";
  import type { CommitSummary } from "@refyard/git-contract";
  import type { GraphRow } from "@refyard/git-graph";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitRefDialog from "./CommitRefDialog.svelte";
  import ContextActionMenu from "./ContextActionMenu.svelte";
  import StateBanner from "./StateBanner.svelte";
  import {
    DEFAULT_METRICS,
    gutterWidth,
    type GraphMetrics,
  } from "../lib/geometry.js";
  import { absoluteTime, relativeTime, shortOid } from "../lib/format.js";
  import { cn } from "../lib/utils.js";
  import type { ContextAction } from "../lib/context-actions.js";

  interface Props {
    /** Graph rows, index-aligned with `commits`. */
    rows: readonly GraphRow[];
    commits: readonly CommitSummary[];
    selectedOid: string | null;
    /** Wall-clock milliseconds used for relative times, so rendering stays a pure function. */
    now: number;
    hasMore: boolean;
    loadingMore: boolean;
    truncated: boolean;
    tipsMoved: boolean;
    shallow: boolean;
    laneCount: number;
    metrics?: GraphMetrics;
    onSelect: (commit: CommitSummary) => void;
    onLoadMore: () => void;
    contextDisabled?: boolean;
    onCreateBranchAt?: (commit: CommitSummary, branchName: string) => void;
    onCreateTagAt?: (
      commit: CommitSummary,
      tagName: string,
      annotation: string | null,
    ) => void;
    onCopyOid?: (commit: CommitSummary) => void;
    class?: string;
  }

  let {
    rows,
    commits,
    selectedOid,
    now,
    hasMore,
    loadingMore,
    truncated,
    tipsMoved,
    shallow,
    laneCount,
    metrics = DEFAULT_METRICS,
    onSelect,
    onLoadMore,
    contextDisabled = false,
    onCreateBranchAt = undefined,
    onCreateTagAt = undefined,
    onCopyOid = undefined,
    class: className = "",
  }: Props = $props();

  let scrollElement = $state<HTMLDivElement | null>(null);

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    // The effect below is the single owner of `count` and `estimateSize`: they change when
    // a page arrives and when the metrics change, and an option captured at construction
    // would freeze the list at whatever was loaded on first render.
    count: 0,
    getScrollElement: () => scrollElement,
    estimateSize: () => metrics.rowHeight,
    overscan: 10,
  });

  /**
   * The instance, held outside the reactive graph on purpose.
   *
   * Subscribing with `$virtualizer` *and* calling `setOptions` on it from an effect makes
   * the effect its own dependency, and Svelte answers that with
   * `effect_update_depth_exceeded` — which is how a list that merely grows a page turns
   * into a page that stops updating. Reading through the store's own `subscribe` keeps the
   * update path one-way: props in, options out.
   */
  let instance: SvelteVirtualizer<HTMLDivElement, HTMLDivElement> | null = null;
  const unsubscribe = virtualizer.subscribe((value) => {
    instance = value;
  });
  onDestroy(unsubscribe);

  $effect(() => {
    const count = commits.length;
    const rowHeight = metrics.rowHeight;
    instance?.setOptions({ count, estimateSize: () => rowHeight });
  });

  const items = $derived($virtualizer.getVirtualItems());
  const totalSize = $derived($virtualizer.getTotalSize());
  const gutter = $derived(gutterWidth(laneCount, metrics));
  const visibleRows = $derived(
    items
      .map((item) => rows[item.index])
      .filter((row): row is GraphRow => row !== undefined),
  );
  const firstVisible = $derived(items[0]?.index ?? 0);
  function formatRefName(ref: string): string {
    return ref.replace(/^refs\/(heads|remotes|tags)\//, "");
  }

  let refDialogOpen = $state(false);
  let refDialogKind = $state<"branch" | "tag">("branch");
  let refDialogCommit = $state<CommitSummary | null>(null);

  function openRefDialog(kind: "branch" | "tag", commit: CommitSummary): void {
    refDialogKind = kind;
    refDialogCommit = commit;
    refDialogOpen = true;
  }

  function contextActionsFor(commit: CommitSummary): readonly ContextAction[] {
    return [
      ...(onCreateBranchAt === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "create-branch",
              label: "Create Branch Here…",
              disabled: contextDisabled,
              onSelect: () => openRefDialog("branch", commit),
            },
          ]),
      ...(onCreateTagAt === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "create-tag",
              label: "Create Tag Here…",
              disabled: contextDisabled,
              onSelect: () => openRefDialog("tag", commit),
            },
          ]),
      { kind: "separator" as const, id: "copy-separator" },
      ...(onCopyOid === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-sha",
              label: "Copy SHA",
              onSelect: () => onCopyOid(commit),
            },
          ]),
    ];
  }
</script>

<div class={cn("flex h-full min-h-0 flex-col gap-2", className)}>
  {#if truncated}
    <StateBanner
      state="truncated"
      title="This page was truncated"
      detail="The repository holds more commits than one page returns. Load more to continue from the previous page's lanes."
    />
  {/if}
  {#if tipsMoved}
    <StateBanner
      state="stale"
      title="The branch moved while you were reading"
      detail="These rows are served from the tips this page started with, so the graph you see is consistent rather than half-updated."
    />
  {/if}
  {#if shallow}
    <StateBanner
      state="info"
      title="Shallow history"
      detail="Some parents are missing locally, so a line may end at the boundary instead of at a root commit."
    />
  {/if}

  {#if commits.length === 0}
    <StateBanner
      state="empty"
      title="No commits yet"
      detail="This repository has no history on these tips."
    />
  {:else}
    <div
      bind:this={scrollElement}
      class="relative min-h-0 flex-1 overflow-auto rounded-md border border-border bg-panel"
    >
      <div class="relative" style="height: {totalSize}px">
        <svg
          class="pointer-events-none absolute top-0 left-0"
          width={gutter}
          height={totalSize}
          aria-hidden="true"
          data-slot="graph-gutter"
        >
          <CommitGraph
            rows={visibleRows}
            startIndex={firstVisible}
            {metrics}
            {selectedOid}
          />
        </svg>

        {#each items as item (item.key)}
          {@const commit = commits[item.index]}
          {#if commit !== undefined}
            {@const selected = commit.oid === selectedOid}
            <div
              class="absolute top-0 right-0 left-0"
              style="height: {item.size}px; padding-left: {gutter}px; transform: translateY({item.start}px)"
            >
              <ContextActionMenu
                actions={contextActionsFor(commit)}
                triggerClass="h-full w-full"
                data-testid={`commit-context-${commit.oid}`}
              >
                {#snippet children()}
                  <button
                    type="button"
                    onclick={() => onSelect(commit)}
                    aria-current={selected ? "true" : undefined}
                    data-testid={`commit-row-${commit.oid}`}
                    class={cn(
                      "relative flex h-full w-full items-center gap-2 px-2.5 text-left transition-colors",
                      selected
                        ? "bg-primary/10 font-medium text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-primary"
                        : "hover:bg-muted/50 text-foreground/90",
                    )}
                  >
                    <span
                      class="min-w-0 flex-1 truncate text-sm text-foreground"
                      title={commit.subject}
                    >
                      {commit.subject.length === 0
                        ? "(no subject)"
                        : commit.subject}
                    </span>

                    {#each commit.refNames.slice(0, 3) as refName (refName)}
                      <Badge
                        tone={refName.includes("/") ? "branch" : "muted"}
                        title={refName}>{formatRefName(refName)}</Badge
                      >
                    {/each}
                    {#if commit.refNames.length > 3}
                      <Badge tone="muted" title={commit.refNames.join(", ")}>
                        +{commit.refNames.length - 3}
                      </Badge>
                    {/if}

                    {#if commit.missingParents.length > 0}
                      <Badge
                        tone="warn"
                        title="A parent object is not present locally, so this line continues to a commit that was not loaded."
                      >
                        boundary
                      </Badge>
                    {/if}
                    {#if commit.signed}
                      <Badge tone="muted" title="Commit carries a signature."
                        >signed</Badge
                      >
                    {/if}

                    <span
                      class="hidden shrink-0 text-xs text-muted-foreground xl:inline"
                      >{commit.authorName}</span
                    >
                    <time
                      class="shrink-0 text-xs text-muted-foreground/75"
                      datetime={commit.authoredAt}
                      title={absoluteTime(commit.authoredAt)}
                    >
                      {relativeTime(commit.authoredAt, now)}
                    </time>
                    <span
                      class="shrink-0 font-mono text-xs text-muted-foreground/60"
                      title={commit.oid}
                    >
                      {shortOid(commit.oid)}
                    </span>
                  </button>
                {/snippet}
              </ContextActionMenu>
            </div>
          {/if}
        {/each}
      </div>

      <div class="flex items-center justify-center border-t border-border p-2">
        {#if hasMore}
          <Button
            size="sm"
            variant="outline"
            disabled={loadingMore}
            onclick={onLoadMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        {:else}
          <span class="text-xs text-ink-faint">End of the loaded history</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<CommitRefDialog
  bind:open={refDialogOpen}
  kind={refDialogKind}
  commit={refDialogCommit}
  disabled={contextDisabled}
  onSubmit={(commit, name, annotation) => {
    if (refDialogKind === "branch") {
      onCreateBranchAt?.(commit, name);
    } else {
      onCreateTagAt?.(commit, name, annotation);
    }
  }}
/>
