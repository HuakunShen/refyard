/**
 * `refyard doctor` — what this machine can actually do.
 *
 * The design is explicit that capabilities are *probed*, not inferred from a
 * version string: a Git built without a feature, or a repository in a format the
 * service does not handle, must show up as a missing capability with a reason
 * rather than as a command that fails later.
 *
 * The probes run in a private temporary repository created for the purpose. They
 * never touch the user's repositories, never reach the network (the "remote" is a
 * local bare repository), and never read a credential or a keychain entry. When a
 * probe cannot run at all, that is reported as `unavailable` with the reason — an
 * absent answer is never reported as a working feature.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCapabilities, ObjectFormat } from "@refyard/git-contract";
import { CatFileDecoder, type GitCommandSpec } from "@refyard/git-core";
import { runGit } from "./runner.js";
import { defaultLimits } from "./runner.js";

/** Functional baseline the design commits to; below this, features are gated. */
export const MINIMUM_GIT_VERSION = "2.43.0";

export interface DoctorProbe {
  readonly name: string;
  readonly supported: boolean;
  readonly detail: string;
}

export interface DoctorReport {
  readonly gitPath: string;
  readonly gitVersion: string | null;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly featureVersionSupported: boolean;
  readonly objectFormats: readonly ObjectFormat[];
  /** The subset published in `GET /capabilities`. */
  readonly features: GitCapabilities;
  readonly probes: readonly DoctorProbe[];
  /** Reasons a capability is missing; empty means everything probed worked. */
  readonly reasons: readonly string[];
  readonly executableFound: boolean;
}

export interface DoctorOptions {
  readonly gitPath: string;
  /** Where to create the scratch repository; defaults to the OS temp directory. */
  readonly scratchParent?: string;
  /** Injected for tests that need to force a failure. */
  readonly runCommand?: typeof runGit;
}

