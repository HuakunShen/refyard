/** Workbench selection transitions independent of queries and rendering. */
import { describe, expect, it } from "vitest";
import type { StatusEntry } from "@refyard/git-contract";
import {
  clearInspectableSelection,
  clearRepositoryIfSelected,
  createWorkbenchSelectionState,
  reconcileRepositorySelection,
  selectCommit,
  selectDiffPath,
  selectRepository,
  selectStatusPath,
  selectWorktree,
} from "../../apps/web/src/lib/workbench/selection.js";

function statusEntry(pathId = "path_1"): StatusEntry {
  return {
    pathId,
    displayPath: "src/file.ts",
    pathEncoding: "utf8",
    kind: "ordinary",
    indexStatus: ".",
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

describe("workbench selection", () => {
  it("selecting a repository clears commit and status-path state", () => {
    const state = createWorkbenchSelectionState();
    state.commitOid = "a".repeat(40);
    state.statusPath = statusEntry();
    state.diffPathId = "path_2";

    selectRepository(state, "repo_2");

    expect(state.repositoryId).toBe("repo_2");
    expect(state.worktreeId).toBeNull();
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();
    expect(state.statusSide).toBeNull();
    expect(state.diffPathId).toBeNull();
  });

  it("commit and status selections are mutually exclusive and clear diff-file selection", () => {
    const state = createWorkbenchSelectionState();
    state.diffPathId = "path_old";
    selectCommit(state, "b".repeat(40));
    expect(state.commitOid).toBe("b".repeat(40));
    expect(state.statusPath).toBeNull();
    expect(state.diffPathId).toBeNull();

    state.diffPathId = "path_old_2";
    const entry = statusEntry("path_new");
    selectStatusPath(state, entry);
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBe(entry);
    expect(state.statusSide).toBe("unstaged");
    expect(state.diffPathId).toBeNull();
  });

  it("selecting a worktree clears every inspectable selection", () => {
    const state = createWorkbenchSelectionState();
    state.repositoryId = "repo_1";
    state.commitOid = "c".repeat(40);
    state.statusPath = statusEntry();
    state.statusSide = "staged";
    state.diffPathId = "path_old";

    selectWorktree(state, "wt_linked");

    expect(state.worktreeId).toBe("wt_linked");
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();
    expect(state.statusSide).toBeNull();
    expect(state.diffPathId).toBeNull();
  });

  it("keeps staged and unstaged sides distinct for an MM path", () => {
    const state = createWorkbenchSelectionState();
    const entry = statusEntry("path_mm");
    entry.indexStatus = "M";
    entry.worktreeStatus = "M";

    selectStatusPath(state, entry, "unstaged");
    expect(state.statusSide).toBe("unstaged");

    selectStatusPath(state, entry, "staged");
    expect(state.statusSide).toBe("staged");
  });

  it("normalizes an unavailable requested side to the side that has changes", () => {
    const state = createWorkbenchSelectionState();
    const unstagedOnly = statusEntry("path_unstaged");
    selectStatusPath(state, unstagedOnly, "staged");
    expect(state.statusSide).toBe("unstaged");

    const stagedOnly = statusEntry("path_staged");
    stagedOnly.indexStatus = "M";
    stagedOnly.worktreeStatus = ".";
    selectStatusPath(state, stagedOnly, "unstaged");
    expect(state.statusSide).toBe("staged");
  });

  it("always treats an untracked path as an unstaged selection", () => {
    const state = createWorkbenchSelectionState();
    const entry = statusEntry("path_untracked");
    entry.kind = "untracked";
    selectStatusPath(state, entry, "staged");
    expect(state.statusSide).toBe("unstaged");
  });

  it("selecting a diff file changes only the second-step diff selection", () => {
    const state = createWorkbenchSelectionState();
    state.repositoryId = "repo_1";
    state.commitOid = "c".repeat(40);

    selectDiffPath(state, "path_3");

    expect(state.repositoryId).toBe("repo_1");
    expect(state.commitOid).toBe("c".repeat(40));
    expect(state.diffPathId).toBe("path_3");
  });

  it("disconnect clears inspectable commit/path state without changing repository", () => {
    const state = createWorkbenchSelectionState();
    state.repositoryId = "repo_1";
    state.commitOid = "d".repeat(40);
    state.statusPath = statusEntry();
    state.diffPathId = "path_4";

    clearInspectableSelection(state);

    expect(state.repositoryId).toBe("repo_1");
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();
    expect(state.diffPathId).toBeNull();
  });

  it("reconciles to the first visible repository only when the current one vanished", () => {
    const state = createWorkbenchSelectionState();
    state.repositoryId = "repo_2";
    state.commitOid = "e".repeat(40);
    state.statusPath = statusEntry();

    expect(reconcileRepositorySelection(state, ["repo_1", "repo_2"])).toBe(
      false,
    );
    expect(state.repositoryId).toBe("repo_2");

    expect(reconcileRepositorySelection(state, ["repo_1", "repo_3"])).toBe(
      true,
    );
    expect(state.repositoryId).toBe("repo_1");
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();

    expect(reconcileRepositorySelection(state, [])).toBe(false);
    expect(state.repositoryId).toBe("repo_1");
  });

  it("revocation clears the repository only when the revoked id is selected", () => {
    const state = createWorkbenchSelectionState();
    state.repositoryId = "repo_1";
    state.commitOid = "f".repeat(40);
    state.statusPath = statusEntry();

    expect(clearRepositoryIfSelected(state, "repo_other")).toBe(false);
    expect(state.repositoryId).toBe("repo_1");

    expect(clearRepositoryIfSelected(state, "repo_1")).toBe(true);
    expect(state.repositoryId).toBeNull();
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();
  });
});
