<script lang="ts">
  /**
   * A two-step confirm for a destructive action.
   *
   * Arming is explicit and the second step names what it will do, because the
   * operations behind this component lose working-tree content. It is deliberately a
   * two-step button rather than a modal dialog: a dialog is one more generated
   * primitive this package would have to carry, and nothing here needs focus
   * trapping to be safe — the armed state is visible, cancellable, and resets when
   * the action runs.
   */
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  interface Props {
    label: string;
    confirmLabel: string;
    description?: string;
    disabled?: boolean;
    busy?: boolean;
    tone?: "default" | "danger";
    onConfirm: () => void;
    class?: string;
    "data-testid"?: string;
  }

  let {
    label,
    confirmLabel,
    description = undefined,
    disabled = false,
    busy = false,
    tone = "danger",
    onConfirm,
    class: className = "",
    "data-testid": testId = undefined,
  }: Props = $props();
  const { t } = useGitViewI18n();

  let armed = $state(false);

  function confirm(): void {
    armed = false;
    onConfirm();
  }
</script>

{#if armed}
  <span
    class={cn("inline-flex flex-wrap items-center gap-2", className)}
    role="group"
    aria-label={confirmLabel}
  >
    {#if description !== undefined}
      <span class="text-xs text-ink-muted">{description}</span>
    {/if}
    <Button
      size="sm"
      variant={tone === "danger" ? "destructive" : "default"}
      disabled={busy || disabled}
      onclick={confirm}
      data-testid={testId === undefined ? undefined : `${testId}-confirm`}
    >
      {busy ? t("action.working") : confirmLabel}
    </Button>
    <Button size="sm" variant="ghost" onclick={() => (armed = false)}>
      {t("action.cancel")}
    </Button>
  </span>
{:else}
  <Button
    size="sm"
    variant="outline"
    {disabled}
    onclick={() => (armed = true)}
    class={className}
    data-testid={testId}
  >
    {label}
  </Button>
{/if}
