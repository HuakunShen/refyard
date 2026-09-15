#!/usr/bin/env bun
/**
 * `pnpm bench:runtime` — measure the real service and write the evidence file.
 *
 * What this is: a bounded, reproducible run against a real temporary repository, a real
 * `git`, and the packaged CLI. What it is not: a long-running soak. Every measurement
 * records its own scope (`processScope`, `memoryMetric`, `durationSeconds`), so the report
 * can never be read as something it did not measure — a 30-second run is not a 24-hour
 * one, and this file says so in its own fields rather than in a footnote.
 *
 * The scale is a parameter (`--commits`), and the default is small on purpose: a report
 * with numbers nobody can reproduce in a minute is a report nobody re-runs. The evidence
 * file records the scale that was actually used.
 */
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { publishedEnginesRange, satisfiesEngines } from "./lib/node-engines.js";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stagingRoot = join(repoRoot, "packages", "npm-dist");
const evidencePath = join(repoRoot, "docs", "evidence", "performance.json");

function argument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const commitCount = argument("commits", 100_000);
const readCount = argument("reads", 100);
const readConcurrency = argument("concurrency", 4);
const runCount = argument("runs", 3);

interface Measurement {
  readonly name: string;
  readonly durationSeconds: number;
  /** Which processes the number covers, in words: this is the anti-ambiguity field. */
  readonly processScope: string;
  /** What the memory number means, or "none" when the measurement is time only. */
  readonly memoryMetric: string;
  readonly value: number;
  readonly unit: string;
  readonly notes: string;
}

const measurements: Measurement[] = [];

