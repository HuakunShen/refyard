<script lang="ts">
  import { m } from "../i18n.js";
  /** GitKraken-style side-by-side rendering for already parsed patch hunks. */
  import type { PatchHunk } from "@refyard/git-contract";
  import {
    buildSplitPatch,
    type SplitPatchCell,
    type SplitPatchCellKind,
  } from "../lib/split-patch.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    hunks: readonly PatchHunk[];
    class?: string;
  }

  let { hunks, class: className = "" }: Props = $props();

  const splitHunks = $derived(buildSplitPatch(hunks));

  function cellClass(cell: SplitPatchCell): string {
    switch (cell.kind) {
      case "add":
        return "bg-emerald-500/10 text-add";
      case "remove":
        return "bg-red-500/10 text-remove";
      case "context":
        return "bg-card/20 text-ink-muted";
      case "empty":
        return "bg-muted/25 text-ink-faint";
    }
  }

  function lineNumberClass(kind: SplitPatchCellKind): string {
    return kind === "empty"
      ? "bg-muted/25 text-ink-faint"
      : "bg-muted/40 text-ink-faint";
  }

  function marker(kind: SplitPatchCellKind): string {
    switch (kind) {
      case "add":
        return "+";
      case "remove":
        return "−";
      default:
        return "";
    }
  }

  function sideWidth(lines: readonly string[]): string {
    const longest = lines.reduce(
      (longest, text) => Math.max(longest, text.length),
      0,
    );
    // Each side sizes to its own longest line: a wide change on one side must not
    // widen — and force scrolling onto — the other.
    return `minmax(${Math.max(36, longest + 4)}ch, 1fr)`;
  }
</script>

<div
  class={cn("flex min-w-0 flex-col gap-2", className)}
  data-testid="split-patch"
>
  {#if splitHunks.length === 0}
    <p class="px-3 py-2 text-xs text-ink-muted">{m.split_no_changes()}</p>
  {:else}
    {#each splitHunks as hunk, hunkIndex}
      {@const oldSide = sideWidth(
        hunk.rows.map((row) => row.old.text),
      )}
      {@const newSide = sideWidth(
        hunk.rows.map((row) => row.new.text),
      )}
      <section
        class="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/90"
        data-testid={`split-patch-hunk-${hunkIndex}`}
      >
        <h3
          class="border-b border-border/40 bg-muted/60 px-3 py-1 font-mono text-[11px] text-muted-foreground"
        >
          {hunk.header}
        </h3>

        <div class="grid grid-cols-2 items-start">
        {#each [{ side: "old" as const }, { side: "new" as const }] as half, halfIndex}
          <div
            class="min-w-0 overflow-x-auto custom-scrollbar {halfIndex === 1
              ? 'border-l border-border/30'
              : ''}"
            data-testid={`split-patch-${half.side}-${hunkIndex}`}
          >
            <div
              class="font-mono text-xs"
              role="table"
              aria-label={`Side-by-side diff ${hunk.header}`}
            >
              <div
                class="grid border-b border-border/30 bg-muted/25 text-[10px] font-semibold tracking-wider text-ink-faint uppercase"
                style={`grid-template-columns: 3rem ${half.side === "old" ? oldSide : newSide}`}
                role="row"
              >
                <span class="px-2 py-1 text-right" role="columnheader">Old</span>
                <span class="px-2 py-1" role="columnheader"
                  >{half.side === "old"
                    ? m.split_before()
                    : m.split_after()}</span
                >
              </div>

              {#each hunk.rows as row, rowIndex}
                {@const cell = half.side === "old" ? row.old : row.new}
                <div
                  class="grid border-b border-border/20 last:border-b-0"
                  style={`grid-template-columns: 3rem ${half.side === "old" ? oldSide : newSide}`}
                  role="row"
                  data-testid={`split-patch-row-${hunkIndex}-${half.side}-${rowIndex}`}
                >
                  <span
                    class={cn(
                      "select-none px-2 py-0.5 text-right text-[10px] leading-relaxed",
                      lineNumberClass(cell.kind),
                    )}
                    role="cell"
                    aria-label={cell.lineNumber === null
                      ? half.side === "old"
                        ? m.split_no_old()
                        : m.split_no_new()
                      : `${half.side === "old" ? "Old" : "New"} line ${cell.lineNumber}`}
                  >
                    {cell.lineNumber ?? ""}
                  </span>
                  <span
                    class={cn(
                      "min-w-0 px-2 py-0.5 leading-relaxed whitespace-pre",
                      cellClass(cell),
                    )}
                    role="cell"
                    data-kind={cell.kind}
                  >
                    {#if cell.kind !== "empty"}
                      <span class="mr-1 select-none opacity-60"
                        >{marker(cell.kind)}</span
                      >{cell.text}{#if cell.noNewline}<span
                          class="ml-2 text-[10px] italic text-ink-faint"
                          >⏎ no newline</span
                        >{/if}
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>
