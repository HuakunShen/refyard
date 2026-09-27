<script lang="ts">
  import type { CommitSummary } from "@refyard/git-contract";
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import { shortOid } from "../lib/format.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
  const { t } = useGitViewI18n();

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
        {t(kind === "branch" ? "commitRef.createBranchAt" : "commitRef.createTagAt").replace("{commit}", () => commit === null ? t("commitRef.commit") : shortOid(commit.oid))}
      </Dialog.Title>
      <Dialog.Description>
        {kind === "branch"
          ? t("commitRef.branchDescription")
          : t("commitRef.tagDescription")}
      </Dialog.Description>
    </Dialog.Header>

    <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
      {t(kind === "branch" ? "commitRef.branchName" : "commitRef.tagName")}
      <input
        class="rounded border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        bind:value={name}
        {disabled}
        data-testid="commit-ref-name"
      />
    </label>

    {#if kind === "tag"}
      <label class="flex flex-col gap-1.5 text-xs text-ink-muted">
        {t("commitRef.annotation")}
        <textarea
          class="min-h-20 resize-y rounded border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          bind:value={annotation}
          {disabled}
          data-testid="commit-ref-annotation"></textarea>
      </label>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{t("action.cancel")}</Button>
      <Button
        disabled={disabled || name.trim().length === 0 || commit === null}
        onclick={submit}
        data-testid="commit-ref-submit"
      >
        {t(kind === "branch" ? "commitRef.createBranch" : "commitRef.createTag")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
