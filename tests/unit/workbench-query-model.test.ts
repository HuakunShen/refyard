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
  laneColorFor,
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
    expect(
      diffRequestForSelection(status("ordinary", "M"), null, "unstaged"),
    ).toEqual({
      kind: "unstaged",
      pathId: "path_1",
    });
    expect(
      diffRequestForSelection(status("ordinary", "M"), null, "staged"),
    ).toEqual({
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
    const page = (
      truncated: boolean,
      tipsMoved: boolean,
      shallow: boolean,
    ): HistoryPage => ({
      snapshotId: "snap_test",
      repositoryId: "repo_test",
      readAt: "2026-09-17T00:00:00Z",
      objectFormat: "sha1",
      topology: "continuous",
      commits: [],
      nextCursor: null,
      detail: null,
      truncated,
      tipsMoved,
      shallow,
    });
    const pages = [page(false, true, false), page(true, false, true)];
    expect(historyNoticesFor(pages)).toEqual({
      truncated: true,
      tipsMoved: true,
      shallow: true,
    });
  });
});

describe("laneColorFor", () => {
  it("paints the checked-out branch the current-branch colour", () => {
    expect(laneColorFor("v2", ["refs/heads/v2"])).toBe("lane-current");
    // ...and so does its remote twin trailing behind: that segment is still the
    // user's line, not another branch's history.
    expect(laneColorFor("v2", ["refs/remotes/origin/v2"])).toBe("lane-current");
    // A different branch's remote tip is a different line.
    expect(laneColorFor("v2", ["refs/remotes/origin/next"])).not.toBe(
      "lane-current",
    );
  });

  it("derives one stable colour from a branch name", () => {
    // The hue follows the branch, not the lane slot: the same branch keeps its
    // colour across pages, and two calls agree.
    expect(laneColorFor(null, ["refs/heads/main"])).toBe(
      laneColorFor(null, ["refs/heads/main"]),
    );
    expect(laneColorFor(null, ["refs/remotes/origin/next"])).toBeDefined();
  });

  it("lets tags colour nothing", () => {
    // A tag landing on a trunk commit must not recolor the trunk below it.
    expect(laneColorFor(null, ["refs/tags/v1.0.0"])).toBeUndefined();
    expect(laneColorFor(null, [])).toBeUndefined();
  });

  it("keeps the checked-out branch's remote twin on the current colour", () => {
    // Prevents: the trunk flipping to a hash hue at origin/<branch> where origin
    // trails local — that segment is still the user's line.
    expect(laneColorFor("main", ["refs/remotes/origin/main"])).toBe(
      "lane-current",
    );
    expect(laneColorFor("main", ["refs/remotes/upstream/main"])).toBe(
      "lane-current",
    );
    // Another branch's remote tip is a different line's history and hashes its name.
    expect(laneColorFor("main", ["refs/remotes/origin/rc5"])).not.toBe(
      "lane-current",
    );
  });

  it("never colours by origin/HEAD, which is a pointer and not a branch", () => {
    expect(laneColorFor(null, ["refs/remotes/origin/HEAD"])).toBeUndefined();
    // ...even when it sits next to real refs: it must not win the hash pick.
    expect(
      laneColorFor(null, ["refs/remotes/origin/HEAD", "refs/tags/v1"]),
    ).toBeUndefined();
  });
});
