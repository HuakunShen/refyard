<script lang="ts">
  /**
   * The one floating menu a list's triggers share.
   *
   * Rows and badges open this layer with their own actions at the pointer, so
   * a badge nested inside a row can show a different menu without two menu
   * triggers fighting over one right-click. The layer positions itself at
   * viewport coordinates (it must live outside any scrolling, transforming
   * ancestor), flips back inside the viewport when the pointer was near an
   * edge, and closes on any outside pointer press, Escape, or scroll — the
   * same dismissal set the native menu it replaces has.
   */
  import Check from "@lucide/svelte/icons/check";
  import {
    compactContextActions,
    type ContextAction,
  } from "../lib/context-actions.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    open: boolean;
    x: number;
    y: number;
    actions: readonly ContextAction[];
    testId?: string;
    onClose: () => void;
  }

  let { open, x, y, actions, testId = undefined, onClose }: Props = $props();

  let layer = $state<HTMLDivElement | null>(null);
  /** When this open cycle began, for the scroll grace window below. */
  let openedAt = 0;

  const visibleActions = $derived(compactContextActions(actions));

  // Focus and edge-flipping happen after render: the menu's size is only known
  // once it exists, and keyboard dismissal needs the menu to hold focus.
  $effect(() => {
    if (!open) {
      return;
    }
    openedAt = performance.now();
    const element = layer;
    if (element === null) {
      return;
    }
    element.focus();
    const rect = element.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  });

  function onScroll(): void {
    // The scroll that reveals the clicked target fires on the frame *after*
    // the click (Chromium dispatches scroll events asynchronously), so a scroll
    // arriving this soon after open is the opening gesture's own — not a user
    // scrolling away. Only a later scroll means the anchor moved off.
    if (performance.now() - openedAt < 150) {
      return;
    }
    onClose();
  }

  function onOutsidePointerDown(event: PointerEvent): void {
    const element = layer;
    if (
      element !== null &&
      event.target instanceof Node &&
      element.contains(event.target)
    ) {
      return;
    }
    onClose();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  function select(action: Extract<ContextAction, { kind: "action" }>): void {
    if (action.disabled) {
      return;
    }
    onClose();
    action.onSelect();
  }
</script>

<svelte:document
  onpointerdown={onOutsidePointerDown}
  onkeydown={onKeyDown}
  onscrollcapture={onScroll}
/>

{#if open}
  <div
    bind:this={layer}
    role="menu"
    tabindex="-1"
    data-testid={testId}
    class="fixed z-50 max-h-[70vh] min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none custom-scrollbar"
    style="left: {x}px; top: {y}px"
  >
    {#each visibleActions as action (action.id)}
      {#if action.kind === "separator"}
        <div role="separator" class="-mx-1 my-1 h-px bg-border"></div>
      {:else}
        <button
          type="button"
          role="menuitem"
          disabled={action.disabled}
          data-testid={testId === undefined
            ? undefined
            : `${testId}-${action.id}`}
          class={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
            action.disabled
              ? "pointer-events-none opacity-50"
              : "hover:bg-accent hover:text-accent-foreground",
            action.destructive &&
              "text-destructive dark:text-red-400 hover:bg-destructive/10",
          )}
          onclick={() => select(action)}
        >
          {#if action.checked === true}
            <Check class="size-3.5 shrink-0" />
          {:else}
            <span class="size-3.5 shrink-0"></span>
          {/if}
          {action.label}
        </button>
      {/if}
    {/each}
  </div>
{/if}
