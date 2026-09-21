<script lang="ts">
  /**
   * Confirm squashing the checked-out branch's top commit into the one below
   * it. An empty message keeps the parent's message; a typed one replaces it.
   * Content is never lost — the combined change stays as one commit.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";

  interface Props {
    open?: boolean;
    /** The top commit's subject, for the title. */
    subject: string | null;
    parentSubject?: string | null;
    disabled?: boolean;
    busy?: boolean;
    onConfirm: (message: string | null) => void;
    "data-testid"?: string;
  }

  let {
    open = $bindable(false),
    subject,
    parentSubject = null,
    disabled = false,
    busy = false,
    onConfirm,
    "data-testid": testId = undefined,
  }: Props = $props();

  let message = $state("");

  function confirm(): void {
    open = false;
    const trimmed = message.trim();
    onConfirm(trimmed.length === 0 ? null : trimmed);
    message = "";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid={testId}>
    <Dialog.Header>
      <Dialog.Title>
        {subject === null
          ? "Squash into parent"
          : `Squash "${subject}" into the commit below?`}
      </Dialog.Title>
      <Dialog.Description>
        {parentSubject === null
          ? "The two commits become one, combining both changes. No content is lost."
          : `The two commits become one, combining "${parentSubject}" and "${subject}". No content is lost.`}
      </Dialog.Description>
    </Dialog.Header>
    <label class="flex flex-col gap-1.5 text-sm">
      <span class="text-muted-foreground">
        Commit message — leave empty to keep "{parentSubject ?? "the parent"}"
      </span>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        autofocus
        bind:value={message}
        rows={3}
        class="rounded-lg border border-border/60 bg-transparent px-3 py-2"
        data-testid={testId === undefined ? undefined : `${testId}-message`}
      ></textarea>
    </label>
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
        {busy ? "Working…" : "Squash"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
