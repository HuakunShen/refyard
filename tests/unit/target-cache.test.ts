/**
 * Repository identity across execution targets.
 *
 * A path is not an identity: `/srv/site` on this machine and `/srv/site` on a host
 * the user's SSH configuration names are two different repositories, and reading one
 * target's answer for the other would show a machine the user did not ask for under
 * the path they typed. These tests pin the key that keeps them apart, that the local
 * form does not depend on how a caller spells "no target", and that the historical
 * tab-identity string is unchanged — so existing tabs, and the unit tests that pin
 * their format, keep working.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  repositoryCacheKey,
  repositoryTabKey,
  type RepositoryTab,
} from "../../apps/web/src/lib/workbench/repository-tabs.js";

const QUERIES_SOURCE = resolve(
  process.cwd(),
  "apps/web/src/lib/workbench/queries.svelte.ts",
);

describe("repository cache keys", () => {
  it("keeps the same path on two targets apart", () => {
    // Prevents: a remote checkout and a local one at the same absolute path sharing
    // cached reads, so switching tabs shows the other machine's content.
    expect(repositoryCacheKey("s1", "local1", "/repo")).not.toEqual(
      repositoryCacheKey("s1", "ssh1", "/repo"),
    );
  });

  it("is stable for the same session, target and path", () => {
    expect(repositoryCacheKey("s1", "tgt_remote", "/repo")).toEqual(
      repositoryCacheKey("s1", "tgt_remote", "/repo"),
    );
    expect(repositoryCacheKey("s1", null, "/repo")).toEqual(
      repositoryCacheKey("s1", null, "/repo"),
    );
  });

  it("leaves the local form unchanged for callers that name no target", () => {
    // Both spellings of "no target" are the same repository: an absent target means
    // the session's own machine, never a third identity.
    expect(repositoryCacheKey("s1", null, "/repo")).toEqual(
      repositoryCacheKey("s1", undefined, "/repo"),
    );
    // And the namespace is still the first element, so a key from another session or
    // authorization round cannot be read as this one's.
    expect(repositoryCacheKey("s1", null, "/repo")).not.toEqual(
      repositoryCacheKey("s2", null, "/repo"),
    );
    expect(repositoryCacheKey("s1", null, "/repo")[0]).toBe("s1");
  });

  it("stays distinct for target ids and paths whose characters could run together", () => {
    // The contract mints targets as tgt_[A-Za-z0-9_-]+, and a path may contain the
    // same characters; a key built by concatenating them would let one repository's
    // key equal another's.
    expect(repositoryCacheKey("s1", "tgt_a-b_c", "/x")).not.toEqual(
      repositoryCacheKey("s1", "tgt_a", "b_c/x"),
    );
    expect(repositoryCacheKey("s1", "tgt_a_b", "/c")).not.toEqual(
      repositoryCacheKey("s1", "tgt_a", "_b/c"),
    );
    expect(repositoryCacheKey("s1", "tgt_a", "b/c")).not.toEqual(
      repositoryCacheKey("s1", "tgt_ab", "/c"),
    );
  });

  it("keeps the historical tab identity format for callers without a target", () => {
    const local: RepositoryTab = {
      repositoryId: "repo_a",
      displayName: "alpha",
      displayPath: "/projects/alpha",
    };
    expect(repositoryTabKey(local)).toBe("repo_a");
    expect(repositoryTabKey({ ...local, worktreeId: "wt_feature" })).toBe(
      "repo_a:wt_feature",
    );
    // A tab that knows its target is identified with it, so two tabs for the same
    // repository id on different machines stay separate tabs.
    expect(repositoryTabKey({ ...local, targetId: "tgt_remote" })).toBe(
      "tgt_remote/repo_a",
    );
  });

  it("is the key the workbench queries repository reads by", async () => {
    // Prevents: the key existing, being tested, and the cache quietly ignoring it.
    const source = await readFile(QUERIES_SOURCE, "utf8");
    expect(source).toContain("repositoryCacheKey(");
  });
});
