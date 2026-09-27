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
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
  const i18n = useGitViewI18n();
  const { t } = i18n;

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

<div class={cn("flex flex-col gap-2.5", className)} data-testid="staging-panel">
  {#if entries.length === 0}
    <p class="text-xs text-ink-faint italic py-1">
      {t("staging.empty")}
    </p>
  {:else}
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          class="h-7 text-xs px-2.5 shadow-none"
          disabled={disabled || busy}
          onclick={selectAll}
          data-testid="select-all"
        >
          {t(allSelected ? "staging.allSelected" : "staging.selectAll")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          class="h-7 text-xs px-2 text-ink-muted hover:text-ink"
          disabled={disabled || busy || effectiveSelection.length === 0}
          onclick={clearSelection}
        >
          {t("staging.clear")}
        </Button>
      </div>
      <span class="text-[11px] text-ink-faint font-mono">
        {t("staging.selectedCount").replace("{selected}", i18n.count(effectiveSelection.length)).replace("{total}", i18n.count(entries.length))}
      </span>
    </div>

    <ul
      class="flex max-h-60 flex-col gap-1 overflow-y-auto pr-0.5"
      data-testid="staging-list"
    >
      {#each entries as entry (entry.pathId)}
        {@const isChecked = selected.has(entry.pathId)}
        <li
          class={cn(
            "flex shrink-0 items-center gap-2 rounded-md border px-2 py-1 transition-colors",
            isChecked
              ? "border-primary/40 bg-primary/5"
              : "border-border/30 bg-card/40 hover:bg-accent/30 hover:border-border/60",
          )}
        >
          <input
            type="checkbox"
            class="size-3.5 accent-primary rounded shrink-0"
            checked={isChecked}
            disabled={disabled || busy}
            aria-label={t("staging.selectPath").replace("{path}", () => entry.displayPath)}
            onchange={() => toggle(entry.pathId)}
          />
          <span
            class={cn(
              "font-mono text-xs px-1 py-0.5 rounded font-semibold shrink-0 text-[10px]",
              entry.indexStatus !== "."
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            )}
            title={t("staging.statusTitle")}
          >
            {entry.indexStatus}{entry.worktreeStatus}
          </span>
          <span
            class="truncate font-mono text-xs text-foreground flex-1 min-w-0"
            title={i18n.statusLetter(entry.indexStatus)}
          >
            {entry.displayPath}
          </span>
          {#if entry.kind !== "ordinary"}
            <Badge
              tone={entry.kind === "untracked" ? "warn" : "muted"}
              class="text-[10px] h-4.5 px-1.5 shrink-0"
            >
              {i18n.statusKind(entry.kind)}
            </Badge>
          {/if}
        </li>
      {/each}
    </ul>

    <div
      class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/30"
    >
      <Button
        size="sm"
        class="h-7 text-xs px-2.5"
        disabled={disabled || busy || effectiveSelection.length === 0}
        onclick={() => onStage(effectiveSelection)}
        data-testid="stage-selected"
      >
        {t("staging.stage").replace("{count}", effectiveSelection.length === 0 ? "" : i18n.count(effectiveSelection.length))}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        class="h-7 text-xs px-2.5 shadow-none"
        disabled={disabled || busy || actionable.length === 0}
        onclick={() => onUnstage(actionable)}
        data-testid="unstage-selected"
      >
        {t("staging.unstage").replace("{count}", actionable.length === 0 ? "" : i18n.count(actionable.length))}
      </Button>
      <span class="ml-auto">
        <ConfirmAction
          label={t("staging.discard").replace("{count}", actionable.length === 0 ? "" : i18n.count(actionable.length))}
          confirmLabel={t("staging.discardConfirm").replace("{paths}", i18n.paths(actionable.length))}
          description={t("staging.discardDescription")}
          disabled={disabled || busy || actionable.length === 0}
          {busy}
          onConfirm={() => onDiscard(actionable)}
          data-testid="discard-selected"
        />
      </span>
    </div>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="staging-message">
      {message}
    </p>
  {/if}
</div>
