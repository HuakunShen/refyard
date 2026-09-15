/**
 * The doctor probe and the Git host's scope rules.
 *
 * The doctor's contract from the design is that capabilities are *measured on this
 * machine* and that a missing one removes a feature instead of producing a command
 * that fails later. These cases check the measurement is real (it runs Git and
 * reads the answers), that it is private (a scratch repository, no network, no
 * credentials), and that a broken Git produces `supported: false` with a reason
 * rather than an exception or an optimistic `true`.
 *
 * The host cases check the one property the whole scope model rests on: a spec's
 * `cwdHandle` is the only way to name a directory, and a spec that names an
 * unapproved one does not run at all.
 */
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runDoctor,
  versionAtLeast,
  type DoctorOptions,
} from "@refyard/host-node/process/doctor";
import { createGitHost } from "@refyard/host-node/process/git-host";
import { createHandleRegistry } from "@refyard/host-node/filesystem/handles";
import {
  createRepo,
  fixtureGitPath,
  type GitFixtureRepo,
} from "../support/repo.js";
import { createFixtureGitHost } from "../support/host.js";
import { scriptedRun, alwaysSucceed } from "../support/fake-process.js";

const gitPath = fixtureGitPath();

describe("versionAtLeast", () => {
  it("compares dotted versions numerically, not as strings", () => {
    // Prevents: "2.9.0" being reported as newer than "2.43.0", which would gate
    // features on the wrong comparison.
    expect(versionAtLeast("2.43.0", "2.43.0")).toBe(true);
    expect(versionAtLeast("2.44.1", "2.43.0")).toBe(true);
    expect(versionAtLeast("2.9.0", "2.43.0")).toBe(false);
    expect(versionAtLeast("3.0.0", "2.43.0")).toBe(true);
  });

  it("ignores vendor suffixes", () => {
    expect(versionAtLeast("2.50.1 (Apple Git-155)", "2.43.0")).toBe(true);
    expect(versionAtLeast("2.39.3", "2.43.0")).toBe(false);
  });
});

