<script lang="ts">
  /** Hosts modal content with immediate initial focus that cannot overwrite later user focus. */
  import { m } from "../../../i18n.js";
  import { tabStopsWithin } from "../../../lib/tab-stops.js";
  import { Dialog as DialogPrimitive } from "bits-ui";
  import XIcon from "@lucide/svelte/icons/x";
  import { Button } from "../button/index.js";
  import { cn, type WithoutChildrenOrChild } from "../../../lib/utils.js";
  import * as Dialog from "./index.js";
  import DialogPortal from "./dialog-portal.svelte";
  import type { Snippet } from "svelte";
  import type { ComponentProps } from "svelte";

  let {
    ref = $bindable(null),
    class: className,
    portalProps,
    children,
    showCloseButton = true,
    onOpenAutoFocus = undefined,
    ...restProps
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
    portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
    children: Snippet;
    showCloseButton?: boolean;
  } = $props();
  function focusOnOpen(event: Event): void {
    onOpenAutoFocus?.(event);
    if (event.defaultPrevented || ref === null) {
      return;
    }
    // The primitive's default waits for an animation frame and can steal focus
    // after the user has already started editing another field.
    event.preventDefault();
    if (ref.contains(document.activeElement)) {
      return;
    }
    const candidates = tabStopsWithin(ref);
    const target =
      candidates.find((candidate) => candidate.hasAttribute("autofocus")) ??
      candidates[0] ??
      ref;
    target.focus({ preventScroll: true });
  }
</script>

<DialogPortal {...portalProps}>
  <Dialog.Overlay />
  <DialogPrimitive.Content
    bind:ref
    onOpenAutoFocus={focusOnOpen}
    data-slot="dialog-content"
    class={cn(
      "bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 grid max-w-[calc(100%_-_2rem)] gap-4 rounded-xl p-4 text-sm ring-1 duration-100 sm:max-w-sm fixed top-1/2 left-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 outline-none",
      className,
    )}
    {...restProps}
  >
    {@render children?.()}
    {#if showCloseButton}
      <DialogPrimitive.Close data-slot="dialog-close">
        {#snippet child({ props })}
          <Button
            variant="ghost"
            class="absolute top-2 right-2"
            size="icon-sm"
            {...props}
          >
            <XIcon />
            <span class="sr-only">{m.common_close()}</span>
          </Button>
        {/snippet}
      </DialogPrimitive.Close>
    {/if}
  </DialogPrimitive.Content>
</DialogPortal>