async function git(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", [...args], { cwd, env, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`git ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

async function runText(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(out);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

/**
 * The byte size of a command's stdout, summed from the raw chunks.
 *
 * Deliberately not `gitText(...).length`: that counts UTF-16 code units of a decoded string,
 * and the numbers below are compared against bytes on the wire.
 */
async function gitByteLength(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise<number>((resolvePromise, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(bytes);
      } else {
        reject(new Error(`git ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

async function gitText(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(out);
      } else {
        reject(new Error(`git ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

const workspace = await mkdtemp(join(tmpdir(), "refyard-bench-"));
const home = join(workspace, "home");
const repository = join(workspace, "repository");
await mkdir(home, { recursive: true });
await mkdir(repository, { recursive: true });

const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "bench",
  GIT_AUTHOR_EMAIL: "bench@localhost",
  GIT_COMMITTER_NAME: "bench",
  GIT_COMMITTER_EMAIL: "bench@localhost",
  GIT_DEFAULT_BRANCH: "main",
};
await writeFile(join(home, ".gitconfig"), "", "utf8");

console.log(
  `bench:runtime: ${commitCount} commits, ${readCount} reads at concurrency ${readConcurrency}`,
);

// Resolved from PATH, and checked, rather than taken from `process.execPath`:
// this script runs under bun, whose execPath and version describe bun, not the
// Node that the published CLI supports. A report that named the wrong runtime
// would be evidence for a platform that was never measured.
const node = "node";
const nodeVersionText = (
  await runText(node, ["--version"], { env, cwd: workspace })
).trim();
// The range comes from the manifest, not from a favourite major written here: the report
// has to describe a runtime the *published promise* covers, and the promise is `engines`
// in `packages/npm-dist/package.json`. Only the `>=A.B <C` shape is understood; anything
// else is reported instead of waved through.
const enginesRange = await publishedEnginesRange(stagingRoot);
const insideRange = satisfiesEngines(enginesRange, nodeVersionText);
if (insideRange !== true) {
  throw new Error(
    `bench:runtime: the Node on PATH is ${nodeVersionText}; the published engines range is ` +
      `"${enginesRange}"` +
      (insideRange === null
        ? " (a shape this check does not understand)"
        : "") +
      " and the report must describe a runtime users can run it on",
  );
}
console.log(`  runtime: node ${nodeVersionText.replace(/^v/, "")}`);

/**
 * Build the fixture history with `git fast-import`.
 *
 * The history is the point of the fixture, and building it through three
 * processes per commit puts the sizes worth measuring (10k and up) out of reach
 * of a run anyone repeats. fast-import is the same Git writing the same objects
 * into the same repository, in one process: a real history, not a stub.
 */
async function buildFixture(commits: number): Promise<void> {
  const stream = spawn("git", ["fast-import", "--quiet", "--force"], {
    cwd: repository,
    env,
    stdio: ["pipe", "ignore", "pipe"],
  });
  let failure = "";
  stream.stderr.on("data", (chunk: Buffer) => {
    failure += chunk.toString("utf8");
  });
  const ended = new Promise<void>((resolvePromise, reject) => {
    stream.on("error", reject);
    stream.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`git fast-import exited ${code}: ${failure}`));
      }
    });
  });

  // One batch per thousand commits, awaiting drain: a single write of the whole
  // stream would buffer the entire history in this process's memory.
  const batch = 1000;
  for (let start = 0; start < commits; start += batch) {
    const lines: string[] = [];
    const end = Math.min(start + batch, commits);
    for (let index = start; index < end; index += 1) {
      const content = `line ${index}\n`;
      const message = `commit ${index}\n`;
      const timestamp = 1_600_000_000 + index * 60;
      lines.push(
        `blob\nmark :${index * 10 + 1}\ndata ${Buffer.byteLength(content)}\n${content}`,
        `commit refs/heads/main\nmark :${index * 10 + 2}\n` +
          `author bench <bench@localhost> ${timestamp} +0000\n` +
          `committer bench <bench@localhost> ${timestamp} +0000\n` +
          `data ${Buffer.byteLength(message)}\n${message}` +
          `M 100644 :${index * 10 + 1} file.txt\n`,
      );
    }
    const written = stream.stdin.write(lines.join(""));
    if (!written) {
      await new Promise<void>((resolvePromise) =>
        stream.stdin.once("drain", resolvePromise),
      );
    }
  }
  stream.stdin.end();
  await ended;

  // A checkout, because the reads being measured are of a repository someone
  // would recognize: a working tree matching HEAD and a packed object store.
  await git(repository, ["checkout", "--force", "main"], env);
  await git(repository, ["repack", "-adq"], env);
}

const checkoutStart = Date.now();
await git(repository, ["init", "--quiet", "--initial-branch=main"], env);
await buildFixture(commitCount);
const checkoutSeconds = (Date.now() - checkoutStart) / 1000;

// The fixture is counted, not assumed: a history that silently came out smaller
// would make every read measurement below a number about a different repository.
const builtCommits = Number.parseInt(
  (await gitText(repository, ["rev-list", "--count", "HEAD"], env)).trim(),
  10,
);
if (builtCommits !== commitCount) {
  throw new Error(
    `the fixture has ${builtCommits} commits, expected ${commitCount}: ` +
      "the measurements would describe a different repository than the report claims",
  );
}
const dirty = await gitText(repository, ["status", "--porcelain"], env);
if (dirty.trim().length > 0) {
  throw new Error(
    "the fixture working tree is not clean; status reads would not be representative",
  );
}
console.log(
  `  fixture built in ${checkoutSeconds.toFixed(1)}s: ${builtCommits} commits, clean tree`,
);

/**
 * The diff fixture: the shapes that a line-oriented parser, a per-file round trip, or a bound
 * gets wrong.
 *
 * The sizes are fixture policy, not measurements. `large` and `long-line` are sized so their
 * patches arrive **complete**, `truncated` is sized so its patch crosses the contract's per-file
 * bound and comes back cut with `truncated: true`, and `many` is what per-file overhead looks
 * like. Every file changes between the baseline commit and the working tree, so the patch bytes
 * are exactly what the read has to produce.
 *
 * A full rewrite produces two patch lines per changed line, and the contract bounds a patch by
 * **lines** (20,000) as well as bytes (2 MiB) — for this shape the line bound is the one that
 * binds first, which is why `large` is 8,000 lines and not "just under 2 MiB".
 */
const diffRepository = join(workspace, "diff-repository");
const LARGE_LINES = 8_000;
const TRUNCATED_LINES = 32_000;
const LONG_LINE_CHARS = 700_000;
/**
 * Deliberately below the service's change-set listing bound (200 files): with more than that,
 * every response reports `truncated` because the *path list* was cut, and the flag would stop
 * meaning "the patch was cut" — the two facts would be indistinguishable in one number.
 */
const MANY_FILES = 150;

/** Lines of 51 bytes each, so a full rewrite of N lines is ~102·N bytes of patch. */
function textLines(count: number, tag: string): string {
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(`${tag} ${String(index).padStart(7, "0")} ${"x".repeat(40)}\n`);
  }
  return parts.join("");
}

async function buildDiffFixture(): Promise<UnboundedPatchBytes> {
  await mkdir(join(diffRepository, "many"), { recursive: true });
  const write = async (variant: string): Promise<void> => {
    await writeFile(
      join(diffRepository, "large.txt"),
      textLines(LARGE_LINES, variant),
      "utf8",
    );
    await writeFile(
      join(diffRepository, "truncated.txt"),
      textLines(TRUNCATED_LINES, variant),
      "utf8",
    );
    await writeFile(
      join(diffRepository, "long-line.txt"),
      `${variant.repeat(LONG_LINE_CHARS)}\n`,
      "utf8",
    );
    for (let index = 0; index < MANY_FILES; index += 1) {
      await writeFile(
        join(diffRepository, "many", `file-${index}.txt`),
        textLines(4, `${variant}${index}`),
        "utf8",
      );
    }
  };
  await git(diffRepository, ["init", "--quiet", "--initial-branch=main"], env);
  await write("a");
  await git(diffRepository, ["add", "--all"], env);
  await git(diffRepository, ["commit", "--quiet", "-m", "baseline"], env);
  await write("b");
  // The same patches with nothing bounding them, measured from git's own stdout: this is the
  // number the bounded responses below have to be read against. Measured here, not derived from
  // a bytes-per-line estimate — an estimate would carry my model of the patch format into the
  // report as if it were a measurement.
  return {
    large: await gitByteLength(
      diffRepository,
      ["diff", "--no-color", "--", "large.txt"],
      env,
    ),
    truncated: await gitByteLength(
      diffRepository,
      ["diff", "--no-color", "--", "truncated.txt"],
      env,
    ),
    longLine: await gitByteLength(
      diffRepository,
      ["diff", "--no-color", "--", "long-line.txt"],
      env,
    ),
  };
}