/** Compare dotted numeric versions; returns true when `version >= minimum`. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (text: string): number[] =>
    text
      .split(/[.\-\s]/)
      .map((part) => Number.parseInt(part, 10))
      .filter((value) => Number.isFinite(value));
  const left = parse(version);
  const right = parse(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a > b;
    }
  }
  return true;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const run = options.runCommand ?? runGit;
  const probes: DoctorProbe[] = [];
  const reasons: string[] = [];

  const versionOutcome = await run(
    {
      argv: ["--version"],
      cwdHandle: "scratch",
      deadlineClass: "readonly",
      description: "git --version",
    },
    { runId: "doctor-version" },
    {
      gitPath: options.gitPath,
      cwd: process.cwd(),
      limits: defaultLimits("readonly"),
    },
  );
  const executableFound =
    versionOutcome.termination === "exit" && versionOutcome.exitCode === 0;
  const gitVersion = executableFound
    ? new TextDecoder()
        .decode(versionOutcome.stdout)
        .trim()
        .replace(/^git version\s+/, "")
    : null;
  probes.push({
    name: "git-executable",
    supported: executableFound,
    detail: executableFound
      ? (gitVersion ?? "found")
      : "the git executable could not be run",
  });
  if (!executableFound) {
    reasons.push("git could not be executed; no Git feature can be probed");
    return emptyReport(options, probes, reasons, executableFound, gitVersion);
  }

  const scratch = await mkdtemp(
    join(options.scratchParent ?? tmpdir(), "refyard-doctor-"),
  );
  const repo = join(scratch, "repo");
  const remote = join(scratch, "remote.git");
  await mkdir(repo, { recursive: true });

  try {
    const git = async (
      spec: GitCommandSpec,
      cwd: string,
    ): Promise<Awaited<ReturnType<typeof run>>> =>
      run(
        spec,
        { runId: `doctor-${spec.description}` },
        {
          gitPath: options.gitPath,
          cwd,
          limits: defaultLimits(spec.deadlineClass),
        },
      );

    const setup = async (
      argv: readonly string[],
      cwd: string,
    ): Promise<boolean> => {
      const outcome = await git(
        {
          argv,
          cwdHandle: "scratch",
          deadlineClass: "hook",
          description: argv.join(" "),
        },
        cwd,
      );
      return outcome.termination === "exit" && outcome.exitCode === 0;
    };

    if (!(await setup(["init", "--quiet", "--initial-branch=main"], repo))) {
      reasons.push("a temporary repository could not be created");
    }
    await writeFile(join(repo, "probe.txt"), "probe\n");
    await setup(["add", "--", "probe.txt"], repo);
    await setup(
      [
        "-c",
        "user.name=Refyard Doctor",
        "-c",
        "user.email=doctor@refyard.invalid",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "--quiet",
        "--no-verify",
        "-m",
        "probe",
      ],
      repo,
    );
    await setup(
      ["init", "--bare", "--quiet", "--initial-branch=main", remote],
      scratch,
    );
    await setup(["symbolic-ref", "HEAD", "refs/heads/main"], remote);
    await setup(["remote", "add", "origin", remote], repo);

    // 1. status --porcelain=v2 --branch -z
    const statusOutcome = await git(
      {
        argv: [
          "--no-optional-locks",
          "status",
          "--porcelain=v2",
          "--branch",
          "-z",
        ],
        cwdHandle: "scratch",
        deadlineClass: "readonly",
        description: "status --porcelain=v2 --branch -z",
      },
      repo,
    );
    const statusText = new TextDecoder().decode(statusOutcome.stdout);
    const statusSupported =
      statusOutcome.exitCode === 0 && statusText.startsWith("# branch.oid");
    probes.push({
      name: "status-porcelain-v2",
      supported: statusSupported,
      detail: statusSupported
        ? "branch headers and NUL framing present"
        : "no porcelain v2 branch header",
    });
    if (!statusSupported) {
      reasons.push(
        "status --porcelain=v2 is unavailable; the Changes view cannot be served",
      );
    }

    // 2. worktree list --porcelain -z
    const worktreeOutcome = await git(
      {
        argv: ["worktree", "list", "--porcelain", "-z"],
        cwdHandle: "scratch",
        deadlineClass: "readonly",
        description: "worktree list --porcelain -z",
      },
      repo,
    );
    const worktreeText = new TextDecoder().decode(worktreeOutcome.stdout);
    const worktreeSupported =
      worktreeOutcome.exitCode === 0 && worktreeText.includes("worktree ");
    probes.push({
      name: "worktree-list-z",
      supported: worktreeSupported,
      detail: worktreeSupported
        ? "NUL-separated attributes present"
        : "no worktree block was reported",
    });

    // 3. cat-file --batch length framing, against a real object.
    const headOutcome = await git(
      {
        argv: ["rev-parse", "HEAD"],
        cwdHandle: "scratch",
        deadlineClass: "readonly",
        description: "rev-parse HEAD",
      },
      repo,
    );
    const headOid = new TextDecoder().decode(headOutcome.stdout).trim();
    let catFileSupported = false;
    if (headOutcome.exitCode === 0 && headOid.length > 0) {
      const decoder = new CatFileDecoder();
      const catFileOutcome = await git(
        {
          argv: ["cat-file", "--batch"],
          cwdHandle: "scratch",
          deadlineClass: "readonly",
          description: "cat-file --batch",
          stdin: new TextEncoder().encode(`${headOid}\n`),
        },
        repo,
      );
      try {
        const entries = decoder.push(catFileOutcome.stdout);
        catFileSupported = entries.length === 1;
      } catch {
        catFileSupported = false;
      }
    }
    probes.push({
      name: "cat-file-batch",
      supported: catFileSupported,
      detail: catFileSupported
        ? "length-framed object read works"
        : "no framed object came back",
    });
    if (!catFileSupported) {
      reasons.push(
        "cat-file --batch framing is unavailable; commit details cannot be read",
      );
    }

    // 4. push/fetch porcelain, against the local bare remote.
    const pushOutcome = await git(
      {
        argv: [
          "push",
          "--porcelain",
          "origin",
          "refs/heads/main:refs/heads/main",
        ],
        cwdHandle: "scratch",
        deadlineClass: "network",
        description: "push --porcelain",
      },
      repo,
    );
    const pushText = new TextDecoder().decode(pushOutcome.stdout);
    const pushSupported =
      pushOutcome.exitCode === 0 &&
      pushText.includes("To ") &&
      pushText.includes("Done");
    probes.push({
      name: "push-porcelain",
      supported: pushSupported,
      detail: pushSupported
        ? "per-ref porcelain output present"
        : "no porcelain push output",
    });

    const fetchOutcome = await git(
      {
        argv: ["fetch", "--porcelain", "origin"],
        cwdHandle: "scratch",
        deadlineClass: "network",
        description: "fetch --porcelain",
      },
      repo,
    );
    // Nothing to fetch is the expected result here, so success is "Git accepted
    // the option", not "refs moved".
    const fetchSupported = fetchOutcome.exitCode === 0;
    probes.push({
      name: "fetch-porcelain",
      supported: fetchSupported,
      detail: fetchSupported
        ? "accepted and reported no changes"
        : "Git rejected the porcelain option",
    });

    // 5. Repository layout and object format.
    const layoutOutcome = await git(
      {
        argv: [
          "rev-parse",
          "--path-format=absolute",
          "--absolute-git-dir",
          "--git-common-dir",
          "--show-toplevel",
          "--is-bare-repository",
          "--show-object-format",
          "--is-shallow-repository",
        ],
        cwdHandle: "scratch",
        deadlineClass: "readonly",
        description: "rev-parse layout",
      },
      repo,
    );
    const layoutText = new TextDecoder().decode(layoutOutcome.stdout).trim();
    const layoutLines = layoutText.split("\n");
    const objectFormats: ObjectFormat[] =
      layoutLines[4] === "sha256" ? ["sha1", "sha256"] : ["sha1"];
    probes.push({
      name: "repository-layout",
      supported: layoutLines.length === 6,
      detail:
        layoutLines.length === 6
          ? `object format ${layoutLines[4] ?? "?"}`
          : "unexpected layout output",
    });

    const featureVersionSupported =
      gitVersion !== null && versionAtLeast(gitVersion, MINIMUM_GIT_VERSION);
    if (!featureVersionSupported) {
      reasons.push(
        `git ${gitVersion ?? "unknown"} is below the functional baseline ${MINIMUM_GIT_VERSION}; features are reported per probe`,
      );
    }

    const features: GitCapabilities = {
      porcelainV2Status: statusSupported,
      worktreeListZ: worktreeSupported,
      catFileBatch: catFileSupported,
      pushPorcelain: pushSupported,
      fetchPorcelain: fetchSupported,
      objectFormats,
    };

    return {
      gitPath: options.gitPath,
      gitVersion,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      featureVersionSupported,
      objectFormats,
      features,
      probes,
      reasons,
      executableFound,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function emptyReport(
  options: DoctorOptions,
  probes: DoctorProbe[],
  reasons: string[],
  executableFound: boolean,
  gitVersion: string | null,
): DoctorReport {
  return {
    gitPath: options.gitPath,
    gitVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    featureVersionSupported: false,
    objectFormats: [],
    features: {
      porcelainV2Status: false,
      worktreeListZ: false,
      catFileBatch: false,
      pushPorcelain: false,
      fetchPorcelain: false,
      objectFormats: [],
    },
    probes,
    reasons,
    executableFound,
  };
}
