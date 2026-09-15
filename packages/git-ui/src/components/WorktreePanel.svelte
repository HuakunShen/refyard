<script lang="ts">
  /**
   * Worktrees: create a linked checkout, remove it, lock or unlock it.
   *
   * Two rules are visible in the markup rather than only in the host: the primary
   * worktree has no remove control at all (Git refuses it, and a button that always
   * fails is a lie), and creating one names the destination as a path *inside* the
   * approved root, because that is the shape the request carries. A removal is two
   * steps — it deletes a directory, and Git refuses it when the checkout is dirty,
   * which the panel reports instead of working around.
   */
  import Lock from "@lucide/svelte/icons/lock";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface WorktreeEntry {
    readonly worktreeId: string;
    readonly displayPath: string;
    readonly isMain: boolean;
    readonly isLocked: boolean;
    readonly lockReason: string | null;
    /** `null` on an unborn branch, which is a state, not a missing value. */
    readonly head: {
      readonly branchName: string | null;
      readonly oid: string | null;
    };
  }

  type Reference =
    | { readonly kind: "newBranch"; readonly branchName: string }
    | { readonly kind: "existingBranch"; readonly branchName: string }
    | { readonly kind: "detached"; readonly oid: string };

  interface Props {
    worktrees: readonly WorktreeEntry[] | null;
    /** Branch names offered for `existingBranch`, from the refs read. */
    branches: readonly string[];
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onCreate: (relativeDestination: string, reference: Reference) => void;
    onRemove: (worktreeId: string) => void;
    onLock: (worktreeId: string, reason: string | null) => void;
    onUnlock: (worktreeId: string) => void;
    class?: string;
  }

  let {
    worktrees,
    branches,
    disabled = false,
    busy = false,
    message = null,
    onCreate,
    onRemove,
    onLock,
    onUnlock,
    class: className = "",
  }: Props = $props();

  let relativeDestination = $state("");
  let referenceKind = $state<Reference["kind"]>("newBranch");
  let branchName = $state("");
  let oid = $state("");
  let lockReason = $state("");

  const shortOid = (value: string | null): string =>
    value === null ? "unborn" : value.slice(0, 12);

  function submitCreate(): void {
    const destination = relativeDestination.trim();
    const name = branchName.trim();
    const revision = oid.trim();
    if (destination.length === 0) {
      return;
    }
    switch (referenceKind) {
      case "newBranch": {
        if (name.length === 0) {
          return;
        }
        onCreate(destination, { kind: "newBranch", branchName: name });
        break;
      }
      case "existingBranch": {
        if (name.length === 0) {
          return;
        }
        onCreate(destination, { kind: "existingBranch", branchName: name });
        break;
      }
      case "detached": {
        if (revision.length === 0) {
          return;
        }
        onCreate(destination, { kind: "detached", oid: revision });
        break;
      }
    }
    relativeDestination = "";
  }
</script>

<div
  class={cn("flex flex-col gap-2.5", className)}
  data-testid="worktree-panel"
>
  <!-- Worktree Creation Form -->
  <div
    class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5"
  >
    <span
      class="text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
    >
      Add linked worktree
    </span>

    <div class="flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="relative/path"
        aria-label="worktree destination"
        bind:value={relativeDestination}
        disabled={disabled || busy}
      />
      <select
        class="w-32 rounded border border-input bg-panel px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
        aria-label="worktree reference kind"
        bind:value={referenceKind}
        disabled={disabled || busy}
      >
        <option value="newBranch">new branch</option>
        <option value="existingBranch">existing branch</option>
        <option value="detached">detached commit</option>
      </select>
    </div>

    <div class="flex items-center gap-2">
      {#if referenceKind === "detached"}
        <input
          class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="commit object name"
          aria-label="worktree commit"
          bind:value={oid}
          disabled={disabled || busy}
        />
      {:else if referenceKind === "existingBranch"}
        <select
          class="min-w-0 flex-1 rounded border border-input bg-panel px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="worktree branch"
          bind:value={branchName}
          disabled={disabled || busy}
        >
          <option value="">choose a branch</option>
          {#each branches as branch (branch)}
            <option value={branch}>{branch}</option>
          {/each}
        </select>
      {:else}
        <input
          class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="new branch name"
          aria-label="worktree new branch"
          bind:value={branchName}
          disabled={disabled || busy}
        />
      {/if}

      <Button
        size="sm"
        class="h-7 text-xs px-3 shrink-0"
        disabled={disabled || busy || relativeDestination.trim().length === 0}
        onclick={submitCreate}
        data-testid="create-worktree"
      >
        Add worktree
      </Button>
    </div>

    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-ink-faint"
      placeholder="lock reason (optional)"
      aria-label="worktree lock reason"
      bind:value={lockReason}
      disabled={disabled || busy}
    />
  </div>

  <!-- Worktree List -->
  {#if worktrees === null}
    <p class="text-xs text-ink-faint">No worktrees loaded.</p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="worktree-list"
    >
      {#each worktrees as worktree (worktree.worktreeId)}
        <li
          class="flex flex-col gap-1.5 rounded-lg border border-border/50 bg-card/60 p-2 hover:border-border hover:bg-accent/30 transition-all"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Badge
              tone={worktree.isMain ? "muted" : "branch"}
              class="shrink-0 text-[10px] h-4.5 px-1.5 font-mono"
            >
              {worktree.isMain ? "primary" : "linked"}
            </Badge>
            {#if worktree.isLocked}
              <Badge
                tone="muted"
                class="shrink-0 text-[10px] h-4.5 px-1.5 flex items-center gap-1"
              >
                <Lock class="size-2.5" />
                locked
              </Badge>
            {/if}
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground"
              title={worktree.displayPath}
            >
              {worktree.displayPath}
            </span>
            <span class="font-mono text-xs text-ink-muted shrink-0">
              {worktree.head.branchName ?? shortOid(worktree.head.oid)}
            </span>
          </div>

          {#if worktree.isLocked && worktree.lockReason !== null}
            <div class="text-[11px] text-ink-faint italic px-0.5">
              Reason: {worktree.lockReason}
            </div>
          {/if}

          <div
            class="flex items-center gap-1.5 pt-0.5 border-t border-border/20"
          >
            {#if worktree.isLocked}
              <Button
                size="sm"
                variant="outline"
                class="h-6 text-xs px-2 shadow-none"
                disabled={disabled || busy}
                onclick={() => onUnlock(worktree.worktreeId)}
                data-testid={`unlock-worktree-${worktree.worktreeId}`}
              >
                Unlock
              </Button>
            {:else}
              <Button
                size="sm"
                variant="outline"
                class="h-6 text-xs px-2 shadow-none"
                disabled={disabled || busy}
                onclick={() =>
                  onLock(
                    worktree.worktreeId,
                    lockReason.trim().length === 0 ? null : lockReason.trim(),
                  )}
                data-testid={`lock-worktree-${worktree.worktreeId}`}
              >
                Lock
              </Button>
            {/if}

            {#if !worktree.isMain}
              <span class="ml-auto">
                <ConfirmAction
                  label="Remove"
                  confirmLabel={`Remove ${worktree.displayPath}`}
                  description="Refused when the checkout has changes."
                  disabled={disabled || busy}
                  {busy}
                  onConfirm={() => onRemove(worktree.worktreeId)}
                  data-testid={`remove-worktree-${worktree.worktreeId}`}
                />
              </span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="worktree-message-result">
      {message}
    </p>
  {/if}
</div>
