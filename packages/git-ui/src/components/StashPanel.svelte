<script lang="ts">
  /**
   * Stashes: create, apply, pop, drop.
   *
   * The panel says what each action does to the entry, because the difference is
   * the whole point: apply keeps it, pop drops it only on success, and drop is the
   * only action that loses the entry — confirmed twice through `ConfirmAction`. A
   * conflicted pop comes back as `needsAttention` and the list still shows the
   * stash; the panel renders the operation's own summary rather than interpreting it.
   */
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface StashEntry {
    readonly oid: string;
    readonly locator: string;
    readonly message: string;
  }

  interface Props {
    stashes: readonly StashEntry[] | null;
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onCreate: (message: string, includeUntracked: boolean) => void;
    onApply: (stash: StashEntry) => void;
    onPop: (stash: StashEntry) => void;
    onDrop: (stash: StashEntry) => void;
    class?: string;
  }

  let {
    stashes,
    disabled = false,
    busy = false,
    message = null,
    onCreate,
    onApply,
    onPop,
    onDrop,
    class: className = "",
  }: Props = $props();

  let stashMessage = $state("");
  let includeUntracked = $state(false);
</script>

<div class={cn("flex flex-col gap-2", className)} data-testid="stash-panel">
  <div class="flex items-center gap-2">
    <input
      class="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="stash message (optional)"
      aria-label="stash message"
      bind:value={stashMessage}
      disabled={disabled || busy}
    />
    <label class="flex items-center gap-1 text-xs text-ink-muted">
      <input
        type="checkbox"
        class="size-3.5 accent-primary"
        aria-label="include untracked files"
        bind:checked={includeUntracked}
        disabled={disabled || busy}
      />
      untracked
    </label>
    <Button
      size="sm"
      disabled={disabled || busy}
      onclick={() => {
        onCreate(stashMessage, includeUntracked);
        stashMessage = "";
        includeUntracked = false;
      }}
      data-testid="create-stash"
    >
      Stash
    </Button>
  </div>

  {#if stashes === null}
    <p class="text-xs text-ink-faint">No stashes loaded.</p>
  {:else if stashes.length === 0}
    <p class="text-xs text-ink-faint">No stashes.</p>
  {:else}
    <ul
      class="flex max-h-48 flex-col gap-1 overflow-y-auto"
      data-testid="stash-list"
    >
      {#each stashes as stash (stash.oid)}
        <li class="flex flex-wrap items-center gap-2 rounded px-1 py-0.5">
          <span class="font-mono text-xs text-ink-faint">{stash.locator}</span>
          <span class="min-w-0 flex-1 truncate text-xs" title={stash.message}>
            {stash.message}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy}
            onclick={() => onApply(stash)}
            data-testid={`apply-stash-${stash.locator}`}
          >
            Apply
          </Button>
          <ConfirmAction
            label="Pop"
            confirmLabel="Pop and drop the entry"
            description="Applies, and drops only if it applies cleanly."
            disabled={disabled || busy}
            {busy}
            onConfirm={() => onPop(stash)}
            data-testid={`pop-stash-${stash.locator}`}
          />
          <ConfirmAction
            label="Drop"
            confirmLabel="Drop for good"
            description="Removes the entry without applying it."
            disabled={disabled || busy}
            {busy}
            onConfirm={() => onDrop(stash)}
            data-testid={`drop-stash-${stash.locator}`}
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="stash-message-result">
      {message}
    </p>
  {/if}
</div>
