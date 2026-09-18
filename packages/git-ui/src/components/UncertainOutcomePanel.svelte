<script lang="ts">
  /**
   * The block an uncertain operation puts on a repository, and the way out of it.
   *
   * A write whose outcome died with a process comes back `unknown` and blocks the
   * repository's next write — by design, because retrying could repeat a side effect
   * nobody can name. This panel explains that in the service's own words, names the
   * operations involved, and requires an explicit confirmation before acknowledging.
   * The acknowledgement never rewrites the uncertain outcome; it only records that a
   * person looked at the repository and lifts the block.
   */
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    /** Why the service is blocking, verbatim from the refusal. */
    reason: string;
    /** The operations whose outcome nobody knows. */
    operationIds: readonly string[];
    /** What the acknowledgement answered, after it ran. */
    note?: string | undefined;
    disabled?: boolean;
    busy?: boolean;
    onAcknowledge: () => void;
    class?: string;
    "data-testid"?: string;
  }

  let {
    reason,
    operationIds,
    note = undefined,
    disabled = false,
    busy = false,
    onAcknowledge,
    class: className = "",
    "data-testid": testId = undefined,
  }: Props = $props();

  let confirmed = $state(false);
</script>

<div
  role="alert"
  class={cn(
    "rounded-md border border-danger/40 bg-danger/10 p-3 text-sm",
    className,
  )}
  data-testid={testId ?? "uncertain-outcome-panel"}
>
  <p class="font-medium text-ink">
    Writes are blocked: an operation's outcome is unknown
  </p>
  <p class="mt-1 text-xs text-ink-muted">{reason}</p>
  {#if operationIds.length > 0}
    <ul
      class="mt-2 space-y-0.5 font-mono text-xs text-ink-muted"
      data-testid="uncertain-operation-ids"
    >
      {#each operationIds as id (id)}
        <li>{id}</li>
      {/each}
    </ul>
  {/if}
  <label
    class="mt-2 flex items-start gap-2 text-xs text-ink"
    data-testid="uncertain-confirm-label"
  >
    <input
      type="checkbox"
      class="mt-0.5"
      bind:checked={confirmed}
      disabled={disabled || busy}
      data-testid="uncertain-confirm-checkbox"
    />
    <span>
      I have re-read the repository state and accept what these operations may
      have done. Acknowledging records that confirmation; it does not change
      their recorded outcome.
    </span>
  </label>
  {#if note !== undefined && note !== ""}
    <p class="mt-2 text-xs text-ink-muted" data-testid="uncertain-note">
      {note}
    </p>
  {/if}
  <div class="mt-2">
    <Button
      size="sm"
      disabled={disabled || busy || !confirmed}
      onclick={() => {
        confirmed = false;
        onAcknowledge();
      }}
      data-testid="uncertain-acknowledge"
    >
      {busy ? "Acknowledging…" : "Confirm and unblock writes"}
    </Button>
  </div>
</div>
