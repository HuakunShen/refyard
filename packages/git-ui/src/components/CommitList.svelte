<script lang="ts">
  /**
   * The commit history table: columns, the graph gutter, and the context menus.
   *
   * The list is virtualized because a repository's history is effectively unbounded,
   * and the graph is drawn *outside* the virtualizer — a single SVG column whose
   * contents are the visible rows only — so a merge line stays continuous while the
   * rows scroll independently of it. The row height is a parameter, not a constant in
   * two places: `metrics.rowHeight` is what the virtualizer estimates with and what
   * the geometry uses to place circles, which is the only reason the two can be
   * trusted to agree.
   *
   * The table is GitKraken-shaped: a fixed header names the columns (Branch / Tag,
   * Graph, Commit message, Author, Date / Time, Sha); each column's width is
   * resizable from the header band and every column except the commit message can be
   * hidden from the settings gear. The layout persists per browser. The commit
   * message column is deliberately absent from those controls: it is the flexible
   * remainder of the row, and a history list without subjects is not a state this
   * app offers.
   *
   * Right-click is per target: a row (graph lanes included) opens the commit's menu,
   * a branch or tag badge in the Branch / Tag column opens that ref's menu, each
   * offering only operations the host reported. This component never decides
   * capability — the page passes a callback only when the operation exists.
   *
   * Paging is automatic. Reaching the scroll threshold asks the caller for the next
   * page; the caller must continue the layout from the previous page's lanes
   * (`layoutPages` in `@refyard/git-graph`) or the graph would restart at lane 0
   * mid-history. `tipsMoved` remains visible because it describes consistency, while
   * page truncation is handled by scrolling.
   */
  import {
    createVirtualizer,
    type SvelteVirtualizer,
  } from "@tanstack/svelte-virtual";
  import { onDestroy } from "svelte";
  import type { CommitSummary } from "@refyard/git-contract";
  import type { GraphRow } from "@refyard/git-graph";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import BadgeCheck from "@lucide/svelte/icons/badge-check";
  import Globe from "@lucide/svelte/icons/globe";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import TagIcon from "@lucide/svelte/icons/tag";
  import { Badge } from "./ui/badge/index.js";
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitRefDialog from "./CommitRefDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextMenuLayer from "./ContextMenuLayer.svelte";
  import StateBanner from "./StateBanner.svelte";
  import {
    DEFAULT_METRICS,
    gutterWidth,
    type GraphMetrics,
  } from "../lib/geometry.js";
  import {
    HIDEABLE_COLUMN_IDS,
    defaultColumnState,
    loadStoredColumnState,
    resizeColumn,
    storeColumnState,
    toggleColumn,
    visibleColumns,
    type HistoryColumnId,
    type HistoryColumnState,
  } from "../lib/column-layout.js";
  import {
    closeContextMenu,
    createContextMenuState,
    openAnchoredContextMenu,
    openContextMenu,
  } from "../lib/context-menu.svelte.js";
  import type { ContextAction } from "../lib/context-actions.js";
  import {
    classifyCommitRef,
    commitRefDisplayName,
  } from "../lib/history-refs.js";
  import { absoluteTime, shortAbsoluteTime, shortOid } from "../lib/format.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    /** Graph rows, index-aligned with `commits`. */
    rows: readonly GraphRow[];
    topology?: "continuous" | "sparse";
    filtered?: boolean;
    commits: readonly CommitSummary[];
    selectedOid: string | null;
    hasMore: boolean;
    loadingMore: boolean;
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
    /** Copy arbitrary text (a subject, a ref name); absent means the host cannot. */
    onCopyText?: (text: string) => void;
    /** The checked-out branch, which hides switch/merge/delete on its own labels. */
    currentBranch?: string | null;
    /**
     * The working copy's uncommitted state, shown as the graph's `// WIP` row the
     * way GitKraken pins the working copy above history. Null (a clean tree, or a
     * host that did not say) renders no row; selecting it hands back to the page,
     * which shows the working copy.
     */
    wip?: {
      readonly changedCount: number;
      readonly onSelect: () => void;
    } | null;
    onCheckoutBranch?: (branchName: string) => void;
    onMergeBranch?: (branchName: string) => void;
    /** Both deletes run after this component's own confirmation dialog. */
    onDeleteBranch?: (branchName: string) => void;
    onDeleteTag?: (tagName: string) => void;
    /**
     * Author photos from GitHub, keyed off noreply commit emails. On by
     * default; a privacy-conscious host can turn the column to initials only.
     */
    showAvatars?: boolean;
    class?: string;
  }

  let {
    rows,
    topology = "continuous",
    filtered = false,
    commits,
    selectedOid,
    hasMore,
    loadingMore,
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
    onCopyText = undefined,
    currentBranch = null,
    wip = null,
    onCheckoutBranch = undefined,
    onMergeBranch = undefined,
    onDeleteBranch = undefined,
    onDeleteTag = undefined,
    showAvatars = true,
    class: className = "",
  }: Props = $props();

  let scrollElement = $state<HTMLDivElement | null>(null);
  let autoLoadPending = $state(false);

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
   * into a page that stops updating. Reading through the store's own `subscribe` keeps
   * the update path one-way: props in, options out.
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

  function maybeLoadMore(): void {
    const element = scrollElement;
    if (
      element === null ||
      !hasMore ||
      loadingMore ||
      autoLoadPending ||
      element.scrollHeight - element.scrollTop - element.clientHeight > 240
    ) {
      return;
    }
    autoLoadPending = true;
    onLoadMore();
  }

  /**
   * Arrow-key navigation, the GitKraken way: Up/Down move the selection one commit,
   * and the list scrolls the row into view. Key handling lives on the scroll
   * container, so it only fires while the user is actually working the list — an
   * arrow in the search box is the search box's business.
   */
  function onListKeyDown(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const index = commits.findIndex((commit) => commit.oid === selectedOid);
    const current =
      index === -1 ? (event.key === "ArrowDown" ? -1 : commits.length) : index;
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    const target = commits[next];
    if (target === undefined) {
      return;
    }
    event.preventDefault();
    onSelect(target);
    instance?.scrollToIndex(next, { align: "auto" });
  }

  $effect(() => {
    if (!loadingMore) {
      autoLoadPending = false;
      queueMicrotask(maybeLoadMore);
    }
  });

  $effect(() => {
    const element = scrollElement;
    if (element === null) {
      return;
    }
    element.addEventListener("scroll", maybeLoadMore, { passive: true });
    queueMicrotask(maybeLoadMore);
    return () => element.removeEventListener("scroll", maybeLoadMore);
  });

  /* --------------------------------------------------------------- columns */

  let columnState = $state<HistoryColumnState>(loadStoredColumnState());
  $effect(() => {
    storeColumnState(columnState);
  });

  /**
   * The graph column can never be narrower than the lanes drawn in it; the lane
   * layout owns that floor. Filtered (sparse) history has no graph at all.
   */
  const graphLaneFloor = $derived(
    topology === "continuous" ? gutterWidth(laneCount, metrics) : 0,
  );
  const cells = $derived(
    visibleColumns(columnState, graphLaneFloor).filter(
      (cell) => cell.id !== "graph" || topology === "continuous",
    ),
  );
  const cellById = $derived(new Map(cells.map((cell) => [cell.id, cell])));
  const graphCell = $derived(cellById.get("graph"));
  const graphLeft = $derived(cellById.get("refs")?.width ?? 0);
  const refsColumn = $derived(cellById.get("refs"));
  const headerLabels: Record<HistoryColumnId, string> = {
    refs: "Branch / Tag",
    graph: "Graph",
    message: "Commit message",
    author: "Author",
    date: "Date / Time",
    sha: "Sha",
  };

  /**
   * The table's width: the sum of the visible columns, never narrower than the
   * panel. Nothing flexes — resizing a column changes only that column and
   * pushes the columns to its right outward (shadcn/TanStack data-table
   * semantics); when the sum passes the panel's width the table scrolls
   * horizontally instead of squeezing a bystander column.
   */
  let shell = $state<HTMLDivElement | null>(null);
  let containerWidth = $state(0);
  $effect(() => {
    const element = shell;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      containerWidth = entries[0]?.contentRect.width ?? 0;
    });
    observer.observe(element);
    return () => observer.disconnect();
  });
  const tableWidth = $derived(
    Math.max(
      cells.reduce((total, cell) => total + cell.width, 0),
      containerWidth,
    ),
  );

  /**
   * The header (and the WIP row above the body) live outside the scrolling
   * element, so the body's horizontal scroll is mirrored into them as a
   * translateX. It must be reactive state, not an imperative style write:
   * Svelte rewrites this element's style attribute when the table width
   * changes mid-scroll, which would wipe an unmanaged transform.
   */
  let historyScrollX = $state(0);
  function onHistoryScroll(): void {
    historyScrollX = scrollElement?.scrollLeft ?? 0;
  }

  function startColumnResize(event: PointerEvent, id: HistoryColumnId): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    // The graph is never narrower than its lane floor; dragging from a
    // floor-raised width must not snap back to the narrower stored one.
    const startWidth =
      id === "graph"
        ? Math.max(columnState.widths[id], graphLaneFloor)
        : columnState.widths[id];
    const floor = id === "graph" ? graphLaneFloor : undefined;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent): void => {
      columnState = resizeColumn(
        columnState,
        id,
        startWidth + move.clientX - startX,
        floor,
      );
    };
    const onEnd = (): void => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  }

  const settingsMenu = $state(createContextMenuState());

  function columnSettingsActions(): readonly ContextAction[] {
    return [
      ...HIDEABLE_COLUMN_IDS.map((id): ContextAction => ({
        kind: "action" as const,
        id: `toggle-${id}`,
        label: headerLabels[id],
        checked: !columnState.hidden.includes(id),
        onSelect: () => {
          columnState = toggleColumn(columnState, id);
        },
      })),
      { kind: "separator" as const, id: "reset-separator" },
      {
        kind: "action" as const,
        id: "reset-columns",
        label: "Reset columns to default layout",
        onSelect: () => {
          columnState = defaultColumnState();
        },
      },
    ];
  }

  let settingsGear = $state<HTMLButtonElement | null>(null);

  function openColumnSettings(): void {
    const gear = settingsGear;
    if (gear === null) {
      return;
    }
    const rect = gear.getBoundingClientRect();
    openAnchoredContextMenu(
      settingsMenu,
      columnSettingsActions(),
      { left: rect.left, bottom: rect.bottom },
      { testId: "history-column-settings-menu" },
    );
  }

  /* ---------------------------------------------------------- context menus */

  const commitMenu = $state(createContextMenuState());

  function commitActionsFor(commit: CommitSummary): readonly ContextAction[] {
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
      ...(onCopyText === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-message",
              label: "Copy Message",
              onSelect: () => onCopyText(commit.subject),
            },
          ]),
    ];
  }

  function openCommitMenu(event: MouseEvent, commit: CommitSummary): void {
    const actions = commitActionsFor(commit);
    if (actions.length === 0) {
      return;
    }
    event.preventDefault();
    openContextMenu(
      commitMenu,
      actions,
      { x: event.clientX + 2, y: event.clientY + 2 },
      { testId: `commit-context-${commit.oid}` },
    );
  }

  let deleteDialogOpen = $state(false);
  let pendingDelete = $state<{ kind: "branch" | "tag"; name: string } | null>(
    null,
  );

  function askDelete(kind: "branch" | "tag", name: string): void {
    pendingDelete = { kind, name };
    deleteDialogOpen = true;
  }

  function refActionsFor(
    ref: ReturnType<typeof classifyCommitRef>,
  ): readonly ContextAction[] {
    if (ref.kind === "local") {
      const isCurrent =
        currentBranch !== null && ref.branchName === currentBranch;
      return [
        ...(onCheckoutBranch !== undefined && !isCurrent
          ? [
              {
                kind: "action" as const,
                id: "checkout",
                label: "Checkout",
                disabled: contextDisabled,
                onSelect: () => onCheckoutBranch(ref.branchName),
              },
            ]
          : []),
        ...(onMergeBranch !== undefined && !isCurrent
          ? [
              {
                kind: "action" as const,
                id: "merge",
                label: `Merge into ${currentBranch ?? "current branch"}`,
                disabled: contextDisabled,
                onSelect: () => onMergeBranch(ref.branchName),
              },
            ]
          : []),
        { kind: "separator" as const, id: "delete-separator" },
        ...(onDeleteBranch !== undefined && !isCurrent
          ? [
              {
                kind: "action" as const,
                id: "delete",
                label: "Delete…",
                destructive: true,
                disabled: contextDisabled,
                onSelect: () => askDelete("branch", ref.branchName),
              },
            ]
          : []),
        ...(onCopyText === undefined
          ? []
          : [
              {
                kind: "action" as const,
                id: "copy-name",
                label: "Copy Branch Name",
                onSelect: () => onCopyText(ref.branchName),
              },
            ]),
      ];
    }
    if (ref.kind === "tag") {
      return [
        ...(onDeleteTag !== undefined
          ? [
              {
                kind: "action" as const,
                id: "delete",
                label: "Delete…",
                destructive: true,
                disabled: contextDisabled,
                onSelect: () => askDelete("tag", ref.tagName),
              },
            ]
          : []),
        ...(onCopyText === undefined
          ? []
          : [
              {
                kind: "action" as const,
                id: "copy-name",
                label: "Copy Tag Name",
                onSelect: () => onCopyText(ref.tagName),
              },
            ]),
      ];
    }
    // Remote-tracking refs and anything unmodelled: this menu has no write for
    // them, so the honest menu is the copy-only one.
    return [
      ...(onCopyText === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-name",
              label: "Copy Name",
              onSelect: () => onCopyText(commitRefDisplayName(ref)),
            },
          ]),
    ];
  }

  function openRefMenu(event: MouseEvent, refName: string): void {
    const ref = classifyCommitRef(refName);
    const actions = refActionsFor(ref);
    event.preventDefault();
    event.stopPropagation();
    if (actions.length === 0) {
      return;
    }
    openContextMenu(
      commitMenu,
      actions,
      { x: event.clientX + 2, y: event.clientY + 2 },
      { testId: `commit-ref-context-${refName}` },
    );
  }

  /* --------------------------------------------------------------- refs UI */

  let refDialogOpen = $state(false);
  let refDialogKind = $state<"branch" | "tag">("branch");
  let refDialogCommit = $state<CommitSummary | null>(null);

  function openRefDialog(kind: "branch" | "tag", commit: CommitSummary): void {
    refDialogKind = kind;
    refDialogCommit = commit;
    refDialogOpen = true;
  }

  const items = $derived($virtualizer.getVirtualItems());
  const totalSize = $derived($virtualizer.getTotalSize());
  const visibleRows = $derived(
    items
      .map((item) => rows[item.index])
      .filter((row): row is GraphRow => row !== undefined),
  );
  const firstVisible = $derived(items[0]?.index ?? 0);

  const shownRefs = $derived.by(() => {
    // Computed once per row set: decoration names classify to stable kinds.
    return new Map(
      commits.map((commit) => [
        commit.oid,
        commit.refNames.slice(0, 3).map((refName) => ({
          refName,
          ref: classifyCommitRef(refName),
        })),
      ]),
    );
  });

  function refTone(
    ref: ReturnType<typeof classifyCommitRef>,
  ): "head" | "branch" | "remote" | "tag" {
    if (ref.kind === "local") {
      return currentBranch !== null && ref.branchName === currentBranch
        ? "head"
        : "branch";
    }
    return ref.kind === "remote" ? "remote" : "tag";
  }
