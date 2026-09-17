<script lang="ts">
  /**
   * GitKraken-style working-copy surface: two independently scrollable XY views,
   * explicit per-file staging controls, and a commit composer kept mounted while
   * status reads change or fail so a user's draft is never lost.
   */
  import type { StatusEntry, StatusSnapshot } from "@refyard/git-contract";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import Check from "@lucide/svelte/icons/check";
  import Minus from "@lucide/svelte/icons/minus";
  import Plus from "@lucide/svelte/icons/plus";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import CommitPanel from "./CommitPanel.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextActionMenu from "./ContextActionMenu.svelte";
  import type { ContextAction } from "../lib/context-actions.js";
  import {
    canDiscard,
    canStage,
    canUnstage,
    groupWorkingCopyEntries,
    isUnmerged,
    type WorkingCopyGroups,
  } from "../lib/working-copy.js";
  import { cn } from "../lib/utils.js";

  export type WorkingCopySide = "staged" | "unstaged";

  interface Props {
    status: StatusSnapshot | null;
    worktreeLabel: string;
    worktreePath: string;
    selectedPathId: string | null;
    selectedSide: WorkingCopySide | null;
    disabled?: boolean;
    busy?: boolean;
    stagingAvailable?: boolean;
    commitAvailable?: boolean;
    stagingMessage?: string | null;
    commitMessage?: string | null;
    draft?: string;
    /** Controlled-input bridge for a parent that stores drafts by worktree. */
    onDraftChange?: (draft: string) => void;
    onSelect: (entry: StatusEntry, side: WorkingCopySide) => void;
    onStage?: (pathIds: readonly string[]) => void;
    onUnstage?: (pathIds: readonly string[]) => void;
    onDiscard?: (pathIds: readonly string[]) => void;
    onCommit: (message: string) => void;
    onAmend: (message: string | null) => void;
    class?: string;
  }

  let {
    status,
    worktreeLabel,
    worktreePath,
    selectedPathId,
    selectedSide,
    disabled = false,
    busy = false,
    stagingAvailable = true,
    commitAvailable = true,
    stagingMessage = null,
    commitMessage = null,
    draft = $bindable(""),
    onDraftChange = undefined,
    onSelect,
    onStage = () => undefined,
    onUnstage = () => undefined,
    onDiscard = () => undefined,
    onCommit,
    onAmend,
    class: className = "",
  }: Props = $props();

  const groups = $derived<WorkingCopyGroups>(
    groupWorkingCopyEntries(status?.entries ?? []),
  );
  const conflicts = $derived(
    [...new Set([...groups.unstaged, ...groups.staged])].filter(isUnmerged),
  );
  const commitDisabled = $derived(
    disabled ||
      busy ||
      !commitAvailable ||
      status === null ||
      conflicts.length > 0,
  );

  let discardDialogOpen = $state(false);
  let pendingDiscardEntry = $state<StatusEntry | null>(null);
  let lastWorktreePath = $state<string | null>(null);

  // A confirmation is bound to a concrete path in one checkout. Switching worktrees while the
  // dialog is open must not leave an old path armed for the newly visible checkout. The commit
  // draft deliberately survives this transition because the parent owns it by worktree key.
  $effect(() => {
    const currentPath = worktreePath;
    if (lastWorktreePath === null) {
      lastWorktreePath = currentPath;
      return;
    }
    if (currentPath !== lastWorktreePath) {
      lastWorktreePath = currentPath;
      discardDialogOpen = false;
      pendingDiscardEntry = null;
    }
  });

  function actionDisabled(): boolean {
    return disabled || busy || !stagingAvailable;
  }

  function askDiscard(entry: StatusEntry): void {
    pendingDiscardEntry = entry;
    discardDialogOpen = true;
  }

  function pathActions(entry: StatusEntry): readonly ContextAction[] {
    const disabledAction = actionDisabled();
    return [
      {
        kind: "action",
        id: "stage",
        label: "Stage",
        disabled: disabledAction || !canStage(entry),
        onSelect: () => onStage([entry.pathId]),
      },
      {
        kind: "action",
        id: "unstage",
        label: "Unstage",
        disabled: disabledAction || !canUnstage(entry),
        onSelect: () => onUnstage([entry.pathId]),
      },
      { kind: "separator", id: "discard-separator" },
      {
        kind: "action",
        id: "discard",
        label: "Discard…",
        destructive: true,
        disabled: disabledAction || !canDiscard(entry),
        onSelect: () => askDiscard(entry),
      },
    ];
  }

  function actionPaths(
    entries: readonly StatusEntry[],
    side: WorkingCopySide,
  ): string[] {
    return entries
      .filter((entry) =>
        side === "unstaged" ? canStage(entry) : canUnstage(entry),
      )
      .map((entry) => entry.pathId);
  }

  function selectEntry(entry: StatusEntry, side: WorkingCopySide): void {
    onSelect(entry, side);
  }