interface UnboundedPatchBytes {
  readonly large: number;
  readonly truncated: number;
  readonly longLine: number;
}

const diffFixtureStart = Date.now();
const unboundedPatchBytes = await buildDiffFixture();
const diffChanged = (
  await gitText(diffRepository, ["status", "--porcelain"], env)
)
  .split("\n")
  .filter((line) => line.trim().length > 0).length;
if (diffChanged !== MANY_FILES + 3) {
  throw new Error(
    `the diff fixture changed ${diffChanged} paths, expected ${MANY_FILES + 3}: ` +
      "the measurements below would describe a different repository than the report claims",
  );
}
console.log(
  `  diff fixture built in ${((Date.now() - diffFixtureStart) / 1000).toFixed(1)}s: ` +
    `${diffChanged} changed paths (${MANY_FILES} small files, large, truncated, long line)`,
);

// The packaged CLI when it exists, so the measurement is of the artifact users install.
const packagedCli = join(stagingRoot, "dist", "cli.mjs");
const devCli = join(repoRoot, ".refyard-dev", "cli.mjs");
let cliPath = devCli;
for (const candidate of [packagedCli, devCli]) {
  try {
    await readFile(candidate);
    cliPath = candidate;
    break;
  } catch {
    continue;
  }
}

const artifactMtime = (await stat(cliPath)).mtimeMs;
const buildInfo = await readBuildInfo(cliPath);
if (cliPath === packagedCli) {
  const newestSource = await newestSourceMtime();
  if (newestSource.mtimeMs > artifactMtime) {
    throw new Error(
      `the packaged artifact is older than its sources (${newestSource.path} is newer): ` +
        "every number below would describe a build nobody has. Run `pnpm build:release` first.",
    );
  }
}
// Read from the repository itself, not from the artifact's own claim: the stamp records the
// commit the build saw, and uncommitted changes at that moment would make the artifact
// unreproducible from that commit without the stamp being wrong.
const headRevision = (
  await gitText(repoRoot, ["rev-parse", "--short", "HEAD"], process.env)
).trim();
const workingTreeDirty =
  (await gitText(repoRoot, ["status", "--porcelain"], process.env)).trim()
    .length > 0;

/**
 * The newest modification time under the directories the CLI bundle is built from.
 *
 * The report's numbers belong to the artifact that answered the requests, and an artifact older
 * than its sources describes a build nobody has: the revision it claims would not be the code
 * that produced these numbers. The list names the bundle's inputs, not every directory in the
 * repository — a change to the web app does not make this artifact stale.
 */
