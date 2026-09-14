<script lang="ts">
  /**
   * Remotes and the three network operations.
   *
   * The panel makes the explicit-choice rules visible rather than hiding them
   * behind one "Sync" button:
   *
   * - **Fetch** names one remote and moves remote-tracking refs only — it is
   *   disabled while a remote is not selected, rather than defaulted to `origin`;
   * - **Pull** is fast-forward only, and its result distinguishes "tracking refs
   *   updated" from "the branch did not move" (the page renders the operation's own
   *   summary, which says both);
   * - **Push** publishes exactly the current branch to the same branch name on the
   *   selected remote — never all branches, never tags, never forced.
   *
   * URLs are shown as the host redacted them; the full URL with a credential never
   * reaches the browser.
   */
  import type { RefsSnapshot } from "@refyard/git-contract";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    refs: RefsSnapshot | null;
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onAdd: (remoteName: string, fetchUrl: string) => void;
    onRemove: (remoteName: string) => void;
    onFetch: (remoteName: string) => void;
    onPush: (remoteName: string, branchName: string) => void;
    onPull: (remoteName: string) => void;
    class?: string;
  }

  let {
    refs,
    disabled = false,
    busy = false,
    message = null,
    onAdd,
    onRemove,
    onFetch,
    onPush,
    onPull,
    class: className = "",
  }: Props = $props();

  let remoteName = $state("");
  let remoteUrl = $state("");
  let selected = $state<string | null>(null);

  const remotes = $derived(refs?.remotes ?? []);
  const currentBranch = $derived(refs?.head.branchName ?? null);
  // A single remote is selected by default for the sync buttons; with several, none
  // is — a default that pushes to a remote nobody chose is the failure this avoids.
  const active = $derived(
    selected ?? (remotes.length === 1 ? (remotes[0]?.name ?? null) : null),
  );
</script>

<div class={cn("flex flex-col gap-2", className)} data-testid="remote-panel">
  {#if refs === null}
    <p class="text-xs text-ink-faint">No refs loaded.</p>
  {:else if remotes.length === 0}
    <p class="text-xs text-ink-faint">No remotes configured.</p>
  {:else}
    <ul class="flex flex-col gap-1" data-testid="remote-list">
      {#each remotes as remote (remote.name)}
        <li class="flex flex-wrap items-center gap-2 rounded px-1 py-0.5">
          <input
            type="radio"
            class="size-3.5 accent-primary"
            name="remote-select"
            checked={active === remote.name}
            disabled={disabled || busy}
            aria-label={`select remote ${remote.name}`}
            onchange={() => (selected = remote.name)}
          />
          <span class="font-mono text-xs">{remote.name}</span>
          <span
            class="min-w-0 flex-1 truncate text-xs text-ink-faint"
            title={remote.fetchUrlDisplay}
          >
            {remote.fetchUrlDisplay}
          </span>
          <ConfirmAction
            label="Remove"
            confirmLabel={`Remove ${remote.name}`}
            description="Local branches are untouched; remote-tracking refs go with it."
            disabled={disabled || busy}
            {busy}
            onConfirm={() => onRemove(remote.name)}
            data-testid={`remove-remote-${remote.name}`}
          />
        </li>
      {/each}
    </ul>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy || active === null}
        onclick={() => {
          if (active !== null) {
            onFetch(active);
          }
        }}
        data-testid="fetch-remote"
      >
        Fetch
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || busy || active === null || currentBranch === null}
        onclick={() => {
          if (active !== null) {
            onPull(active);
          }
        }}
        data-testid="pull-remote"
      >
        Pull (ff-only)
      </Button>
      <Button
        size="sm"
        disabled={disabled || busy || active === null || currentBranch === null}
        onclick={() => {
          if (active !== null && currentBranch !== null) {
            onPush(active, currentBranch);
          }
        }}
        data-testid="push-remote"
      >
        Push {currentBranch ?? ""}
      </Button>
    </div>
  {/if}

  <div class="flex items-center gap-2">
    <input
      class="w-24 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="origin"
      aria-label="remote name"
      bind:value={remoteName}
      disabled={disabled || busy}
    />
    <input
      class="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="https://… or /path/to/repo.git"
      aria-label="remote url"
      bind:value={remoteUrl}
      disabled={disabled || busy}
    />
    <Button
      size="sm"
      disabled={disabled ||
        busy ||
        remoteName.trim().length === 0 ||
        remoteUrl.trim().length === 0}
      onclick={() => {
        onAdd(remoteName.trim(), remoteUrl.trim());
        remoteName = "";
        remoteUrl = "";
      }}
      data-testid="add-remote"
    >
      Add
    </Button>
  </div>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="remote-message">{message}</p>
  {/if}
</div>
