<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  export interface WorkbenchNavItem {
    readonly id: string;
    readonly label: string;
    readonly count?: number;
    readonly disabled?: boolean;
  }

  interface Props {
    items: readonly WorkbenchNavItem[];
    activeId: string;
    onSelect: (id: string) => void;
    icon?: Snippet<[WorkbenchNavItem]>;
    class?: string;
    "data-testid"?: string;
  }

  let {
    items,
    activeId,
    onSelect,
    icon = undefined,
    class: className = "",
    "data-testid": testId = "workbench-nav",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;
</script>

<nav
  class={cn("flex flex-col gap-0.5", className)}
  aria-label={t("navigation.repository")}
  data-testid={testId}
>
  {#each items as item (item.id)}
    {@const active = item.id === activeId}
    <button
      type="button"
      disabled={item.disabled}
      aria-current={active ? "page" : undefined}
      data-testid={`${testId}-${item.id}`}
      class={cn(
        "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        item.disabled && "pointer-events-none opacity-50",
      )}
      onclick={() => onSelect(item.id)}
    >
      {#if icon !== undefined}
        <span class="flex size-4 shrink-0 items-center justify-center">
          {@render icon(item)}
        </span>
      {/if}
      <span class="min-w-0 flex-1 truncate">{item.label}</span>
      {#if item.count !== undefined}
        <span
          class={cn(
            "min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] tabular-nums",
            active
              ? "bg-background/70 text-foreground"
              : "bg-muted/70 text-ink-faint group-hover:text-muted-foreground",
          )}
        >
          {i18n.count(item.count)}
        </span>
      {/if}
    </button>
  {/each}
</nav>
