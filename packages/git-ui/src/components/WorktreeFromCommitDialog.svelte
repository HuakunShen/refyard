<script lang="ts">
  /**
   * Ask where a worktree created from a commit should live and what its new
   * branch is named. The destination is relative to an approved root — the
   * contract refuses absolute paths — and the branch starts at the clicked
   * commit rather than at HEAD.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";

  interface Props {
    open?: boolean;
    /** The commit the new branch starts at, for the title. */
    subject: string | null;
    disabled?: boolean;
    busy?: boolean;
    onConfirm: (relativeDestination: string, branchName: string) => void;
    "data-testid"?: string;
  }

  let {
    open = $bindable(false),
    subject,
    disabled = false,
    busy = false,
    onConfirm,
    "data-testid": testId = undefined,
  }: Props = $props();

  let relativeDestination = $state("");
  let branchName = $state("");

  const ready = $derived(
    relativeDestination.trim().length > 0 && branchName.trim().length > 0,
  );

  function confirm(): void {
    if (!ready) {
      return;
    }
    open = false;
    onConfirm(relativeDestination.trim(), branchName.trim());
    relativeDestination = "";
    branchName = "";
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid={testId}>
    <Dialog.Header>
      <Dialog.Title>
        {subject === null
          ? "Create worktree from here"
          : `Create worktree from "${subject}"?`}
      </Dialog.Title>
      <Dialog.Description>
        Adds a linked worktree inside the approved root, with a new branch
        starting at this commit. Your checked-out branch and working tree stay
        where they are.
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="text-muted-foreground">New branch name</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={branchName}
          placeholder="branch this worktree works on"
          class="h-9 rounded-lg border border-border/60 bg-transparent px-3"
          data-testid={testId === undefined ? undefined : `${testId}-branch`}
        />
      </label>
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="text-muted-foreground">
          Worktree folder, relative to the approved root
        </span>
        <input
          bind:value={relativeDestination}
          placeholder="e.g. worktrees/my-branch"
          class="h-9 rounded-lg border border-border/60 bg-transparent px-3"
          data-testid={testId === undefined
            ? undefined
            : `${testId}-destination`}
        />
      </label>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
        Cancel
      </Button>
      <Button
        variant="default"
        disabled={disabled || busy || !ready}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? "Working…" : "Create worktree"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
