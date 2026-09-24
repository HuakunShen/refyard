<script lang="ts">
  /**
   * Keyboard and pointer resize handle for a workbench divider.
   *
   * Two orientations, because the workbench has two layouts. Side by side it drags a column
   * edge sideways; stacked — which is what a narrow column, an embedded panel or a small
   * window gets — it drags the divider between the repository list and the history up and
   * down. Its visibility follows the same container query the layout does, so the handle
   * exists exactly when the divider it moves does. Keying that to the *viewport* is what made
   * it vanish in a narrow pane while the columns it was supposed to size were still there.
   */
  import { cn } from "@refyard/git-ui";

  interface Props {
    side: "left" | "right";
    onResize: (delta: number) => void;
    onResizeEnd: () => void;
    /** `vertical` drags a column edge sideways; `horizontal` drags a stacked divider. */
    orientation?: "vertical" | "horizontal";
    style?: string;
  }

  let {
    side,
    onResize,
    onResizeEnd,
    orientation = "vertical",
    style = "",
  }: Props = $props();
  let dragging = $state(false);
  let last = 0;

  const horizontal = $derived(orientation === "horizontal");

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    last = horizontal ? event.clientY : event.clientX;
    event.currentTarget instanceof HTMLElement &&
      event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent): void {
    if (!dragging) {
      return;
    }
    const position = horizontal ? event.clientY : event.clientX;
    const movement = position - last;
    last = position;
    // Sideways, the trailing edge of a right-hand column moves against the pointer; a
    // stacked divider always follows it.
    onResize(horizontal || side === "left" ? movement : -movement);
  }

  function pointerUp(event: PointerEvent): void {
    if (!dragging) {
      return;
    }
    dragging = false;
    if (
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResizeEnd();
  }

  function keydown(event: KeyboardEvent): void {
    const step = event.shiftKey ? 32 : 12;
    const forward = horizontal
      ? event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowUp"
          ? -1
          : 0
      : event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : 0;
    if (forward === 0) {
      return;
    }
    event.preventDefault();
    onResize(horizontal || side === "left" ? forward * step : -forward * step);
    onResizeEnd();
  }
</script>

<button
  type="button"
  class={cn(
    "group absolute z-20 items-center justify-center border-0 bg-transparent p-0",
    // The column handles are hidden while the layout is stacked, and the stacked divider is
    // hidden once it is not: one container query decides both, so the two can never both be
    // absent or both be present.
    horizontal
      ? "right-0 left-0 flex h-3 -translate-y-1/2 cursor-row-resize @5xl:hidden"
      : "top-0 bottom-0 hidden w-3 cursor-col-resize @5xl:flex",
    !horizontal && (side === "left" ? "-translate-x-1/2" : "translate-x-1/2"),
    dragging && "bg-primary/10",
  )}
  {style}
  aria-label={horizontal
    ? "Repository list height"
    : `${side === "left" ? "Left" : "Right"} sidebar width`}
  data-testid={horizontal
    ? "stacked-nav-resize-handle"
    : `${side}-sidebar-resize-handle`}
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  onpointercancel={pointerUp}
  onkeydown={keydown}
>
  <span
    class={cn(
      "rounded-full bg-border/70 transition-colors group-hover:bg-primary/70",
      horizontal ? "h-px w-10" : "h-10 w-px",
      dragging && (horizontal ? "w-full bg-primary" : "h-full bg-primary"),
    )}
  ></span>
</button>
