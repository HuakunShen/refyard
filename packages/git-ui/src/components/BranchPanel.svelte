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
  import GitBranch from "@lucide/svelte/icons/git-branch";
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

<div class={cn("flex flex-col gap-2.5", className)} data-testid="branch-panel">
  {#if refs === null}
    <p class="text-xs text-ink-faint">No refs loaded.</p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="branch-list"
    >
      {#each branches as branch (branch.fullName)}
        <li
          class={cn(
            "group flex flex-col gap-1.5 rounded-lg border p-2 transition-all",
            branch.isCurrent
              ? "border-primary/40 bg-primary/5 shadow-2xs"
              : "border-border/50 bg-card/60 hover:border-border hover:bg-accent/30",
          )}
        >
          {#if renaming === branch.name}
            <div class="flex items-center gap-1.5">
              <input
                class="min-w-0 flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`new name for ${branch.name}`}
                bind:value={renameValue}
                disabled={disabled || busy}
              />
              <Button
                size="sm"
                class="h-7 text-xs px-2.5"
                disabled={disabled || busy || renameValue.trim().length === 0}
                onclick={() => {
                  onRename(branch.name, renameValue.trim());
                  renaming = null;
                }}
              >
                Rename
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-7 text-xs px-2"
                onclick={() => (renaming = null)}
              >
                Cancel
              </Button>
            </div>
          {:else}
            <div class="flex items-center gap-2 min-w-0">
              <GitBranch
                class={cn(
                  "size-3.5 shrink-0",
                  branch.isCurrent ? "text-primary" : "text-ink-muted",
                )}
              />
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs font-medium"
                title={branch.name}
              >
                {branch.name}
              </span>
              {#if branch.isCurrent}
                <Badge
                  tone="head"
                  class="shrink-0 text-[10px] h-4.5 px-1.5 font-mono"
                  >HEAD</Badge
                >
              {/if}
              {#if branch.upstream !== null}
                <span class="text-[11px] text-ink-faint shrink-0 font-mono">
                  {branch.upstream.gone
                    ? "upstream gone"
                    : `${branch.upstream.ahead}↑ ${branch.upstream.behind}↓`}
                </span>
              {/if}
            </div>

            <div
              class="flex flex-wrap items-center gap-1.5 pt-0.5 border-t border-border/20"
            >
              {#if branch.isCurrent}
                <span class="text-[11px] text-ink-faint italic py-0.5"
                  >Current branch</span
                >
              {:else}
                <Button
                  size="sm"
                  variant="secondary"
                  class="h-6 text-xs px-2 shadow-none"
                  disabled={disabled || busy}
                  onclick={() => onSwitch(branch.name)}
                  data-testid={`switch-${branch.name}`}
                >
                  Switch
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-6 text-xs px-2 shadow-none"
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
                class="h-6 text-xs px-2 text-ink-muted hover:text-ink ml-auto"
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
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex flex-col gap-2 pt-1 border-t border-border/30">
      <div class="flex items-center gap-2">
        <input
          class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="new-branch-name"
          aria-label="new branch name"
          bind:value={newBranch}
          disabled={disabled || busy}
        />
        <Button
          size="sm"
          class="h-7 text-xs px-3"
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
      <label
        class="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none"
      >
        <input
          type="checkbox"
          class="size-3.5 accent-primary rounded"
          aria-label="merge creates a commit"
          bind:checked={mergeNoFf}
          disabled={disabled || busy}
        />
        merge always creates a commit (--no-ff)
      </label>
    </div>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="branch-message">{message}</p>
  {/if}
</div>