describe("runDoctor", () => {
  it("probes the machine's Git and reports which formats work", async () => {
    const report = await runDoctor({ gitPath });
    expect(report.executableFound).toBe(true);
    expect(report.gitVersion).not.toBeNull();
    expect(report.featureVersionSupported).toBe(true);
    // Every probe reported, and a successful probe carries no reason.
    const names = report.probes.map((probe) => probe.name);
    expect(names).toContain("status-porcelain-v2");
    expect(names).toContain("cat-file-batch");
    expect(names).toContain("worktree-list-z");
    expect(names).toContain("push-porcelain");
    expect(names).toContain("fetch-porcelain");
    for (const probe of report.probes) {
      expect(probe.detail.length).toBeGreaterThan(0);
      if (!probe.supported) {
        expect(report.reasons.length).toBeGreaterThan(0);
      }
    }
    expect(report.objectFormats).toContain("sha1");
  });

  it("reports an object format the repository actually uses", async () => {
    const report = await runDoctor({ gitPath });
    const layout = report.probes.find(
      (probe) => probe.name === "repository-layout",
    );
    expect(layout?.supported).toBe(true);
    expect(layout?.detail).toContain("object format");
  });

  it("reports an unrepresentable platform rather than guessing", async () => {
    // Prevents: a machine with no usable Git being reported as supported, which
    // would let the UI advertise operations that cannot run.
    const report = await runDoctor({
      gitPath: "/nonexistent/refyard-no-git-here/git",
    });
    expect(report.executableFound).toBe(false);
    expect(report.gitVersion).toBeNull();
    expect(report.features.porcelainV2Status).toBe(false);
    expect(report.reasons.join(" ")).toContain("could not be executed");
  });

  it("gives each probe an identity instead of resolving the machine's own", async () => {
    // Prevents: a machine whose Git has no configured user.* making the doctor
    // wait on the system account lookup before each network probe — measured at
    // ~5s per probe on the machine this was found on, which blocks service
    // startup — and reporting a probe as unsupported when that lookup outlives
    // the probe's deadline.
    const fake = alwaysSucceed();
    // The runner's outcome carries a cleanup report the doctor never reads; the
    // scripted fake stops at the result, so the report is added back here.
    const runCommand: NonNullable<DoctorOptions["runCommand"]> = async (
      spec,
      context,
      options,
    ) => ({
      ...(await fake.run(spec, context, options)),
      cleanup: { kind: "not-needed" },
    });
    await runDoctor({ gitPath, runCommand });
    for (const subcommand of ["push", "fetch"]) {
      const call = fake.calls.find((entry) =>
        entry.spec.argv.includes(subcommand),
      );
      // The probe reuses the fixture commit's identity, passed per invocation:
      // writing it to a config file would change the machine's Git configuration,
      // which the doctor must never do.
      expect(call).toBeDefined();
      const argv = call?.spec.argv ?? [];
      expect(argv).toContain("user.name=Refyard Doctor");
      expect(argv).toContain("user.email=doctor@refyard.invalid");
      expect(argv.indexOf("user.name=Refyard Doctor")).toBeLessThan(
        argv.indexOf(subcommand),
      );
    }
  });

  it("leaves no scratch repository behind", async () => {
    // Prevents: the doctor littering the temp directory on every start.
    const parent = await mkdtemp(join(tmpdir(), "refyard-doctor-parent-"));
    try {
      await runDoctor({ gitPath, scratchParent: parent });
      const entries = await readdir(parent);
      expect(entries).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe("GitHost scope", () => {
  let repo: GitFixtureRepo;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
  });

  afterEach(async () => {
    await repo.dispose();
  });

  it("runs a command in the directory its handle resolves to", async () => {
    const fixture = await createFixtureGitHost({ repo });
    const outcome = await fixture.git(["rev-parse", "--show-toplevel"]);
    expect(outcome.exitCode).toBe(0);
    const topLevel = new TextDecoder().decode(outcome.stdout).trim();
    expect(await stat(topLevel)).toBeTruthy();
  });

  it("returns Git's bytes to the caller unchanged, including invalid UTF-8", async () => {
    // Prevents: the host half of the byte-safety rule breaking — a decode here
    // would replace a byte with U+FFFD before a byte-safe parser could frame it.
    // Blob content is the portable carrier: a POSIX *path* with invalid UTF-8
    // cannot be created on every platform this runs on.
    const content = new Uint8Array([0x00, 0xff, 0xfe, 0x41, 0x0a]);
    await repo.write("blob.bin", content);
    await repo.commitAll("add blob");
    const fixture = await createFixtureGitHost({ repo });
    const outcome = await fixture.git(["cat-file", "blob", "HEAD:blob.bin"]);
    expect(outcome.exitCode).toBe(0);
    expect([...outcome.stdout]).toEqual([...content]);
  });

  it("refuses to run for a handle it never minted", async () => {
    const fixture = await createFixtureGitHost({ repo });
    const outcome = await fixture.host.runGit(
      {
        argv: ["status"],
        cwdHandle: "dir_forged",
        deadlineClass: "readonly",
        description: "status",
      },
      { runId: "scope-2" },
    );
    expect(outcome.termination).toBe("spawn-error");
    expect(outcome.exitCode).toBeNull();
    expect(new TextDecoder().decode(outcome.stderr)).toContain(
      "unknown directory handle",
    );
  });

  it("refuses argv with a NUL byte instead of truncating it silently", async () => {
    // Prevents: an argument being cut short at the NUL by the OS, so Git acts on a
    // different value than the one that was validated.
    const fixture = await createFixtureGitHost({ repo });
    const outcome = await fixture.host.runGit(
      {
        argv: ["status", "--porcelain\u0000--branch"],
        cwdHandle: fixture.cwdHandle,
        deadlineClass: "readonly",
        description: "status with NUL",
      },
      { runId: "scope-3" },
    );
    expect(outcome.termination).toBe("spawn-error");
    expect(new TextDecoder().decode(outcome.stderr)).toContain("NUL");
  });

  it("passes the fixture's identity environment through to Git", async () => {
    // Prevents: the host dropping HOME/GIT_CONFIG_* so a command reads the
    // developer's global config — which is also what would let a test pass while
    // production reads the wrong identity.
    const fixture = await createFixtureGitHost({ repo });
    const outcome = await fixture.git(["var", "GIT_AUTHOR_IDENT"]);
    expect(outcome.exitCode).toBe(0);
    expect(new TextDecoder().decode(outcome.stdout)).toContain(
      "fixture@refyard.invalid",
    );
  });

  it("resolves a workdir handle without running Git", async () => {
    const fixture = await createFixtureGitHost({ repo });
    const path = await fixture.host.resolveWorkdir(fixture.cwdHandle);
    expect(path).toBe(await realpath(repo.root));
  });

  it("gives each handle call a fresh resolution, so a scope change takes effect", async () => {
    const fixture = await createFixtureGitHost({ repo });
    await fixture.registry.approveRoot({
      allowedRootId: "root_2",
      path: repo.root,
    });
    const other = fixture.registry.handleFor("root_2", "");
    const first = await fixture.host.runGit(
      {
        argv: ["rev-parse", "--show-toplevel"],
        cwdHandle: fixture.cwdHandle,
        deadlineClass: "readonly",
        description: "x",
      },
      { runId: "scope-4" },
    );
    const second = await fixture.host.runGit(
      {
        argv: ["rev-parse", "--show-toplevel"],
        cwdHandle: other,
        deadlineClass: "readonly",
        description: "x",
      },
      { runId: "scope-5" },
    );
    expect(new TextDecoder().decode(first.stdout)).toBe(
      new TextDecoder().decode(second.stdout),
    );
  });
});

describe("GitHost argument passing", () => {
  it("hands the planner's argv to the runner without rewriting it", async () => {
    const registry = createHandleRegistry();
    const scratch = await mkdtemp(join(tmpdir(), "refyard-argv-"));
    try {
      await registry.approveRoot({ allowedRootId: "root_1", path: scratch });
      const recorded = scriptedRun(() => ({
        termination: "exit",
        exitCode: 0,
        stdout: new Uint8Array(0),
        stderr: new Uint8Array(0),
        stderrTruncated: false,
        durationMs: 1,
      }));
      const host = createGitHost({
        gitPath: "/usr/bin/git",
        registry,
        run: recorded.run,
      });
      const argv = ["status", "--porcelain=v2", "--branch", "-z"];
      await host.runGit(
        {
          argv,
          cwdHandle: registry.handleFor("root_1", ""),
          deadlineClass: "readonly",
          description: "status",
        },
        { runId: "argv-1" },
      );
      expect(recorded.lastCall()?.spec.argv).toEqual(argv);
      // The registry resolves real paths, so on a platform where the temp
      // directory is a symlink the recorded cwd is the resolved one.
      expect(recorded.lastCall()?.options.cwd).toBe(await realpath(scratch));
      expect(recorded.lastCall()?.options.gitPath).toBe("/usr/bin/git");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses an empty argv, which would start Git with no subcommand", async () => {
    const registry = createHandleRegistry();
    const scratch = await mkdtemp(join(tmpdir(), "refyard-argv-"));
    try {
      await registry.approveRoot({ allowedRootId: "root_1", path: scratch });
      const host = createGitHost({
        gitPath: "/usr/bin/git",
        registry,
        run: alwaysSucceed().run,
      });
      const outcome = await host.runGit(
        {
          argv: [],
          cwdHandle: registry.handleFor("root_1", ""),
          deadlineClass: "readonly",
          description: "empty",
        },
        { runId: "argv-2" },
      );
      expect(outcome.termination).toBe("spawn-error");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