</script>

<div
  class={cn("flex min-h-0 h-full flex-col gap-2.5", className)}
  data-testid="working-copy-panel"
>
  <header class="flex min-w-0 items-center justify-between gap-3 px-1">
    <div class="min-w-0">
      <p class="truncate text-sm font-semibold text-ink" title={worktreePath}>
        {worktreeLabel}
      </p>
      <p
        class="truncate font-mono text-[11px] text-ink-faint"
        title={worktreePath}
      >
        {worktreePath}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint">
      {#if conflicts.length > 0}
        <Badge tone="danger" class="gap-1 text-[10px]">
          <AlertTriangle class="size-3" />
          {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}
        </Badge>
      {/if}
      {#if status === null}
        <span class="rounded-full border border-border/50 px-2 py-0.5">
          Status unavailable
        </span>
      {:else}
        <span
          class="rounded-full border border-border/50 px-2 py-0.5 font-mono"
        >
          {status.entryCount} changed
        </span>
      {/if}
    </div>
  </header>

  {#if conflicts.length > 0}
    <div
      class="flex shrink-0 items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-ink"
      role="status"
      data-testid="working-copy-conflict-warning"
    >
      <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-destructive" />
      <span>Resolve and stage every conflicted file before committing.</span>
    </div>
  {/if}

  <div
    class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2"
  >
    {#each [{ side: "unstaged" as const, label: "Unstaged Files", entries: groups.unstaged }, { side: "staged" as const, label: "Staged Files", entries: groups.staged }] as group (group.side)}
      <section
        class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40"
        data-testid={`${group.side}-files`}
      >
        <div
          class="flex shrink-0 items-center justify-between gap-2 border-b border-border/30 px-2.5 py-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="text-xs font-semibold tracking-wide text-ink-muted">
              {group.label}
            </span>
            <span
              class="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-faint"
            >
              {group.entries.length}
            </span>
          </div>
          <Button
            size="xs"
            variant="outline"
            class="h-6 px-2 text-[11px]"
            disabled={actionDisabled() ||
              actionPaths(group.entries, group.side).length === 0}
            onclick={() => {
              const paths = actionPaths(group.entries, group.side);
              if (group.side === "unstaged") {
                onStage(paths);
              } else {
                onUnstage(paths);
              }
            }}
            aria-label={`${group.side === "unstaged" ? "Stage" : "Unstage"} all ${group.label.toLowerCase()}`}
            data-testid={`${group.side}-all`}
          >
            {group.side === "unstaged" ? "Stage all" : "Unstage all"}
          </Button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
          {#if group.entries.length === 0}
            <p class="px-2 py-4 text-center text-xs italic text-ink-faint">
              {#if status === null}
                Waiting for status…
              {:else if group.side === "unstaged"}
                Working tree is clean.
              {:else}
                Nothing staged.
              {/if}
            </p>
          {:else}
            <ul
              class="flex flex-col gap-1"
              data-testid={`${group.side}-file-list`}
            >
              {#each group.entries as entry (entry.pathId)}
                {@const selected =
                  entry.pathId === selectedPathId &&
                  selectedSide === group.side}
                {@const rowActionDisabled = actionDisabled()}
                <li class="min-w-0">
                  <ContextActionMenu
                    actions={pathActions(entry)}
                    triggerClass="block w-full"
                    triggerTestId={`${group.side}-row-${entry.pathId}`}
                  >
                    {#snippet children()}
                      <div
                        class={cn(
                          "group flex min-w-0 items-center gap-1 rounded-lg border px-1.5 py-1 transition-colors",
                          selected
                            ? "border-primary/50 bg-primary/10"
                            : "border-border/30 bg-background/30 hover:border-border/70 hover:bg-accent/30",
                        )}
                      >
                        <button
                          type="button"
                          class="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onclick={() => selectEntry(entry, group.side)}
                          aria-current={selected ? "true" : undefined}
                          title={entry.displayPath}
                          data-testid={`${group.side}-path-${entry.pathId}`}
                        >
                          <span
                            class={cn(
                              "shrink-0 rounded px-1 py-0.5 font-mono text-[10px] font-bold",
                              group.side === "staged"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                            )}
                            title="index / worktree status"
                          >
                            {entry.indexStatus}{entry.worktreeStatus}
                          </span>
                          <span
                            class="min-w-0 flex-1 truncate font-mono text-xs text-ink"
                            title={entry.displayPath}
                          >
                            {entry.displayPath}
                          </span>
                          {#if isUnmerged(entry)}
                            <Badge
                              tone="danger"
                              class="h-4.5 shrink-0 px-1.5 text-[10px]"
                            >
                              conflict
                            </Badge>
                          {:else if entry.kind === "untracked"}
                            <Badge
                              tone="warn"
                              class="h-4.5 shrink-0 px-1.5 text-[10px]"
                            >
                              untracked
                            </Badge>
                          {/if}
                        </button>

                        {#if group.side === "unstaged"}
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            class="size-6 text-ink-muted hover:text-emerald-600"
                            disabled={rowActionDisabled || !canStage(entry)}
                            onclick={() => onStage([entry.pathId])}
                            title={`Stage ${entry.displayPath}`}
                            aria-label={`Stage ${entry.displayPath}`}
                            data-testid={`stage-${entry.pathId}`}
                          >
                            <Plus class="size-3.5" />
                          </Button>
                        {:else}
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            class="size-6 text-ink-muted hover:text-amber-600"
                            disabled={rowActionDisabled || !canUnstage(entry)}
                            onclick={() => onUnstage([entry.pathId])}
                            title={`Unstage ${entry.displayPath}`}
                            aria-label={`Unstage ${entry.displayPath}`}
                            data-testid={`unstage-${entry.pathId}`}
                          >
                            <Minus class="size-3.5" />
                          </Button>
                        {/if}
                      </div>
                    {/snippet}
                  </ContextActionMenu>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </section>
    {/each}
  </div>

  <section
    class="shrink-0 rounded-xl border border-border/60 bg-card/40 px-2.5 py-2.5"
    data-testid="working-copy-commit"
  >
    <div
      class="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-muted"
    >
      <Check class="size-3.5" />
      Commit
      {#if conflicts.length > 0}
        <span class="font-normal text-destructive">Resolve conflicts first</span
        >
      {/if}
    </div>
    {#key worktreePath}
      <CommitPanel
        stagedCount={groups.staged.length}
        disabled={commitDisabled}
        {busy}
        canAmend={status?.head.kind === "born"}
        message={commitMessage}
        bind:draft
        {onDraftChange}
        {onCommit}
        {onAmend}
      />
    {/key}
    {#if stagingMessage !== null}
      <p
        class="mt-2 text-xs text-ink-muted"
        data-testid="working-copy-staging-message"
      >
        {stagingMessage}
      </p>
    {/if}
  </section>
</div>

<ConfirmDialog
  bind:open={discardDialogOpen}
  title={pendingDiscardEntry === null
    ? "Discard path"
    : `Discard ${pendingDiscardEntry.displayPath}?`}
  description="Restore this tracked path to the index version. Refyard writes a recovery backup before changing the working tree."
  confirmLabel="Discard path"
  disabled={pendingDiscardEntry === null || disabled || busy}
  {busy}
  onConfirm={() => {
    if (pendingDiscardEntry !== null) {
      onDiscard([pendingDiscardEntry.pathId]);
      pendingDiscardEntry = null;
    }
  }}
  data-testid="working-copy-discard-dialog"
/>
