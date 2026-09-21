/** Verifies decoration-name classification drives the Branch / Tag column menus. */
import { describe, expect, it } from "vitest";
import {
  classifyCommitRef,
  commitRefDisplayName,
  groupCommitRefs,
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

describe("commit ref badge grouping", () => {
  it("merges a local branch with its in-sync remote twin into one pill", () => {
    // Real-world failure prevented: three pills saying `main` twice (and
    // origin/HEAD once) squeezed a narrow column with no information gain.
    const groups = groupCommitRefs(
      [
        "refs/heads/main",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
      ],
      "main",
    );
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.name).toBe("main");
    expect(group?.primaryRefName).toBe("refs/heads/main");
    expect(group?.head).toBe(true);
    expect(group?.local).toBe(true);
    expect(group?.remotes).toEqual(["origin"]);
    expect(group?.refs).toHaveLength(2);
  });

  it("keeps origin/HEAD out of the badges entirely", () => {
    // A symbolic ref is not a branch; decorating a row with it is how a
    // synced trunk reads as three different things.
    const groups = groupCommitRefs(["refs/remotes/origin/HEAD"], "main");
    expect(groups).toEqual([]);
  });

  it("keeps a tag a separate pill even on the same commit as its branch", () => {
    const groups = groupCommitRefs(
      ["refs/heads/v1.0", "refs/remotes/origin/v1.0", "refs/tags/v1.0"],
      null,
    );
    expect(groups.map((group) => group.name)).toEqual(["v1.0", "v1.0"]);
    expect(groups[0]?.tag).toBe(false);
    expect(groups[1]?.tag).toBe(true);
    expect(groups[1]?.primaryRefName).toBe("refs/tags/v1.0");
  });

  it("shows a remote-only branch as remote without local flags", () => {
    const groups = groupCommitRefs(["refs/remotes/origin/topic"], "topic");
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.local).toBe(false);
    expect(group?.head).toBe(false);
    expect(group?.remotes).toEqual(["origin"]);
    expect(group?.primaryRefName).toBe("refs/remotes/origin/topic");
  });

  it("records every remote name when two remotes carry the branch", () => {
    const groups = groupCommitRefs(
      [
        "refs/remotes/origin/v2",
        "refs/remotes/upstream/v2",
        "refs/heads/v2",
      ],
      null,
    );
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group?.remotes).toEqual(["origin", "upstream"]);
    expect(group?.local).toBe(true);
    expect(group?.primaryRefName).toBe("refs/heads/v2");
  });
});
