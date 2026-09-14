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
  import { Badge } from "./ui/badge/index.js";
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
    class?: string;
  }

  let {
    snapshot,
    selectedPathId,
    onSelect,
    class: className = "",
  }: Props = $props();

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
    <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span class="font-mono text-ink">{headLabel(snapshot.head)}</span>
      {#if snapshot.upstream !== null}
        <span
          >{snapshot.upstream.ahead}↑ {snapshot.upstream.behind}↓ vs {snapshot
            .upstream.name}</span
        >
      {/if}
      {#if snapshot.operationInProgress !== null}
        <Badge tone="warn">{snapshot.operationInProgress} in progress</Badge>
      {/if}
      <span
        >{snapshot.entryCount} changed {snapshot.entryCount === 1
          ? "path"
          : "paths"}</span
      >
    </div>

    {#if snapshot.entries.length === 0}
      <p class="text-sm text-ink-muted">
        Working tree and index match the last commit.
      </p>
    {:else}
      <ul class="flex flex-col">
        {#each snapshot.entries as entry (entry.pathId)}
          {@const selected = entry.pathId === selectedPathId}
          <li>
            <button
              type="button"
              onclick={() => onSelect(entry)}
              aria-current={selected ? "true" : undefined}
              title={statusEntryLabel(entry)}
              class={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1 text-left",
                selected ? "bg-brand/10" : "hover:bg-panel-muted",
              )}
            >
              <span
                class="w-8 shrink-0 font-mono text-xs text-ink-faint"
                aria-hidden="true"
              >
                {entry.indexStatus}{entry.worktreeStatus}
              </span>
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs text-ink"
                title={entry.displayPath}
              >
                {entry.displayPath}
              </span>
              {#if entry.originalDisplayPath !== null}
                <span
                  class="truncate text-xs text-ink-faint"
                  title={entry.originalDisplayPath}
                >
                  ← {entry.originalDisplayPath}
                </span>
              {/if}
              {#if entry.kind !== "ordinary"}
                <Badge tone={KIND_TONES[entry.kind]}>{entry.kind}</Badge>
              {/if}
              {#if entry.pathEncoding === "unrepresentable"}
                <Badge
                  tone="warn"
                  title="This path's bytes are not valid UTF-8, so it can be read as metadata but not handed back for an operation."
                >
                  metadata only
                </Badge>
              {/if}
              {#if entry.stages !== null && entry.stages.length > 0}
                <Badge
                  tone="danger"
                  title="Conflicted: base, ours and theirs are all present in the index."
                >
                  {entry.stages.length} stages
                </Badge>
              {/if}
              {#if entry.submodule !== null}
                <Badge
                  tone="muted"
                  title="Submodule with changed commit, modified content or untracked files."
                >
                  submodule
                </Badge>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="text-xs text-ink-faint">
      Letters are Git's own: index first, then working tree ({statusLetterLabel(
        "M",
      )} = modified,
      {statusLetterLabel("?")} = untracked). This build reads; it does not stage or
      discard.
    </p>
  </div>
{/if}
