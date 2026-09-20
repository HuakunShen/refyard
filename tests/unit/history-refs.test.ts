/** Verifies decoration-name classification drives the Branch / Tag column menus. */
import { describe, expect, it } from "vitest";
import {
  classifyCommitRef,
  commitRefDisplayName,
} from "@refyard/git-ui/lib/history-refs";

describe("commit ref classification", () => {
  it("classifies local branches, remote-tracking refs and tags", () => {
    expect(classifyCommitRef("refs/heads/v2")).toEqual({
      kind: "local",
      fullName: "refs/heads/v2",
      branchName: "v2",
    });
    expect(classifyCommitRef("refs/remotes/origin/v2")).toEqual({
      kind: "remote",
      fullName: "refs/remotes/origin/v2",
      remoteName: "origin",
      branchName: "v2",
    });
    expect(classifyCommitRef("refs/tags/v1.0.0")).toEqual({
      kind: "tag",
      fullName: "refs/tags/v1.0.0",
      tagName: "v1.0.0",
    });
  });

  it("falls back to other for a ref kind this UI does not model", () => {
    // Real-world failure prevented: `git log --decorate` can surface refs the
    // UI has no menu for (notes, a future worktree ref); it must still render
    // instead of crashing or pretending to be a branch.
    expect(classifyCommitRef("refs/notes/commits")).toEqual({
      kind: "other",
      fullName: "refs/notes/commits",
    });
    expect(classifyCommitRef("HEAD")).toEqual({
      kind: "other",
      fullName: "HEAD",
    });
  });

  it("keeps branch names containing slashes intact", () => {
    const ref = classifyCommitRef("refs/remotes/origin/feat/a/b");
    expect(ref.kind === "remote" ? ref.remoteName : null).toBe("origin");
    expect(ref.kind === "remote" ? ref.branchName : null).toBe("feat/a/b");
  });

  it("names refs the way Git names them", () => {
    expect(commitRefDisplayName(classifyCommitRef("refs/heads/v2"))).toBe("v2");
    expect(
      commitRefDisplayName(classifyCommitRef("refs/remotes/origin/v2")),
    ).toBe("origin/v2");
    expect(commitRefDisplayName(classifyCommitRef("refs/tags/v1"))).toBe("v1");
  });
});
