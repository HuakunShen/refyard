/** Host-free derived views for the static Refyard Git sandbox. */
import { layoutGraph, type LayoutResult } from "@refyard/git-graph";
import { diffResponseSchema, type CommitDetail, type CommitSummary, type DiffResponse } from "@refyard/git-contract";
import { makeDemoDiff } from "./fixtures.js";
import type { DemoState } from "./reducer.js";

export function getDemoGraph(state: DemoState): LayoutResult {
  return layoutGraph(getVisibleDemoCommits(state).map((commit) => ({
    id: commit.oid, parentIds: commit.parents, refNames: commit.refNames,
  })));
}

export function getVisibleDemoCommits(state: DemoState): readonly CommitSummary[] {
  const query = state.filter.trim().toLowerCase();
  if (!query) return state.commits;
  return state.commits.filter((commit) => `${commit.subject} ${commit.authorName} ${commit.oid} ${commit.refNames.join(" ")}`.toLowerCase().includes(query));
}

export function getSelectedDemoCommit(state: DemoState): CommitSummary | null {
  return state.commits.find((commit) => commit.oid === state.selectedOid) ?? null;
}

export function getSelectedDemoDetail(state: DemoState): CommitDetail | null {
  return state.selectedOid ? state.detailsByOid[state.selectedOid] ?? null : null;
}

export function getSelectedDemoDiff(state: DemoState): DiffResponse | null {
  return state.selectedOid ? state.diffsByOid[state.selectedOid] ?? null : null;
}

export function getSelectedWorkingCopyDiff(state: DemoState): DiffResponse | null {
  const entry = state.status.entries.find((item) => item.pathId === state.selectedPathId)
    ?? state.status.entries.find((item) => item.worktreeStatus !== ".")
    ?? state.status.entries[0];
  if (!entry) return null;
  const selectedSideIsCurrent = state.selectedSide === "staged"
    ? entry.indexStatus !== "." && entry.kind !== "untracked"
    : state.selectedSide === "unstaged"
      ? entry.worktreeStatus !== "." || entry.kind === "untracked"
      : false;
  const side = selectedSideIsCurrent ? state.selectedSide : entry.worktreeStatus !== "." ? "unstaged" : "staged";
  const example = makeDemoDiff(state.status.head.oid ?? "0".repeat(40), 2);
  return diffResponseSchema.parse({
    ...example,
    request: { kind: side, oid: null, from: null, to: null, pathId: entry.pathId },
    files: example.files.map((file) => ({ ...file, pathId: entry.pathId, displayPath: entry.displayPath })),
  });
}
