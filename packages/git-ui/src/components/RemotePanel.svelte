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
    onUpdate: (
      remoteName: string,
      changes: {
        readonly newName: string | null;
        readonly fetchUrl: string | null;
        readonly pushUrl: string | null;
      },
    ) => void;
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
    onUpdate,
    onRemove,
    onFetch,
    onPush,
    onPull,
    class: className = "",
  }: Props = $props();

  let remoteName = $state("");
  let remoteUrl = $state("");
  let selected = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let editName = $state("");
  let editFetchUrl = $state("");
  let editPushUrl = $state("");

  const remotes = $derived(refs?.remotes ?? []);
  const currentBranch = $derived(refs?.head.branchName ?? null);
  const active = $derived(
    selected ?? (remotes.length === 1 ? (remotes[0]?.name ?? null) : null),
  );

  function beginRemoteEdit(remoteName: string): void {
    editing = remoteName;
    editName = remoteName;
    editFetchUrl = "";
    editPushUrl = "";
  }

  function hasEditChanges(remoteName: string): boolean {
    return (
      editName.trim() !== remoteName ||
      editFetchUrl.trim().length > 0 ||
      editPushUrl.trim().length > 0
    );
  }

  function saveRemoteEdit(remoteName: string): void {
    const nextName = editName.trim();
    const fetchUrl = editFetchUrl.trim();
    const pushUrl = editPushUrl.trim();
    if (nextName.length === 0 || !hasEditChanges(remoteName)) {
      return;
    }
    onUpdate(remoteName, {
      newName: nextName === remoteName ? null : nextName,
      fetchUrl: fetchUrl.length === 0 ? null : fetchUrl,
      pushUrl: pushUrl.length === 0 ? null : pushUrl,
    });
    editing = null;
  }
</script>

<div class={cn("flex flex-col gap-2.5", className)} data-testid="remote-panel">
  {#if refs === null}
    <p class="text-xs text-ink-faint">No refs loaded.</p>
  {:else if remotes.length === 0}
    <p class="text-xs text-ink-faint italic py-1">No remotes configured.</p>
  {:else}
    <!-- Remote list -->
    <ul class="flex flex-col gap-1.5" data-testid="remote-list">
      {#each remotes as remote (remote.name)}
        {@const isSelected = active === remote.name}
        <li
          class={cn(
            "flex flex-col gap-2 rounded-lg border p-2 transition-all",
            isSelected
              ? "border-primary/40 bg-primary/5 shadow-2xs"
              : "border-border/50 bg-card/60 hover:border-border hover:bg-accent/30",
          )}
        >
          <div class="flex items-center gap-2">
            <input
              type="radio"
              class="size-3.5 accent-primary rounded-full shrink-0"
              name="remote-select"
              checked={isSelected}
              disabled={disabled || busy}
              aria-label={`select remote ${remote.name}`}
              onchange={() => (selected = remote.name)}
            />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="font-mono text-xs font-semibold text-foreground">
                {remote.name}
              </span>
              <span
                class="truncate text-[11px] text-ink-faint"
                title={remote.fetchUrlDisplay}
              >
                {remote.fetchUrlDisplay}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              class="h-6 px-2 text-xs"
              disabled={disabled || busy}
              onclick={() => beginRemoteEdit(remote.name)}
              data-testid={`edit-remote-${remote.name}`}
            >
              Edit
            </Button>
            <span class="shrink-0">
              <ConfirmAction
                label="Remove"
                confirmLabel={`Remove ${remote.name}`}
                description="Local branches are untouched; remote-tracking refs go with it."
                disabled={disabled || busy}
                {busy}
                onConfirm={() => onRemove(remote.name)}
                data-testid={`remove-remote-${remote.name}`}
              />
            </span>
          </div>

          {#if editing === remote.name}
            <div
              class="flex flex-col gap-2 rounded-md border border-border/40 bg-background/50 p-2"
            >
              <div class="grid gap-2 md:grid-cols-3">
                <label
                  class="flex min-w-0 flex-col gap-1 text-[11px] text-ink-muted"
                >
                  Name
                  <input
                    class="min-w-0 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`remote name for ${remote.name}`}
                    bind:value={editName}
                    disabled={disabled || busy}
                  />
                </label>
                <label
                  class="flex min-w-0 flex-col gap-1 text-[11px] text-ink-muted"
                >
                  Fetch URL
                  <input
                    class="min-w-0 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`fetch URL for ${remote.name}`}
                    placeholder={remote.fetchUrlDisplay}
                    bind:value={editFetchUrl}
                    disabled={disabled || busy}
                  />
                </label>
                <label
                  class="flex min-w-0 flex-col gap-1 text-[11px] text-ink-muted"
                >
                  Push URL
                  <input
                    class="min-w-0 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={`push URL for ${remote.name}`}
                    placeholder={remote.pushUrlDisplay ?? "same as fetch URL"}
                    bind:value={editPushUrl}
                    disabled={disabled || busy}
                  />
                </label>
              </div>
              <div class="flex items-center gap-2">
                <span class="min-w-0 flex-1 text-[11px] text-ink-faint">
                  URL fields start blank on purpose; blank keeps the current
                  value.
                </span>
                <Button
                  size="sm"
                  class="h-7 px-2.5 text-xs"
                  disabled={disabled ||
                    busy ||
                    editName.trim().length === 0 ||
                    !hasEditChanges(remote.name)}
                  onclick={() => saveRemoteEdit(remote.name)}
                  data-testid={`save-remote-${remote.name}`}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="h-7 px-2 text-xs"
                  disabled={busy}
                  onclick={() => (editing = null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <!-- Sync action buttons -->
    <div
      class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/30"
    >
      <Button
        size="sm"
        variant="outline"
        class="h-7 text-xs px-2.5 shadow-none"
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
        class="h-7 text-xs px-2.5 shadow-none"
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
        class="h-7 text-xs px-2.5 ml-auto"
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

  <!-- Add remote form -->
  <div
    class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5 pt-2"
  >
    <span
      class="text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
    >
      Add remote
    </span>
    <div class="flex items-center gap-2">
      <input
        class="w-24 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
        placeholder="origin"
        aria-label="remote name"
        bind:value={remoteName}
        disabled={disabled || busy}
      />
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="https://… or /path/to/repo.git"
        aria-label="remote url"
        bind:value={remoteUrl}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        class="h-7 text-xs px-3 shrink-0"
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
  </div>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="remote-message">{message}</p>
  {/if}
</div>