</script>

<div class={cn("flex h-full min-h-0 flex-col gap-2", className)}>
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
      title={filtered ? "No matching commits" : "No commits yet"}
      detail={filtered
        ? "Try adjusting the filters or clear them to see all history."
        : "This repository has no history on these tips."}
    />
  {:else}
    <div
      bind:this={shell}
      class="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-panel"
    >
      <div
        class="relative flex h-7 shrink-0 items-stretch border-b border-border select-none"
        data-testid="history-column-header"
      >
        <!-- The clip window stays put; the transform rides the content div so
             scrolling reveals the table instead of dragging the window away. -->
        <div class="flex min-w-0 flex-1 items-stretch overflow-hidden">
          <div
            class="flex items-stretch"
            style="width: {tableWidth}px; transform: translateX({-historyScrollX}px)"
          >
            {#each cells as cell (cell.id)}
              <div
                class="relative flex items-center border-r border-border/60 px-2.5"
                style="width: {cell.width}px; min-width: {cell.width}px; flex: none"
              >
                <span
                  class="truncate text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                  >{headerLabels[cell.id]}</span
                >
                <span
                  class="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/50"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="resize {headerLabels[cell.id]} column"
                  data-testid={`history-column-resize-${cell.id}`}
                  onpointerdown={(event) => startColumnResize(event, cell.id)}
                ></span>
              </div>
            {/each}
          </div>
        </div>
        <button
          bind:this={settingsGear}
          type="button"
          class="flex shrink-0 items-center px-2 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Column settings"
          title="Column settings"
          data-testid="history-column-settings"
          onclick={openColumnSettings}
        >
          <Settings2 class="size-3.5" />
        </button>
      </div>

      {#if wip !== null}
        <!-- The working copy, pinned between the header and the history the way
             GitKraken pins its `// WIP` row above the graph: the uncommitted state is
             the first thing a read of history should offer, not something reached
             through the sidebar. It rides the same horizontal scroll as the body. -->
        <div class="shrink-0 overflow-hidden border-b border-border/40">
          <div
            class="flex h-7 items-stretch bg-muted/25"
            style="transform: translateX({-historyScrollX}px)"
          >
            <button
              type="button"
              class="flex h-full items-stretch text-left transition-colors hover:bg-muted/50"
              style="width: {tableWidth}px"
              data-testid="wip-row"
              onclick={wip.onSelect}
            >
              {#if refsColumn !== undefined}
                <div
                  class="flex items-center gap-1 overflow-hidden border-r border-border/25 px-2.5"
                  style="width: {refsColumn.width}px; min-width: {refsColumn.width}px; flex: none"
                >
                  {#if currentBranch !== null}
                    <Badge tone="head">
                      <GitBranch />
                      {currentBranch}
                    </Badge>
                  {/if}
                </div>
              {/if}
              {#if graphCell !== undefined}
                <div
                  class="flex shrink-0 items-center border-r border-border/25"
                  style="width: {graphCell.width}px; min-width: {graphCell.width}px; padding-left: {metrics.lanePadding +
                    metrics.radius -
                    6}px"
                >
                  <span
                    aria-hidden="true"
                    class="size-3 rounded-full border-2 border-dashed border-muted-foreground/50"
                  ></span>
                </div>
              {/if}
              <div class="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                <span class="truncate font-mono text-xs text-muted-foreground"
                  >// WIP</span
                >
                <Pencil class="size-3 shrink-0 text-muted-foreground/70" />
                <span class="shrink-0 text-xs text-muted-foreground"
                  >{wip.changedCount}</span
                >
                <span class="truncate text-xs text-muted-foreground/60"
                  >uncommitted changes — click to work on them</span
                >
              </div>
            </button>
          </div>
        </div>
      {/if}

      <div
        bind:this={scrollElement}
        class="relative min-h-0 flex-1 overflow-auto"
        tabindex="0"
        aria-label="Commit history — arrow keys move the selection"
        data-testid="history-scroll"
        onkeydown={onListKeyDown}
        onscroll={onHistoryScroll}
      >
        <div
          class="relative"
          style="height: {totalSize}px; width: {tableWidth}px"
        >
          {#if topology === "continuous" && graphCell !== undefined}
            <svg
              class="pointer-events-none absolute top-0"
              style="left: {graphLeft}px"
              width={graphCell.width}
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
          {/if}

          {#each items as item (item.key)}
            {@const commit = commits[item.index]}
            {@const selected =
              commit !== undefined && commit.oid === selectedOid}
            {@const refs =
              commit === undefined ? [] : (shownRefs.get(commit.oid) ?? [])}
            {@const refsCell = cellById.get("refs")}
            {@const messageCell = cellById.get("message")}
            {@const authorCell = cellById.get("author")}
            {@const dateCell = cellById.get("date")}
            {@const shaCell = cellById.get("sha")}
            {#if commit !== undefined}
              <div
                role="presentation"
                class={cn(
                  "absolute top-0 right-0 left-0",
                  selected ? "bg-primary/10" : "hover:bg-muted/50",
                )}
                style="height: {item.size}px; transform: translateY({item.start}px)"
                oncontextmenu={(event) => openCommitMenu(event, commit)}
              >
                {#if selected}
                  <span
                    class="absolute top-1.5 bottom-1.5 left-0 w-1 rounded-r bg-primary"
                    aria-hidden="true"
                  ></span>
                {/if}
                {#if topology === "sparse"}
                  <div
                    class="absolute top-0 bottom-0 left-0 flex w-6 items-center justify-center"
                  >
                    <span
                      aria-hidden="true"
                      data-testid="sparse-commit-marker"
                      class="size-2 rounded-full border border-muted-foreground/60 bg-panel"
                    ></span>
                  </div>
                {/if}
                <div
                  class="flex h-full items-stretch"
                  style="padding-left: {topology === 'sparse' ? 24 : 0}px"
                >
                  {#if refsCell !== undefined}
                    <div
                      class="flex items-center gap-1 overflow-hidden border-r border-border/25 px-2.5"
                      style="width: {refsCell.width}px; min-width: {refsCell.width}px; flex: none"
                    >
                      {#each refs as entry (entry.refName)}
                        <button
                          type="button"
                          class="cursor-default"
                          data-testid={`commit-ref-${entry.refName}`}
                          title={entry.refName}
                          onclick={() => onSelect(commit)}
                          oncontextmenu={(event) =>
                            openRefMenu(event, entry.refName)}
                        >
                          <Badge tone={refTone(entry.ref)}>
                            {#if entry.ref.kind === "local"}
                              <GitBranch />
                            {:else if entry.ref.kind === "remote"}
                              <Globe />
                            {:else if entry.ref.kind === "tag"}
                              <TagIcon />
                            {/if}
                            {commitRefDisplayName(entry.ref)}
                          </Badge>
                        </button>
                      {/each}
                      {#if commit.refNames.length > 3}
                        <Badge tone="muted" title={commit.refNames.join(", ")}>
                          +{commit.refNames.length - 3}
                        </Badge>
                      {/if}
                    </div>
                  {/if}
                  {#if graphCell !== undefined}
                    <div
                      class="shrink-0 border-r border-border/25"
                      style="width: {graphCell.width}px; min-width: {graphCell.width}px"
                    ></div>
                  {/if}
                  <button
                    type="button"
                    onclick={() => onSelect(commit)}
                    aria-current={selected ? "true" : undefined}
                    data-testid={`commit-row-${commit.oid}`}
                    class={cn(
                      "flex h-full items-center gap-2 px-2.5 text-left",
                      selected
                        ? "font-medium text-foreground"
                        : "text-foreground/90",
                    )}
                    style="width: {messageCell !== undefined ? messageCell.width : 160}px; min-width: {messageCell !== undefined ? messageCell.width : 160}px; flex: none"
                  >
                    <span
                      class="min-w-0 flex-1 truncate text-sm"
                      title={commit.subject}
                    >
                      {commit.subject.length === 0
                        ? "(no subject)"
                        : commit.subject}
                    </span>
                    {#if commit.missingParents.length > 0}
                      <Badge
                        tone="warn"
                        title="A parent object is not present locally, so this line continues to a commit that was not loaded."
                      >
                        boundary
                      </Badge>
                    {/if}
                    {#if commit.signed}
                      <!-- A text badge per row turns every signed history into a wall
                           of chips; GitKraken's signature mark is an icon first. -->
                      <span
                        class="shrink-0 text-muted-foreground/70"
                        title="Commit carries a signature."
                      >
                        <BadgeCheck class="size-3.5" />
                      </span>
                    {/if}
                  </button>
                  {#if authorCell !== undefined}
                    <div
                      class="flex shrink-0 items-center gap-1.5 overflow-hidden border-r border-border/25 px-2.5"
                      style="width: {authorCell.width}px; min-width: {authorCell.width}px"
                    >
                      {#if showAvatars}
                        <AuthorAvatar
                          email={commit.authorEmail}
                          name={commit.authorName}
                        />
                      {/if}
                      <span class="truncate text-xs text-muted-foreground"
                        >{commit.authorName}</span
                      >
                    </div>
                  {/if}
                  {#if dateCell !== undefined}
                    <div
                      class="flex shrink-0 items-center overflow-hidden border-r border-border/25 px-2.5"
                      style="width: {dateCell.width}px; min-width: {dateCell.width}px"
                    >
                      <time
                        class="truncate font-mono text-xs text-muted-foreground/75"
                        datetime={commit.authoredAt}
                        title={absoluteTime(commit.authoredAt)}
                      >
                        {shortAbsoluteTime(commit.authoredAt)}
                      </time>
                    </div>
                  {/if}
                  {#if shaCell !== undefined}
                    <div
                      class="flex shrink-0 items-center overflow-hidden px-2.5"
                      style="width: {shaCell.width}px; min-width: {shaCell.width}px"
                    >
                      <span
                        class="truncate font-mono text-xs text-muted-foreground/60"
                        title={commit.oid}
                      >
                        {shortOid(commit.oid)}
                      </span>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        </div>

        <div
          class="flex items-center justify-center border-t border-border p-2"
        >
          {#if loadingMore}
            <span class="text-xs text-ink-faint" aria-live="polite"
              >Loading more…</span
            >
          {:else if hasMore}
            <span class="text-xs text-ink-faint">Scroll for more</span>
          {:else}
            <span class="text-xs text-ink-faint">End of the loaded history</span
            >
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<ContextMenuLayer
  open={commitMenu.open}
  x={commitMenu.x}
  y={commitMenu.y}
  actions={commitMenu.actions}
  testId={commitMenu.testId}
  onClose={() => closeContextMenu(commitMenu)}
/>
<ContextMenuLayer
  open={settingsMenu.open}
  x={settingsMenu.x}
  y={settingsMenu.y}
  actions={settingsMenu.actions}
  testId={settingsMenu.testId}
  onClose={() => closeContextMenu(settingsMenu)}
/>

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

<ConfirmDialog
  bind:open={deleteDialogOpen}
  title={pendingDelete === null
    ? "Delete ref"
    : pendingDelete.kind === "branch"
      ? `Delete ${pendingDelete.name}?`
      : `Delete tag ${pendingDelete.name}?`}
  description={pendingDelete?.kind === "tag"
    ? "The tag is removed from this repository. Pushed copies stay on the remote until pushed as a deletion."
    : "Only fully merged branches can be deleted; unmerged work is refused by Git."}
  confirmLabel={pendingDelete === null
    ? "Delete"
    : pendingDelete.kind === "branch"
      ? `Delete ${pendingDelete.name}`
      : `Delete tag ${pendingDelete.name}`}
  disabled={pendingDelete === null || contextDisabled}
  onConfirm={() => {
    if (pendingDelete === null) {
      return;
    }
    if (pendingDelete.kind === "branch") {
      onDeleteBranch?.(pendingDelete.name);
    } else {
      onDeleteTag?.(pendingDelete.name);
    }
    pendingDelete = null;
  }}
  data-testid="commit-ref-delete-dialog"
/>
