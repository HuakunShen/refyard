<script lang="ts">
  /**
   * The workbench's section navigation: one row per view, with its count.
   *
   * `collapsed` turns it into an icon rail. Same rows, same keys, same clicks — the label
   * becomes a tooltip and an accessible name, and the count becomes a badge on the icon. A
   * column that is only ever used to look at the graph can then spend its width on the graph
   * instead of on labels nobody is reading, which is the whole reason the rail exists.
   *
   * The rail's direction is the caller's: a side column wants it vertical, and a stacked
   * workbench — where the navigation is a band across the top — wants a single row.
   */
  import type { Snippet } from "svelte";
  import { cn } from "../lib/utils.js";

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
    /** Icon-only rail. */
    collapsed?: boolean;
    class?: string;
    "data-testid"?: string;
  }

  let {
    items,
    activeId,
    onSelect,
    icon = undefined,
    collapsed = false,
    class: className = "",
    "data-testid": testId = "workbench-nav",
  }: Props = $props();
</script>

<nav
  class={cn("flex gap-0.5", collapsed ? "flex-row" : "flex-col", className)}
  aria-label="Repository navigation"
  data-testid={testId}
  data-collapsed={collapsed}
>
  {#each items as item (item.id)}
    {@const active = item.id === activeId}
    <button
      type="button"
      disabled={item.disabled}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      data-testid={`${testId}-${item.id}`}
      class={cn(
        "group relative flex h-8 items-center rounded-md text-left text-sm transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "w-8 shrink-0 justify-center" : "w-full gap-2 px-2",
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
      {#if collapsed}
        {#if item.count !== undefined && item.count > 0}
          <!-- The count is the one part of the label worth keeping on the rail: it is what
               tells a glance whether there is anything here to open. -->
          <span
            class={cn(
              "pointer-events-none absolute right-0 bottom-0 rounded-full px-0.5 text-[9px] leading-3 tabular-nums",
              active
                ? "bg-background/80 text-foreground"
                : "bg-muted text-ink-faint",
            )}
          >
            {item.count > 99 ? "99+" : item.count}
          </span>
        {/if}
      {:else}
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
            {item.count}
          </span>
        {/if}
      {/if}
    </button>
  {/each}
</nav>
