/**
 * Authorization scope policy for Git mutations.
 *
 * Resource grants decide which repository/root a session may address. This table decides what
 * category of operation it may perform there. It is total over MutationKind so a new operation
 * cannot compile until its authority is chosen explicitly.
 */
import type { MutationKind } from "@refyard/git-contract";
import type { AuthorizationScope } from "./auth.js";

const MUTATION_SCOPE = {
  initRepository: "workspace:manage",
  cloneRepository: "workspace:manage",
  stagePaths: "repository:write",
  unstagePaths: "repository:write",
  discardTrackedPaths: "repository:write",
  commit: "repository:write",
  amendCommit: "repository:write",
  createBranch: "repository:write",
  switchBranch: "repository:write",
  renameBranch: "repository:write",
  deleteBranch: "repository:write",
  setBranchUpstream: "repository:write",
  addRemote: "repository:write",
  updateRemote: "repository:write",
  removeRemote: "repository:write",
  fetch: "repository:network",
  push: "repository:network",
  pull: "repository:network",
  createStash: "repository:write",
  applyStash: "repository:write",
  popStash: "repository:write",
  dropStash: "repository:write",
  createTag: "repository:write",
  deleteTag: "repository:write",
  pushTag: "repository:network",
  createWorktree: "repository:write",
  removeWorktree: "repository:write",
  lockWorktree: "repository:write",
  unlockWorktree: "repository:write",
  addSubmodule: "repository:write",
  updateSubmodule: "repository:write",
  syncSubmodule: "repository:write",
  merge: "repository:write",
  continueMerge: "repository:write",
  abortMerge: "repository:write",
  cherryPick: "repository:write",
  continueCherryPick: "repository:write",
  abortCherryPick: "repository:write",
  rebase: "repository:write",
  continueRebase: "repository:write",
  abortRebase: "repository:write",
  dropCommit: "repository:write",
  squashCommit: "repository:write",
  revertCommit: "repository:write",
  resetBranch: "repository:write",
} satisfies Record<MutationKind, AuthorizationScope>;

export function scopeForMutationKind(kind: MutationKind): AuthorizationScope {
  return MUTATION_SCOPE[kind];
}
