<script lang="ts">
  /**
   * The commit surface: message, commit, amend.
   *
   * The panel performs no requests. It is handed the staged change count (what the
   * host reported, not what the UI believes), and it refuses to offer a commit when
   * that count is zero: Git would refuse it too, and a button that produces a
   * refusal is worse than no button. Amend is a two-step confirm because it rewrites
   * the tip, and its "keep the existing message" form is a separate explicit choice
   * rather than an empty textarea that means something different here than it does
   * for a normal commit.
   */
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    stagedCount: number;
    disabled?: boolean;
    busy?: boolean;
    /** True when the branch has at least one commit (amend needs a tip to rewrite). */
    canAmend?: boolean;
    message?: string | null;
    onCommit: (message: string) => void;
    onAmend: (message: string | null) => void;
    class?: string;
  }

  let {
    stagedCount,
    disabled = false,
    busy = false,
    canAmend = true,
    message = null,
    onCommit,
    onAmend,
    class: className = "",
  }: Props = $props();

  let text = $state("");
  const trimmed = $derived(text.trim());
  const commitReady = $derived(
    !disabled && !busy && trimmed.length > 0 && stagedCount > 0,
  );
</script>

<div class={cn("flex flex-col gap-2", className)} data-testid="commit-panel">
  <label class="text-xs text-ink-muted" for="commit-message">
    Commit message ({stagedCount} staged path{stagedCount === 1 ? "" : "s"})
  </label>
  <textarea
    id="commit-message"
    data-testid="commit-message"
    class="min-h-16 w-full rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
    placeholder="What changed, and why"
    bind:value={text}
    disabled={disabled || busy}></textarea>

  <div class="flex flex-wrap items-center gap-2">
    <Button
      size="sm"
      disabled={!commitReady}
      onclick={() => onCommit(text)}
      data-testid="commit-button"
    >
      Commit
    </Button>

    <ConfirmAction
      label="Amend…"
      confirmLabel="Rewrite the tip commit"
      description="Amend rewrites the last commit. This version performs no follow-up push."
      disabled={disabled || busy || !canAmend || trimmed.length === 0}
      {busy}
      onConfirm={() => onAmend(text)}
      data-testid="amend-button"
    />

    <ConfirmAction
      label="Amend, keep message"
      confirmLabel="Rewrite the tip, same message"
      disabled={disabled || busy || !canAmend}
      {busy}
      onConfirm={() => onAmend(null)}
      data-testid="amend-keep-button"
    />
  </div>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="commit-message-result">
      {message}
    </p>
  {/if}
</div>
