/** Pure working-copy projections used by the GitKraken-style status surface. */
import type { StatusEntry } from "@refyard/git-contract";

export interface WorkingCopyGroups {
  readonly unstaged: readonly StatusEntry[];
  readonly staged: readonly StatusEntry[];
}

/**
 * Preserve Git's XY semantics while projecting one status snapshot into two lists.
 *
 * A path can belong to both lists: `MM` is staged once and still has a working-tree
 * edit. Untracked paths have no index entry and therefore never appear in Staged.
 * Ignored paths are metadata for other status views, not working-copy actions.
 */
export function groupWorkingCopyEntries(
  entries: readonly StatusEntry[],
): WorkingCopyGroups {
  const unstaged: StatusEntry[] = [];
  const staged: StatusEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "ignored") {
      continue;
    }
    if (isUnstaged(entry)) {
      unstaged.push(entry);
    }
    if (isStaged(entry)) {
      staged.push(entry);
    }
  }

  return { unstaged, staged };
}

export function isUnstaged(entry: StatusEntry): boolean {
  return (
    entry.kind !== "ignored" &&
    (entry.kind === "untracked" || entry.worktreeStatus !== ".")
  );
}

export function isStaged(entry: StatusEntry): boolean {
  return (
    entry.kind !== "ignored" &&
    entry.kind !== "untracked" &&
    entry.indexStatus !== "."
  );
}

export function isUnmerged(entry: StatusEntry): boolean {
  return entry.kind === "unmerged" || (entry.stages?.length ?? 0) > 0;
}

export function canStage(entry: StatusEntry): boolean {
  return (
    entry.pathEncoding === "utf8" &&
    entry.kind !== "ignored" &&
    (entry.kind === "untracked" || entry.worktreeStatus !== ".")
  );
}

export function canUnstage(entry: StatusEntry): boolean {
  return (
    entry.pathEncoding === "utf8" &&
    entry.kind !== "untracked" &&
    entry.kind !== "ignored" &&
    entry.indexStatus !== "."
  );
}

export function canDiscard(entry: StatusEntry): boolean {
  return (
    entry.pathEncoding === "utf8" &&
    entry.kind !== "untracked" &&
    entry.kind !== "ignored" &&
    entry.worktreeStatus !== "."
  );
}
