import { describe, expect, it } from "vitest";
import type { PatchHunk, PatchLine } from "@refyard/git-contract";
import { buildSplitPatch } from "@refyard/git-ui/lib/split-patch";

function line(
  kind: PatchLine["kind"],
  text: string,
  noNewline = false,
): PatchLine {
  return { kind, text, noNewline };
}

function hunk(lines: readonly PatchLine[]): PatchHunk {
  return {
    header: "@@ -10,3 +10,4 @@",
    oldStart: 10,
    oldLines: 3,
    newStart: 10,
    newLines: 4,
    lines: [...lines],
  };
}

describe("buildSplitPatch", () => {
  it("keeps context on both sides and aligns a replacement block", () => {
    const result = buildSplitPatch([
      hunk([
        line("context", "same"),
        line("remove", "before"),
        line("remove", "old"),
        line("add", "new"),
        line("context", "after"),
      ]),
    ])[0];
    if (result === undefined) {
      throw new Error("expected one split hunk");
    }

    expect(result.rows).toEqual([
      {
        old: {
          kind: "context",
          text: "same",
          noNewline: false,
          lineNumber: 10,
        },
        new: {
          kind: "context",
          text: "same",
          noNewline: false,
          lineNumber: 10,
        },
      },
      {
        old: {
          kind: "remove",
          text: "before",
          noNewline: false,
          lineNumber: 11,
        },
        new: { kind: "add", text: "new", noNewline: false, lineNumber: 11 },
      },
      {
        old: { kind: "remove", text: "old", noNewline: false, lineNumber: 12 },
        new: { kind: "empty", text: "", noNewline: false, lineNumber: null },
      },
      {
        old: {
          kind: "context",
          text: "after",
          noNewline: false,
          lineNumber: 13,
        },
        new: {
          kind: "context",
          text: "after",
          noNewline: false,
          lineNumber: 12,
        },
      },
    ]);
  });

  it("pairs additions and removals independently for unbalanced blocks", () => {
    const result = buildSplitPatch([
      {
        ...hunk([
          line("add", "one"),
          line("add", "two", true),
          line("add", "three"),
        ]),
        oldStart: 1,
        newStart: 4,
      },
    ])[0];
    if (result === undefined) {
      throw new Error("expected one split hunk");
    }

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.old.kind).toBe("empty");
    expect(result.rows[0]?.new.lineNumber).toBe(4);
    expect(result.rows[1]?.new.noNewline).toBe(true);
    expect(result.rows[2]?.old.kind).toBe("empty");
    expect(result.rows[2]?.new.text).toBe("three");
  });
});
