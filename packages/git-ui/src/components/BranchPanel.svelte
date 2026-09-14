<script lang="ts">
  /**
   * Branches: list, create, switch, rename, delete.
   *
   * Props and callbacks only — the page owns the client, exactly as with staging.
   * Two rules from the operation semantics are visible here:
   *
   * - **switch is never forced.** A checkout that would overwrite local changes comes
   *   back as a refusal from Git, and the panel shows the reason instead of offering
   *   a force.
   * - **delete is confirmed and has no force form.** An unmerged branch is refused by
   *   Git, and that refusal is the answer.
   */
  import type { RefsSnapshot } from "@refyard/git-contract";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    refs: RefsSnapshot | null;
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onCreate: (branchName: string) => void;
    onSwitch: (branchName: string) => void;
    onRename: (branchName: string, newName: string) => void;
    onDelete: (branchName: string) => void;
    /** Merge the named branch into the current one; `noFf` forces a merge commit. */
    onMerge: (branchName: string, noFf: boolean) => void;
    class?: string;
  }

  let {
    refs,
    disabled = false,
    busy = false,
    message = null,
    onCreate,
    onSwitch,
    onRename,
    onDelete,
    onMerge,
    class: className = "",
  }: Props = $props();

  let newBranch = $state("");
  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let mergeNoFf = $state(false);

  const branches = $derived(refs?.branches ?? []);
</script>

<div class={cn("flex flex-col gap-2", className)} data-testid="branch-panel">
  {#if refs === null}
    <p class="text-xs text-ink-faint">No refs loaded.</p>
  {:else}
    <ul
      class="flex max-h-48 flex-col gap-1 overflow-y-auto"
      data-testid="branch-list"
    >
      {#each branches as branch (branch.fullName)}
        <li class="flex flex-wrap items-center gap-2 rounded px-1 py-0.5">
          {#if branch.isCurrent}
            <Badge tone="head">HEAD</Badge>
          {:else}
            <span class="w-10"></span>
          {/if}
          {#if renaming === branch.name}
            <input
              class="w-40 rounded border border-input bg-transparent px-1 py-0.5 font-mono text-xs"
              aria-label={`new name for ${branch.name}`}
              bind:value={renameValue}
              disabled={disabled || busy}
            />
            <Button
              size="sm"
              disabled={disabled || busy || renameValue.trim().length === 0}
              onclick={() => {
                onRename(branch.name, renameValue.trim());
                renaming = null;
              }}
            >
              Rename
            </Button>
            <Button size="sm" variant="ghost" onclick={() => (renaming = null)}>
              Cancel
            </Button>
          {:else}
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs"
              title={branch.name}
            >
              {branch.name}
            </span>
            {#if branch.upstream !== null}
              <span class="text-xs text-ink-faint">
                {branch.upstream.gone
                  ? "upstream gone"
                  : `${branch.upstream.ahead}↑ ${branch.upstream.behind}↓`}
              </span>
            {/if}
            {#if branch.isCurrent}
              <span class="text-xs text-ink-faint">current</span>
            {:else}
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || busy}
                onclick={() => onSwitch(branch.name)}
                data-testid={`switch-${branch.name}`}
              >
                Switch
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || busy}
                onclick={() => onMerge(branch.name, mergeNoFf)}
                data-testid={`merge-${branch.name}`}
              >
                Merge in
              </Button>
            {/if}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || busy}
              onclick={() => {
                renaming = branch.name;
                renameValue = branch.name;
              }}
              data-testid={`rename-${branch.name}`}
            >
              Rename…
            </Button>
            {#if !branch.isCurrent}
              <ConfirmAction
                label="Delete"
                confirmLabel={`Delete ${branch.name}`}
                description="Merged branches only; an unmerged branch is refused."
                disabled={disabled || busy}
                {busy}
                onConfirm={() => onDelete(branch.name)}
                data-testid={`delete-${branch.name}`}
              />
            {/if}
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
        placeholder="new-branch-name"
        aria-label="new branch name"
        bind:value={newBranch}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        disabled={disabled || busy || newBranch.trim().length === 0}
        onclick={() => {
          onCreate(newBranch.trim());
          newBranch = "";
        }}
        data-testid="create-branch"
      >
        Create
      </Button>
    </div>
    <label class="flex items-center gap-1 text-xs text-ink-muted">
      <input
        type="checkbox"
        aria-label="merge creates a commit"
        bind:checked={mergeNoFf}
        disabled={disabled || busy}
      />
      merge always creates a commit (--no-ff)
    </label>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="branch-message">{message}</p>
  {/if}
</div>
