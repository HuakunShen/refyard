<script lang="ts">
  import { ScrollArea as ScrollAreaPrimitive } from "bits-ui";
  import { cn, type WithoutChild } from "../../../lib/utils.js";
  import { Scrollbar } from "./index.js";

  let {
    ref = $bindable(null),
    viewportRef = $bindable(null),
    class: className,
    orientation = "vertical",
    scrollbarXClasses = "",
    scrollbarYClasses = "",
    children,
    ...restProps
  }: WithoutChild<ScrollAreaPrimitive.RootProps> & {
    orientation?: "vertical" | "horizontal" | "both" | undefined;
    scrollbarXClasses?: string | undefined;
    scrollbarYClasses?: string | undefined;
    viewportRef?: HTMLElement | null;
  } = $props();
</script>

<ScrollAreaPrimitive.Root
  bind:ref
  data-slot="scroll-area"
  class={cn("relative flex flex-col", className)}
  {...restProps}
>
  <!--
    The viewport is a stretched flex item rather than `size-full`. A percentage height only
    resolves against a parent whose height is definite, and the caller's height usually is
    not: a `flex-1` or `max-height`-clamped parent has a used height without being definite,
    so `height: 100%` fell back to `auto`, the viewport grew to its content, and nothing
    ever scrolled. Flex stretching needs no definiteness, and an unbounded parent still
    sizes the viewport to its content.
  -->
  <ScrollAreaPrimitive.Viewport
    bind:ref={viewportRef}
    data-slot="scroll-area-viewport"
    class="min-h-0 w-full min-w-0 flex-1 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
  >
    {@render children?.()}
  </ScrollAreaPrimitive.Viewport>
  {#if orientation === "vertical" || orientation === "both"}
    <Scrollbar orientation="vertical" class={scrollbarYClasses} />
  {/if}
  {#if orientation === "horizontal" || orientation === "both"}
    <Scrollbar orientation="horizontal" class={scrollbarXClasses} />
  {/if}
  <ScrollAreaPrimitive.Corner />
</ScrollAreaPrimitive.Root>
