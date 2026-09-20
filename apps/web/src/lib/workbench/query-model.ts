/** Pure transformations from GitService read data to workbench presentation/query intent. */
import type {
  CommitSummary,
  HistoryPage,
  RepositorySummary,
  StatusEntry,
} from "@refyard/git-contract";
import {
  refColorFor,
  type GraphCommit,
  type LaneColor,
} from "@refyard/git-graph";

export interface WorkspaceRootChoice {
  readonly allowedRootId: string;
  readonly displayPath: string;
}

export type WorkbenchDiffRequest =
  | { readonly kind: "untracked"; readonly pathId: string }
  | { readonly kind: "unstaged"; readonly pathId: string }
  | { readonly kind: "staged"; readonly pathId: string }
  | { readonly kind: "commit"; readonly oid: string };

export interface HistoryNotices {
  readonly truncated: boolean;
  readonly tipsMoved: boolean;
  readonly shallow: boolean;
}

function diffSideForSelection(
  selectedPath: StatusEntry,
  selectedSide: "staged" | "unstaged" | null,
): "staged" | "unstaged" {
  if (selectedPath.kind === "untracked") {
    return "unstaged";
  }
  const hasStaged = selectedPath.indexStatus !== ".";
  const hasUnstaged = selectedPath.worktreeStatus !== ".";
  if (selectedSide === "staged") {
    return hasStaged || !hasUnstaged ? "staged" : "unstaged";
  }
  if (selectedSide === "unstaged") {
    return hasUnstaged || !hasStaged ? "unstaged" : "staged";
  }
  return hasStaged ? "staged" : "unstaged";
}

/** Preserve the existing Map semantics: duplicate root ids keep their last repository path. */
export function workspaceRootsFor(
  repositories: readonly RepositorySummary[],
): WorkspaceRootChoice[] {
  return [
    ...new Map(
      repositories.map((entry) => [
        entry.allowedRootId,
        {
          allowedRootId: entry.allowedRootId,
          displayPath: entry.displayPath,
        },
      ]),
    ).values(),
  ];
}

export function diffRequestForSelection(
  selectedPath: StatusEntry | null,
  selectedOid: string | null,
  selectedSide: "staged" | "unstaged" | null = null,
): WorkbenchDiffRequest | null {
  if (selectedPath !== null && selectedPath.kind !== "ignored") {
    if (selectedPath.kind === "untracked") {
      return { kind: "untracked", pathId: selectedPath.pathId };
    }
    return {
      kind: diffSideForSelection(selectedPath, selectedSide),
      pathId: selectedPath.pathId,
    };
  }
  if (selectedOid !== null) {
    return { kind: "commit", oid: selectedOid };
  }
  return null;
}

export function historyNoticesFor(
  pages: readonly HistoryPage[],
): HistoryNotices {
  return {
    truncated: pages.some((page) => page.truncated),
    tipsMoved: pages.some((page) => page.tipsMoved),
    shallow: pages.some((page) => page.shallow),
  };
}

export function graphCommitFor(commit: CommitSummary): GraphCommit {
  return {
    id: commit.oid,
    parentIds: commit.parents,
    refNames: commit.refNames,
  };
}

/**
 * The colour a commit's ref implies for its lane.
 *
 * GitKraken paints the checked-out branch a signature accent so the trunk reads as
 * "where am I" at a glance, and every other branch keeps one stable hue derived from
 * its name — the hue follows the branch, not the lane slot, so a branch keeps its
 * colour across pages and after a lane closes and reopens. Tags colour nothing: a
 * tag landing on a trunk commit must not recolor the trunk below it.
 */
export function laneColorFor(
  currentBranch: string | null,
  refNames: readonly string[],
): LaneColor | undefined {
  if (
    currentBranch !== null &&
    refNames.includes(`refs/heads/${currentBranch}`)
  ) {
    return "lane-current";
  }
  return refColorFor(
    refNames.filter(
      (name) =>
        name.startsWith("refs/heads/") || name.startsWith("refs/remotes/"),
    ),
  );
}
