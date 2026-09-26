<script lang="ts">
  /**
   * Ask where a worktree created from a commit should live and what its new
   * branch is named. The destination is relative to an approved root — the
   * contract refuses absolute paths — and the branch starts at the clicked
   * commit rather than at HEAD.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
  const { t } = useGitViewI18n();

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
          ? t("worktreeCommit.titleHere")
          : t("worktreeCommit.titleSubject").replace("{subject}", () => subject)}
      </Dialog.Title>
      <Dialog.Description>
        {t("worktreeCommit.description")}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="text-muted-foreground">{t("worktreeCommit.branchName")}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          bind:value={branchName}
          placeholder={t("worktreeCommit.branchPlaceholder")}
          class="h-9 rounded-lg border border-border/60 bg-transparent px-3"
          data-testid={testId === undefined ? undefined : `${testId}-branch`}
        />
      </label>
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="text-muted-foreground">
          {t("worktreeCommit.folder")}
        </span>
        <input
          bind:value={relativeDestination}
          placeholder={t("worktreeCommit.folderPlaceholder")}
          class="h-9 rounded-lg border border-border/60 bg-transparent px-3"
          data-testid={testId === undefined
            ? undefined
            : `${testId}-destination`}
        />
      </label>
    </div>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
        {t("action.cancel")}
      </Button>
      <Button
        variant="default"
        disabled={disabled || busy || !ready}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? t("action.working") : t("worktreeCommit.confirm")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
