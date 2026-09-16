<script lang="ts">
  import type { CommitSummary } from "@refyard/git-contract";
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import { shortOid } from "../lib/format.js";

  interface Props {
    open?: boolean;
    kind: "branch" | "tag";
    commit: CommitSummary | null;
    disabled?: boolean;
    onSubmit: (
      commit: CommitSummary,
      name: string,
      annotation: string | null,
    ) => void;
  }

  let {
    open = $bindable(false),
    kind,
    commit,
    disabled = false,
    onSubmit,
  }: Props = $props();

  let name = $state("");
  let annotation = $state("");
  let previousTarget = "";

  $effect(() => {
    const target = open && commit !== null ? `${kind}:${commit.oid}` : "";
    if (target !== "" && target !== previousTarget) {
      name = "";
      annotation = "";
    }
    previousTarget = target;
  });

  function submit(): void {
    if (commit === null || name.trim().length === 0) {
      return;
    }
    onSubmit(
      commit,
      name.trim(),
      kind === "tag" && annotation.trim().length > 0 ? annotation.trim() : null,
    );
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid="commit-ref-dialog">
    <Dialog.Header>
      <Dialog.Title>
        Create {kind} at {commit === null ? "commit" : shortOid(commit.oid)}
      </Dialog.Title>
      <Dialog.Description>
        {kind === "branch"
          ? "Create a branch that points at this exact commit without switching HEAD."
          : "Create a tag that points at this exact commit."}
      </Dialog.Description>
    </Dialog.Header>

    <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
      {kind === "branch" ? "Branch name" : "Tag name"}
      <input
        class="rounded border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        bind:value={name}
        {disabled}
        data-testid="commit-ref-name"
      />
    </label>

    {#if kind === "tag"}
      <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
        Annotation (optional)
        <textarea
          class="min-h-20 resize-y rounded border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          bind:value={annotation}
          {disabled}
          data-testid="commit-ref-annotation"></textarea>
      </label>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button
        disabled={disabled || name.trim().length === 0 || commit === null}
        onclick={submit}
        data-testid="commit-ref-submit"
      >
        Create {kind}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
