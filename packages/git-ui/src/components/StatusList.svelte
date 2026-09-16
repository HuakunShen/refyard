<script lang="ts">
  /**
   * Changed paths, exactly as `git status` reports them.
   *
   * Three things this pane refuses to do, each because the alternative would lie:
   *
   * - it does not translate the status characters into a verdict ("ready to commit"), the
   *   letters are Git's and they are shown with an explicit legend;
   * - it does not hide an unrepresentable path — such a path is readable metadata and is
   *   shown, marked, with its reason, because "the file is not listed" and "the file
   *   cannot be acted on" are different facts;
   * - it does not offer an action. M1 has no mutations, so a row is selectable (to read
   *   its diff) and nothing else.
   */
  import type { StatusEntry, StatusSnapshot } from "@refyard/git-contract";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import { Badge } from "./ui/badge/index.js";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import ContextActionMenu from "./ContextActionMenu.svelte";
  import type { ContextAction } from "../lib/context-actions.js";
  import { cn } from "../lib/utils.js";
  import {
    headLabel,
    statusEntryLabel,
    statusLetterLabel,
  } from "../lib/format.js";

  interface Props {
    snapshot: StatusSnapshot | null;
    selectedPathId: string | null;
    onSelect: (entry: StatusEntry) => void;
    disabled?: boolean;
    busy?: boolean;
    onStage?: (pathIds: readonly string[]) => void;
    onUnstage?: (pathIds: readonly string[]) => void;
    onDiscard?: (pathIds: readonly string[]) => void;
    class?: string;
  }

  let {
    snapshot,
    selectedPathId,
    onSelect,
    disabled = false,
    busy = false,
    onStage = undefined,
    onUnstage = undefined,
    onDiscard = undefined,
    class: className = "",
  }: Props = $props();

  let discardDialogOpen = $state(false);
  let pendingDiscardEntry = $state<StatusEntry | null>(null);

  function representable(entry: StatusEntry): boolean {
    return entry.pathEncoding !== "unrepresentable";
  }

  function canStage(entry: StatusEntry): boolean {
    return (
      representable(entry) &&
      entry.kind !== "ignored" &&
      (entry.kind === "untracked" ||
        entry.kind === "unmerged" ||
        entry.worktreeStatus !== ".")
    );
  }

  function canUnstage(entry: StatusEntry): boolean {
    return (
      representable(entry) &&
      entry.kind !== "untracked" &&
      entry.kind !== "ignored" &&
      entry.indexStatus !== "."
    );
  }

  function canDiscard(entry: StatusEntry): boolean {
    return (
      representable(entry) &&
      entry.kind !== "untracked" &&
      entry.kind !== "ignored" &&
      entry.worktreeStatus !== "."
    );
  }

  function askDiscard(entry: StatusEntry): void {
    pendingDiscardEntry = entry;
    discardDialogOpen = true;
  }

  function pathContextActions(entry: StatusEntry): readonly ContextAction[] {
    const actionDisabled = disabled || busy;
    return [
      ...(onStage === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "stage",
              label: "Stage",
              disabled: actionDisabled || !canStage(entry),
              onSelect: () => onStage([entry.pathId]),
            },
          ]),
      ...(onUnstage === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "unstage",
              label: "Unstage",
              disabled: actionDisabled || !canUnstage(entry),
              onSelect: () => onUnstage([entry.pathId]),
            },
          ]),
      { kind: "separator" as const, id: "discard-separator" },
      ...(onDiscard === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "discard",
              label: "Discard…",
              destructive: true,
              disabled: actionDisabled || !canDiscard(entry),
              onSelect: () => askDiscard(entry),
            },
          ]),
    ];
  }

  const KIND_TONES = {
    ordinary: "muted",
    renamed: "muted",
    copied: "muted",
    unmerged: "danger",
    untracked: "warn",
    ignored: "muted",
  } as const;
</script>

