<script lang="ts">
  /**
   * The one button in the kit.
   *
   * Variants and sizes are exhaustive maps rather than free-form classes, so a caller
   * cannot invent a fourth look, and `cn` resolves conflicts when a caller needs one
   * adjustment (a full-width button in a form, for example).
   */
  import type { Snippet } from "svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    variant?: "primary" | "outline" | "ghost";
    size?: "sm" | "md";
    disabled?: boolean;
    type?: "button" | "submit";
    title?: string;
    class?: string;
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = "outline",
    size = "md",
    disabled = false,
    type = "button",
    title,
    class: className = "",
    onclick,
    children,
  }: Props = $props();

  const VARIANTS = {
    primary:
      "border border-transparent bg-accent text-accent-ink hover:bg-accent-strong",
    outline: "border border-border bg-panel text-ink hover:bg-panel-muted",
    ghost:
      "border border-transparent bg-transparent text-ink-muted hover:text-ink",
  } as const;

  const SIZES = {
    sm: "h-7 gap-1 px-2 text-xs",
    md: "h-9 gap-1.5 px-3 text-sm",
  } as const;
</script>

<button
  {type}
  {disabled}
  {title}
  onclick={(event) => onclick?.(event)}
  class={cn(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  )}
>
  {@render children()}
</button>
