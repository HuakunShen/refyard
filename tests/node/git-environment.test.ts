/**
 * The environment the *service* gives Git, end to end.
 *
 * `runner.test.ts` checks the variables; this file checks what they are for: a Git
 * process started the way the service starts one must obey the session's Git
 * configuration, because the alternative is a workbench whose writes do not look
 * like the ones the same user gets from their own `git`.
 *
 * The cases deliberately build the host **without** an `env` override. The test
 * fixtures pass their environment as `extra` (see `tests/support/host.ts`), which is
 * applied after the allow-list and therefore would hide exactly the defect these
 * cases exist for: on the first Windows run the service dropped `GIT_CONFIG_NOSYSTEM`,
 * read Git for Windows' system config, and wrote CRLF into files the fixture's own Git
 * wrote with LF — fifteen end-to-end cases compared the two and failed.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGitHost, createHandleRegistry } from "@refyard/host-node";
import type { GitCommandSpec } from "@refyard/git-core";
import { createRepo, fixtureGitPath, type GitFixtureRepo } from "../support/repo.js";
import { writeFile } from "node:fs/promises";

const CONFIG_NAMES = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
] as const;

/** The production-shaped environment: the process's own, and nothing else. */
function adoptProcessConfig(repo: GitFixtureRepo): () => void {
  const saved = CONFIG_NAMES.map((name) => [name, process.env[name]] as const);
  for (const name of CONFIG_NAMES) {
    const value = repo.env[name];
    if (value !== undefined) {
      process.env[name] = value;
    }
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
}

/** A host built the way `refyard serve` builds one: no environment overrides. */
async function productionHost(repo: GitFixtureRepo) {
  const registry = createHandleRegistry();
  const allowedRootId = "root_env_case";
  await registry.approveRoot({ allowedRootId, path: repo.root });
  const host = createGitHost({ gitPath: fixtureGitPath(), registry });
  const spec = (argv: readonly string[]): GitCommandSpec => ({
    argv,
    cwdHandle: registry.handleFor(allowedRootId, ""),
    deadlineClass: "readonly",
    description: argv.join(" "),
  });
  return { host, spec };
}

describe("the environment the service gives Git", () => {
  let repo: GitFixtureRepo | undefined;
  let restore: (() => void) | undefined;

  afterEach(async () => {
    restore?.();
    restore = undefined;
    await repo?.dispose();
    repo = undefined;
  });

  it("writes a checked-out file with the line endings the session's config asks for", async () => {
    // Prevents: `refyard` producing different bytes on disk than the user's own `git`
    // run from the same shell. `core.autocrlf=true` is what Git for Windows installs by
    // default and what many Windows users keep; a session that asks for it must get it,
    // and a session that cancels it (the fixture's `GIT_CONFIG_NOSYSTEM`, a scratch
    // `GIT_CONFIG_GLOBAL`) must get LF. Either way the answer comes from the session's
    // configuration, not from whichever files the service happens to read.
    repo = await createRepo({ initialCommit: true });
    await writeFile(
      repo.env["GIT_CONFIG_GLOBAL"] ?? join(tmpdir(), "unused"),
      "[core]\n\tautocrlf = true\n",
      "utf8",
    );
    // The fixture's own Git is the control: same repository, same command, and the
    // file has to differ from the index first or the checkout writes nothing at all.
    await repo.write("a.txt", "changed\n");
    await repo.git(["checkout", "--", "a.txt"]);
    const viaFixture = await repo.read("a.txt");
    expect(new TextDecoder().decode(viaFixture)).toBe("base\r\n");

    restore = adoptProcessConfig(repo);
    const { host, spec } = await productionHost(repo);
    await repo.write("a.txt", "changed again\n");
    const result = await host.runGit(spec(["checkout", "--", "a.txt"]), {
      runId: "env-checkout",
    });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(await repo.read("a.txt"))).toBe("base\r\n");
  });

  it("leaves the working file alone when the session cancels the system config", async () => {
    // The other half of the same promise, and the one the fixture relies on: with
    // `GIT_CONFIG_NOSYSTEM=1` and an empty scratch global config, nothing converts.
    // Prevents: a service that always applies the machine's system config, which would
    // make `refyard`'s bytes differ from `git`'s in the opposite direction.
    repo = await createRepo({ initialCommit: true });
    restore = adoptProcessConfig(repo);
    const { host, spec } = await productionHost(repo);
    await repo.write("a.txt", "changed\n");
    const result = await host.runGit(spec(["checkout", "--", "a.txt"]), {
      runId: "env-checkout-lf",
    });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(await repo.read("a.txt"))).toBe("base\n");
  });
});
