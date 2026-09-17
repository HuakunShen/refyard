<script lang="ts">
  /** GitKraken-style side-by-side rendering for already parsed patch hunks. */
  import type { PatchHunk } from "@refyard/git-contract";
  import {
    buildSplitPatch,
    type SplitPatchCell,
    type SplitPatchCellKind,
    type SplitPatchHunk,
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

  function gridTemplate(hunk: SplitPatchHunk): string {
    const longestLine = hunk.rows.reduce(
      (longest, row) =>
        Math.max(longest, row.old.text.length, row.new.text.length),
      0,
    );
    // Both sides share one width so aligned rows never paint into the next
    // column. Very long lines make the outer container scroll horizontally.
    const sideWidth = Math.max(36, longestLine + 4);
    return `3rem minmax(${sideWidth}ch, 1fr) 3rem minmax(${sideWidth}ch, 1fr)`;
  }
</script>

<div
  class={cn("flex min-w-0 flex-col gap-2", className)}
  data-testid="split-patch"
>
  {#if splitHunks.length === 0}
    <p class="px-3 py-2 text-xs text-ink-muted">No line changes.</p>
  {:else}
    {#each splitHunks as hunk, hunkIndex}
      {@const columns = gridTemplate(hunk)}
      <section
        class="min-w-0 overflow-hidden rounded-lg border border-border/60 bg-card/90"
        data-testid={`split-patch-hunk-${hunkIndex}`}
      >
        <h3
          class="border-b border-border/40 bg-muted/60 px-3 py-1 font-mono text-[11px] text-muted-foreground"
        >
          {hunk.header}
        </h3>

        <div class="overflow-x-auto custom-scrollbar">
          <div
            class="min-w-[52rem] font-mono text-xs"
            role="table"
            aria-label={`Side-by-side diff ${hunk.header}`}
          >
            <div
              class="grid border-b border-border/30 bg-muted/25 text-[10px] font-semibold tracking-wider text-ink-faint uppercase"
              style={`grid-template-columns: ${columns}`}
              role="row"
            >
              <span class="px-2 py-1 text-right" role="columnheader">Old</span>
              <span class="px-2 py-1" role="columnheader">Before</span>
              <span class="px-2 py-1 text-right" role="columnheader">New</span>
              <span class="px-2 py-1" role="columnheader">After</span>
            </div>

            {#each hunk.rows as row, rowIndex}
              <div
                class="grid border-b border-border/20 last:border-b-0"
                style={`grid-template-columns: ${columns}`}
                role="row"
                data-testid={`split-patch-row-${hunkIndex}-${rowIndex}`}
              >
                <span
                  class={cn(
                    "select-none px-2 py-0.5 text-right text-[10px] leading-relaxed",
                    lineNumberClass(row.old.kind),
                  )}
                  role="cell"
                  aria-label={row.old.lineNumber === null
                    ? "No old line"
                    : `Old line ${row.old.lineNumber}`}
                >
                  {row.old.lineNumber ?? ""}
                </span>
                <span
                  class={cn(
                    "min-w-0 px-2 py-0.5 leading-relaxed whitespace-pre",
                    cellClass(row.old),
                  )}
                  role="cell"
                  data-kind={row.old.kind}
                >
                  {#if row.old.kind !== "empty"}
                    <span class="mr-1 select-none opacity-60"
                      >{marker(row.old.kind)}</span
                    >{row.old.text}{#if row.old.noNewline}<span
                        class="ml-2 text-[10px] italic text-ink-faint"
                        >⏎ no newline</span
                      >{/if}
                  {/if}
                </span>
                <span
                  class={cn(
                    "select-none px-2 py-0.5 text-right text-[10px] leading-relaxed",
                    lineNumberClass(row.new.kind),
                  )}
                  role="cell"
                  aria-label={row.new.lineNumber === null
                    ? "No new line"
                    : `New line ${row.new.lineNumber}`}
                >
                  {row.new.lineNumber ?? ""}
                </span>
                <span
                  class={cn(
                    "min-w-0 px-2 py-0.5 leading-relaxed whitespace-pre",
                    cellClass(row.new),
                  )}
                  role="cell"
                  data-kind={row.new.kind}
                >
                  {#if row.new.kind !== "empty"}
                    <span class="mr-1 select-none opacity-60"
                      >{marker(row.new.kind)}</span
                    >{row.new.text}{#if row.new.noNewline}<span
                        class="ml-2 text-[10px] italic text-ink-faint"
                        >⏎ no newline</span
                      >{/if}
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        </div>
      </section>
    {/each}
  {/if}
</div>
