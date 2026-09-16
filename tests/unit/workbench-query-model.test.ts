/** Pure models that sit between TanStack query data and the workbench UI. */
import { describe, expect, it } from "vitest";
import type {
  HistoryPage,
  RepositorySummary,
  StatusEntry,
} from "@refyard/git-contract";
import {
  diffRequestForSelection,
  historyNoticesFor,
  workspaceRootsFor,
} from "../../apps/web/src/lib/workbench/query-model.js";

function repository(
  repositoryId: string,
  allowedRootId: string,
  displayPath: string,
): RepositorySummary {
  return {
    repositoryId,
    allowedRootId,
    displayName: repositoryId,
    displayPath,
    objectFormat: "sha1",
    worktreeIds: [`wt_${repositoryId}`],
    primaryWorktreeId: `wt_${repositoryId}`,
    head: { kind: "unborn", branchName: "main", oid: null, detached: false },
    operationInProgress: null,
    lastFetchedAt: null,
  };
}

function status(kind: StatusEntry["kind"], indexStatus = "."): StatusEntry {
  return {
    pathId: "path_1",
    displayPath: "src/file.ts",
    pathEncoding: "utf8",
    kind,
    indexStatus,
    worktreeStatus: "M",
    originalPathId: null,
    originalDisplayPath: null,
    headOid: null,
    indexOid: null,
    modes: null,
    submodule: null,
    stages: null,
  };
}

describe("workbench query model", () => {
  it("keeps first root order while duplicate ids take the last repository path", () => {
    expect(
      workspaceRootsFor([
        repository("repo_1", "root_a", "/code/a"),
        repository("repo_2", "root_a", "/code/a/sub"),
        repository("repo_3", "root_b", "/code/b"),
      ]),
    ).toEqual([
      { allowedRootId: "root_a", displayPath: "/code/a/sub" },
      { allowedRootId: "root_b", displayPath: "/code/b" },
    ]);
  });

  it("turns a selected status path into the same bounded diff intent as the page", () => {
    expect(diffRequestForSelection(status("untracked"), null)).toEqual({
      kind: "untracked",
      pathId: "path_1",
    });
    expect(diffRequestForSelection(status("ordinary", "."), null)).toEqual({
      kind: "unstaged",
      pathId: "path_1",
    });
    expect(diffRequestForSelection(status("ordinary", "M"), null)).toEqual({
      kind: "staged",
      pathId: "path_1",
    });
    expect(diffRequestForSelection(status("ignored"), "a".repeat(40))).toEqual({
      kind: "commit",
      oid: "a".repeat(40),
    });
    expect(diffRequestForSelection(null, "b".repeat(40))).toEqual({
      kind: "commit",
      oid: "b".repeat(40),
    });
    expect(diffRequestForSelection(null, null)).toBeNull();
  });

  it("combines incomplete-history notices across every loaded page", () => {
    const pages = [
      { truncated: false, tipsMoved: true, shallow: false },
      { truncated: true, tipsMoved: false, shallow: true },
    ] as HistoryPage[];
    expect(historyNoticesFor(pages)).toEqual({
      truncated: true,
      tipsMoved: true,
      shallow: true,
    });
  });
});
