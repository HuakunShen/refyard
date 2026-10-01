<script lang="ts">
  /**
   * The stopped Git operation, conflicted paths, and supported recovery actions.
   * Status is authoritative even when another tool started the operation.
   * Continue stays disabled until every conflict has been resolved and staged;
   * unsupported sequencer states remain visible without completion controls.
   */
  import { m } from "../i18n.js";
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
    /** Absent callbacks mean the backend does not advertise the corresponding recovery operation. */
    onContinue?: () => void;
    onAbort?: () => void;
    class?: string;
  }

  let {
    operationInProgress,
    conflicted,
    disabled = false,
    busy = false,
    message = null,
    onContinue = undefined,
    onAbort = undefined,
    class: className = "",
  }: Props = $props();

  /** The operation's own name, for the buttons that finish it. */
  const operationName = $derived.by(() => {
    switch (operationInProgress) {
      case "merge":
        return m.conflict_operation_merge();
      case "cherry-pick":
        return m.conflict_operation_cherry_pick();
      case "rebase":
        return m.conflict_operation_rebase();
      case "revert":
        return m.conflict_operation_revert();
      case "bisect":
        return m.conflict_operation_bisect();
      case "apply-mailbox":
        return m.conflict_operation_mailbox();
      case "unknown":
        return m.conflict_operation_unknown();
      default:
        return operationInProgress ?? m.conflict_operation_unknown();
    }
  });

  const stageSummary = (entry: ConflictedPath): string => {
    const stages = (entry.stages ?? []).map((stage) => stage.stage).sort();
    return stages.length === 0
      ? m.conflict_no_stages()
      : m.conflict_stages({ stages: stages.join("/") });
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
        <Badge tone="warn"
          >{m.conflict_in_progress({ operation: operationName })}</Badge
        >
        <span class="text-xs text-ink-muted">
          {conflicted.length === 0
            ? m.conflict_no_paths()
            : m.conflict_count({ n: conflicted.length })}
        </span>
      </div>
    {/if}

    {#if operationInProgress !== null}
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
        {#if onContinue !== undefined}
          <p class="text-xs text-ink-muted">{m.conflict_resolution_hint()}</p>
        {/if}
      {/if}
      <div class="flex flex-wrap items-center gap-2">
        {#if onContinue !== undefined}
          <Button
            size="sm"
            disabled={disabled || busy || conflicted.length > 0}
            onclick={onContinue}
            data-testid="continue-merge"
          >
            {m.conflict_continue({ operation: operationName })}
          </Button>
        {/if}
        {#if onAbort !== undefined}
          <!-- A changed sequencer state must not inherit an armed confirmation. -->
          {#key operationInProgress}
            <ConfirmAction
              label={m.conflict_abort({ operation: operationName })}
              confirmLabel={m.abort_and_restore()}
              description={m.conflict_abort_description()}
              disabled={disabled || busy}
              {busy}
              onConfirm={onAbort}
              data-testid="abort-merge"
            />
          {/key}
        {/if}
      </div>
      {#if onContinue === undefined && onAbort === undefined}
        <p class="text-xs text-ink-muted" data-testid="foreign-operation-note">
          {m.conflict_unsupported_hint()}
        </p>
      {:else if onContinue === undefined}
        <p
          class="text-xs text-ink-muted"
          data-testid="conflict-no-continue-note"
        >
          {m.conflict_no_continue_hint()}
        </p>
      {:else if onAbort === undefined}
        <p class="text-xs text-ink-muted" data-testid="conflict-no-abort-note">
          {m.conflict_no_abort_hint()}
        </p>
      {/if}
    {/if}

    {#if message !== null}
      <p class="text-xs text-ink-muted" data-testid="conflict-message-result">
        {message}
      </p>
    {/if}
  </div>
{/if}
