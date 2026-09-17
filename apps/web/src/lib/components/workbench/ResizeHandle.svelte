<script lang="ts">
  /** Keyboard and pointer resize handle for a desktop workbench column. */
  import { cn } from "@refyard/git-ui";

  interface Props {
    side: "left" | "right";
    onResize: (delta: number) => void;
    onResizeEnd: () => void;
    style?: string;
  }

  let { side, onResize, onResizeEnd, style = "" }: Props = $props();
  let dragging = $state(false);
  let lastX = 0;

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    lastX = event.clientX;
    event.currentTarget instanceof HTMLElement &&
      event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent): void {
    if (!dragging) {
      return;
    }
    const movement = event.clientX - lastX;
    lastX = event.clientX;
    onResize(side === "left" ? movement : -movement);
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
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (direction === 0) {
      return;
    }
    event.preventDefault();
    onResize(side === "left" ? direction * step : -direction * step);
    onResizeEnd();
  }
</script>

<button
  type="button"
  class={cn(
    "group absolute top-0 bottom-0 z-20 hidden w-3 cursor-col-resize items-center justify-center border-0 bg-transparent p-0 lg:flex",
    side === "left" ? "-translate-x-1/2" : "translate-x-1/2",
    dragging && "bg-primary/10",
  )}
  {style}
  aria-label={`${side === "left" ? "Left" : "Right"} sidebar width`}
  data-testid={`${side}-sidebar-resize-handle`}
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  onpointercancel={pointerUp}
  onkeydown={keydown}
>
  <span
    class={cn(
      "h-10 w-px rounded-full bg-border/70 transition-colors",
      "group-hover:bg-primary/70",
      dragging && "h-full bg-primary",
    )}
  ></span>
</button>
