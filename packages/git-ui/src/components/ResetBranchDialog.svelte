<script lang="ts">
  /**
   * Confirm resetting the checked-out branch to a commit, with a mode choice.
   *
   * Only the two modes that cannot lose content are offered: soft keeps the
   * index, mixed unstages what is staged. Git's hard reset is deliberately
   * absent — discarding working-tree content belongs to the discard machinery,
   * which pre-checks paths and backs them up first.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import Check from "@lucide/svelte/icons/check";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";

  interface Props {
    open?: boolean;
    /** The subject the branch moves to, for the title. */
    subject: string | null;
    branchName?: string | null;
    disabled?: boolean;
    busy?: boolean;
    onConfirm: (mode: "soft" | "mixed") => void;
    "data-testid"?: string;
  }

  let {
    open = $bindable(false),
    subject,
    branchName = null,
    disabled = false,
    busy = false,
    onConfirm,
    "data-testid": testId = undefined,
  }: Props = $props();

  let mode = $state<"soft" | "mixed">("mixed");

  const MODES: readonly {
    readonly id: "soft" | "mixed";
    readonly label: string;
    readonly note: string;
  }[] = [
    {
      id: "mixed",
      label: "Mixed — unstage changes",
      note: "Moves the branch and resets the index to the commit. Staged work becomes unstaged; every file keeps its content.",
    },
    {
      id: "soft",
      label: "Soft — keep everything staged",
      note: "Moves the branch and leaves the index exactly as it is, so the same changes stay staged on top of the new head.",
    },
  ];

  function confirm(): void {
    open = false;
    onConfirm(mode);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid={testId}>
    <Dialog.Header>
      <Dialog.Title>
        {subject === null
          ? "Reset branch to here"
          : branchName === null
            ? `Reset branch to "${subject}"?`
            : `Reset ${branchName} to "${subject}"?`}
      </Dialog.Title>
      <Dialog.Description>
        Moves the checked-out branch to this commit. The working tree is never
        touched and no content is lost.
      </Dialog.Description>
    </Dialog.Header>
    <div
      class="flex flex-col gap-2"
      data-testid={testId === undefined ? undefined : `${testId}-modes`}
    >
      {#each MODES as option (option.id)}
        <button
          type="button"
          class="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors {mode ===
          option.id
            ? 'border-primary/60 bg-primary/5'
            : 'border-border/50 hover:bg-muted/40'}"
          disabled={busy}
          onclick={() => (mode = option.id)}
          data-testid={testId === undefined
            ? undefined
            : `${testId}-mode-${option.id}`}
        >
          <span
            class="mt-0.5 shrink-0 {mode === option.id
              ? 'text-primary'
              : 'text-muted-foreground'}"
          >
            {#if mode === option.id}
              <Check class="size-4" />
            {:else}
              <CircleDashed class="size-4" />
            {/if}
          </span>
          <span class="min-w-0">
            <span class="block text-sm font-medium">{option.label}</span>
            <span class="block text-xs text-muted-foreground"
              >{option.note}</span
            >
          </span>
        </button>
      {/each}
    </div>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
        Cancel
      </Button>
      <Button
        variant="destructive"
        disabled={disabled || busy}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? "Working…" : "Reset branch"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
