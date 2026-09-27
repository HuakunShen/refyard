<script lang="ts">
  /**
   * One diff: the change set, its files, and the patch for the file being read.
   *
   * The host deliberately bounds work: a diff request without a `pathId` describes the
   * change set (paths, kinds, line counts) and does **not** fetch patches for every file,
   * because a patch for every changed file in one response is unbounded on a large commit.
   * A patch is requested one path at a time. This pane is shaped around that: the file rows
   * are selectable, and the selected file's patch is rendered underneath it.
   *
   * That is why the patch can arrive in two ways, and both are handled here: an untracked
   * file's content is synthesized by the host inside the same response (there is no Git
   * object to diff against), while every other change set needs the follow-up request whose
   * result is passed in as `patch`. A pane that only understood one of them would show an
   * empty diff for the other — which reads as "nothing changed", the worst possible lie.
   */
  import type {
    DiffFile,
    DiffResponse,
    FilePatch,
  } from "@refyard/git-contract";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import FileText from "@lucide/svelte/icons/file-text";
  import { Badge } from "./ui/badge/index.js";
  import StateBanner from "./StateBanner.svelte";
  import SplitPatch from "./SplitPatch.svelte";
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";
  import type { TranslationKey } from "../lib/i18n/types.js";

  interface Props {
    /** The change set: files, counts and, when the host chose to include them, patches. */
    diff: DiffResponse | null;
    /** The follow-up response for `selectedPathId`, when one was requested. */
    patch?: DiffResponse | null;
    selectedPathId?: string | null;
    onSelectPath?: (file: DiffFile) => void;
    /** Shown when there is no change set to read. */
    placeholder?: string;
    onlySelected?: boolean;
    listingOnly?: boolean;
    class?: string;
  }

  let {
    diff,
    patch = null,
    selectedPathId = null,
    onSelectPath,
    placeholder = undefined,
    onlySelected = false,
    listingOnly = false,
    class: className = "",
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;
  const changeKindKeys: Readonly<Record<DiffFile["changeKind"], TranslationKey>> = {
    added: "diff.kind.added", modified: "diff.kind.modified", deleted: "diff.kind.deleted",
    renamed: "diff.kind.renamed", copied: "diff.kind.copied", typeChanged: "diff.kind.typeChanged",
    unmerged: "diff.kind.unmerged",
  };
  const requestKindKeys: Readonly<Record<DiffResponse["request"]["kind"], TranslationKey>> = {
    unstaged: "diff.request.unstaged", staged: "diff.request.staged", untracked: "diff.request.untracked",
    commit: "diff.request.commit", range: "diff.request.range",
  };
  function statLabel(file: DiffFile): string {
    if (file.isBinary) return t("diff.binary");
    if (file.insertions === null && file.deletions === null) return t("diff.noLineCounts");
    return `+${i18n.count(file.insertions ?? 0)} −${i18n.count(file.deletions ?? 0)}`;
  }

  let splitView = $state(true);

  const LINE_PREFIX = { context: " ", add: "+", remove: "−" } as const;
  const LINE_CLASS = {
    context: "patch-context text-ink-muted",
    add: "patch-add text-add",
    remove: "patch-remove text-remove",
  } as const;

  const PATCH_FETCHED_SEPARATELY = "no patch was requested for this path";

  /** The patch to draw for one file: its own, or the one fetched for it by path. */
  function patchFor(file: DiffFile): FilePatch {
    if (
      file.patch.kind !== "unavailable" ||
      file.patch.reason !== PATCH_FETCHED_SEPARATELY
    ) {
      return file.patch;
    }
    if (patch === null || file.pathId !== selectedPathId) {
      return file.patch;
    }
    return (
      patch.files.find((entry) => entry.pathId === selectedPathId)?.patch ??
      file.patch
    );
  }

  const awaitingPerPathPatches = $derived(
    diff !== null &&
      diff.files.length > 0 &&
      diff.files.every(
        (file) =>
          file.patch.kind === "unavailable" &&
          file.patch.reason === PATCH_FETCHED_SEPARATELY,
      ),
  );
</script>

<div
  class={cn(
    "flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto custom-scrollbar",
    className,
  )}
>
  {#if diff === null}
    <p class="p-3 text-sm text-ink-faint">{placeholder ?? t("diff.placeholder")}</p>
  {:else}
    <header
      class="sticky top-0 z-10 shrink-0 flex flex-wrap items-center gap-2 pb-2.5 pt-0.5 bg-canvas/95 backdrop-blur-sm border-b border-border/40 text-xs text-ink-muted -mx-3 px-3"
    >
      <span class="font-medium text-ink">
        {t(requestKindKeys[diff.request.kind])}
        {#if diff.request.oid !== null}<span class="font-mono ml-1"
            >{diff.request.oid.slice(0, 8)}</span
          >{/if}
        {#if diff.request.from !== null && diff.request.to !== null}
          <span class="font-mono ml-1"
            >{diff.request.from.slice(0, 8)}..{diff.request.to.slice(
              0,
              8,
            )}</span
          >
        {/if}
      </span>
      <span class="text-muted-foreground">·</span>
      <span
        >{i18n.plural(diff.stats.filesChanged, "diff.fileOne", "diff.fileOther")}</span
      >
      <span class="text-add font-mono font-medium"
        >+{i18n.count(diff.stats.insertions)}</span
      >
      <span class="text-remove font-mono font-medium"
        >−{i18n.count(diff.stats.deletions)}</span
      >
      {#if diff.stats.binaryFiles > 0}
        <span class="text-muted-foreground"
          >· {i18n.count(diff.stats.binaryFiles)} {t("diff.binary")}</span
        >
      {/if}
      {#if onlySelected}
        <span class="flex-1"></span>
        <div class="flex gap-1" aria-label={t("diff.view")}>
          <Button
            size="sm"
            variant={splitView ? "default" : "ghost"}
            aria-pressed={splitView}
            onclick={() => (splitView = true)}>{t("diff.split")}</Button
          >
          <Button
            size="sm"
            variant={!splitView ? "default" : "ghost"}
            aria-pressed={!splitView}
            onclick={() => (splitView = false)}>{t("diff.unified")}</Button
          >
        </div>
      {/if}
    </header>

    {#if awaitingPerPathPatches && !listingOnly && !onlySelected}
      <div class="shrink-0">
        <StateBanner
          state="info"
          title={t("diff.perPathTitle")}
          detail={t("diff.perPathDetail")}
        />
      </div>
    {:else if diff.truncated}
      <div class="shrink-0">
        <!--
          `truncated` means "the host applied a limitation", and one of those limitations is
          the per-path patch rule — which cuts nothing. Saying "later files are not shown" for
          a complete listing is the kind of confident wrong answer this pane exists to avoid,
          so the claim is narrowed to what the file data proves: with patches present, only a
          bound can have set the flag; without them, either could have.
        -->
        <StateBanner
          state="truncated"
          title={awaitingPerPathPatches
            ? t("diff.limitedTitle")
            : t("diff.truncatedTitle")}
          detail={awaitingPerPathPatches
            ? t("diff.limitedDetail")
            : t("diff.truncatedDetail")}
        />
      </div>
    {/if}

    {#if diff.files.length === 0}
      <p class="text-sm text-ink-muted shrink-0">
        {t("diff.empty")}
      </p>
    {:else}
      {#each onlySelected && selectedPathId !== null ? diff.files.filter((file) => file.pathId === selectedPathId) : diff.files as file (file.pathId + file.changeKind)}
        {@const selected = file.pathId === selectedPathId}
        {@const filePatch = patchFor(file)}
        <section
          class="shrink-0 overflow-hidden rounded-lg border border-border/80 bg-card/60 shadow-2xs transition-colors"
        >
          <button
            type="button"
            onclick={() => onSelectPath?.(file)}
            aria-current={selected ? "true" : undefined}
            class={cn(
              "group flex min-h-[38px] w-full items-center gap-2 px-3 py-2 text-left cursor-pointer transition-colors select-none",
              selected
                ? "bg-primary/10 hover:bg-primary/15"
                : "hover:bg-accent/40",
            )}
          >
            <span class="text-muted-foreground shrink-0 transition-transform">
              {#if !listingOnly && (selected || filePatch.kind !== "unavailable")}
                <ChevronDown class="size-3.5" />
              {:else}
                <ChevronRight class="size-3.5" />
              {/if}
            </span>
            <FileText class="size-3.5 text-muted-foreground/70 shrink-0" />
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground"
              title={file.displayPath}
            >
              {file.displayPath}
            </span>
            <Badge
              tone={file.changeKind === "deleted" ? "danger" : "muted"}
              class="text-[10px] h-4.5 px-1.5 shrink-0"
            >
              {t(changeKindKeys[file.changeKind])}
            </Badge>
            {#if file.oldDisplayPath !== null && file.oldDisplayPath !== file.displayPath}
              <span
                class="truncate font-mono text-xs text-muted-foreground shrink-0"
                title={file.oldDisplayPath}
              >
                ← {file.oldDisplayPath}
              </span>
            {/if}
            <span class="text-xs font-mono text-muted-foreground shrink-0"
              >{statLabel(file)}</span
            >
          </button>

          {#if !listingOnly && (selected || filePatch.kind !== "unavailable")}
            {#if filePatch.kind === "text"}
              {#if filePatch.synthesized}
                <p
                  class="border-t border-border/60 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
                >
                  {t("diff.synthesized")}
                </p>
              {/if}
              {#if filePatch.hunks.length === 0}
                <p
                  class="border-t border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  {t("diff.noLines")}
                </p>
              {:else if onlySelected && splitView}
                <SplitPatch hunks={filePatch.hunks} />
              {:else}
                <div
                  class="overflow-x-auto border-t border-border/60 bg-card/90 custom-scrollbar"
                >
                  {#each filePatch.hunks as hunk (hunk.header)}
                    <div class="min-w-max text-xs">
                      <p
                        class="bg-muted/60 px-3 py-1 font-mono text-[11px] text-muted-foreground select-none border-b border-border/30"
                      >
                        {hunk.header}
                      </p>
                      {#each hunk.lines as line, lineIndex (lineIndex)}
                        <p
                          class={cn(
                            "px-3 py-0.5 font-mono text-xs whitespace-pre leading-relaxed",
                            LINE_CLASS[line.kind],
                          )}
                        >
                          <span class="select-none text-muted-foreground"
                            >{LINE_PREFIX[line.kind]}</span
                          >{line.text}{#if line.noNewline}<span
                              class="text-muted-foreground italic ml-1"
                            >
                              ⏎ {t("diff.noNewline")}</span
                            >{/if}
                        </p>
                      {/each}
                    </div>
                  {/each}
                </div>
              {/if}
            {:else if filePatch.kind === "binary"}
              <p
                class="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground"
              >
                {t("diff.binaryHelp")}
              </p>
            {:else if filePatch.kind === "oversize"}
              <p
                class="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground"
              >
                {t("diff.omitted")} {filePatch.reason}
              </p>
            {:else if filePatch.kind === "unavailable"}
              <p
                class="border-t border-border/60 px-3 py-2.5 text-xs text-muted-foreground"
              >
                {selected
                  ? `${t("diff.unavailable")} ${filePatch.reason}`
                  : t("diff.selectFile")}
              </p>
            {:else}
              <p
                class="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground font-mono"
              >
                {t("diff.submodulePointer")} {filePatch.oldOid === null
                  ? t("diff.none")
                  : filePatch.oldOid.slice(0, 8)}
                → {filePatch.newOid === null
                  ? t("diff.none")
                  : filePatch.newOid.slice(0, 8)}
              </p>
            {/if}
          {/if}
        </section>
      {/each}
    {/if}
  {/if}
</div>
