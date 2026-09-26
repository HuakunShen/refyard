<!--
  Collapsible card for workbench sidebar sections.
  Features an interactive header with icon, title, count badge, and expand/collapse toggle.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import { Badge } from "./ui/badge/index.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  interface Props {
    title: string;
    icon?: Snippet;
    count?: number | string | null;
    countTone?: "muted" | "branch" | "head" | "tag" | "warn" | "danger";
    defaultOpen?: boolean;
    open?: boolean;
    onToggle?: (isOpen: boolean) => void;
    children?: Snippet;
    headerAction?: Snippet;
    class?: string;
  }

  let {
    title,
    icon: Icon,
    count = null,
    countTone = "muted",
    defaultOpen = true,
    open = $bindable(defaultOpen),
    onToggle,
    children,
    headerAction,
    class: className = "",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;

  function toggle(): void {
    open = !open;
    onToggle?.(open);
  }
</script>

<div
  data-slot="card"
  class={cn(
    "shrink-0 flex flex-col rounded-xl border border-border/60 bg-card text-card-foreground shadow-2xs transition-colors hover:border-border/80",
    className,
  )}
>
  <div
    class="flex items-center justify-between px-3 py-2 select-none border-b border-border/30"
  >
    <button
      type="button"
      onclick={toggle}
      class="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer hover:opacity-80 transition-opacity"
      aria-expanded={open}
      aria-label={t("section.toggle").replace("{title}", () => title)}
    >
      <span class="text-ink-muted shrink-0 transition-transform duration-150">
        {#if open}
          <ChevronDown class="size-3.5" />
        {:else}
          <ChevronRight class="size-3.5" />
        {/if}
      </span>
      {#if Icon}{@render Icon()}{/if}
      <span
        class="text-xs font-semibold tracking-wide text-ink-muted uppercase truncate"
      >
        {title}
      </span>
      {#if count !== null && count !== undefined}
        <Badge
          tone={countTone}
          class="text-[10px] h-4.5 px-1.5 min-w-5 justify-center"
        >
          {typeof count === "number" ? i18n.count(count) : count}
        </Badge>
      {/if}
    </button>

    {#if headerAction}
      <div class="flex items-center gap-1 shrink-0">
        {@render headerAction()}
      </div>
    {/if}
  </div>

  {#if open}
    <div class="p-3 flex flex-col gap-2 min-h-0">
      {@render children?.()}
    </div>
  {/if}
</div>
