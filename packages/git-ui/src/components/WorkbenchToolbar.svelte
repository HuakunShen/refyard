<script lang="ts">
  /**
   * The workbench's action toolbar: the row of basic Git actions a workbench is
   * operated by — stage all, stash, pop, fetch, pull, push — each shown only when the
   * host advertises the operation behind it, each disabled with an explanation when
   * the repository state gives it nothing to act on. GitKraken puts this row at the
   * top; a reader who has to hunt through side panels for "push" has been made to
   * think about the UI instead of their repository.
   */
  import ArrowDownToLine from "@lucide/svelte/icons/arrow-down-to-line";
  import ArrowUpFromLine from "@lucide/svelte/icons/arrow-up-from-line";
  import CloudDownload from "@lucide/svelte/icons/cloud-download";
  import Layers from "@lucide/svelte/icons/layers";
  import PackageOpen from "@lucide/svelte/icons/package-open";
  import { m } from "../i18n.js";
  import { cn } from "../lib/utils.js";
  import { Button } from "./ui/button/index.js";
  import PushSetUpstreamDialog from "./PushSetUpstreamDialog.svelte";

  interface Props {
    /** True while any write is in flight; the whole row holds still. */
    busy?: boolean;
    /** True when no repository is open; the row is absent, not greyed. */
    visible: boolean;
    changedCount: number;
    onStageAll: (() => void) | null;
    onStash: (() => void) | null;
    onPopStash: (() => void) | null;
    onFetch: (() => void) | null;
    onPull: (() => void) | null;
    onPush: (() => void) | null;
    /**
     * Push a branch that has no upstream yet: the dialog names the remote and the
     * destination, and the push sets upstream tracking in the same move.
     */
    onPushUpstream?: ((remoteName: string, branchName: string) => void) | null;
    /** Why a sync button cannot run, when it cannot: the tooltip says it. */
    syncProblem?: null | "no-remote" | "no-branch" | "no-upstream";
    /** The remote the sync buttons act on, for their tooltips. */
    remoteName?: string;
    /** The checked-out branch, for the upstream question and its prefilled answer. */
    branchName?: string | null;
    /** The repository's remote names, for the upstream question's dropdown. */
    remotes?: readonly string[];
    stashCount?: number;
    class?: string;
  }

  let {
    busy = false,
    visible,
    changedCount,
    onStageAll,
    onStash,
    onPopStash,
    onFetch,
    onPull,
    onPush,
    onPushUpstream = null,
    syncProblem = null,
    remoteName = "",
    branchName = null,
    remotes = [],
    stashCount = 0,
    class: className = "",
  }: Props = $props();

  const syncDisabledReason = $derived(
    syncProblem === "no-remote"
      ? m.toolbar_no_remote()
      : syncProblem === "no-branch"
        ? m.toolbar_no_branch()
        : null,
  );

  /** A branch without upstream can still push — by answering where it goes first. */
  let upstreamOpen = $state(false);

  function push(): void {
    if (busy) return;
    if (syncProblem === "no-upstream" && onPushUpstream !== null) {
      upstreamOpen = true;
      return;
    }
    onPush?.();
  }
</script>

{#if visible}
  <div
    class={cn(
      "macos:border-b-border macos:bg-(--chrome) macos:backdrop-blur-xl macos:backdrop-saturate-150 windows:bg-(--chrome) linux:bg-(--chrome) flex shrink-0 items-center gap-1.5 border-b border-border/60 bg-card/40 px-2.5 py-1.5",
      className,
    )}
    data-testid="workbench-toolbar"
  >
    {#if onStageAll !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || changedCount === 0}
        title={
          changedCount === 0
            ? m.working_copy_clean()
            : m.toolbar_stage_all_title({ n: changedCount })
        }
        data-testid="toolbar-stage-all"
        onclick={onStageAll}
      >
        <Layers class="size-3.5" />
        {m.toolbar_stage_all()}
        {#if changedCount > 0}
          <span class="font-mono text-[10px] text-muted-foreground"
            >{changedCount}</span
          >
        {/if}
      </Button>
    {/if}

    {#if onStash !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || changedCount === 0}
        title={m.toolbar_stash()}
        data-testid="toolbar-stash"
        onclick={onStash}
      >
        <PackageOpen class="size-3.5" />
        {m.toolbar_stash()}
      </Button>
    {/if}

    {#if onPopStash !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || stashCount === 0}
        title={stashCount === 0 ? m.toolbar_pop_none_title() : m.toolbar_pop_stash()}
        data-testid="toolbar-pop-stash"
        onclick={onPopStash}
      >
        <PackageOpen class="size-3.5 rotate-180" />
        {m.toolbar_pop_stash()}
      </Button>
    {/if}

    <div class="mx-1 h-5 w-px bg-border/60"></div>

    {#if onFetch !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || syncProblem === "no-remote"}
        title={
          syncProblem === "no-remote"
            ? m.toolbar_no_remote()
            : `${m.toolbar_fetch()}${remoteName === "" ? "" : ` · ${remoteName}`}`
        }
        data-testid="toolbar-fetch"
        onclick={onFetch}
      >
        <CloudDownload class="size-3.5" />
        {m.toolbar_fetch()}
      </Button>
    {/if}

    {#if onPull !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || syncDisabledReason !== null}
        title={syncDisabledReason ?? m.toolbar_pull()}
        data-testid="toolbar-pull"
        onclick={onPull}
      >
        <ArrowDownToLine class="size-3.5" />
        {m.toolbar_pull()}
      </Button>
    {/if}

    {#if onPush !== null}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5 px-2.5 text-xs"
        disabled={busy || syncDisabledReason !== null}
        title={syncDisabledReason ??
          (syncProblem === "no-upstream" ? m.toolbar_push_set_upstream() : m.toolbar_push())}
        data-testid="toolbar-push"
        onclick={push}
      >
        <ArrowUpFromLine class="size-3.5" />
        {m.toolbar_push()}
      </Button>
    {/if}
  </div>
{/if}

{#if onPushUpstream !== null}
  <PushSetUpstreamDialog
    bind:open={upstreamOpen}
    {branchName}
    {remotes}
    {busy}
    onSubmit={(remote, branch) => onPushUpstream(remote, branch)}
  />
{/if}
