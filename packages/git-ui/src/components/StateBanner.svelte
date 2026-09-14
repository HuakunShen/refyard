<script lang="ts">
  /**
   * Every state that is not "here is the data".
   *
   * The read-only build has six of them and they mean different things to the reader:
   * `loading` is patience, `stale` is "this is real but may have moved", `truncated` is
   * "there is more that you are not seeing", `disconnected` is "we lost the service",
   * `error` is a failure with a problem code, `empty` is a true zero.
   *
   * They are one component so a pane cannot quietly show a spinner where the data is
   * actually stale, and `role` is chosen by severity: a failure announces itself, a
   * loading state does not interrupt.
   */
  import type { Snippet } from "svelte";
  import { cn } from "../lib/utils.js";

  export type BannerState =
    | "loading"
    | "empty"
    | "stale"
    | "truncated"
    | "disconnected"
    | "error"
    | "info";

  interface Props {
    state: BannerState;
    title: string;
    detail?: string;
    class?: string;
    /** Rendered after the text — usually a retry button. */
    action?: Snippet;
  }

  let { state, title, detail, class: className = "", action }: Props = $props();

  const TONES: Record<BannerState, string> = {
    loading: "border-border bg-panel-muted text-ink-muted",
    empty: "border-border bg-panel-muted text-ink-muted",
    stale: "border-warn/40 bg-warn/10 text-ink",
    truncated: "border-warn/40 bg-warn/10 text-ink",
    disconnected: "border-danger/40 bg-danger/10 text-ink",
    error: "border-danger/40 bg-danger/10 text-ink",
    info: "border-border bg-panel-muted text-ink-muted",
  };

  const role = $derived(
    state === "error" || state === "disconnected"
      ? "alert"
      : state === "loading"
        ? "status"
        : undefined,
  );
</script>

<div
  {role}
  aria-live={state === "loading" ? "polite" : undefined}
  class={cn(
    "flex items-start gap-3 rounded-md border px-3 py-2 text-sm",
    TONES[state],
    className,
  )}
>
  <div class="min-w-0 flex-1">
    <p class="font-medium">{title}</p>
    {#if detail !== undefined}
      <p class="mt-0.5 text-xs text-ink-muted">{detail}</p>
    {/if}
  </div>
  {#if action !== undefined}
    <div class="shrink-0">{@render action()}</div>
  {/if}
</div>
