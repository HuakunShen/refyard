/**
 * Choosing what the toolbar's sync buttons act on.
 *
 * Pull, push and fetch each name a remote, and push also names a branch — but the
 * reader never types either one into a toolbar; they click. This module is the whole
 * decision, as a pure function of the two reads the workbench already holds: the
 * branch's configured upstream when there is one, otherwise the repository's first
 * remote, with `origin` winning any tie. `null` means the honest answer is "there is
 * nothing sensible to act on", and the button explains itself instead of firing a
 * request the host would only refuse.
 */
import type { RefsSnapshot, StatusSnapshot } from "@refyard/git-contract";

export interface SyncTarget {
  readonly remoteName: string;
  readonly branchName: string | null;
  /** Why a part of the target is missing, when one is. The button shows this. */
  readonly problem: null | "no-remote" | "no-branch" | "no-upstream";
}

/**
 * The remote a sync action addresses: the branch's own upstream first — a branch
 * tracking a fork must not be pushed at `origin` just because `origin` sorts first —
 * then `origin`, then whichever remote remains.
 */
export function syncTarget(
  status: Pick<StatusSnapshot, "head" | "upstream"> | null | undefined,
  refs: Pick<RefsSnapshot, "remotes"> | null | undefined,
): SyncTarget | null {
  const remotes = refs?.remotes ?? [];
  if (remotes.length === 0) {
    return { remoteName: "", branchName: null, problem: "no-remote" };
  }
  const branchName = status?.head.branchName ?? null;
  if (branchName === null) {
    // An unborn or detached HEAD: pull has no branch to fast-forward and push has
    // nothing to name. Fetch stays possible, so the target names the remote anyway.
    const remoteName = defaultRemote(remotes.map((remote) => remote.name));
    return { remoteName, branchName: null, problem: "no-branch" };
  }
  const upstreamRemote = status?.upstream?.name.split("/")[0] ?? null;
  if (upstreamRemote !== null && upstreamRemote.length > 0) {
    return { remoteName: upstreamRemote, branchName, problem: null };
  }
  return {
    remoteName: defaultRemote(remotes.map((remote) => remote.name)),
    branchName,
    problem: "no-upstream",
  };
}

/** `origin` when it exists, else the first remote in the refs order. */
function defaultRemote(names: readonly string[]): string {
  return names.includes("origin") ? "origin" : (names[0] ?? "");
}
