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
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
  const { t } = useGitViewI18n();

  let mode = $state<"soft" | "mixed">("mixed");

  const MODES: readonly {
    readonly id: "soft" | "mixed";
    readonly label: string;
    readonly note: string;
  }[] = [
    {
      id: "mixed",
      label: t("reset.mixedLabel"),
      note: t("reset.mixedNote"),
    },
    {
      id: "soft",
      label: t("reset.softLabel"),
      note: t("reset.softNote"),
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
          ? t("reset.titleHere")
          : branchName === null
            ? t("reset.titleSubject").replace("{subject}", () => subject)
            : t("reset.titleNamed").replace("{branch}", () => branchName).replace("{subject}", () => subject)}
      </Dialog.Title>
      <Dialog.Description>
        {t("reset.description")}
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
        {t("action.cancel")}
      </Button>
      <Button
        variant="destructive"
        disabled={disabled || busy}
        onclick={confirm}
        data-testid={testId === undefined ? undefined : `${testId}-confirm`}
      >
        {busy ? t("action.working") : t("reset.confirm")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
