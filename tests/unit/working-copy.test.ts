/** Working-copy grouping tests protect the meaning of Git's two status columns. */
import { describe, expect, it } from "vitest";
import type { StatusEntry } from "@refyard/git-contract";
import {
  canDiscard,
  canStage,
  canUnstage,
  groupWorkingCopyEntries,
  isUnmerged,
} from "@refyard/git-ui/lib/working-copy";

function entry(
  pathId: string,
  indexStatus: string,
  worktreeStatus: string,
  kind: StatusEntry["kind"] = "ordinary",
  overrides: Partial<StatusEntry> = {},
): StatusEntry {
  return {
    pathId,
    displayPath: `src/${pathId}.ts`,
    pathEncoding: "utf8",
    kind,
    indexStatus,
    worktreeStatus,
    originalPathId: null,
    originalDisplayPath: null,
    headOid: null,
    indexOid: null,
    modes: null,
    submodule: null,
    stages: null,
    ...overrides,
  };
}

describe("working-copy grouping", () => {
  it("keeps mixed staged and unstaged paths in their correct groups", () => {
    const mixed = entry("mixed", "M", "M");
    const stagedOnly = entry("staged", "M", ".");
    const unstagedOnly = entry("unstaged", ".", "M");
    const untracked = entry("new", ".", "?", "untracked");
    const ignored = entry("ignored", ".", "!", "ignored");

    const groups = groupWorkingCopyEntries([
      mixed,
      stagedOnly,
      unstagedOnly,
      untracked,
      ignored,
    ]);

    expect(groups.unstaged.map((item) => item.pathId)).toEqual([
      "mixed",
      "unstaged",
      "new",
    ]);
    expect(groups.staged.map((item) => item.pathId)).toEqual([
      "mixed",
      "staged",
    ]);
    expect(groups.unstaged).not.toContain(ignored);
    expect(groups.staged).not.toContain(untracked);
  });

  it("keeps conflicts visible and exposes safe action boundaries", () => {
    const conflict = entry("conflict", "U", "U", "unmerged", {
      stages: [
        { stage: 1, mode: "100644", oid: "a".repeat(40) },
        { stage: 2, mode: "100644", oid: "b".repeat(40) },
      ],
    });
    const unrepresentable = entry("bytes", ".", "M", "ordinary", {
      pathEncoding: "unrepresentable",
    });

    const groups = groupWorkingCopyEntries([conflict, unrepresentable]);
    expect(groups.unstaged.map((item) => item.pathId)).toEqual([
      "conflict",
      "bytes",
    ]);
    expect(groups.staged.map((item) => item.pathId)).toEqual(["conflict"]);
    expect(isUnmerged(conflict)).toBe(true);
    expect(canStage(conflict)).toBe(true);
    expect(canUnstage(conflict)).toBe(true);
    expect(canDiscard(conflict)).toBe(true);
    expect(canStage(unrepresentable)).toBe(false);
    expect(canDiscard(unrepresentable)).toBe(false);
  });
});
