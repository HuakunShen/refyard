<script lang="ts">
  /**
   * An unfinished operation: what it is, what is conflicted, and what can end it.
   *
   * This panel is deliberately two-sided:
   *
   * - **A merge this build started** can be continued or aborted here. The conflicted
   *   paths come from the status read, never from the operation record, and the
   *   guidance says resolution happens outside the workbench — there is no conflict
   *   editor, and pretending otherwise would leave people waiting for one.
   * - **An operation this build did not start** (rebase, cherry-pick, revert, bisect,
   *   mailbox apply) is shown and offers nothing. Finishing somebody else's operation
   *   is not a button this product should have, and the text says why.
   *
   * The continue control is disabled while any conflicted path is still unmerged, with
   * the reason stated: Git would refuse the commit, and a button that can only fail is
   * worse than a button that explains itself.
   */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface ConflictedPath {
    readonly pathId: string;
    readonly displayPath: string;
    readonly stages: readonly { readonly stage: number }[] | null;
  }

  interface Props {
    /** What Git reports as in progress, from the status read. */
    operationInProgress: string | null;
    conflicted: readonly ConflictedPath[];
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onContinue: () => void;
    onAbort: () => void;
    class?: string;
  }

  let {
    operationInProgress,
    conflicted,
    disabled = false,
    busy = false,
    message = null,
    onContinue,
    onAbort,
    class: className = "",
  }: Props = $props();

  /**
   * Operations this build can finish: the sequencer states its own effects can
   * open. A rebase or a bisect is somebody else's state and offers nothing.
   */
  const ours: readonly string[] = ["merge", "cherry-pick", "rebase"];

  /** The operation's own name, for the buttons that finish it. */
  const operationName = $derived(
    operationInProgress === "cherry-pick"
      ? "cherry-pick"
      : operationInProgress === "rebase"
        ? "rebase"
        : "merge",
  );

  const isOurs = $derived(
    operationInProgress !== null && ours.includes(operationInProgress),
  );
  const stageSummary = (entry: ConflictedPath): string => {
    const stages = (entry.stages ?? []).map((stage) => stage.stage).sort();
    return stages.length === 0
      ? "no stages read"
      : `stages ${stages.join("/")}`;
  };
</script>

<!--
  The panel outlives the state on purpose: aborting or continuing clears
  `operationInProgress` in the same beat that the outcome arrives, and a message that
  vanished with the state would leave the user wondering whether anything happened.
-->
{#if operationInProgress !== null || message !== null}
  <div
    class={cn(
      "flex flex-col gap-2 rounded border border-warn/40 bg-warn/5 p-2",
      className,
    )}
    data-testid="conflict-panel"
  >
    {#if operationInProgress !== null}
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone="warn">{operationInProgress} in progress</Badge>
        {#if isOurs}
          <span class="text-xs text-ink-muted">
            {conflicted.length === 0
              ? "no conflicted paths remain — continue to commit the result"
              : `${conflicted.length} conflicted path(s)`}
          </span>
        {/if}
      </div>
    {/if}

    {#if operationInProgress !== null && isOurs}
      {#if conflicted.length > 0}
        <ul
          class="flex max-h-32 flex-col gap-1 overflow-y-auto"
          data-testid="conflicted-paths"
        >
          {#each conflicted as entry (entry.pathId)}
            <li class="flex items-center gap-2">
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs"
                title={entry.displayPath}
              >
                {entry.displayPath}
              </span>
              <span class="font-mono text-xs text-ink-faint">
                {stageSummary(entry)}
              </span>
            </li>
          {/each}
        </ul>
        <p class="text-xs text-ink-muted">
          Resolve these files outside Refyard, stage the results with the
          staging panel above, then continue. Nothing here edits a conflicted
          file.
        </p>
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={disabled || busy || conflicted.length > 0}
          onclick={onContinue}
          data-testid="continue-merge"
        >
          Continue {operationName}
        </Button>
        <ConfirmAction
          label="Abort {operationName}"
          confirmLabel="Abort and restore the state it started from"
          description="Restores the commit and index the operation started from."
          disabled={disabled || busy}
          {busy}
          onConfirm={onAbort}
          data-testid="abort-merge"
        />
      </div>
    {:else if operationInProgress !== null}
      <p class="text-xs text-ink-muted" data-testid="foreign-operation-note">
        This operation was started outside Refyard, and this build does not
        finish another tool's operation. Complete or abandon it with the tool
        that started it; writes stay blocked in this worktree until the state is
        resolved.
      </p>
    {/if}

    {#if message !== null}
      <p class="text-xs text-ink-muted" data-testid="conflict-message-result">
        {message}
      </p>
    {/if}
  </div>
{/if}
