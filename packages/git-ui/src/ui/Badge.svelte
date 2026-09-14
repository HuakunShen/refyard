<script lang="ts">
  /**
   * A small label for a ref, a state, or a count.
   *
   * Tones are semantic (`head` means "this is where HEAD is"), not decorative: a badge
   * that says the wrong thing about a ref is worse than no badge, so the callers pick a
   * tone from meaning rather than from colour.
   */
  import type { Snippet } from "svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    tone?: "muted" | "branch" | "head" | "tag" | "remote" | "warn" | "danger";
    title?: string;
    class?: string;
    children: Snippet;
  }

  let {
    tone = "muted",
    title,
    class: className = "",
    children,
  }: Props = $props();

  const TONES = {
    muted: "border-border bg-panel-muted text-ink-muted",
    branch: "border-lane-1/40 bg-lane-1/10 text-lane-1",
    head: "border-accent/40 bg-accent/15 text-accent",
    tag: "border-lane-3/40 bg-lane-3/10 text-lane-3",
    remote: "border-lane-6/40 bg-lane-6/10 text-lane-6",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
  } as const;
</script>

<span
  {title}
  class={cn(
    "inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[11px] leading-4",
    TONES[tone],
    className,
  )}
>
  {@render children()}
</span>
