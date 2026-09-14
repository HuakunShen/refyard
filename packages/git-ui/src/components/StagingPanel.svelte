<script lang="ts">
  /**
   * The staging surface: choose paths, then stage, unstage or discard exactly those.
   *
   * The rules it encodes, from the operation semantics:
   *
   * - nothing is staged implicitly — every action names its selection, and a batch is
   *   only offered while something is selected;
   * - "select all" is an explicit click on an explicit list, never a default;
   * - discard is a two-step confirm (`ConfirmAction`) because it destroys working-tree
   *   content, and the host backs it up first;
   * - the panel performs no requests itself. The page owns the client, previews and
   *   submissions, so this stays a props-only component another host can mount.
   */
  import type { StatusEntry } from "@refyard/git-contract";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";
  import { statusLetterLabel } from "../lib/format.js";

  interface Props {
    entries: readonly StatusEntry[];
    disabled?: boolean;
    busy?: boolean;
    /** Set while the previous action's outcome is known, cleared on the next one. */
    message?: string | null;
    onStage: (pathIds: readonly string[]) => void;
    onUnstage: (pathIds: readonly string[]) => void;
    onDiscard: (pathIds: readonly string[]) => void;
    class?: string;
  }

  let {
    entries,
    disabled = false,
    busy = false,
    message = null,
    onStage,
    onUnstage,
    onDiscard,
    class: className = "",
  }: Props = $props();

  let selected = $state<Set<string>>(new Set());

  // Selection is keyed by path id, and a path id is stable for the same bytes in the
  // same worktree — so a re-read after an operation keeps what is still valid and
  // silently drops what is gone, instead of acting on a stale id.
  const presentIds = $derived(new Set(entries.map((entry) => entry.pathId)));
  const effectiveSelection = $derived(
    [...selected].filter((pathId) => presentIds.has(pathId)),
  );
  const allSelected = $derived(
    entries.length > 0 && effectiveSelection.length === entries.length,
  );

  function toggle(pathId: string): void {
    const next = new Set(selected);
    if (next.has(pathId)) {
      next.delete(pathId);
    } else {
      next.add(pathId);
    }
    selected = next;
  }

  function selectAll(): void {
    selected = new Set(entries.map((entry) => entry.pathId));
  }

  function clearSelection(): void {
    selected = new Set();
  }

  function canAct(pathId: string): boolean {
    const entry = entries.find((candidate) => candidate.pathId === pathId);
    if (entry === undefined) {
      return false;
    }
    // Untracked and ignored paths cannot be unstaged or discarded; the host refuses
    // them, and offering the button would only produce a refusal.
    return entry.kind !== "untracked" && entry.kind !== "ignored";
  }

  const actionable = $derived(effectiveSelection.filter(canAct));
</script>

<div class={cn("flex flex-col gap-2", className)} data-testid="staging-panel">
  {#if entries.length === 0}
    <p class="text-xs text-ink-faint">
      Nothing to stage — the working tree matches the index.
    </p>
  {:else}
    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy}
        onclick={selectAll}
        data-testid="select-all"
      >
        {allSelected ? "All selected" : "Select all"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || busy || effectiveSelection.length === 0}
        onclick={clearSelection}
      >
        Clear
      </Button>
      <span class="text-xs text-ink-faint">
        {effectiveSelection.length} of {entries.length} selected
      </span>
    </div>

    <ul
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      data-testid="staging-list"
    >
      {#each entries as entry (entry.pathId)}
        <li
          class="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-accent/40"
        >
          <input
            type="checkbox"
            class="size-3.5 accent-primary"
            checked={selected.has(entry.pathId)}
            disabled={disabled || busy}
            aria-label={`select ${entry.displayPath}`}
            onchange={() => toggle(entry.pathId)}
          />
          <span
            class="font-mono text-xs text-ink-muted"
            title="index / worktree"
          >
            {entry.indexStatus}{entry.worktreeStatus}
          </span>
          <span
            class="truncate text-xs"
            title={statusLetterLabel(entry.indexStatus)}
          >
            {entry.displayPath}
          </span>
          {#if entry.kind !== "ordinary"}
            <Badge tone={entry.kind === "untracked" ? "warn" : "muted"}>
              {entry.kind}
            </Badge>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={disabled || busy || effectiveSelection.length === 0}
        onclick={() => onStage(effectiveSelection)}
        data-testid="stage-selected"
      >
        Stage {effectiveSelection.length || ""}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled || busy || actionable.length === 0}
        onclick={() => onUnstage(actionable)}
        data-testid="unstage-selected"
      >
        Unstage {actionable.length || ""}
      </Button>
      <ConfirmAction
        label={`Discard ${actionable.length || ""}`}
        confirmLabel={`Discard ${actionable.length} path${actionable.length === 1 ? "" : "s"} for good`}
        description="Restores the selected files to the index. A backup is written first."
        disabled={disabled || busy || actionable.length === 0}
        {busy}
        onConfirm={() => onDiscard(actionable)}
        data-testid="discard-selected"
      />
    </div>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="staging-message">
      {message}
    </p>
  {/if}
</div>
