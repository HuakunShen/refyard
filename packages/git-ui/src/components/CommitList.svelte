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
  import BadgeCheck from "@lucide/svelte/icons/badge-check";
  import Check from "@lucide/svelte/icons/check";
  import Globe from "@lucide/svelte/icons/globe";
  import Laptop from "@lucide/svelte/icons/laptop";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import TagIcon from "@lucide/svelte/icons/tag";
  import { headSegmentFor } from "../lib/head-segment.js";
  import { Badge } from "./ui/badge/index.js";
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitRefDialog from "./CommitRefDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ResetBranchDialog from "./ResetBranchDialog.svelte";
  import WorktreeFromCommitDialog from "./WorktreeFromCommitDialog.svelte";
  import SquashCommitDialog from "./SquashCommitDialog.svelte";
  import ContextMenuLayer from "./ContextMenuLayer.svelte";
  import StateBanner from "./StateBanner.svelte";
  import {
    DEFAULT_METRICS,
    compressedMetrics,
    lanePaint,
    type GraphMetrics,
  } from "../lib/geometry.js";
  import {
    authorAvatar,
    githubBranchUrl,
    githubCommitUrl,
  } from "../lib/avatars.js";
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
    groupCommitRefs,
    type CommitRefBadgeGroup,
  } from "../lib/history-refs.js";
  import { shortOid } from "../lib/format.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
    /**
     * A GitHub remote URL for this repository, when it has one. Used only to offer
     * "Copy GitHub link" items; without it those items are absent rather than
     * disabled, because a link that cannot exist is not a feature.
     */
    githubRemoteUrl?: string;
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
     * Undo one completed commit with Git's own revert. The component only
     * asks for confirmation; the host refuses merges, aborts conflicts, and
     * reports anything uncertain as unknown. Absent means the host cannot.
     */
    onRevertCommit?: (commit: CommitSummary) => void;
    /**
     * Move the checked-out branch to a commit, soft or mixed — the host
     * refuses modes that could lose content, so none are offered. Absent
     * means the host cannot.
     */
    onResetBranch?: (commit: CommitSummary, mode: "soft" | "mixed") => void;
    /**
     * Apply this commit's change onto the checked-out branch, keeping the
     * original message and author. A conflict stops into the state the
     * sidebar's conflict panel finishes. Absent means the host cannot.
     */
    onCherryPickCommit?: (commit: CommitSummary) => void;
    /**
     * Check a remote-tracking branch out into a new local branch of the same
     * name at the ref's commit, then switch to it. The menu item only offers
     * remote branches that have no local twin on the same commit. Absent
     * means the host cannot.
     */
    onCheckoutRemoteBranch?: (branchName: string, startOid: string) => void;
    /**
     * Replay the checked-out branch's own commits onto this branch's tip.
     * Offered on local branches only, never on the checked-out branch itself.
     * Absent means the host cannot.
     */
    onRebaseOntoBranch?: (branchName: string, tipOid: string) => void;
    /**
     * Remove this commit from the checked-out branch by replaying its
     * descendants onto its parent — history rewriting, hence the host's own
     * refusals and this component's confirmation dialog. Absent means the
     * host cannot.
     */
    onDropCommit?: (commit: CommitSummary) => void;
    /**
     * Fold the checked-out branch's top commit into the one below it. The
     * menu item appears on the top commit's row only, which is what
     * `headOid` marks; absent means the host cannot.
     */
    onSquashTopCommit?: (message: string | null) => void;
    /** The checked-out branch's tip, which is the only squashable row. */
    headOid?: string | null;
    /**
     * Add a linked worktree whose new branch starts at this commit. The
     * component asks for the destination and branch name; the host's own
     * validation refuses paths that leave the approved root. Absent means the
     * host cannot.
     */
    onCreateWorktreeAt?: (
      commit: CommitSummary,
      relativeDestination: string,
      branchName: string,
    ) => void;
    /**
     * Author photos from GitHub, keyed off noreply commit emails. On by
     * default; a privacy-conscious host can turn the column to initials only.
     */
    showAvatars?: boolean;
    /**
     * Remote avatar URLs by remote name (GitHub org photos from the remote's
     * URL, when the host can resolve one); remotes absent from the map get a
     * globe icon on their badges.
     */
    remoteAvatars?: ReadonlyMap<string, string>;
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
    githubRemoteUrl = undefined,
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
    onRevertCommit = undefined,
    onResetBranch = undefined,
    onCreateWorktreeAt = undefined,
    onCherryPickCommit = undefined,
    onCheckoutRemoteBranch = undefined,
    onRebaseOntoBranch = undefined,
    onDropCommit = undefined,
    onSquashTopCommit = undefined,
    headOid = null,
    showAvatars = true,
    remoteAvatars = undefined,
    class: className = "",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;

  function inject(
    key: Parameters<typeof t>[0],
    tokens: Readonly<Record<string, string>>,
  ): string {
    let value = t(key);
    for (const [name, token] of Object.entries(tokens)) {
      value = value.replace(`{${name}}`, () => token);
    }
    return value;
  }

  function compactTime(iso: string): string {
    const timestamp = Date.parse(iso);
    return Number.isNaN(timestamp)
      ? t("xross.time.invalid")
      : new Intl.DateTimeFormat(i18n.locale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(timestamp);
  }

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

  /**
   * The row height the virtualizer currently believes in.
   *
   * Deliberately not reactive: it exists so the effect below can tell a density change
   * from a page arriving, and making it `$state` would make that effect its own
   * dependency.
   */
  let lastRowHeight: number | null = null;

  $effect(() => {
    const count = commits.length;
    const rowHeight = metrics.rowHeight;
    instance?.setOptions({ count, estimateSize: () => rowHeight });
    if (lastRowHeight !== null && lastRowHeight !== rowHeight) {
      // A row's height *is* the virtualizer's item size here, so a density change has to
      // discard the sizes it measured at the old one. Without this, switching density
      // left every row at its previous height until something else remounted the list:
      // the setting looked like it did nothing until a reload.
      instance?.measure();
    }
    lastRowHeight = rowHeight;
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
   * The graph column no longer owns a lane floor: whatever width it has, the
   * lanes compress into it (GitKraken-style). Filtered (sparse) history has no
   * graph at all.
   */
  const cells = $derived(
    visibleColumns(columnState).filter(
      (cell) => cell.id !== "graph" || topology === "continuous",
    ),
  );
  const cellById = $derived(new Map(cells.map((cell) => [cell.id, cell])));
  const graphCell = $derived(cellById.get("graph"));
  const graphLeft = $derived(cellById.get("refs")?.width ?? 0);
  const refsColumn = $derived(cellById.get("refs"));
  const headerLabels = $derived<Record<HistoryColumnId, string>>({
    refs: t("history.column.refs"),
    graph: t("history.column.graph"),
    message: t("history.column.message"),
    author: t("history.column.author"),
    date: t("history.column.date"),
    sha: t("history.column.sha"),
  });

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
   * The metrics the graph actually draws with: the lanes compress into whatever
   * width the graph column has, so a narrowed column squeezes its spacing
   * instead of forcing the table wide.
   */
  const graphMetrics = $derived(
    graphCell === undefined
      ? metrics
      : compressedMetrics(laneCount, graphCell.width, metrics),
  );
  /**
   * The rows where the checked-out branch still owns its line, GitKraken's tinted
   * "what my branch adds" segment. Skipped when filtered: a filtered list does not
   * start at HEAD, so rows[0] is not the branch tip the walk has to start from.
   */
  const headSegment = $derived(filtered ? null : headSegmentFor(rows));

  /**
   * GitHub photo URLs by commit oid, for the graph's avatar nodes. Authors the
   * commit email cannot map keep the plain coloured dot.
   */
  const avatarByOid = $derived.by(() => {
    const map = new Map<string, string>();
    if (showAvatars) {
      for (const commit of commits) {
        const avatar = authorAvatar(commit.authorEmail, commit.authorName);
        if (avatar.kind === "github") {
          map.set(commit.oid, avatar.url);
        }
      }
    }
    return map;
  });

  /**
   * The header (and the WIP row above the body) live outside the scrolling
   * element, so the body's horizontal scroll is mirrored into them as a
   * translateX. It must be reactive state, not an imperative style write:
   * Svelte rewrites this element's style attribute when the table width
   * changes mid-scroll, which would wipe an unmanaged transform.
   */
  let historyScrollX = $state(0);
  function onHistoryScroll(): void {
    const left = scrollElement?.scrollLeft ?? 0;
    // Clear on horizontal movement only: an auto-reveal vertical scroll (from
    // clicking or hovering a row just brought into view) fires this too, and
    // would tear down a menu or badge overlay the pointer is still on.
    if (left !== historyScrollX) {
      expandedRef = null;
    }
    historyScrollX = left;
  }

  function startColumnResize(event: PointerEvent, id: HistoryColumnId): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnState.widths[id];
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent): void => {
      columnState = resizeColumn(
        columnState,
        id,
        startWidth + move.clientX - startX,
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
        label: t("history.column.reset"),
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
              label: t("history.action.createBranch"),
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
              label: t("history.action.createTag"),
              disabled: contextDisabled,
              onSelect: () => openRefDialog("tag", commit),
            },
          ]),
      ...(onCreateWorktreeAt === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "create-worktree",
              label: t("history.action.createWorktree"),
              disabled: contextDisabled,
              onSelect: () => askWorktree(commit),
            },
          ]),
      ...(onRevertCommit === undefined
        ? []
        : [
            { kind: "separator" as const, id: "revert-separator" },
            {
              kind: "action" as const,
              id: "revert-commit",
              label: t("history.action.revert"),
              disabled: contextDisabled,
              onSelect: () => askRevert(commit),
            },
          ]),
      ...(onCherryPickCommit === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "cherry-pick-commit",
              label: t("history.action.cherryPick"),
              disabled: contextDisabled,
              onSelect: () => askCherryPick(commit),
            },
          ]),
      ...(onSquashTopCommit !== undefined &&
      headOid !== null &&
      commit.oid === headOid &&
      (rows.find((row) => row.id === commit.oid)?.parentIds.length ?? 0) > 0
        ? [
            {
              kind: "action" as const,
              id: "squash-commit",
              label: t("history.action.squash"),
              disabled: contextDisabled,
              onSelect: () => askSquash(),
            },
          ]
        : []),
      ...(onDropCommit === undefined
        ? []
        : [
            { kind: "separator" as const, id: "drop-separator" },
            {
              kind: "action" as const,
              id: "drop-commit",
              label: t("history.action.drop"),
              destructive: true,
              disabled: contextDisabled,
              onSelect: () => askDrop(commit),
            },
          ]),
      ...(onResetBranch === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "reset-branch",
              label: t("history.action.reset"),
              disabled: contextDisabled,
              onSelect: () => askReset(commit),
            },
          ]),
      { kind: "separator" as const, id: "copy-separator" },
      ...(onCopyOid === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-sha",
              label: t("history.action.copySha"),
              onSelect: () => onCopyOid(commit),
            },
          ]),
      ...(onCopyText === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-message",
              label: t("history.action.copyMessage"),
              onSelect: () => onCopyText(commit.subject),
            },
          ]),
      ...(commitUrlFor(commit) === null || onCopyText === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-github-link",
              label: t("history.action.copyGithubLink"),
              onSelect: () => {
                const url = commitUrlFor(commit);
                if (url !== null) {
                  onCopyText(url);
                }
              },
            },
          ]),
    ];
  }

  /** The branch's page on GitHub, or null when there is no GitHub remote. */
  function branchUrlFor(branchName: string): string | null {
    return githubRemoteUrl === undefined
      ? null
      : githubBranchUrl(githubRemoteUrl, branchName);
  }

  /** The commit's page on GitHub, or null when there is no GitHub remote. */
  function commitUrlFor(commit: CommitSummary): string | null {
    return githubRemoteUrl === undefined
      ? null
      : githubCommitUrl(githubRemoteUrl, commit.oid);
  }

  /**
   * The right button's *press* must not start anything. WebKit places the caret on
   * right-mouse-down, so right-clicking a commit highlighted the words under and below
   * the pointer; the `contextmenu` event's own preventDefault is too late, because the
   * selection began one event earlier. Refusing the press's default stops exactly that,
   * and the `contextmenu` event still fires, which is what opens the menu.
   */
  function refuseRightPress(event: MouseEvent): void {
    if (event.button === 2) {
      event.preventDefault();
    }
  }

  /**
   * Clears whatever the right press may have selected. WebKit's own handling can place
   * a caret — and with it a word selection — on the press itself, before any DOM
   * handler runs, so the menu's opener sweeps the selection away rather than trusting
   * the mousedown's preventDefault to have stopped it. A selection a user made earlier
   * with the left button is theirs, but it is also already gone the moment the right
   * press landed, so there is nothing of theirs to protect here.
   */
  function clearRightPressSelection(): void {
    window.getSelection()?.removeAllRanges();
  }

  function openCommitMenu(event: MouseEvent, commit: CommitSummary): void {
    const actions = commitActionsFor(commit);
    if (actions.length === 0) {
      return;
    }
    event.preventDefault();
    clearRightPressSelection();
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

  let revertDialogOpen = $state(false);
  let pendingRevert = $state<CommitSummary | null>(null);

  function askRevert(commit: CommitSummary): void {
    pendingRevert = commit;
    revertDialogOpen = true;
  }

  let resetDialogOpen = $state(false);
  let pendingReset = $state<CommitSummary | null>(null);

  function askReset(commit: CommitSummary): void {
    pendingReset = commit;
    resetDialogOpen = true;
  }

  let worktreeDialogOpen = $state(false);
  let pendingWorktree = $state<CommitSummary | null>(null);

  function askWorktree(commit: CommitSummary): void {
    pendingWorktree = commit;
    worktreeDialogOpen = true;
  }

  let cherryPickDialogOpen = $state(false);
  let pendingCherryPick = $state<CommitSummary | null>(null);

  function askCherryPick(commit: CommitSummary): void {
    pendingCherryPick = commit;
    cherryPickDialogOpen = true;
  }

  let dropDialogOpen = $state(false);
  let pendingDrop = $state<CommitSummary | null>(null);

  function askDrop(commit: CommitSummary): void {
    pendingDrop = commit;
    dropDialogOpen = true;
  }

  let squashDialogOpen = $state(false);

  function askSquash(): void {
    squashDialogOpen = true;
  }

  function refActionsFor(
    ref: ReturnType<typeof classifyCommitRef>,
    commit: CommitSummary,
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
                label: t("history.action.checkout"),
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
                // GitKraken names both sides — "Merge feature into main" — because a
                // menu opened on a ref label sits between other rows and the direction
                // is the one thing a misread click cannot undo.
                label: `Merge ${ref.branchName} into ${currentBranch ?? "current branch"}`,
                disabled: contextDisabled,
                onSelect: () => onMergeBranch(ref.branchName),
              },
            ]
          : []),
        ...(onRebaseOntoBranch !== undefined && !isCurrent
          ? [
              {
                kind: "action" as const,
                id: "rebase-onto",
                label: `Rebase ${currentBranch ?? "current branch"} onto ${ref.branchName}`,
                disabled: contextDisabled,
                onSelect: () => onRebaseOntoBranch(ref.branchName, commit.oid),
              },
            ]
          : []),
        { kind: "separator" as const, id: "delete-separator" },
        ...(onDeleteBranch !== undefined && !isCurrent
          ? [
              {
                kind: "action" as const,
                id: "delete",
                label: t("history.action.deleteMore"),
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
                label: t("history.action.copyBranchName"),
                onSelect: () => onCopyText(ref.branchName),
              },
            ]),
        ...(onCopyText === undefined || branchUrlFor(ref.branchName) === null
          ? []
          : [
              {
                kind: "action" as const,
                id: "copy-github-branch",
                label: t("history.action.copyGithubLink"),
                onSelect: () => {
                  const url = branchUrlFor(ref.branchName);
                  if (url !== null) {
                    onCopyText(url);
                  }
                },
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
                label: t("history.action.deleteMore"),
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
                label: t("history.action.copyTagName"),
                onSelect: () => onCopyText(ref.tagName),
              },
            ]),
      ];
    }
    if (ref.kind === "remote") {
      return [
        ...(onCheckoutRemoteBranch !== undefined
          ? [
              {
                kind: "action" as const,
                id: "checkout-remote",
                label: inject("history.action.checkoutRemote", {
                  ref: `${ref.remoteName}/${ref.branchName}`,
                }),
                disabled: contextDisabled,
                onSelect: () =>
                  onCheckoutRemoteBranch(ref.branchName, commit.oid),
              },
            ]
          : []),
        ...(onCopyText === undefined
          ? []
          : [
              {
                kind: "action" as const,
                id: "copy-name",
                label: t("history.action.copyName"),
                onSelect: () => onCopyText(commitRefDisplayName(ref)),
              },
            ]),
      ];
    }
    // Anything else unmodelled: this menu has no write for it, so the honest
    // menu is the copy-only one.
    return [
      ...(onCopyText === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "copy-name",
              label: t("history.action.copyName"),
              onSelect: () => onCopyText(commitRefDisplayName(ref)),
            },
          ]),
    ];
  }

  function openRefMenu(
    event: MouseEvent,
    group: CommitRefBadgeGroup,
    commit: CommitSummary,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    clearRightPressSelection();
    // One pill can stand for several refs (local branch + its remote twins).
    // The menu is the union: the primary ref's actions first, then each other
    // ref's honest copy-only actions, so right-clicking a merged pill can
    // still address the remote by name.
    const primary =
      group.refs.find((entry) => entry.refName === group.primaryRefName) ??
      group.refs[0];
    if (primary === undefined) {
      return;
    }
    let actions: readonly ContextAction[] = refActionsFor(primary.ref, commit);
    for (const entry of group.refs) {
      if (
        entry.refName === group.primaryRefName ||
        entry.ref.kind !== "remote"
      ) {
        continue;
      }
      actions = [
        ...actions,
        { kind: "separator" as const, id: `sep-${entry.refName}` },
        ...(onCopyText === undefined
          ? []
          : [
              {
                kind: "action" as const,
                id: `copy-${entry.refName}`,
                label: inject("history.action.copyRef", {
                  ref: commitRefDisplayName(entry.ref),
                }),
                onSelect: () => onCopyText(commitRefDisplayName(entry.ref)),
              },
            ]),
      ];
    }
    if (actions.length === 0) {
      return;
    }
    openContextMenu(
      commitMenu,
      actions,
      { x: event.clientX + 2, y: event.clientY + 2 },
      { testId: `commit-ref-context-${group.primaryRefName}` },
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

  const refGroups = $derived.by(() => {
    // Computed once per row set: decoration names cluster into logical-branch
    // badges (a local branch and its in-sync remote twin share one pill), and
    // a row shows at most three of them before the +N badge.
    return new Map(
      commits.map((commit) => [
        commit.oid,
        groupCommitRefs(commit.refNames, currentBranch).slice(0, 3),
      ]),
    );
  });

  /** Remote avatars that failed to load fall back to a globe, per remote. */
  let failedRemoteAvatars = $state<ReadonlySet<string>>(new Set());

  function groupTone(
    group: CommitRefBadgeGroup,
  ): "head" | "branch" | "remote" | "tag" {
    if (group.head) {
      return "head";
    }
    if (group.local) {
      return "branch";
    }
    return group.remotes.length > 0 ? "remote" : "tag";
  }

  /* --------------------------------------------------- ref badge expansion */

  type ExpandedRefBadge = {
    /** The row that owns the overlay: a commit oid, or `"wip"` for the WIP row. */
    owner: string;
    /** Position within the owning row (the badge's offsetLeft/offsetTop). */
    left: number;
    top: number;
    label: string;
    tone: "head" | "branch" | "remote" | "tag";
    head: boolean;
    local: boolean;
    remotes: readonly string[];
    tag: boolean;
  };

  /**
   * GitKraken-style hover expansion: a ref badge truncated by a narrow
   * Branch / Tag column grows a floating full-name copy on hover. The overlay
   * is positioned against the row (the nearest positioned ancestor), so the
   * cell's own overflow-hidden does not clip it and it may reach over the
   * graph the way GitKraken's does.
   */
  let expandedRef = $state<ExpandedRefBadge | null>(null);

  function showExpandedRef(
    event: MouseEvent,
    owner: string,
    info: Omit<ExpandedRefBadge, "owner" | "left" | "top">,
  ): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    // Only a badge that is actually truncated expands; an untruncated hover
    // would just re-draw the same badge with a shadow. The truncation lives on
    // the label span (the ellipsis is drawn there), so that is what measures.
    const badge = target.matches('[data-slot="badge"]')
      ? target
      : target.querySelector<HTMLElement>('[data-slot="badge"]');
    if (badge === null) {
      expandedRef = null;
      return;
    }
    const label = badge.querySelector<HTMLElement>("span.truncate") ?? badge;
    if (label.scrollWidth <= label.clientWidth + 1) {
      expandedRef = null;
      return;
    }
    expandedRef = {
      owner,
      left: target.offsetLeft,
      top: target.offsetTop,
      ...info,
    };
  }

  function expandRefGroup(
    event: MouseEvent,
    owner: string,
    group: CommitRefBadgeGroup,
  ): void {
    showExpandedRef(event, owner, {
      label: group.name,
      tone: groupTone(group),
      head: group.head,
      local: group.local,
      remotes: group.remotes,
      tag: group.tag,
    });
  }

  function clearExpandedRef(owner: string): void {
    if (expandedRef?.owner === owner) {
      expandedRef = null;
    }
  }
</script>

<div class={cn("flex h-full min-h-0 flex-col gap-2", className)}>
  {#if tipsMoved}
    <StateBanner
      state="stale"
      title={t("history.tipsMovedTitle")}
      detail={t("history.tipsMovedDetail")}
    />
  {/if}
  {#if shallow}
    <StateBanner
      state="info"
      title={t("history.shallowTitle")}
      detail={t("history.shallowDetail")}
    />
  {/if}

  {#if commits.length === 0}
    <StateBanner
      state="empty"
      title={t(filtered ? "history.noMatching" : "history.noCommits")}
      detail={filtered
        ? t("history.noMatchingDetail")
        : t("history.noCommitsDetail")}
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
                  aria-label={inject("history.resizeColumn", {
                    column: headerLabels[cell.id],
                  })}
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
          aria-label={t("history.column.settings")}
          title={t("history.column.settings")}
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
                    <Badge
                      tone="head"
                      class="max-w-full"
                      onmouseenter={(event) =>
                        showExpandedRef(event, "wip", {
                          label: currentBranch,
                          tone: "head",
                          head: true,
                          local: true,
                          remotes: [],
                          tag: false,
                        })}
                      onmouseleave={() => clearExpandedRef("wip")}
                    >
                      <Check />
                      <Laptop />
                      <span class="min-w-0 truncate">{currentBranch}</span>
                    </Badge>
                  {/if}
                </div>
              {/if}
              {#if graphCell !== undefined}
                <div
                  class="flex shrink-0 items-center border-r border-border/25"
                  style="width: {graphCell.width}px; min-width: {graphCell.width}px; padding-left: {graphMetrics.lanePadding +
                    graphMetrics.radius -
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
                  >// {t("history.wip")}</span
                >
                <Pencil class="size-3 shrink-0 text-muted-foreground/70" />
                <span class="shrink-0 text-xs text-muted-foreground"
                  >{i18n.count(wip.changedCount)}</span
                >
                <span class="truncate text-xs text-muted-foreground/60"
                  >{t("history.uncommittedChanges")}</span
                >
              </div>
            </button>
            {#if expandedRef !== null && expandedRef.owner === "wip"}
              <span
                class="pointer-events-none absolute top-1.5 z-30 rounded-4xl bg-panel shadow-md"
                style="left: {expandedRef.left}px"
                data-testid="ref-badge-overlay"
              >
                <Badge tone="head">
                  <Check />
                  <Laptop />
                  {expandedRef.label}
                </Badge>
              </span>
            {/if}
          </div>
        </div>
      {/if}

      <div
        bind:this={scrollElement}
        class="relative min-h-0 flex-1 overflow-auto"
        tabindex="0"
        aria-label={t("history.keyboardHint")}
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
                metrics={graphMetrics}
                {avatarByOid}
                {selectedOid}
              />
            </svg>
          {/if}

          {#each items as item (item.key)}
            {@const commit = commits[item.index]}
            {@const selected =
              commit !== undefined && commit.oid === selectedOid}
            {@const refsCell = cellById.get("refs")}
            {@const messageCell = cellById.get("message")}
            {@const authorCell = cellById.get("author")}
            {@const dateCell = cellById.get("date")}
            {@const shaCell = cellById.get("sha")}
            <!-- The lane this row sits on, for tinting its ref labels: GitKraken paints a
                 branch label in the colour of the line it names, which is what makes a
                 colourful graph readable at a glance. -->
            {@const rowLane = rows[item.index]}
            {@const laneTint =
              rowLane === undefined ? undefined : lanePaint(rowLane.laneColor)}
            {@const segmentTint =
              headSegment !== null &&
              commit !== undefined &&
              headSegment.ids.has(commit.oid)
                ? lanePaint(headSegment.token)
                : undefined}
            {#if commit !== undefined}
              <div
                role="presentation"
                class={cn(
                  "absolute top-0 right-0 left-0 cursor-default",
                  selected ? "bg-primary/10" : "hover:bg-muted/50",
                )}
                style="height: {item.size}px; transform: translateY({item.start}px);{segmentTint !==
                  undefined && !selected
                  ? ` background-color: color-mix(in oklab, ${segmentTint} 12%, transparent);`
                  : ''}"
                onclick={() => onSelect(commit)}
                onmousedown={refuseRightPress}
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
                    {@const groups = refGroups.get(commit.oid) ?? []}
                    <div
                      class="flex items-center gap-1 overflow-hidden border-r border-border/25 px-2.5"
                      style="width: {refsCell.width}px; min-width: {refsCell.width}px; flex: none"
                    >
                      {#each groups as group (group.primaryRefName)}
                        <button
                          type="button"
                          class="min-w-0 max-w-full cursor-default"
                          data-testid={`commit-ref-${group.primaryRefName}`}
                          title={group.refs
                            .map((entry) => entry.refName)
                            .join(" ")}
                          onclick={() => onSelect(commit)}
                          onmousedown={refuseRightPress}
                          oncontextmenu={(event) =>
                            openRefMenu(event, group, commit)}
                          onmouseenter={(event) =>
                            expandRefGroup(event, commit.oid, group)}
                          onmouseleave={() => clearExpandedRef(commit.oid)}
                        >
                          <Badge
                            tone={groupTone(group)}
                            class="max-w-full"
                            style={laneTint === undefined || group.tag
                              ? undefined
                              : `border-color: color-mix(in oklab, ${laneTint} 45%, transparent); background-color: color-mix(in oklab, ${laneTint} 15%, transparent); color: ${laneTint}`}
                          >
                            {#if group.head}
                              <Check />
                            {/if}
                            {#if group.local}
                              <Laptop />
                            {/if}
                            {#each group.remotes as remoteName (remoteName)}
                              {#if remoteAvatars?.get(remoteName) !== undefined && !failedRemoteAvatars.has(remoteName)}
                                <img
                                  src={remoteAvatars.get(remoteName)}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  referrerpolicy="no-referrer"
                                  class="size-3 shrink-0 rounded-full object-cover"
                                  onerror={() => {
                                    failedRemoteAvatars = new Set(
                                      failedRemoteAvatars,
                                    ).add(remoteName);
                                  }}
                                />
                              {:else}
                                <Globe />
                              {/if}
                            {/each}
                            {#if group.tag}
                              <TagIcon />
                            {/if}
                            <span class="min-w-0 truncate">{group.name}</span>
                          </Badge>
                        </button>
                      {/each}
                      {#if groups.length > 3}
                        <Badge tone="muted" title={commit.refNames.join(", ")}>
                          +{i18n.count(groups.length - 3)}
                        </Badge>
                      {/if}
                    </div>
                  {/if}
                  {#if graphCell !== undefined}
                    <div
                      class="relative shrink-0 border-r border-border/25"
                      style="width: {graphCell.width}px; min-width: {graphCell.width}px"
                    >
                      {#if laneTint !== undefined}
                        <!-- GitKraken marks every row with its lane's colour at the
                             graph's right edge, which keeps the lanes readable when
                             the graph itself is squeezed or mostly straight. -->
                        <span
                          class="absolute top-1.5 bottom-1.5 right-0.5 w-1 rounded-full"
                          style="background-color: {laneTint}"
                          aria-hidden="true"
                        ></span>
                      {/if}
                    </div>
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
                    style="width: {messageCell !== undefined
                      ? messageCell.width
                      : 160}px; min-width: {messageCell !== undefined
                      ? messageCell.width
                      : 160}px; flex: none"
                  >
                    <span
                      class="min-w-0 flex-1 truncate text-sm"
                      title={commit.subject}
                    >
                      {commit.subject.length === 0
                        ? t("history.noSubject")
                        : commit.subject}
                    </span>
                    {#if commit.missingParents.length > 0}
                      <Badge tone="warn" title={t("history.boundaryHelp")}>
                        {t("history.boundary")}
                      </Badge>
                    {/if}
                    {#if commit.signed}
                      <!-- A text badge per row turns every signed history into a wall
                           of chips; GitKraken's signature mark is an icon first. -->
                      <span
                        class="shrink-0 text-muted-foreground/70"
                        title={t("history.signedHelp")}
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
                        title={i18n.absoluteIso(commit.authoredAt)}
                      >
                        {compactTime(commit.authoredAt)}
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
                {#if expandedRef !== null && expandedRef.owner === commit.oid}
                  <span
                    class="pointer-events-none absolute z-30 rounded-4xl bg-panel shadow-md"
                    style="left: {expandedRef.left}px; top: {expandedRef.top}px"
                    data-testid="ref-badge-overlay"
                  >
                    <Badge tone={expandedRef.tone}>
                      {#if expandedRef.head}
                        <Check />
                      {/if}
                      {#if expandedRef.local}
                        <Laptop />
                      {/if}
                      {#each expandedRef.remotes as remoteName (remoteName)}
                        {#if remoteAvatars?.get(remoteName) !== undefined && !failedRemoteAvatars.has(remoteName)}
                          <img
                            src={remoteAvatars.get(remoteName)}
                            alt=""
                            referrerpolicy="no-referrer"
                            class="size-3 shrink-0 rounded-full object-cover"
                          />
                        {:else}
                          <Globe />
                        {/if}
                      {/each}
                      {#if expandedRef.tag}
                        <TagIcon />
                      {/if}
                      {expandedRef.label}
                    </Badge>
                  </span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>

        <div
          class="flex items-center justify-center border-t border-border p-2"
        >
          {#if loadingMore}
            <span class="text-xs text-ink-faint" aria-live="polite"
              >{t("history.loadingMore")}</span
            >
          {:else if hasMore}
            <span class="text-xs text-ink-faint">{t("history.scrollMore")}</span
            >
          {:else}
            <span class="text-xs text-ink-faint">{t("history.endLoaded")}</span>
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
    ? t("history.deleteRef")
    : pendingDelete.kind === "branch"
      ? inject("history.deleteQuestion", { name: pendingDelete.name })
      : inject("history.deleteTagQuestion", { name: pendingDelete.name })}
  description={pendingDelete?.kind === "tag"
    ? t("history.deleteTagDescription")
    : t("history.deleteBranchDescription")}
  confirmLabel={pendingDelete === null
    ? t("history.delete")
    : pendingDelete.kind === "branch"
      ? inject("history.deleteNamed", { name: pendingDelete.name })
      : inject("history.deleteTagNamed", { name: pendingDelete.name })}
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

<ConfirmDialog
  bind:open={revertDialogOpen}
  title={pendingRevert === null
    ? t("history.revertCommit")
    : inject("history.revertQuestion", { subject: pendingRevert.subject })}
  description={t("history.revertDescription")}
  confirmLabel={pendingRevert === null
    ? t("history.revert")
    : inject("history.revertNamed", { subject: pendingRevert.subject })}
  disabled={pendingRevert === null || contextDisabled}
  onConfirm={() => {
    if (pendingRevert === null) {
      return;
    }
    onRevertCommit?.(pendingRevert);
    pendingRevert = null;
  }}
  data-testid="commit-revert-dialog"
/>

<ResetBranchDialog
  bind:open={resetDialogOpen}
  subject={pendingReset?.subject ?? null}
  branchName={currentBranch}
  disabled={pendingReset === null || contextDisabled}
  onConfirm={(mode) => {
    if (pendingReset === null) {
      return;
    }
    onResetBranch?.(pendingReset, mode);
    pendingReset = null;
  }}
  data-testid="commit-reset-dialog"
/>

<WorktreeFromCommitDialog
  bind:open={worktreeDialogOpen}
  subject={pendingWorktree?.subject ?? null}
  disabled={pendingWorktree === null || contextDisabled}
  onConfirm={(relativeDestination, branchName) => {
    if (pendingWorktree === null) {
      return;
    }
    onCreateWorktreeAt?.(pendingWorktree, relativeDestination, branchName);
    pendingWorktree = null;
  }}
  data-testid="commit-worktree-dialog"
/>

<ConfirmDialog
  bind:open={cherryPickDialogOpen}
  title={pendingCherryPick === null
    ? t("history.cherryPickCommit")
    : inject("history.cherryPickQuestion", {
        subject: pendingCherryPick.subject,
        branch: currentBranch ?? t("history.checkedOutBranch"),
      })}
  description={t("history.cherryPickDescription")}
  confirmLabel={pendingCherryPick === null
    ? t("history.cherryPick")
    : inject("history.cherryPickNamed", { subject: pendingCherryPick.subject })}
  disabled={pendingCherryPick === null || contextDisabled}
  onConfirm={() => {
    if (pendingCherryPick === null) {
      return;
    }
    onCherryPickCommit?.(pendingCherryPick);
    pendingCherryPick = null;
  }}
  data-testid="commit-cherry-pick-dialog"
/>

<ConfirmDialog
  bind:open={dropDialogOpen}
  title={pendingDrop === null
    ? t("history.dropCommit")
    : inject("history.dropQuestion", { subject: pendingDrop.subject })}
  description={t("history.dropDescription")}
  confirmLabel={pendingDrop === null
    ? t("history.drop")
    : inject("history.dropNamed", { subject: pendingDrop.subject })}
  disabled={pendingDrop === null || contextDisabled}
  onConfirm={() => {
    if (pendingDrop === null) {
      return;
    }
    onDropCommit?.(pendingDrop);
    pendingDrop = null;
  }}
  data-testid="commit-drop-dialog"
/>

<SquashCommitDialog
  bind:open={squashDialogOpen}
  subject={headOid === null
    ? null
    : (commits.find((entry) => entry.oid === headOid)?.subject ?? null)}
  disabled={contextDisabled}
  onConfirm={(message) => {
    onSquashTopCommit?.(message);
  }}
  data-testid="commit-squash-dialog"
/>
