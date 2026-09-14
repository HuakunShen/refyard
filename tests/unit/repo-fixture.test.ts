/**
 * Tests for the repository fixture itself.
 *
 * The fixture is the safety mechanism for every later test: if it leaks the
 * caller's environment, a "temporary" repository can turn out to be somebody's
 * real one. So the isolation properties are asserted rather than assumed, and the
 * awkward path shapes (spaces, non-ASCII, newlines in names) get exercised here
 * once instead of being rediscovered repeatedly.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createBareRemote, createRepo } from "../support/repo.ts";

describe("the repository fixture", () => {
  it("isolates HOME, global config and identity from the developer’s environment", async () => {
    const repo = await createRepo();
    try {
      // Reading an unset key exits 1, so this also documents that a fixture has no
      // inherited identity; then a global write must land in the fixture's file.
      const unset = await repo.gitResult(["config", "--global", "user.name"]);
      expect(unset.code).toBe(1);
      await repo.git(["config", "--global", "fixture.marker", "yes"]);
      const marker = await repo.git(["config", "--global", "fixture.marker"]);
      expect(new TextDecoder().decode(marker).trim()).toBe("yes");
      // …and it landed in the fixture's own file, not the developer's ~/.gitconfig.
      expect(
        await readFile(repo.env["GIT_CONFIG_GLOBAL"] ?? "", "utf8"),
      ).toContain("[fixture]");
      expect(repo.home.startsWith(repo.scratchRoot)).toBe(true);
      expect(repo.home === process.env["HOME"]).toBe(false);
      expect(repo.env["GIT_CONFIG_GLOBAL"]).toBe(`${repo.home}/.gitconfig`);
      expect(repo.env["GIT_TERMINAL_PROMPT"]).toBe("0");
      expect(repo.env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
      // A stray GIT_DIR or GIT_WORK_TREE in the caller's shell must not survive.
      expect(repo.env["GIT_DIR"]).toBeUndefined();
      expect(repo.env["GIT_WORK_TREE"]).toBeUndefined();
      expect(repo.env["GIT_INDEX_FILE"]).toBeUndefined();
    } finally {
      await repo.dispose();
    }
  });

  it("creates an unborn repository by default and a committed one on request", async () => {
    const unborn = await createRepo();
    try {
      const status = await unborn.git(["status", "--porcelain=v2", "--branch"]);
      const text = new TextDecoder().decode(status);
      expect(text).toContain("# branch.head main");
      expect(text).toContain("branch.oid (initial)");
    } finally {
      await unborn.dispose();
    }

    const committed = await createRepo({ initialCommit: true });
    try {
      const oid = await committed.headOid();
      expect(oid).toMatch(/^[0-9a-f]{40}$/);
      expect(await committed.readText("a.txt")).toBe("base\n");
    } finally {
      await committed.dispose();
    }
  });

  it("reports a non-zero exit as a result rather than throwing, and throws from git()", async () => {
    const repo = await createRepo();
    try {
      const result = await repo.gitResult(["rev-parse", "HEAD"]);
      expect(result.code).not.toBe(0);
      expect(result.stderr.byteLength).toBeGreaterThan(0);
      await expect(repo.git(["rev-parse", "HEAD"])).rejects.toThrowError(
        /exited with/,
      );
    } finally {
      await repo.dispose();
    }
  });

  it("handles paths with spaces, non-ASCII characters and tabs in commit fixtures", async () => {
    const repo = await createRepo();
    try {
      // These are the path shapes the byte parsers must survive, so the fixture
      // must be able to create them in the first place.
      await repo.write("space 中文.txt", "one\n");
      await repo.write("tab\tname.txt", "two\n");
      await repo.write("dir with space/nested 文件.txt", "three\n");
      const oid = await repo.commitAll("paths");
      expect(oid).toMatch(/^[0-9a-f]{40}$/);
      const listed = new TextDecoder().decode(
        await repo.git(["ls-files", "-z"]),
      );
      expect(listed).toContain("space 中文.txt");
      expect(listed).toContain("tab\tname.txt");
      expect(listed).toContain("dir with space/nested 文件.txt");
    } finally {
      await repo.dispose();
    }
  });

  it("produces deterministic commit ids for the same content and date", async () => {
    const first = await createRepo({ initialCommit: true });
    const second = await createRepo({ initialCommit: true });
    try {
      expect(await first.headOid()).toBe(await second.headOid());
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("removes the whole fixture directory on dispose", async () => {
    const repo = await createRepo({ initialCommit: true });
    const scratch = repo.scratchRoot;
    expect(existsSync(scratch)).toBe(true);
    await repo.dispose();
    expect(existsSync(scratch)).toBe(false);
  });

  it("provides a bare remote that never touches the network or the user’s remotes", async () => {
    const repo = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    try {
      await repo.git(["remote", "add", "origin", remote.path]);
      await repo.git(["push", "--quiet", "origin", "main"]);
      const heads = new TextDecoder().decode(
        await remote.git(["for-each-ref", "--format=%(refname)", "refs/heads"]),
      );
      expect(heads.trim()).toBe("refs/heads/main");
      expect(remote.path.startsWith("/")).toBe(true);
      expect(remote.path).toContain("refyard-remote-");
    } finally {
      await repo.dispose();
      await remote.dispose();
    }
  });

  it("supports SHA-256 repositories so OID handling is not hard-coded to 40 characters", async () => {
    const repo = await createRepo({
      initialCommit: true,
      initArgs: ["--object-format=sha256"],
    });
    try {
      const oid = await repo.headOid();
      expect(oid).toMatch(/^[0-9a-f]{64}$/);
      const format = new TextDecoder()
        .decode(await repo.git(["rev-parse", "--show-object-format"]))
        .trim();
      expect(format).toBe("sha256");
    } finally {
      await repo.dispose();
    }
  });
});
