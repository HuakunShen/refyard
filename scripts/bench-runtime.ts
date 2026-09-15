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
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const nodeMajor = Number.parseInt(nodeVersionText.replace(/^v/, ""), 10);
if (nodeMajor !== 26) {
  throw new Error(
    `bench:runtime: the Node on PATH is ${nodeVersionText}; refyard publishes engines ">=26 <27" ` +
      "and the report must describe a runtime users can run it on",
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

// The packaged CLI when it exists, so the measurement is of the artifact users install.
const packagedCli = join(repoRoot, "packages", "npm-dist", "dist", "cli.mjs");
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

/** One service lifecycle: spawn, read, shut down. */
interface RunSamples {
  readonly coldStartSeconds: number;
  readonly rssAfterStart: number | null;
  readonly readSeconds: number;
  readonly rssAfterReads: number | null;
  readonly historySeconds: number;
  readonly historyTruncated: boolean;
  readonly shutdownSeconds: number;
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

async function once(): Promise<RunSamples> {
  const coldStart = Date.now();
  const service = spawn(
    node,
    [
      cliPath,
      "serve",
      "--no-open",
      "--port",
      "0",
      "--repo",
      repository,
      "--json",
    ],
    { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] as const },
  );
  let stdout = "";
  let stderr = "";
  service.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  service.stderr.on("data", (chunk: Buffer) => {
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
      if (service.exitCode !== null) {
        throw new Error(`the service exited ${service.exitCode}: ${stderr}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`no readiness within 60s: ${stderr}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
  };

  const ready = await waitForReady();
  const coldStartSeconds = (Date.now() - coldStart) / 1000;
  const rssAfterStart = await rssOf(service.pid);

  const origin = `http://127.0.0.1:${ready.port}`;
  const exchanged = await fetch(`${origin}/api/v1/session/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      ticket: /pair=([A-Za-z0-9_-]+)/.exec(stderr)?.[1] ?? "",
    }),
  });
  const { token } = (await exchanged.json()) as { token: string };

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
        `${origin}/api/v1/status?repositoryId=${ready.repositoryId}`,
        { headers: { authorization: `Bearer ${token}`, origin } },
      );
      await response.arrayBuffer();
      if (response.status !== 200) {
        throw new Error(`status read answered ${response.status}`);
      }
    }
  };
  await Promise.all(Array.from({ length: readConcurrency }, () => reader()));
  const readSeconds = (Date.now() - readStart) / 1000;
  const rssAfterReads = await rssOf(service.pid);

  // History paging: the bounded read a large repository would stress.
  const historyStart = Date.now();
  const history = await fetch(
    `${origin}/api/v1/history?repositoryId=${ready.repositoryId}&limit=100`,
    { headers: { authorization: `Bearer ${token}`, origin } },
  );
  const historyBody = (await history.json()) as { truncated?: boolean };
  const historySeconds = (Date.now() - historyStart) / 1000;

  const shutdownStart = Date.now();
  service.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    service.once("exit", () => resolvePromise());
  });

  return {
    coldStartSeconds,
    rssAfterStart,
    readSeconds,
    rssAfterReads,
    historySeconds,
    historyTruncated: historyBody.truncated === true,
    shutdownSeconds: (Date.now() - shutdownStart) / 1000,
  };
}

const samples: RunSamples[] = [];
for (let index = 0; index < runCount; index += 1) {
  samples.push(await once());
}
console.log(`  ${samples.length} lifecycle run(s) measured`);

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
    processScope:
      "one refyard service process; `git log` for one page plus the graph fold",
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
    name: "graceful-shutdown",
    window: (sample) => sample.shutdownSeconds,
    processScope:
      "the refyard service process, SIGTERM → exit (no in-flight requests)",
    memoryMetric: "none",
    unit: "milliseconds",
    pick: (sample) => sample.shutdownSeconds * 1000,
    round: (value) => Math.round(value),
    notes: (summary) =>
      `The bounded drain window applies only when a request is in flight. ${summary}.`,
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
  fixture: {
    commits: commitCount,
    repository: "one temporary repository, one file, linear history",
    isolation: "own HOME and GIT_CONFIG_GLOBAL; no network",
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