async function newestSourceMtime(): Promise<{
  readonly path: string;
  readonly mtimeMs: number;
}> {
  const roots = [
    "apps/cli/src",
    "packages/git-contract/src",
    "packages/git-core/src",
    "packages/git-graph/src",
    "packages/git-client/src",
    "packages/host-node/src",
  ];
  let newest = { path: "(none)", mtimeMs: 0 };
  for (const root of roots) {
    const directory = join(repoRoot, root);
    let entries;
    try {
      entries = await readdir(directory, {
        recursive: true,
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const file = join(entry.parentPath, entry.name);
      const stats = await stat(file);
      if (stats.mtimeMs > newest.mtimeMs) {
        newest = { path: relative(repoRoot, file), mtimeMs: stats.mtimeMs };
      }
    }
  }
  return newest;
}

/** The stamp `scripts/build-release.ts` writes next to the bundle, or null for the dev bundle. */
interface BuildInfo {
  readonly builtAt?: string;
  readonly gitCommit?: string;
  readonly node?: string;
  readonly bundleBytes?: number;
}

async function readBuildInfo(artifactPath: string): Promise<BuildInfo | null> {
  try {
    return JSON.parse(
      await readFile(join(dirname(artifactPath), "build-info.json"), "utf8"),
    ) as BuildInfo;
  } catch {
    return null;
  }
}

/** One service lifecycle: spawn, read, shut down. */
interface DiffSamples {
  /** One diff read of the large file: a patch that arrives complete. */
  readonly largeMs: number;
  readonly largeBytes: number;
  /** Whether the service reported that patch as cut (it must not be, for this shape). */
  readonly largeLines: number;
  /** What the response said about that patch: it must be false, i.e. nothing was cut. */
  readonly largeTruncated: boolean;
  /** The same read again, immediately: what a cache is worth, if anything. */
  readonly secondReadMs: number;
  /** The single very long line: where a line-oriented parser pays. */
  readonly longLineMs: number;
  readonly longLineBytes: number;
  readonly longLineLines: number;
  /** One request covering every changed path. */
  readonly manyMs: number;
  readonly manyBytes: number;
  /** A rewrite whose patch crosses the per-file bound: the bounded answer. */
  readonly truncatedMs: number;
  readonly truncatedBytes: number;
  readonly truncatedLines: number;
  /** What the response said about that patch: it must be true, and the two flags must differ. */
  readonly boundedTruncated: boolean;
  /** Resident memory of the diff service before and after the batch above. */
  readonly rssAfterStartDiff: number | null;
  readonly rssAfterDiff: number | null;
  /** One sequential status read on this service, then one against the other service. */
  readonly sameServiceStatusMs: number;
  readonly switchMs: number;
}

interface RunSamples {
  readonly coldStartSeconds: number;
  readonly rssAfterStart: number | null;
  readonly readSeconds: number;
  readonly rssAfterReads: number | null;
  readonly historySeconds: number;
  readonly historyTruncated: boolean;
  readonly shutdownSeconds: number;
  readonly diff: DiffSamples;
}

function rssOf(pid: number | undefined): Promise<number | null> {
  return new Promise<number | null>((resolvePromise) => {
    const ps = spawn("ps", ["-o", "rss=", "-p", String(pid ?? 0)], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    ps.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    ps.on("exit", () => {
      const parsed = Number.parseInt(out.trim(), 10);
      resolvePromise(Number.isFinite(parsed) ? parsed : null);
    });
  });
}

interface ServiceHandle {
  readonly pid: number | undefined;
  readonly origin: string;
  readonly token: string;
  readonly repositoryId: string;
  readonly headers: Readonly<Record<string, string>>;
  stop(): Promise<void>;
}

/** Start the packaged CLI against one repository, wait for readiness, and pair. */
async function startService(repositoryPath: string): Promise<ServiceHandle> {
  const child = spawn(
    node,
    [
      cliPath,
      "serve",
      "--no-open",
      "--port",
      "0",
      "--repo",
      repositoryPath,
      "--json",
    ],
    { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] as const },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const waitForReady = async (): Promise<{
    port: number;
    repositoryId: string;
  }> => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const line = stdout
        .split("\n")
        .find((candidate) => candidate.trim().startsWith("{"));
      if (line !== undefined) {
        return JSON.parse(line) as { port: number; repositoryId: string };
      }
      if (child.exitCode !== null) {
        throw new Error(`the service exited ${child.exitCode}: ${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`no readiness within 60s: ${stderr}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  };

  const ready = await waitForReady();
  const origin = `http://127.0.0.1:${ready.port}`;
  // The ticket is printed on stderr and nothing orders it against stdout's readiness line, so an
  // exchange that fired early carried an empty ticket, got a 401, and left every later read
  // unauthorized — a harness race that reads exactly like an auth failure in the product. Wait
  // for the ticket, and check the exchange instead of trusting it.
  const ticketFrom = (text: string): string | undefined =>
    /pair=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  let ticket = ticketFrom(stderr);
  const ticketDeadline = Date.now() + 10_000;
  while (ticket === undefined && Date.now() < ticketDeadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    ticket = ticketFrom(stderr);
  }
  if (ticket === undefined) {
    throw new Error(`no pairing ticket within 10s: ${stderr}`);
  }
  const exchanged = await fetch(`${origin}/api/v1/session/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ ticket }),
  });
  if (!exchanged.ok) {
    throw new Error(
      `the ticket exchange answered ${exchanged.status}: ${await exchanged.text()}`,
    );
  }
  const { token } = (await exchanged.json()) as { token: string };
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("the ticket exchange answered without a token");
  }

  return {
    pid: child.pid,
    origin,
    token,
    repositoryId: ready.repositoryId,
    headers: { authorization: `Bearer ${token}`, origin },
    async stop(): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      const exited = new Promise<void>((resolvePromise) => {
        child.once("exit", () => resolvePromise());
      });
      child.kill("SIGTERM");
      await exited;
    },
  };
}

interface DiffRead {
  readonly ms: number;
  readonly bytes: number;
  readonly truncated: boolean;
  /** Patch lines actually delivered for the requested path: the completeness signal. */
  readonly patchLines: number;
  readonly body: {
    readonly files?: readonly {
      readonly pathId: string;
      readonly patch?: {
        readonly kind?: string;
        readonly reason?: string;
        readonly hunks?: readonly {
          readonly lines?: readonly unknown[];
        }[];
      };
    }[];
  };
}

async function readDiff(
  service: ServiceHandle,
  query: string,
): Promise<DiffRead> {
  const started = Date.now();
  const response = await fetch(
    `${service.origin}/api/v1/diff?repositoryId=${service.repositoryId}&${query}`,
    { headers: service.headers },
  );
  const text = await response.text();
  const body = JSON.parse(text) as DiffRead["body"] & { truncated?: boolean };
  return {
    ms: (Date.now() - started) / 1000,
    bytes: Buffer.byteLength(text),
    truncated: body.truncated === true,
    // The response reports bounds with a boolean and does not carry the limitation text, so
    // completeness is measured from the patch itself: lines delivered vs lines expected.
    patchLines: (body.files ?? []).reduce(
      (total, file) =>
        total +
        (file.patch?.hunks ?? []).reduce(
          (hunkTotal, hunk) => hunkTotal + (hunk.lines ?? []).length,
          0,
        ),
      0,
    ),
    body,
  };
}

/**
 * The diff batch, against the second service.
 *
 * A diff is asked for by path id, and path ids come from a status read — the same two round trips
 * a UI makes when a user opens a file. The oversize read is expected to degrade; the measurement
 * is what that costs and how small the answer is, not that it succeeded.
 */
async function diffPhase(other: ServiceHandle): Promise<DiffSamples> {
  const service = await startService(diffRepository);
  try {
    const rssAfterStartDiff = await rssOf(service.pid);
    const statusStarted = Date.now();
    const status = await fetch(
      `${service.origin}/api/v1/status?repositoryId=${service.repositoryId}`,
      { headers: service.headers },
    );
    const statusBody = (await status.json()) as {
      entries: readonly { pathId: string; displayPath: string }[];
    };
    void statusStarted;
    const pathIdFor = (suffix: string): string =>
      statusBody.entries.find((entry) => entry.displayPath.endsWith(suffix))
        ?.pathId ?? "";

    const large = await readDiff(
      service,
      `kind=unstaged&pathId=${pathIdFor("large.txt")}`,
    );
    const secondLarge = await readDiff(
      service,
      `kind=unstaged&pathId=${pathIdFor("large.txt")}`,
    );
    const longLine = await readDiff(
      service,
      `kind=unstaged&pathId=${pathIdFor("long-line.txt")}`,
    );
    const many = await readDiff(service, "kind=unstaged");
    const truncated = await readDiff(
      service,
      `kind=unstaged&pathId=${pathIdFor("truncated.txt")}`,
    );
    const rssAfterDiff = await rssOf(service.pid);

    // The switch, measured against its own control: one sequential status read on this
    // service, then one against the other service, so the difference is the switch and
    // not "sequential read versus four concurrent ones".
    const sameStarted = Date.now();
    await fetch(
      `${service.origin}/api/v1/status?repositoryId=${service.repositoryId}`,
      { headers: service.headers },
    ).then((response) => response.arrayBuffer());
    const sameServiceStatusMs = (Date.now() - sameStarted) / 1000;
    const switchStarted = Date.now();
    await fetch(
      `${other.origin}/api/v1/status?repositoryId=${other.repositoryId}`,
      { headers: other.headers },
    ).then((response) => response.arrayBuffer());
    const switchMs = (Date.now() - switchStarted) / 1000;

    return {
      largeMs: large.ms,
      largeBytes: large.bytes,
      largeLines: large.patchLines,
      largeTruncated: large.truncated,
      secondReadMs: secondLarge.ms,
      longLineMs: longLine.ms,
      longLineBytes: longLine.bytes,
      longLineLines: longLine.patchLines,
      manyMs: many.ms,
      manyBytes: many.bytes,
      truncatedMs: truncated.ms,
      truncatedBytes: truncated.bytes,
      truncatedLines: truncated.patchLines,
      boundedTruncated: truncated.truncated,
      rssAfterStartDiff,
      rssAfterDiff,
      sameServiceStatusMs,
      switchMs,
    };
  } finally {
    await service.stop();
  }
}

async function once(): Promise<RunSamples> {
  const coldStart = Date.now();
  const primary = await startService(repository);
  try {
    const coldStartSeconds = (Date.now() - coldStart) / 1000;
    const rssAfterStart = await rssOf(primary.pid);

    // Reads: the same endpoint the UI polls, at a fixed concurrency.
    let issued = 0;
    const readStart = Date.now();
    const reader = async (): Promise<void> => {
      for (;;) {
        if (issued >= readCount) {
          return;
        }
        issued += 1;
        const response = await fetch(
          `${primary.origin}/api/v1/status?repositoryId=${primary.repositoryId}`,
          { headers: primary.headers },
        );
        await response.arrayBuffer();
        if (response.status !== 200) {
          throw new Error(`status read answered ${response.status}`);
        }
      }
    };
    await Promise.all(Array.from({ length: readConcurrency }, () => reader()));
    const readSeconds = (Date.now() - readStart) / 1000;
    const rssAfterReads = await rssOf(primary.pid);

    const historyStart = Date.now();
    const history = await fetch(
      `${primary.origin}/api/v1/history?repositoryId=${primary.repositoryId}&limit=100`,
      { headers: primary.headers },
    );
    const historyBody = (await history.json()) as { truncated?: boolean };
    const historySeconds = (Date.now() - historyStart) / 1000;

    const diff = await diffPhase(primary);

    const shutdownStart = Date.now();
    await primary.stop();
    const shutdownSeconds = (Date.now() - shutdownStart) / 1000;

    return {
      coldStartSeconds,
      rssAfterStart,
      readSeconds,
      rssAfterReads,
      historySeconds,
      historyTruncated: historyBody.truncated === true,
      shutdownSeconds,
      diff,
    };
  } finally {
    // A run that failed midway keeps its service: the number it was measuring is already
    // lost, and a process left behind outlives the report.
    await primary.stop();
  }
}

const samples: RunSamples[] = [];
for (let index = 0; index < runCount; index += 1) {
  samples.push(await once());
}
console.log(`  ${samples.length} lifecycle run(s) measured`);

// The fixture is checked the way the commit count is, and from the payload rather than from the
// response's `truncated` flag: that flag is also set when the change-set list itself is bounded,
// so it cannot tell a complete patch from a cut one.
const expectedLargeLines = 2 * LARGE_LINES;
const expectedTruncatedLines = 2 * TRUNCATED_LINES;
if (samples.some((sample) => sample.diff.largeLines !== expectedLargeLines)) {
  throw new Error(
    `the large patch delivered ${samples.map((sample) => sample.diff.largeLines).join("/")} lines, ` +
      `expected ${expectedLargeLines}: a report must not call a cut patch complete`,
  );
}
if (
  samples.some(
    (sample) =>
      sample.diff.truncatedLines === 0 ||
      sample.diff.truncatedLines >= expectedTruncatedLines,
  )
) {
  throw new Error(
    `the bounded patch delivered ${samples.map((sample) => sample.diff.truncatedLines).join("/")} lines ` +
      `of ${expectedTruncatedLines}, so it was not bounded: the fixture no longer crosses the bound`,
  );
}
// The flag has to separate the two shapes, or the report cannot say it did: a flag that is
// true for a complete patch and for a cut one distinguishes nothing. Both directions are
// asserted, because only the pair makes "the response said so" a meaningful sentence.
if (samples.some((sample) => sample.diff.largeTruncated)) {
  throw new Error(
    "a complete patch was reported truncated, so the flag cannot mark a bounded answer either",
  );
}
if (samples.some((sample) => !sample.diff.boundedTruncated)) {
  throw new Error(
    "the bounded patch was not reported truncated, so the response does not say when it cut one",
  );
}
console.log(
  `  patch completeness: ${expectedLargeLines} of ${expectedLargeLines} lines delivered for the large ` +
    `shape; ${samples[0]?.diff.truncatedLines ?? 0} of ${expectedTruncatedLines} for the bounded one ` +
    `(truncated=false/true, as asserted)`,
);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted.at(middle) ?? 0;
  const lower =
    sorted.length % 2 === 0 ? (sorted.at(middle - 1) ?? upper) : upper;
  return (lower + upper) / 2;
}

function spread(values: readonly number[]): string {
  if (values.length === 1) {
    return "single run";
  }
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return `median of ${values.length} runs, range ${round(Math.min(...values))}–${round(Math.max(...values))}`;
}

/** Record one measurement from per-run samples, or skip it when a run had no sample. */
function record(
  details: Omit<Measurement, "value" | "durationSeconds" | "notes"> & {
    readonly pick: (sample: RunSamples) => number | null;
    readonly window: (sample: RunSamples) => number;
    readonly round: (value: number) => number;
    readonly notes: (summary: string) => string;
  },
  runSamples: readonly RunSamples[],
): void {
  const picked = runSamples
    .map((sample) => details.pick(sample))
    .filter((value): value is number => value !== null);
  if (picked.length === 0) {
    return;
  }
  const windowSeconds = median(
    runSamples.map((sample) => details.window(sample)),
  );
  measurements.push({
    name: details.name,
    durationSeconds: Math.round(windowSeconds * 1000) / 1000,
    processScope: details.processScope,
    memoryMetric: details.memoryMetric,
    value: details.round(median(picked)),
    unit: details.unit,
    notes: details.notes(spread(picked)),
  });
}

record(
  {
    name: "cold-start-to-ready",
    window: (sample) => sample.coldStartSeconds,
    processScope:
      "refyard CLI process: spawn → listener up → readiness object printed (Git feature probe included)",
    memoryMetric: "none",
    unit: "seconds",
    pick: (sample) => sample.coldStartSeconds,
    round: (value) => Math.round(value * 1000) / 1000,
    notes: (summary) =>
      `Includes the doctor-style Git feature probe at startup; excludes building the fixture. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "service-rss-after-start",
    window: (sample) => sample.readSeconds,
    processScope:
      "the refyard service process only (ps -o rss), after readiness and before any read",
    memoryMetric: "resident set size of that process, as reported by ps",
    unit: "MiB",
    pick: (sample) =>
      sample.rssAfterStart === null ? null : sample.rssAfterStart / 1024,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Excludes the browser and excludes any Git process. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "status-read-throughput",
    window: (sample) => sample.readSeconds,
    processScope:
      "one refyard service process over loopback HTTP; each read runs `git status --porcelain=v2 --branch -z` plus the index read",
    memoryMetric: "none",
    unit: "reads/second",
    pick: (sample) => readCount / sample.readSeconds,
    round: (value) => Math.round(value * 10) / 10,
    notes: (summary) =>
      `At concurrency ${readConcurrency} against a ${commitCount}-commit repository on this machine. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "service-rss-after-reads",
    window: (sample) => sample.readSeconds,
    processScope:
      "the refyard service process only, after the read batch above",
    memoryMetric: "resident set size of that process, as reported by ps",
    unit: "MiB",
    pick: (sample) =>
      sample.rssAfterReads === null ? null : sample.rssAfterReads / 1024,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `After ${readCount} reads at concurrency ${readConcurrency}. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "history-first-page",
    window: (sample) => sample.historySeconds,
    // The lane fold is not in this number: `packages/git-graph` runs in the browser,
    // and the service never computes lanes.
    processScope:
      "one refyard service process: `git log` for one page, parsed into commit summaries",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.historySeconds * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Page size 100 of ${commitCount} commits; the response is bounded by the contract's page limit ` +
      `(truncated in ${samples.filter((sample) => sample.historyTruncated).length} of ${samples.length} runs). ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-large-file",
    window: (sample) => sample.diff.largeMs,
    processScope:
      `a second refyard service process, one repository with uncommitted changes: one \`git diff\` of a ` +
      `${LARGE_LINES}-line file, parsed into hunks`,
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.largeMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Every patch line delivered (${2 * LARGE_LINES} of ${2 * LARGE_LINES}; the run fails if a run delivers fewer), ` +
      `and the response also carries every changed path's metadata. The same patch as git prints it is ` +
      `${Math.round(unboundedPatchBytes.large / 1024)} KiB; the response is ${Math.round(median(samples.map((sample) => sample.diff.largeBytes)) / 1024)} KiB, ` +
      `because each line travels as a {kind,text,noNewline} object. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-large-file-payload",
    window: (sample) => sample.diff.largeMs,
    processScope:
      "the same response as diff-large-file, measured as the bytes on the wire",
    memoryMetric: "none",
    unit: "bytes",
    pick: (sample) => sample.diff.largeBytes,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `This is the number a streaming design would move, not remove: a browser parses these bytes either way. ` +
      `Almost half of it is the per-line JSON envelope rather than file content. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "graceful-shutdown",
    window: (sample) => sample.shutdownSeconds,
    processScope:
      "the first service process: SIGTERM to exit, with no request in flight",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.shutdownSeconds * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `After a full read batch and a diff batch on other services. The bounded drain window ` +
      `applies only when a request is in flight, so this is the floor. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-large-file-second-read",
    window: (sample) => sample.diff.secondReadMs,
    processScope:
      "the same read again, immediately, against the same service (cache warm)",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.secondReadMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Compared with diff-large-file this is what the service's read cache is worth, not what Git costs. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-long-line",
    window: (sample) => sample.diff.longLineMs,
    processScope: `a second refyard service process: one \`git diff\` of a single ${LONG_LINE_CHARS}-character line`,
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.longLineMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `The minified-file shape: one line with no newlines to split on, carried complete ` +
      `(${samples[0]?.diff.longLineLines ?? 0} patch lines for a single line, ` +
      `${Math.round(unboundedPatchBytes.longLine / 1024)} KiB of patch text). ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-long-line-payload",
    window: (sample) => sample.diff.longLineMs,
    processScope:
      "the same response as diff-long-line, measured as the bytes on the wire",
    memoryMetric: "none",
    unit: "bytes",
    pick: (sample) => sample.diff.longLineBytes,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `One ${LONG_LINE_CHARS}-character line, both sides of the rewrite: ${Math.round(unboundedPatchBytes.longLine / 1024)} KiB ` +
      `of patch text. No hunk can be streamed line by line here — the unit a streaming design would ` +
      `hand over is either this whole line or an offset into it. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-many-files",
    window: (sample) => sample.diff.manyMs,
    processScope: `a second refyard service process: one diff request covering ${MANY_FILES} changed files`,
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.manyMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Per-file share is in the note's first number divided by ${MANY_FILES} (${Math.round((median(samples.map((sample) => sample.diff.manyMs * 1000)) / MANY_FILES) * 100) / 100} ms each). ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-many-files-payload",
    window: (sample) => sample.diff.manyMs,
    processScope: `the same response as diff-many-files, measured as the bytes on the wire`,
    memoryMetric: "none",
    unit: "bytes",
    pick: (sample) => sample.diff.manyBytes,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Across ${MANY_FILES} files, i.e. ${Math.round(median(samples.map((sample) => sample.diff.manyBytes)) / MANY_FILES)} bytes per file. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-truncated-patch",
    window: (sample) => sample.diff.truncatedMs,
    processScope:
      "a second refyard service process: one `git diff` whose patch crosses the per-file bound, answered bounded",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.truncatedMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `The service delivered ${samples.map((sample) => sample.diff.truncatedLines).join("/")} of ` +
      `${2 * TRUNCATED_LINES} patch lines and reported the response truncated in every run ` +
      `(asserted above): a bounded answer, not a failure. The complete patch is ` +
      `${Math.round((unboundedPatchBytes.truncated / 1024 / 1024) * 10) / 10} MB of patch text. ` +
      `The response names no limit — that string is computed and dropped (see the note in plan 0003's R2). ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-truncated-patch-payload",
    window: (sample) => sample.diff.truncatedMs,
    processScope:
      "the same response as diff-truncated-patch, measured as the bytes on the wire",
    memoryMetric: "none",
    unit: "bytes",
    pick: (sample) => sample.diff.truncatedBytes,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `What one bounded path costs on the wire, against the ` +
      `${Math.round((unboundedPatchBytes.truncated / 1024 / 1024) * 10) / 10} MB patch git produces for it ` +
      `with nothing in the way. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-service-rss-after-start",
    window: (sample) => sample.diff.largeMs,
    processScope:
      "the second refyard service process only, before any diff was read",
    memoryMetric: "resident set size of that process, as reported by ps",
    unit: "MiB",
    pick: (sample) =>
      sample.diff.rssAfterStartDiff === null
        ? null
        : sample.diff.rssAfterStartDiff / 1024,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `The baseline for the batch below; it serves the diff fixture, not the ${commitCount}-commit one. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "diff-service-rss-after-batch",
    window: (sample) => sample.diff.largeMs,
    processScope:
      "the second refyard service process only, after the diff batch above",
    memoryMetric: "resident set size of that process, as reported by ps",
    unit: "MiB",
    pick: (sample) =>
      sample.diff.rssAfterDiff === null
        ? null
        : sample.diff.rssAfterDiff / 1024,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `Growth over diff-service-rss-after-start: ${Math.round((median(samples.map((sample) => (sample.diff.rssAfterDiff ?? 0) / 1024)) - median(samples.map((sample) => (sample.diff.rssAfterStartDiff ?? 0) / 1024))) * 10) / 10} MiB for a batch that read a complete ~${Math.round((LARGE_LINES * 102 * 2) / 1024 / 1024)} MB patch, a bounded one, a long line, and every changed path's metadata. ${summary}.`,
  },
  samples,
);

record(
  {
    name: "status-after-switching-services",
    window: (sample) => sample.diff.switchMs,
    processScope:
      "two refyard service processes: a status read against the first, immediately after the second one answered",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.diff.switchMs * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `A sequential status read on the first service measured in the same position was ` +
      `${Math.round(median(samples.map((sample) => sample.diff.sameServiceStatusMs * 1000)))} ms, so this number is what talking to a different process costs. ${summary}.`,
  },
  samples,
);

const gitVersion = await new Promise<string>((resolvePromise) => {
  const child = spawn("git", ["--version"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  let out = "";
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  child.on("exit", () => resolvePromise(out.trim()));
});

const report = {
  kind: "refyard-performance-report",
  measuredAt: new Date().toISOString(),
  runtime: {
    // The runtime that actually ran the CLI, read from that binary: `process`
    // here belongs to the bun running this script, not to the service.
    kind: "node",
    version: nodeVersionText.replace(/^v/, ""),
    platform: process.platform,
    arch: process.arch,
    launched: `${node} ${relative(repoRoot, cliPath)}`,
  },
  gitVersion: gitVersion.replace(/^git version /, ""),
  artifact: {
    path: relative(repoRoot, cliPath),
    modifiedAt: new Date(artifactMtime).toISOString(),
    /** The artifact's own build-info.json, verbatim; null for the dev bundle, which has none. */
    buildInfo,
    /** The checkout's revision, and whether uncommitted changes were present while measuring. */
    headRevision,
    workingTreeDirty,
  },
  fixture: {
    commits: commitCount,
    repository: "one temporary repository, one file, linear history",
    isolation: "own HOME and GIT_CONFIG_GLOBAL; no network",
  },
  // The diff shapes with their scale as fields, not only in prose notes: the numbers that make
  // "a bounded answer" checkable after the fact — a run whose patch fit inside the bound would
  // otherwise be indistinguishable from one that crossed it.
  diffFixture: {
    changedPaths: diffChanged,
    manyFiles: MANY_FILES,
    largeLines: LARGE_LINES,
    truncatedLines: TRUNCATED_LINES,
    truncatedPatchLines: 2 * TRUNCATED_LINES,
    deliveredTruncatedLines: samples[0]?.diff.truncatedLines ?? 0,
    longLineChars: LONG_LINE_CHARS,
    unboundedPatchBytes,
  },
  methodology: {
    repeated: runCount > 1,
    runs: samples.length,
    concurrency: readConcurrency,
    statistic:
      runCount > 1
        ? "median across runs, with the observed range in each note"
        : "single run",
    caveat:
      "A short repeated run on one machine, not a soak test. Every measurement names the processes it covers; nothing here is a 24-hour figure or a claim about other hardware.",
  },
  measurements,
};

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await rm(workspace, { recursive: true, force: true });

console.log(`bench:runtime: wrote ${evidencePath}`);
for (const measurement of measurements) {
  console.log(
    `  ${measurement.name}: ${measurement.value} ${measurement.unit} (${measurement.durationSeconds.toFixed(2)}s window)`,
  );
}
