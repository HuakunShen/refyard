<script lang="ts">
  /**
   * The repositories this session was granted.
   *
   * A list rather than a single repository because the service is a workbench, not a
   * one-repository window: adding more is a future feature (`docs/product/north-star.md`
   * §4), and the UI is written for N repositories from the start so that adding one does
   * not become a refactor.
   *
   * Nothing here is discovered: every row was approved before it appeared, and a row
   * whose HEAD is unborn or detached says so rather than guessing a branch name.
   */
  import type { RepositorySummary } from "@refyard/git-contract";
  import Badge from "../ui/Badge.svelte";
  import { cn } from "../lib/utils.js";
  import { headLabel } from "../lib/format.js";

  interface Props {
    repositories: readonly RepositorySummary[];
    selectedId: string | null;
    onSelect: (repositoryId: string) => void;
    class?: string;
  }

  let {
    repositories,
    selectedId,
    onSelect,
    class: className = "",
  }: Props = $props();
</script>

<ul class={cn("flex flex-col gap-1", className)}>
  {#each repositories as repository (repository.repositoryId)}
    {@const selected = repository.repositoryId === selectedId}
    <li>
      <button
        type="button"
        onclick={() => onSelect(repository.repositoryId)}
        aria-current={selected ? "true" : undefined}
        class={cn(
          "flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors",
          selected
            ? "border-accent/50 bg-accent/10"
            : "border-border bg-panel hover:bg-panel-muted",
        )}
      >
        <span class="flex items-center gap-2">
          <span class="truncate text-sm font-medium text-ink"
            >{repository.displayName}</span
          >
          {#if repository.operationInProgress !== null}
            <Badge tone="warn"
              >{repository.operationInProgress} in progress</Badge
            >
          {/if}
        </span>
        <span class="flex items-center gap-2 text-xs text-ink-muted">
          <span class="truncate font-mono">{headLabel(repository.head)}</span>
          <span class="text-ink-faint">·</span>
          <span
            >{repository.worktreeIds.length}
            {repository.worktreeIds.length === 1
              ? "worktree"
              : "worktrees"}</span
          >
          <span class="text-ink-faint">·</span>
          <span>{repository.objectFormat}</span>
        </span>
        <span
          class="truncate text-xs text-ink-faint"
          title={repository.displayPath}
        >
          {repository.displayPath}
        </span>
      </button>
    </li>
  {/each}
</ul>
