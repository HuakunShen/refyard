/** Pure projection of parsed patch hunks into aligned side-by-side rows. */
import type { PatchHunk, PatchLine } from "@refyard/git-contract";

export type SplitPatchCellKind = PatchLine["kind"] | "empty";

export interface SplitPatchCell {
  readonly kind: SplitPatchCellKind;
  readonly text: string;
  readonly noNewline: boolean;
  readonly lineNumber: number | null;
}

export interface SplitPatchRow {
  readonly old: SplitPatchCell;
  readonly new: SplitPatchCell;
}

export interface SplitPatchHunk {
  readonly header: string;
  readonly rows: readonly SplitPatchRow[];
}

const EMPTY_CELL: SplitPatchCell = {
  kind: "empty",
  text: "",
  noNewline: false,
  lineNumber: null,
};

function cell(line: PatchLine, lineNumber: number): SplitPatchCell {
  return {
    kind: line.kind,
    text: line.text,
    noNewline: line.noNewline,
    lineNumber,
  };
}

/**
 * Align a parsed hunk without trying to parse patch grammar in the component.
 * Context lines occupy both columns. A contiguous remove/add block is paired
 * by position, leaving an explicit empty cell when one side has more lines.
 */
export function buildSplitPatch(
  hunks: readonly PatchHunk[],
): readonly SplitPatchHunk[] {
  return hunks.map((hunk) => {
    const rows: SplitPatchRow[] = [];
    let oldLineNumber = hunk.oldStart;
    let newLineNumber = hunk.newStart;
    let index = 0;

    while (index < hunk.lines.length) {
      const current = hunk.lines[index];
      if (current === undefined) {
        break;
      }

      if (current.kind === "context") {
        rows.push({
          old: cell(current, oldLineNumber),
          new: cell(current, newLineNumber),
        });
        oldLineNumber += 1;
        newLineNumber += 1;
        index += 1;
        continue;
      }

      const removed: Array<{
        readonly line: PatchLine;
        readonly number: number;
      }> = [];
      const added: Array<{
        readonly line: PatchLine;
        readonly number: number;
      }> = [];
      while (index < hunk.lines.length) {
        const line = hunk.lines[index];
        if (line === undefined || line.kind === "context") {
          break;
        }
        if (line.kind === "remove") {
          removed.push({ line, number: oldLineNumber });
          oldLineNumber += 1;
        } else {
          added.push({ line, number: newLineNumber });
          newLineNumber += 1;
        }
        index += 1;
      }

      const rowCount = Math.max(removed.length, added.length);
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const old = removed[rowIndex];
        const next = added[rowIndex];
        rows.push({
          old: old === undefined ? EMPTY_CELL : cell(old.line, old.number),
          new: next === undefined ? EMPTY_CELL : cell(next.line, next.number),
        });
      }
    }

    return { header: hunk.header, rows };
  });
}
