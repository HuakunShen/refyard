<script lang="ts">
  /** Top-level repository tabs; one tab is active while the session may keep many open. */
  import { X, Plus } from "@lucide/svelte";
  import { cn } from "../lib/utils.js";

  export interface RepositoryTabItem {
    readonly repositoryId: string;
    readonly displayName: string;
    readonly displayPath: string;
  }

  interface Props {
    tabs: readonly RepositoryTabItem[];
    activeRepositoryId: string | null;
    onSelect: (repositoryId: string) => void;
    onClose: (repositoryId: string) => void;
    onNew: () => void;
  }

  let { tabs, activeRepositoryId, onSelect, onClose, onNew }: Props = $props();
</script>

<div
  class="flex min-w-0 items-center gap-1 overflow-x-auto"
  data-testid="repository-tabs"
>
  {#each tabs as tab (tab.repositoryId)}
    <div
      class={cn(
        "group flex min-w-32 max-w-52 items-center gap-1 rounded-md border px-2 py-1 text-xs",
        tab.repositoryId === activeRepositoryId
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
      )}
      data-testid={`repository-tab-${tab.repositoryId}`}
    >
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left font-medium"
        title={tab.displayPath}
        aria-current={tab.repositoryId === activeRepositoryId
          ? "page"
          : undefined}
        onclick={() => onSelect(tab.repositoryId)}
      >
        {tab.displayName}
      </button>
      <button
        type="button"
        class="rounded p-0.5 text-muted-foreground opacity-70 hover:bg-background hover:text-foreground group-hover:opacity-100"
        aria-label={`Close ${tab.displayName}`}
        onclick={() => onClose(tab.repositoryId)}
      >
        <X class="size-3" />
      </button>
    </div>
  {/each}
  <button
    type="button"
    class="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
    aria-label="New repository tab"
    data-testid="new-repository-tab"
    onclick={onNew}
  >
    <Plus class="size-3" />
    New Tab
  </button>
</div>
