/** Rules out replay actions that cannot work with the selected commit's known shape. */
import type { CommitSummary } from "@refyard/git-contract";

export function commitReplayRestrictions(
  commit: Pick<CommitSummary, "parents" | "boundary" | "missingParents">,
): {
  readonly merge: boolean;
  readonly drop: "root" | "merge" | "missing-parent" | null;
} {
  if (commit.parents.length > 1) {
    return { merge: true, drop: "merge" };
  }
  if (
    commit.missingParents.length > 0 ||
    (commit.boundary && commit.parents.length === 0)
  ) {
    return { merge: false, drop: "missing-parent" };
  }
  return { merge: false, drop: commit.parents.length === 0 ? "root" : null };
}
