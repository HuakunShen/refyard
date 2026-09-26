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
  import ContextActionMenu from "./ContextActionMenu.svelte";
  import type { ContextAction } from "../lib/context-actions.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
    activeWorktreeId?: string | null;
    onOpenWorktree?: (worktreeId: string) => void;
    onOpenWorktreeInTab?: (worktreeId: string) => void;
    /**
     * The checked-out branch, which is what a worktree's branch would merge *into*.
     * Both this and `onMergeBranch` are needed for the item to exist: a caller whose
     * host cannot merge omits the callback, and a worktree on a detached head has no
     * branch to name.
     */
    currentBranch?: string | null;
    onMergeBranch?: (branchName: string, noFf: boolean) => void;
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
    activeWorktreeId = null,
    onOpenWorktree = undefined,
    onOpenWorktreeInTab = undefined,
    currentBranch = null,
    onMergeBranch = undefined,
    class: className = "",
  }: Props = $props();
  const { t } = useGitViewI18n();

  let relativeDestination = $state("");
  let referenceKind = $state<Reference["kind"]>("newBranch");
  let branchName = $state("");
  let oid = $state("");
  let lockReason = $state("");

  const shortOid = (value: string | null): string =>
    value === null ? t("worktree.unborn") : value.slice(0, 12);

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

  function worktreeContextActions(
    worktree: WorktreeEntry,
  ): readonly ContextAction[] {
    const actionDisabled = disabled || busy;
    // A worktree's branch is what the *current* branch would merge in from it — the
    // same item GitKraken's worktree menu carries. The current branch itself, a
    // detached head, and a host without the merge capability all simply leave the item
    // out rather than showing a dead one.
    const branch = worktree.head.branchName;
    const mergeAction: ContextAction | null =
      onMergeBranch !== undefined &&
      branch !== null &&
      currentBranch !== null &&
      currentBranch.length > 0 &&
      branch !== currentBranch
        ? {
            kind: "action",
            id: "merge",
            label: `Merge ${branch} into ${currentBranch}`,
            disabled: actionDisabled,
            onSelect: () => onMergeBranch(branch, false),
          }
        : null;
    return [
      ...(onOpenWorktree === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "open",
              label: t("worktree.open"),
              disabled: actionDisabled,
              onSelect: () => onOpenWorktree(worktree.worktreeId),
            },
          ]),
      ...(onOpenWorktreeInTab === undefined
        ? []
        : [
            {
              kind: "action" as const,
              id: "open-new-tab",
              label: t("worktree.openTab"),
              disabled: actionDisabled,
              onSelect: () => onOpenWorktreeInTab(worktree.worktreeId),
            },
          ]),
      ...(mergeAction === null ? [] : [mergeAction]),
    ];
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
      {t("worktree.addTitle")}
    </span>

    <div class="flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder={t("worktree.relativePath")}
        aria-label={t("worktree.destination")}
        bind:value={relativeDestination}
        disabled={disabled || busy}
      />
      <select
        class="w-32 rounded border border-input bg-panel px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
        aria-label={t("worktree.referenceKind")}
        bind:value={referenceKind}
        disabled={disabled || busy}
      >
        <option value="newBranch">{t("worktree.newBranch")}</option>
        <option value="existingBranch">{t("worktree.existingBranch")}</option>
        <option value="detached">{t("worktree.detachedCommit")}</option>
      </select>
    </div>

    <div class="flex items-center gap-2">
      {#if referenceKind === "detached"}
        <input
          class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={t("worktree.commitPlaceholder")}
          aria-label={t("worktree.commit")}
          bind:value={oid}
          disabled={disabled || busy}
        />
      {:else if referenceKind === "existingBranch"}
        <select
          class="min-w-0 flex-1 rounded border border-input bg-panel px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={t("worktree.branch")}
          bind:value={branchName}
          disabled={disabled || busy}
        >
          <option value="">{t("worktree.chooseBranch")}</option>
          {#each branches as branch (branch)}
            <option value={branch}>{branch}</option>
          {/each}
        </select>
      {:else}
        <input
          class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder={t("worktree.newBranchPlaceholder")}
          aria-label={t("worktree.newBranchLabel")}
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
        {t("worktree.add")}
      </Button>
    </div>

    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-ink-faint"
      placeholder={t("worktree.lockReasonPlaceholder")}
      aria-label={t("worktree.lockReasonLabel")}
      bind:value={lockReason}
      disabled={disabled || busy}
    />
  </div>

  <!-- Worktree List -->
  {#if worktrees === null}
    <p class="text-xs text-ink-faint">{t("worktree.notLoaded")}</p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="worktree-list"
    >
      {#each worktrees as worktree (worktree.worktreeId)}
        {@const selected = worktree.worktreeId === activeWorktreeId}
        {@const openable = onOpenWorktree !== undefined}
        <li
          class={cn(
            "flex flex-col gap-1.5 rounded-lg border p-2 transition-all",
            selected
              ? "border-primary/50 bg-primary/10 shadow-2xs"
              : "border-border/50 bg-card/60 hover:border-border hover:bg-accent/30",
          )}
        >
          <ContextActionMenu
            actions={worktreeContextActions(worktree)}
            triggerClass="block w-full"
            triggerTestId={`worktree-row-${worktree.worktreeId}`}
            data-testid={`worktree-context-${worktree.worktreeId}`}
          >
            {#snippet children()}
              <button
                type="button"
                class={cn(
                  "flex w-full items-center gap-2 min-w-0 rounded-md text-left",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                )}
                disabled={!openable || disabled}
                aria-current={selected ? "true" : undefined}
                aria-label={openable
                  ? t("worktree.openNamed").replace("{name}", () => worktree.head.branchName ?? shortOid(worktree.head.oid))
                  : undefined}
                title={worktree.displayPath}
                onclick={() => onOpenWorktree?.(worktree.worktreeId)}
              >
                <Badge
                  tone={worktree.isMain ? "muted" : "branch"}
                  class="shrink-0 text-[10px] h-4.5 px-1.5 font-mono"
                >
                  {t(worktree.isMain ? "worktree.primary" : "worktree.linked")}
                </Badge>
                {#if worktree.isLocked}
                  <Badge
                    tone="muted"
                    class="shrink-0 text-[10px] h-4.5 px-1.5 flex items-center gap-1"
                  >
                    <Lock class="size-2.5" />
                    {t("worktree.locked")}
                  </Badge>
                {/if}
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    class="truncate font-mono text-xs font-medium text-foreground"
                  >
                    {worktree.head.branchName ?? shortOid(worktree.head.oid)}
                  </span>
                  <span
                    class="truncate font-mono text-[10px] text-ink-faint"
                    title={worktree.displayPath}
                  >
                    {worktree.displayPath}
                  </span>
                </span>
              </button>

              {#if worktree.isLocked && worktree.lockReason !== null}
                <div class="text-[11px] text-ink-faint italic px-0.5">
                  {t("worktree.reason")} {worktree.lockReason}
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
                    {t("worktree.unlock")}
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
                        lockReason.trim().length === 0
                          ? null
                          : lockReason.trim(),
                      )}
                    data-testid={`lock-worktree-${worktree.worktreeId}`}
                  >
                    {t("worktree.lock")}
                  </Button>
                {/if}

                {#if !worktree.isMain}
                  <span class="ml-auto">
                    <ConfirmAction
                      label={t("worktree.remove")}
                      confirmLabel={t("worktree.removeNamed").replace("{path}", () => worktree.displayPath)}
                      description={t("worktree.removeDescription")}
                      disabled={disabled || busy}
                      {busy}
                      onConfirm={() => onRemove(worktree.worktreeId)}
                      data-testid={`remove-worktree-${worktree.worktreeId}`}
                    />
                  </span>
                {/if}
              </div>
            {/snippet}
          </ContextActionMenu>
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
