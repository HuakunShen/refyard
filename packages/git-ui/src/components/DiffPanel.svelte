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
  import Badge from "../ui/Badge.svelte";
  import StateBanner from "./StateBanner.svelte";
  import { changeKindLabel, diffStatLabel } from "../lib/format.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    /** The change set: files, counts and, when the host chose to include them, patches. */
    diff: DiffResponse | null;
    /** The follow-up response for `selectedPathId`, when one was requested. */
    patch?: DiffResponse | null;
    selectedPathId?: string | null;
    onSelectPath?: (file: DiffFile) => void;
    /** Shown when there is no change set to read. */
    placeholder?: string;
    class?: string;
  }

  let {
    diff,
    patch = null,
    selectedPathId = null,
    onSelectPath,
    placeholder = "Select a path or a commit to read its diff.",
    class: className = "",
  }: Props = $props();

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

<div class={cn("flex h-full min-h-0 flex-col gap-3 overflow-auto", className)}>
  {#if diff === null}
    <p class="p-3 text-sm text-ink-faint">{placeholder}</p>
  {:else}
    <header class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span class="font-medium text-ink">
        {diff.request.kind}
        {#if diff.request.oid !== null}<span class="font-mono"
            >{diff.request.oid.slice(0, 8)}</span
          >{/if}
        {#if diff.request.from !== null && diff.request.to !== null}
          <span class="font-mono"
            >{diff.request.from.slice(0, 8)}..{diff.request.to.slice(
              0,
              8,
            )}</span
          >
        {/if}
      </span>
      <span>{diff.stats.filesChanged} files</span>
      <span class="text-add">+{diff.stats.insertions}</span>
      <span class="text-remove">−{diff.stats.deletions}</span>
      {#if diff.stats.binaryFiles > 0}
        <span>{diff.stats.binaryFiles} binary</span>
      {/if}
    </header>

    {#if awaitingPerPathPatches}
      <StateBanner
        state="info"
        title="Patches are read one path at a time"
        detail="This change set is listed without patches: a patch for every file at once is unbounded work. Select a file to read its patch."
      />
    {:else if diff.truncated}
      <StateBanner
        state="truncated"
        title="This listing was truncated"
        detail="The host bounded this response, so later files in it are not shown. Narrow the request to see them."
      />
    {/if}

    {#if diff.files.length === 0}
      <p class="text-sm text-ink-muted">No changed files for this request.</p>
    {:else}
      {#each diff.files as file (file.pathId + file.changeKind)}
        {@const selected = file.pathId === selectedPathId}
        {@const filePatch = patchFor(file)}
        <section
          class="overflow-hidden rounded-md border border-border bg-panel"
        >
          <button
            type="button"
            onclick={() => onSelectPath?.(file)}
            aria-current={selected ? "true" : undefined}
            class={cn(
              "flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left",
              selected ? "bg-accent/10" : "hover:bg-panel-muted",
            )}
          >
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs text-ink"
              title={file.displayPath}
            >
              {file.displayPath}
            </span>
            <Badge tone="muted">{changeKindLabel(file.changeKind)}</Badge>
            {#if file.oldDisplayPath !== null && file.oldDisplayPath !== file.displayPath}
              <span
                class="truncate font-mono text-xs text-ink-faint"
                title={file.oldDisplayPath}
              >
                ← {file.oldDisplayPath}
              </span>
            {/if}
            <span class="text-xs text-ink-muted">{diffStatLabel(file)}</span>
          </button>

          {#if selected || filePatch.kind !== "unavailable"}
            {#if filePatch.kind === "text"}
              {#if filePatch.synthesized}
                <p
                  class="border-t border-border px-2 py-1 text-xs text-ink-faint"
                >
                  Untracked file: this content was read from the working tree,
                  not produced by Git.
                </p>
              {/if}
              {#if filePatch.hunks.length === 0}
                <p
                  class="border-t border-border px-2 py-2 text-xs text-ink-muted"
                >
                  No line changes — the file's mode or type changed.
                </p>
              {:else}
                <div class="overflow-x-auto border-t border-border">
                  {#each filePatch.hunks as hunk (hunk.header)}
                    <div class="min-w-max">
                      <p
                        class="bg-panel-muted px-2 py-0.5 font-mono text-xs text-ink-faint"
                      >
                        {hunk.header}
                      </p>
                      {#each hunk.lines as line, lineIndex (lineIndex)}
                        <p
                          class={cn(
                            "px-2 font-mono text-xs whitespace-pre",
                            LINE_CLASS[line.kind],
                          )}
                        >
                          <span class="select-none text-ink-faint"
                            >{LINE_PREFIX[line.kind]}</span
                          >{line.text}{#if line.noNewline}<span
                              class="text-ink-faint"
                            >
                              ⏎ no newline at end of file</span
                            >{/if}
                        </p>
                      {/each}
                    </div>
                  {/each}
                </div>
              {/if}
            {:else if filePatch.kind === "binary"}
              <p
                class="border-t border-border px-2 py-3 text-sm text-ink-muted"
              >
                Binary file — Git reported no text patch for it.
              </p>
            {:else if filePatch.kind === "oversize"}
              <p
                class="border-t border-border px-2 py-3 text-sm text-ink-muted"
              >
                Patch omitted: {filePatch.reason}
              </p>
            {:else if filePatch.kind === "unavailable"}
              <p
                class="border-t border-border px-2 py-3 text-xs text-ink-faint"
              >
                {selected
                  ? `Patch unavailable: ${filePatch.reason}`
                  : "Select this file to read its patch."}
              </p>
            {:else}
              <p
                class="border-t border-border px-2 py-3 text-sm text-ink-muted"
              >
                Submodule pointer: {filePatch.oldOid === null
                  ? "(none)"
                  : filePatch.oldOid.slice(0, 8)}
                → {filePatch.newOid === null
                  ? "(none)"
                  : filePatch.newOid.slice(0, 8)}
              </p>
            {/if}
          {/if}
        </section>
      {/each}
    {/if}
  {/if}
</div>
