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
  import Archive from "@lucide/svelte/icons/archive";
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

<div class={cn("flex flex-col gap-2.5", className)} data-testid="stash-panel">
  <!-- Create stash form -->
  <div
    class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5"
  >
    <div class="flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="stash message (optional)"
        aria-label="stash message"
        bind:value={stashMessage}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        class="h-7 text-xs px-3 shrink-0"
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
    <label
      class="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none"
    >
      <input
        type="checkbox"
        class="size-3.5 accent-primary rounded"
        aria-label="include untracked files"
        bind:checked={includeUntracked}
        disabled={disabled || busy}
      />
      include untracked files
    </label>
  </div>

  {#if stashes === null}
    <p class="text-xs text-ink-faint">No stashes loaded.</p>
  {:else if stashes.length === 0}
    <p class="text-xs text-ink-faint italic py-1">No stashes.</p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="stash-list"
    >
      {#each stashes as stash (stash.oid)}
        <li
          class="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card/60 p-2 hover:border-border hover:bg-accent/30 transition-all"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Archive class="size-3.5 text-amber-500 shrink-0" />
            <span
              class="font-mono text-xs font-semibold text-foreground shrink-0"
            >
              {stash.locator}
            </span>
            <span
              class="min-w-0 flex-1 truncate text-xs text-ink-muted"
              title={stash.message}
            >
              {stash.message}
            </span>
          </div>

          <div
            class="flex items-center gap-1.5 pt-0.5 border-t border-border/20"
          >
            <Button
              size="sm"
              variant="outline"
              class="h-6 text-xs px-2 shadow-none"
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
            <span class="ml-auto">
              <ConfirmAction
                label="Drop"
                confirmLabel="Drop for good"
                description="Removes the entry without applying it."
                disabled={disabled || busy}
                {busy}
                onConfirm={() => onDrop(stash)}
                data-testid={`drop-stash-${stash.locator}`}
              />
            </span>
          </div>
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
