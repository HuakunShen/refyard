<script lang="ts">
  /**
   * The commit surface: message, commit, amend.
   *
   * The panel performs no requests. It is handed the staged change count (what the
   * host reported, not what the UI believes), and it refuses to offer a commit when
   * that count is zero: Git would refuse it too, and a button that produces a
   * refusal is worse than no button. Amend is a two-step confirm because it rewrites
   * the tip, and its "keep the existing message" form is a separate explicit choice
   * rather than an empty textarea that means something different here than it does
   * for a normal commit.
   */
  import GitCommit from "@lucide/svelte/icons/git-commit";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  interface Props {
    stagedCount: number;
    disabled?: boolean;
    busy?: boolean;
    /** True when the branch has at least one commit (amend needs a tip to rewrite). */
    canAmend?: boolean;
    message?: string | null;
    /** The draft is bindable so each worktree can retain its own composer text. */
    draft?: string;
    /** Optional controlled-input bridge for hosts that key drafts by worktree. */
    onDraftChange?: (draft: string) => void;
    onCommit: (message: string) => void;
    onAmend: (message: string | null) => void;
    class?: string;
  }

  let {
    stagedCount,
    disabled = false,
    busy = false,
    canAmend = true,
    message = null,
    draft = $bindable(""),
    onDraftChange = undefined,
    onCommit,
    onAmend,
    class: className = "",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;

  const trimmed = $derived(draft.trim());
  const commitReady = $derived(
    !disabled && !busy && trimmed.length > 0 && stagedCount > 0,
  );

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      if (commitReady) {
        event.preventDefault();
        onCommit(draft);
      }
    }
  }

  function handleInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    draft = target.value;
    onDraftChange?.(draft);
  }
</script>

<div class={cn("flex flex-col gap-2.5", className)} data-testid="commit-panel">
  <div class="flex items-center justify-between">
    <label
      class="flex items-center gap-1.5 text-xs font-medium text-ink-muted"
      for="commit-message"
    >
      <span>{t("commit.composer.message")}</span>
      <kbd
        class="rounded border border-border/60 bg-muted/40 px-1 py-0.5 text-[10px] font-sans text-ink-faint"
        >⌘↵</kbd
      >
    </label>
    <span class="text-[11px] font-mono text-ink-faint">
      {i18n.plural(stagedCount, "commit.composer.stagedOne", "commit.composer.stagedOther")}
    </span>
  </div>

  <textarea
    id="commit-message"
    data-testid="commit-message"
    class="min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-xs shadow-2xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 transition-all placeholder:text-ink-faint"
    placeholder={t("commit.composer.placeholder")}
    value={draft}
    oninput={handleInput}
    onkeydown={handleKeydown}
    disabled={disabled || busy}></textarea>

  <div class="flex flex-wrap items-center gap-1.5">
    <Button
      size="sm"
      class="h-7 text-xs px-3 gap-1.5 shadow-xs"
      disabled={!commitReady}
      onclick={() => onCommit(draft)}
      data-testid="commit-button"
    >
      <GitCommit class="size-3.5" />
      {t("commit.composer.commit")}
    </Button>

    <ConfirmAction
      label={t("commit.composer.amend")}
      confirmLabel={t("commit.composer.amendConfirm")}
      description={t("commit.composer.amendDescription")}
      disabled={disabled || busy || !canAmend || trimmed.length === 0}
      {busy}
      onConfirm={() => onAmend(draft)}
      data-testid="amend-button"
    />

    <ConfirmAction
      label={t("commit.composer.amendKeep")}
      confirmLabel={t("commit.composer.amendKeepConfirm")}
      disabled={disabled || busy || !canAmend}
      {busy}
      onConfirm={() => onAmend(null)}
      data-testid="amend-keep-button"
    />
  </div>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="commit-message-result">
      {message}
    </p>
  {/if}
</div>
