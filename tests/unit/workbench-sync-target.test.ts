/**
 * Toolbar sync targeting: what pull/push/fetch act on when the reader clicks.
 *
 * The cases are the ones a real remote workflow produces — a branch tracking its
 * fork, an untracked branch, no remotes at all, a detached HEAD — and each asserts
 * the decision a button depends on, never an internal shape.
 */
import { describe, expect, it } from "vitest";
import { syncTarget } from "../../apps/web/src/lib/workbench/sync-target.js";

function status(upstream: string | null, branchName: string | null = "main") {
  return {
    head: {
      kind: "born" as const,
      branchName,
      oid: "a".repeat(40),
      detached: branchName === null,
    },
    upstream: upstream === null ? null : { name: upstream, ahead: 0, behind: 0 },
  };
}

function refs(names: readonly string[]) {
  return {
    remotes: names.map((name) => ({
      name,
      fetchUrlDisplay: `git@github.com:o/${name}.git`,
      pushUrlDisplay: null,
    })),
  };
}

describe("syncTarget", () => {
  it("prefers the branch's own upstream remote", () => {
    const target = syncTarget(status("fork/feature", "feature"), refs(["origin", "fork"]));
    expect(target).toEqual({
      remoteName: "fork",
      branchName: "feature",
      problem: null,
    });
  });

  it("falls back to origin when the branch has no upstream", () => {
    const target = syncTarget(status(null), refs(["upstream", "origin"]));
    expect(target?.remoteName).toBe("origin");
    expect(target?.problem).toBe("no-upstream");
  });

  it("falls back to the first remote when there is no origin", () => {
    const target = syncTarget(status(null), refs(["mirror", "other"]));
    expect(target?.remoteName).toBe("mirror");
  });

  it("answers no-remote when the repository has none — fetch has nothing either", () => {
    const target = syncTarget(status("origin/main"), refs([]));
    expect(target?.problem).toBe("no-remote");
    expect(target?.remoteName).toBe("");
  });

  it("names the remote but no branch for a detached HEAD — fetch stays possible", () => {
    const target = syncTarget(status(null, null), refs(["origin"]));
    expect(target).toEqual({
      remoteName: "origin",
      branchName: null,
      problem: "no-branch",
    });
  });
});
