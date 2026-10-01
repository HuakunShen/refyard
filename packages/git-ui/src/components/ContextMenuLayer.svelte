<script lang="ts">
  /**
   * The one floating menu a list's triggers share.
   *
   * Rows and badges open this layer with their own actions at the pointer, so
   * a badge nested inside a row can show a different menu without two menu
   * triggers fighting over one right-click. The layer positions itself at
   * viewport coordinates (it must live outside any scrolling, transforming
   * ancestor), flips back inside the viewport when the pointer was near an
   * edge, and closes on any outside pointer press, Escape, or outside scroll — the
   * same dismissal set the native menu it replaces has.
   */
  import Check from "@lucide/svelte/icons/check";
  import {
    compactContextActions,
    contextActionDisabled,
    type ContextAction,
  } from "../lib/context-actions.js";
  import { cn } from "../lib/utils.js";
  import { tabStopsWithin } from "../lib/tab-stops.js";

  interface Props {
    open: boolean;
    x: number;
    y: number;
    actions: readonly ContextAction[];
    testId?: string;
    trigger?: HTMLElement | null;
    onClose: () => void;
  }

  let {
    open,
    x,
    y,
    actions,
    testId = undefined,
    trigger = null,
    onClose,
  }: Props = $props();

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

  function onScroll(event: Event): void {
    if (!open) {
      return;
    }
    // Scrolling the menu reveals actions; only scrolling its background moves the anchor.
    if (
      layer !== null &&
      event.target instanceof Node &&
      layer.contains(event.target)
    ) {
      return;
    }
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

  function closeToTrigger(): void {
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    }
    onClose();
  }

  function onKeyDown(event: KeyboardEvent): void {
    const element = layer;
    if (
      !open ||
      element === null ||
      !element.contains(document.activeElement)
    ) {
      return;
    }
    if (event.key === "Escape") {
      event.stopPropagation();
      closeToTrigger();
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      // Follow the trigger's tab order consistently across browser keyboard settings.
      const candidates = tabStopsWithin(document).filter(
        (candidate) => !element.contains(candidate),
      );
      const index = candidates.findIndex((candidate) => candidate === trigger);
      const next =
        index < 0 ? undefined : candidates[index + (event.shiftKey ? -1 : 1)];
      if (next !== undefined) {
        event.preventDefault();
        onClose();
        next.focus({ preventScroll: true });
      } else {
        // At the document boundary, allow the browser to move into its own controls.
        closeToTrigger();
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const items = Array.from(
      element.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
      ),
    );
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const current = items.findIndex((item) => item === document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : current < 0
              ? items.length - 1
              : (current - 1 + items.length) % items.length;
    const item = items[next];
    if (item !== undefined) {
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest" });
    }
  }

  function select(action: Extract<ContextAction, { kind: "action" }>): void {
    if (contextActionDisabled(action)) {
      return;
    }
    closeToTrigger();
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
    class="fixed z-50 max-h-[70vh] min-w-56 max-w-[min(28rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none custom-scrollbar"
    style="left: {x}px; top: {y}px"
  >
    {#each visibleActions as action (action.id)}
      {#if action.kind === "separator"}
        <div role="separator" class="-mx-1 my-1 h-px bg-border"></div>
      {:else}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          disabled={contextActionDisabled(action)}
          data-testid={testId === undefined
            ? undefined
            : `${testId}-${action.id}`}
          class={cn(
            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
            contextActionDisabled(action)
              ? "opacity-50"
              : "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
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
          <span class="min-w-0">
            <span class="block">{action.label}</span>
            {#if contextActionDisabled(action) && action.disabledReason !== undefined}
              <span
                class="block whitespace-normal text-xs font-normal text-muted-foreground"
                >{action.disabledReason}</span
              >
            {/if}
          </span>
        </button>
      {/if}
    {/each}
  </div>
{/if}
