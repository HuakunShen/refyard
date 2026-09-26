<script lang="ts">
  /**
   * Confirm squashing the checked-out branch's top commit into the one below
   * it. An empty message keeps the parent's message; a typed one replaces it.
   * Content is never lost — the combined change stays as one commit.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
  const { t } = useGitViewI18n();

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
          ? t("squash.titleParent")
          : t("squash.titleSubject").replace("{subject}", () => subject)}
      </Dialog.Title>
      <Dialog.Description>
        {parentSubject === null
          ? t("squash.description")
          : t("squash.descriptionNamed").replace("{parent}", () => parentSubject).replace("{subject}", () => subject ?? "")}
      </Dialog.Description>
    </Dialog.Header>
    <label class="flex flex-col gap-1.5 text-sm">
      <span class="text-muted-foreground">
        {t("squash.messageHelp").replace("{parent}", () => parentSubject ?? t("squash.parent"))}
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
        {t("action.cancel")}
      </Button>
      <Button
        variant="destructive"
        disabled={disabled || busy}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? t("action.working") : t("squash.confirm")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