{#if snapshot === null}
  <p class={cn("text-xs text-ink-faint", className)}>No status loaded.</p>
{:else}
  <div class={cn("flex flex-col gap-2", className)}>
    <div
      class="flex flex-wrap items-center gap-2 text-xs text-ink-muted pb-1 border-b border-border/20"
    >
      <span class="font-mono font-medium text-ink"
        >{headLabel(snapshot.head)}</span
      >
      {#if snapshot.upstream !== null}
        <span class="font-mono text-[11px] text-ink-faint">
          {snapshot.upstream.ahead}↑ {snapshot.upstream.behind}↓ vs {snapshot
            .upstream.name}
        </span>
      {/if}
      {#if snapshot.operationInProgress !== null}
        <Badge tone="warn" class="text-[10px]"
          >{snapshot.operationInProgress} in progress</Badge
        >
      {/if}
      <span class="ml-auto text-[11px] font-mono text-ink-faint">
        {snapshot.entryCount} changed {snapshot.entryCount === 1
          ? "path"
          : "paths"}
      </span>
    </div>

    {#if snapshot.entries.length === 0}
      <p class="text-xs text-ink-faint italic py-1">
        Working tree and index match the last commit.
      </p>
    {:else}
      <ul class="flex flex-col gap-1 max-h-60 overflow-y-auto pr-0.5">
        {#each snapshot.entries as entry (entry.pathId)}
          {@const selected = entry.pathId === selectedPathId}
          <li class="shrink-0">
            <ContextActionMenu
              actions={pathContextActions(entry)}
              triggerClass="block w-full"
              triggerTestId={`status-row-${entry.pathId}`}
              data-testid={`status-context-${entry.pathId}`}
            >
              {#snippet children()}
                <button
                  type="button"
                  onclick={() => onSelect(entry)}
                  aria-current={selected ? "true" : undefined}
                  title={statusEntryLabel(entry)}
                  class={cn(
                    "group flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-all cursor-pointer",
                    selected
                      ? "border-primary/50 bg-primary/10 shadow-2xs"
                      : "border-border/30 bg-card/40 hover:border-border/70 hover:bg-accent/30",
                  )}
                >
                  <span
                    class={cn(
                      "font-mono text-[10px] px-1 py-0.5 rounded font-bold shrink-0",
                      entry.indexStatus !== "."
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                    )}
                    aria-hidden="true"
                  >
                    {entry.indexStatus}{entry.worktreeStatus}
                  </span>
                  <span
                    class="min-w-0 flex-1 truncate font-mono text-xs text-ink group-hover:text-foreground"
                    title={entry.displayPath}
                  >
                    {entry.displayPath}
                  </span>
                  {#if entry.originalDisplayPath !== null}
                    <span
                      class="flex items-center gap-0.5 truncate text-[11px] text-ink-faint"
                      title={entry.originalDisplayPath}
                    >
                      <ArrowLeft class="size-2.5 shrink-0" />
                      {entry.originalDisplayPath}
                    </span>
                  {/if}
                  {#if entry.kind !== "ordinary"}
                    <Badge
                      tone={KIND_TONES[entry.kind]}
                      class="text-[10px] h-4.5 px-1.5 shrink-0"
                    >
                      {entry.kind}
                    </Badge>
                  {/if}
                  {#if entry.pathEncoding === "unrepresentable"}
                    <Badge
                      tone="warn"
                      class="text-[10px] h-4.5 px-1.5 shrink-0"
                      title="This path's bytes are not valid UTF-8, so it can be read as metadata but not handed back for an operation."
                    >
                      metadata only
                    </Badge>
                  {/if}
                  {#if entry.stages !== null && entry.stages.length > 0}
                    <Badge
                      tone="danger"
                      class="text-[10px] h-4.5 px-1.5 shrink-0"
                      title="Conflicted: base, ours and theirs are all present in the index."
                    >
                      {entry.stages.length} stages
                    </Badge>
                  {/if}
                  {#if entry.submodule !== null}
                    <Badge
                      tone="muted"
                      class="text-[10px] h-4.5 px-1.5 shrink-0"
                      title="Submodule with changed commit, modified content or untracked files."
                    >
                      submodule
                    </Badge>
                  {/if}
                </button>
              {/snippet}
            </ContextActionMenu>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="text-[11px] text-ink-faint">
      Letters are Git's own: index first, then working tree ({statusLetterLabel(
        "M",
      )} = modified,
      {statusLetterLabel("?")} = untracked).
    </p>
  </div>
{/if}

<ConfirmDialog
  bind:open={discardDialogOpen}
  title={pendingDiscardEntry === null
    ? "Discard path"
    : `Discard ${pendingDiscardEntry.displayPath}?`}
  description="Restore this tracked path to the index version. Refyard writes a recovery backup before changing the working tree."
  confirmLabel="Discard path"
  disabled={pendingDiscardEntry === null || disabled}
  {busy}
  onConfirm={() => {
    if (pendingDiscardEntry !== null) {
      onDiscard?.([pendingDiscardEntry.pathId]);
      pendingDiscardEntry = null;
    }
  }}
  data-testid="path-discard-dialog"
/>
