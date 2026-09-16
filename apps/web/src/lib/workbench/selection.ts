/**
 * Selection state shared by the workbench panels.
 *
 * These transitions describe which selections are mutually exclusive. They deliberately contain
 * no query/cache behavior, so every UI entry point can apply the same reset rules without knowing
 * how the selected object is loaded.
 */
import type { StatusEntry } from "@refyard/git-contract";

export interface WorkbenchSelectionState {
  repositoryId: string | null;
  commitOid: string | null;
  statusPath: StatusEntry | null;
  diffPathId: string | null;
}

export function createWorkbenchSelectionState(): WorkbenchSelectionState {
  return {
    repositoryId: null,
    commitOid: null,
    statusPath: null,
    diffPathId: null,
  };
}

export function selectRepository(
  state: WorkbenchSelectionState,
  repositoryId: string | null,
): void {
  state.repositoryId = repositoryId;
  state.commitOid = null;
  state.statusPath = null;
}

export function selectCommit(
  state: WorkbenchSelectionState,
  commitOid: string,
): void {
  state.commitOid = commitOid;
  state.statusPath = null;
  state.diffPathId = null;
}

export function selectStatusPath(
  state: WorkbenchSelectionState,
  statusPath: StatusEntry,
): void {
  state.statusPath = statusPath;
  state.commitOid = null;
  state.diffPathId = null;
}

export function selectDiffPath(
  state: WorkbenchSelectionState,
  pathId: string | null,
): void {
  state.diffPathId = pathId;
}

/** Preserve repository choice while forgetting the object/path being inspected. */
export function clearInspectableSelection(state: WorkbenchSelectionState): void {
  state.commitOid = null;
  state.statusPath = null;
}

/**
 * Keep selection on a repository that still exists; otherwise choose the first visible one.
 * An empty list leaves the current id untouched, matching the page's historical behavior while a
 * repository query is temporarily empty/pending.
 */
export function reconcileRepositorySelection(
  state: WorkbenchSelectionState,
  repositoryIds: readonly string[],
): boolean {
  if (
    repositoryIds.length === 0 ||
    (state.repositoryId !== null && repositoryIds.includes(state.repositoryId))
  ) {
    return false;
  }
  selectRepository(state, repositoryIds[0] ?? null);
  return true;
}

/** Clear repository selection only when the revoked repository is the active one. */
export function clearRepositoryIfSelected(
  state: WorkbenchSelectionState,
  repositoryId: string,
): boolean {
  if (state.repositoryId !== repositoryId) {
    return false;
  }
  selectRepository(state, null);
  return true;
}
