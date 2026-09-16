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
    expect(state.commitOid).toBeNull();
    expect(state.statusPath).toBeNull();
    // Repository switching historically did not touch this second-step diff selection.
    expect(state.diffPathId).toBe("path_2");
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
    expect(state.diffPathId).toBeNull();
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
    // Preserve the current page behavior: this id is inert without a diff request.
    expect(state.diffPathId).toBe("path_4");
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
