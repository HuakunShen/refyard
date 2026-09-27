<script lang="ts">
  /** Explicit cursor continuation with keyboard, busy and retry semantics. */
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  let {
    nextCursor,
    truncated,
    loading = false,
    error = null,
    onContinue,
  }: {
    nextCursor: string | null;
    truncated: boolean;
    loading?: boolean;
    error?: string | null;
    onContinue: () => void | Promise<void>;
  } = $props();

  const { t } = useGitViewI18n();
</script>

<div class="flex flex-col gap-2 py-3" aria-live="polite">
  {#if truncated && nextCursor === null}
    <p class="text-sm text-destructive" role="status">{t("xross.page.truncatedNoCursor")}</p>
  {:else if truncated || nextCursor !== null}
    <p class="text-sm text-muted-foreground">{t("xross.page.partial")}</p>
  {/if}
  {#if error !== null}
    <p class="text-sm text-destructive" role="alert">{t("xross.page.error")} {error}</p>
  {/if}
  {#if nextCursor !== null}
    <button
      type="button"
      class="rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
      disabled={loading}
      aria-busy={loading}
      onclick={() => void onContinue()}
    >{loading ? t("xross.page.loading") : t("xross.page.more")}</button>
  {/if}
</div>
