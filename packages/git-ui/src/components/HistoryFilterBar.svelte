<script lang="ts">
  /** Compact explicit-submit history controls, with host-observed ref and file choices. */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { Input } from "./ui/input/index.js";
  import { ChevronDown, SlidersHorizontal } from "@lucide/svelte";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";
  import type {
    HistoryFilterDraft,
    KnownHistoryPath,
  } from "../lib/history-filters.js";

  interface Props {
    draft: HistoryFilterDraft;
    appliedLabels: readonly string[];
    appliedPath?: KnownHistoryPath | null;
    error: string | null;
    onDraftChange: (draft: HistoryFilterDraft) => void;
    refs: readonly { fullName: string; displayName: string }[];
    paths: readonly KnownHistoryPath[];
    disabled?: boolean;
    onApply: () => void;
    onClear: () => void;
  }
  let {
    draft,
    appliedLabels,
    appliedPath = null,
    error,
    onDraftChange,
    refs,
    paths,
    disabled = false,
    onApply,
    onClear,
  }: Props = $props();
  const { t } = useGitViewI18n();
  let expanded = $state(false);
  function updateDraft(patch: Partial<HistoryFilterDraft>): void {
    onDraftChange({ ...draft, ...patch });
  }
  const knownPaths = $derived([
    ...new Map(
      [
        ...paths,
        ...(draft.path === null ? [] : [draft.path]),
        ...(appliedPath === null ? [] : [appliedPath]),
      ].map((path) => [path.pathId, path]),
    ).values(),
  ]);
  const selectClass =
    "h-8 w-full min-w-0 rounded-lg border border-input bg-panel px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
</script>

<form
  aria-label={t("history.search")}
  aria-describedby={error === null ? undefined : "history-filter-error"}
  data-testid="history-filters"
  class="shrink-0 flex min-w-0 flex-col gap-2"
  onsubmit={(event) => {
    event.preventDefault();
    if (!disabled) onApply();
  }}
>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
    <label for="history-message" class="sr-only">{t("history.searchMessages")}</label>
    <Input
      id="history-message"
      class="min-w-36 flex-1 basis-40 text-xs"
      placeholder={t("history.searchMessagesPlaceholder")}
      value={draft.message}
      oninput={(event) => updateDraft({ message: event.currentTarget.value })}
      {disabled}
    />
    <Button type="submit" size="sm" class="h-8 text-xs" {disabled}>{t("history.apply")}</Button
    >
    <Button
      type="button"
      size="sm"
      variant="outline"
      class="h-8 gap-1 text-xs"
      {disabled}
      aria-expanded={expanded}
      aria-controls="history-secondary-filters"
      onclick={() => (expanded = !expanded)}
    >
      <SlidersHorizontal data-icon="inline-start" />{t("history.filters")}<ChevronDown
        data-icon="inline-end"
        class={expanded ? "rotate-180" : ""}
      />
    </Button>
    <Button
      type="button"
      size="sm"
      variant="ghost"
      class="h-8 text-xs"
      {disabled}
      onclick={onClear}>{t("history.clear")}</Button
    >
  </div>
  {#if expanded}
    <fieldset
      id="history-secondary-filters"
      class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2 rounded-lg border border-border bg-muted/20 p-2.5"
      {disabled}
    >
      <legend class="sr-only">{t("history.additionalFilters")}</legend>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-author"
          >{t("history.author")}</label
        ><Input
          id="history-author"
          class="text-xs"
          placeholder={t("history.authorPlaceholder")}
          value={draft.author}
          oninput={(event) =>
            updateDraft({ author: event.currentTarget.value })}
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-ref"
          >{t("history.ref")}</label
        ><select
          id="history-ref"
          class={selectClass}
          value={draft.refFullName}
          onchange={(event) =>
            updateDraft({ refFullName: event.currentTarget.value })}
          ><option value="">{t("history.allRefs")}</option
          >{#each refs as ref (ref.fullName)}<option value={ref.fullName}
              >{ref.displayName}</option
            >{/each}</select
        >
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-sha"
          >{t("history.sha")}</label
        ><Input
          id="history-sha"
          class="font-mono text-xs"
          placeholder={t("history.shaPlaceholder")}
          value={draft.oidPrefix}
          oninput={(event) =>
            updateDraft({ oidPrefix: event.currentTarget.value })}
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-after"
          >{t("history.after")}</label
        ><Input
          id="history-after"
          type="datetime-local"
          class="text-xs"
          value={draft.committedAfter}
          oninput={(event) =>
            updateDraft({ committedAfter: event.currentTarget.value })}
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-before"
          >{t("history.before")}</label
        ><Input
          id="history-before"
          type="datetime-local"
          class="text-xs"
          value={draft.committedBefore}
          oninput={(event) =>
            updateDraft({ committedBefore: event.currentTarget.value })}
        />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <label class="text-xs text-muted-foreground" for="history-file"
          >{t("history.knownFile")}</label
        ><select
          id="history-file"
          class={selectClass}
          value={draft.path?.pathId ?? ""}
          onchange={(event) => {
            updateDraft({
              path:
                knownPaths.find(
                  (path) => path.pathId === event.currentTarget.value,
                ) ?? null,
            });
          }}
          ><option value="">{t("history.allFiles")}</option
          >{#each knownPaths as path (path.pathId)}<option value={path.pathId}
              >{path.displayPath}</option
            >{/each}</select
        >
      </div>
      <p class="col-span-full text-[11px] text-muted-foreground">
        {t("history.fileHelp")}
      </p>
    </fieldset>
  {/if}
  {#if error !== null}<p
      id="history-filter-error"
      role="alert"
      class="text-xs text-destructive"
    >
      {error}
    </p>{/if}
  {#if appliedLabels.length > 0}
    <div
      aria-label={t("history.appliedFilters")}
      class="flex min-w-0 flex-wrap gap-1"
    >
      {#each appliedLabels as label (label)}<Badge
          tone="muted"
          class="max-w-full"
          title={label}><span class="truncate">{label}</span></Badge
        >{/each}
    </div>
  {/if}
</form>
