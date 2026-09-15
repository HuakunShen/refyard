/**
 * Repository-creation planners: `git init` and `git clone`.
 *
 * These two are the only planners whose subject does not exist yet, so they are
 * tested for different things than the rest of the planner suite: the destination is
 * absolute and comes from the caller (the host proved it is inside an approved root),
 * the branch name is either the request's or **Git's own default** — never a name
 * this code invented — and a clone Git refuses must leave whatever was in the
 * destination untouched.
 *
 * Both argv shapes are also run for real. A flag that looks right but is rejected by
 * Git is only discovered by running it, and the clone cases push to a local bare
 * remote, so nothing here reaches a network or a credential helper.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planRepositoryClone, planRepositoryInit } from "@refyard/git-core";
import { createBareRemote, createRepo } from "../support/repo.js";

const CWD = "wt_bbbbbbbbbbbbbbbb";
const context = { cwdHandle: CWD };
const decoder = new TextDecoder();

describe("init planning", () => {
  it("passes the destination after `--`, so a path that begins with `-` is a path", () => {
    const spec = planRepositoryInit(context, {
      destination: "/root/nested/new",
      initialBranch: "trunk",
    });
    expect(spec.argv).toEqual([
      "init",
      "--quiet",
      "--initial-branch=trunk",
      "--",
      "/root/nested/new",
    ]);
    expect(spec.cwdHandle).toBe(CWD);
    expect(spec.deadlineClass).toBe("hook");
    expect(spec.description.length).toBeGreaterThan(0);
  });

  it("leaves the branch name to Git when the request says null", () => {
    // The contract's `null` means "Git's default", which is configurable on the
    // machine that runs the service. A planner that substituted a name here would
    // silently override the operator's own `init.defaultBranch`.
    const spec = planRepositoryInit(context, {
      destination: "/root/new",
      initialBranch: null,
    });
    expect(spec.argv).toEqual(["init", "--quiet", "--", "/root/new"]);
  });

  it("lets Git's default decide, and takes the requested branch when there is one", async () => {
    const repo = await createRepo();
    try {
      // Git's default is the machine's `init.defaultBranch`, not a name this code
      // chose, and the fixture owns the global config so the test can spell it out.
      // Measured on Git 2.50.1 while writing this: `git init` reads that config and
      // ignores `GIT_DEFAULT_BRANCH`, which is why the fixture's own `init` passes
      // `--initial-branch` explicitly.
      await writeFile(
        join(repo.home, ".gitconfig"),
        "[init]\n\tdefaultBranch = from-config\n",
        "utf8",
      );
      const fromGit = join(repo.scratchRoot, "from-git-default");
      await repo.git(
        planRepositoryInit(context, { destination: fromGit, initialBranch: null })
          .argv,
      );
      expect(
        decoder
          .decode(
            await repo.git(["-C", fromGit, "symbolic-ref", "--short", "HEAD"]),
          )
          .trim(),
      ).toBe("from-config");

      const named = join(repo.scratchRoot, "named");
      await repo.git(
        planRepositoryInit(context, { destination: named, initialBranch: "trunk" })
          .argv,
      );
      expect(
        decoder
          .decode(
            await repo.git(["-C", named, "symbolic-ref", "--short", "HEAD"]),
          )
          .trim(),
      ).toBe("trunk");
    } finally {
      await repo.dispose();
    }
  });

  it("creates missing parent directories, so a nested destination is one command", async () => {
    const repo = await createRepo();
    try {
      const nested = join(repo.scratchRoot, "parent", "child", "repo");
      await repo.git(
        planRepositoryInit(context, { destination: nested, initialBranch: "main" })
          .argv,
      );
      expect(
        decoder
          .decode(await repo.git(["-C", nested, "rev-parse", "--is-inside-work-tree"]))
          .trim(),
      ).toBe("true");
    } finally {
      await repo.dispose();
    }
  });
});

describe("clone planning", () => {
  it("recurses into submodules only when the request asks, and takes the network deadline", () => {
    const plain = planRepositoryClone(context, {
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: false,
    });
    expect(plain.argv).toEqual([
      "clone",
      "--quiet",
      "--",
      "/remote/repo.git",
      "/root/cloned",
    ]);
    expect(plain.deadlineClass).toBe("network");

    const recursive = planRepositoryClone(context, {
      remoteUrl: "/remote/repo.git",
      destination: "/root/cloned",
      initializeSubmodules: true,
    });
    expect(recursive.argv).toContain("--recurse-submodules");
    // Both operands stay after `--`: a remote URL beginning with `-` is refused by
    // the contract, and this makes sure it could not be read as a switch anyway.
    expect(recursive.argv.at(-2)).toBe("/remote/repo.git");
    expect(recursive.argv.at(-1)).toBe("/root/cloned");
  });

  it("clones the remote's history, and the working tree matches its tip", async () => {
    const origin = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    try {
      await origin.git(["push", "--quiet", remote.path, "main"]);
      const destination = join(origin.scratchRoot, "cloned");
      await origin.git(
        planRepositoryClone(context, {
          remoteUrl: remote.path,
          destination,
          initializeSubmodules: false,
        }).argv,
      );
      const clonedHead = decoder
        .decode(await origin.git(["-C", destination, "rev-parse", "HEAD"]))
        .trim();
      expect(clonedHead).toBe((await origin.headOid()).trim());
      expect(await readFile(join(destination, "a.txt"), "utf8")).toBe("base\n");
    } finally {
      await remote.dispose();
      await origin.dispose();
    }
  });

  it("refuses a destination that is not empty, and deletes nothing the user put there", async () => {
    // Git's own refusal is the answer: this service never clears a path the user
    // chose in order to make room for a clone, so the refusal carries Git's
    // diagnostic and the destination is exactly as it was.
    const origin = await createRepo({ initialCommit: true });
    const remote = await createBareRemote();
    try {
      await origin.git(["push", "--quiet", remote.path, "main"]);
      const destination = join(origin.scratchRoot, "occupied");
      await mkdir(destination, { recursive: true });
      await writeFile(join(destination, "keep.txt"), "mine\n", "utf8");
      const result = await origin.gitResult(
        planRepositoryClone(context, {
          remoteUrl: remote.path,
          destination,
          initializeSubmodules: false,
        }).argv,
      );
      expect(result.code).not.toBe(0);
      expect(decoder.decode(result.stderr)).toMatch(/empty/i);
      expect(await readFile(join(destination, "keep.txt"), "utf8")).toBe("mine\n");
    } finally {
      await remote.dispose();
      await origin.dispose();
    }
  });
});
