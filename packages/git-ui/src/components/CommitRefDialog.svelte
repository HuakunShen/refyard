<script lang="ts">
  /** Creates a branch or tag at the selected commit without changing the checkout. */
  import { m } from "../i18n.js";
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
        {kind === "branch"
          ? m.dialog_create_branch_title({
              commit:
                commit === null ? m.dialog_commit() : shortOid(commit.oid),
            })
          : m.dialog_create_tag_title({
              commit:
                commit === null ? m.dialog_commit() : shortOid(commit.oid),
            })}
      </Dialog.Title>
      <Dialog.Description>
        {kind === "branch"
          ? m.dialog_create_branch_note()
          : m.dialog_create_tag_note()}
      </Dialog.Description>
    </Dialog.Header>

    <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
      {kind === "branch" ? m.ref_branch_name() : m.dialog_tag_name()}
      <input
        class="rounded border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        bind:value={name}
        {disabled}
        data-testid="commit-ref-name"
      />
    </label>

    {#if kind === "tag"}
      <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
        {m.commitref_annotation()}
        <textarea
          class="min-h-20 resize-y rounded border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          bind:value={annotation}
          {disabled}
          data-testid="commit-ref-annotation"></textarea>
      </label>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}
        >{m.common_cancel()}</Button
      >
      <Button
        disabled={disabled || name.trim().length === 0 || commit === null}
        onclick={submit}
        data-testid="commit-ref-submit"
      >
        {kind === "branch"
          ? m.dialog_create_branch_confirm()
          : m.dialog_create_tag_confirm()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
