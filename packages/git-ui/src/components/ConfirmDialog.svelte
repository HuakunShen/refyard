<script lang="ts">
  /** Confirms an operation with localized defaults and caller-supplied impact text. */
  import { m } from "../i18n.js";
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";

  interface Props {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel?: string;
    disabled?: boolean;
    busy?: boolean;
    destructive?: boolean;
    onConfirm: () => void;
    "data-testid"?: string;
  }

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    cancelLabel = undefined,
    disabled = false,
    busy = false,
    destructive = true,
    onConfirm,
    "data-testid": testId = undefined,
  }: Props = $props();

  function confirm(): void {
    open = false;
    onConfirm();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid={testId}>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>
        {cancelLabel ?? m.common_cancel()}
      </Button>
      <Button
        variant={destructive ? "destructive" : "default"}
        disabled={disabled || busy}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? m.working() : confirmLabel}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
