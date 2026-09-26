<script lang="ts">
  /**
   * Compact worktree WIP switcher for the workbench.
   *
   * Each linked checkout owns its own index and working tree, so the counts
   * come from that worktree's status snapshot. A missing or failed snapshot
   * remains visible as loading or unavailable instead of being presented as a
   * clean checkout.
   */
  import type { StatusSnapshot, WorktreeSummary } from "@refyard/git-contract";
  import GitBranch from "@lucide/svelte/icons/git-branch";
  import { Badge } from "./ui/badge/index.js";
  import { groupWorkingCopyEntries } from "../lib/working-copy.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  interface WorktreeStatus {
    readonly worktreeId: string;
    readonly status: StatusSnapshot | null;
    readonly error: string | null;
  }

  interface Props {
    worktrees: readonly WorktreeSummary[];
    activeWorktreeId: string | null;
    statuses: readonly WorktreeStatus[];
    onSelect: (worktreeId: string) => void;
    disabled?: boolean;
    class?: string;
  }

  let {
    worktrees,
    activeWorktreeId,
    statuses,
    onSelect,
    disabled = false,
    class: className = "",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;

  const visibleWorktrees = $derived(
    worktrees.filter((worktree) => !worktree.isBare && !worktree.isPrunable),
  );
  const statusByWorktreeId = $derived(
    new Map(statuses.map((entry) => [entry.worktreeId, entry])),
  );

  function branchLabel(worktree: WorktreeSummary): string {
    return (
      worktree.head.branchName ??
      (worktree.head.kind === "unborn" ? t("worktreeWip.unborn") : t("worktreeWip.detached"))
    );
  }

  function statusCounts(status: StatusSnapshot): {
    readonly staged: number;
    readonly unstaged: number;
  } {
    const groups = groupWorkingCopyEntries(status.entries);
    return { staged: groups.staged.length, unstaged: groups.unstaged.length };
  }
</script>

{#if visibleWorktrees.length > 0}
  <section
    class={cn("flex min-w-0 flex-col gap-1.5", className)}
    aria-label={t("worktreeWip.changes")}
    data-testid="worktree-wip-list"
  >
    <div class="flex items-center gap-2 px-0.5">
      <span
        class="text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
        >{t("worktreeWip.wip")}</span
      >
      <Badge tone="muted" class="h-4.5 px-1.5 text-[10px] font-mono"
        >{i18n.count(visibleWorktrees.length)}</Badge
      >
      <span class="text-[11px] text-ink-faint">{t("worktreeWip.workingCopies")}</span>
    </div>

    <ul
      class="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5"
      data-testid="worktree-wip-rows"
    >
      {#each visibleWorktrees as worktree (worktree.worktreeId)}
        {@const selected = worktree.worktreeId === activeWorktreeId}
        {@const record = statusByWorktreeId.get(worktree.worktreeId)}
        {@const counts =
          record?.status === null || record?.status === undefined
            ? null
            : statusCounts(record.status)}
        {@const label = branchLabel(worktree)}
        <li class="min-w-0 shrink-0">
          <button
            type="button"
            class={cn(
              "flex min-w-52 max-w-80 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all",
              selected
                ? "border-primary/50 bg-primary/10 shadow-2xs"
                : "border-border/40 bg-card/40 hover:border-border/70 hover:bg-accent/30",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            )}
            {disabled}
            aria-current={selected ? "true" : undefined}
            aria-label={t("worktreeWip.atPath").replace("{branch}", () => label).replace("{path}", () => worktree.displayPath)}
            title={`${label}\n${worktree.displayPath}`}
            onclick={() => onSelect(worktree.worktreeId)}
            data-testid={`worktree-wip-${worktree.worktreeId}`}
          >
            <GitBranch
              class="size-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block truncate font-mono text-xs font-medium text-foreground"
              >
                {label}
              </span>
              <span class="block truncate font-mono text-[10px] text-ink-faint">
                {worktree.displayPath}
              </span>
            </span>
            {#if counts !== null}
              <span
                class="flex shrink-0 items-center gap-1 font-mono text-[10px]"
              >
                {#if counts.unstaged > 0}
                  <span class="text-amber-600 dark:text-amber-400"
                    >{i18n.count(counts.unstaged)} {t("worktreeWip.unstaged")}</span
                  >
                {/if}
                {#if counts.staged > 0}
                  <span class="text-emerald-600 dark:text-emerald-400"
                    >{i18n.count(counts.staged)} {t("worktreeWip.staged")}</span
                  >
                {/if}
                {#if counts.unstaged === 0 && counts.staged === 0}
                  <span class="text-ink-faint">{t("worktreeWip.clean")}</span>
                {/if}
              </span>
            {:else if record?.error !== null && record?.error !== undefined}
              <span
                class="shrink-0 text-[10px] text-ink-faint"
                title={record.error}>{t("worktreeWip.unavailable")}</span
              >
            {:else}
              <span class="shrink-0 text-[10px] text-ink-faint">{t("xross.read.loading")}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}
