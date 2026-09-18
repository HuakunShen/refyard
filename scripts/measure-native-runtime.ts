/**
 * `pnpm native:bench` — measured numbers for the acceptance budget table.
 *
 * Every number here comes from running the real release binary against a real fixture
 * repository with a minimal `PATH` (git and ssh reachable, no JavaScript runtime on it),
 * several times, and printing the runs rather than a summary that could hide one. The
 * idle-memory figure is the serve process's own RSS: the CLI has no WebView, so there is
 * no shared-page double counting to caveat — the desktop app's figures are separate and
 * named as launch-only.
 *
 * Results land in `docs/evidence/native-runtime.json` and are printed for the transcript.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepo } from "../tests/support/repo.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(ROOT, "target/release/refyard-native");
const RUNS = 3;

interface Run {
  readonly readyMs: number | null;
  readonly firstStatusMs: number | null;
  readonly historyMs: number | null;
  readonly rssKb: number | null;
  readonly rssAfterWorkKb: number | null;
  readonly note?: string;
}

/** A `PATH` with exactly the programs a native service needs, and nothing else. */
function minimalBinDir(staging: string): string {
  const bin = join(staging, "bin");
  mkdirSync(bin);
  for (const program of ["git", "ssh"]) {
    const resolved = execFileSync("which", [program], {
      encoding: "utf8",
    }).trim();
    symlinkSync(resolved, join(bin, program));
  }
  return bin;
}

import { mkdirSync, symlinkSync } from "node:fs";

function spawnServe(
  binDir: string,
  home: string,
  repoRoot: string,
  stateDir: string,
) {
  const child = spawn(
    CLI,
    ["serve", "--port", "0", "--json", "--no-open", repoRoot],
    {
      env: {
        PATH: `${binDir}:/usr/bin:/bin`,
        HOME: home,
        TMPDIR: tmpdir(),
        LANG: "C",
        REFYARD_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return child;
}

async function oneRun(
  binDir: string,
  repo: Awaited<ReturnType<typeof createRepo>>,
): Promise<Run> {
  const stateDir = await mkdtemp(join(tmpdir(), "refyard-bench-state-"));
  const startedAt = performance.now();
  const child = spawnServe(binDir, repo.home, repo.root, stateDir);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) =>
    stdoutChunks.push(chunk.toString("utf8")),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    stderrChunks.push(chunk.toString("utf8")),
  );

  let readyMs: number | null = null;
  let readiness: { url: string; port: number } | null = null;
  for (let waited = 0; waited < 15_000; waited += 25) {
    const line = stdoutChunks
      .join("")
      .split("\n")
      .find((line) => line.startsWith("{"));
    if (line !== undefined) {
      readiness = JSON.parse(line);
      readyMs = Math.round(performance.now() - startedAt);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (readiness === null) {
    child.kill("SIGTERM");
    return {
      readyMs: null,
      firstStatusMs: null,
      historyMs: null,
      rssKb: null,
      rssAfterWorkKb: null,
      note: `no readiness line; stderr: ${stderrChunks.join("").slice(0, 200)}`,
    };
  }

  // Pair, then time the first status and the first history page.
  const pairingLine = stderrChunks
    .join("")
    .split("\n")
    .find((line) => line.includes("pairing URL (single use): "));
  const ticket = pairingLine?.split("pair=")[1]?.trim() ?? "";
  const exchanged = await fetch(`${readiness.url}/api/v1/session/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: readiness.url },
    body: JSON.stringify({ ticket }),
  });
  const { token } = (await exchanged.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };

  const statusStarted = performance.now();
  const statusAnswer = await fetch(`${readiness.url}/api/v1/repositories`, {
    headers: auth,
  });
  const repositories = (await statusAnswer.json()) as {
    repositories: { repositoryId: string }[];
  };
  await fetch(
    `${readiness.url}/api/v1/status?repositoryId=${repositories.repositories[0]?.repositoryId}`,
    { headers: auth },
  );
  const firstStatusMs = Math.round(performance.now() - statusStarted);

  const historyStarted = performance.now();
  await fetch(
    `${readiness.url}/api/v1/history?repositoryId=${repositories.repositories[0]?.repositoryId}`,
    {
      headers: auth,
    },
  );
  const historyMs = Math.round(performance.now() - historyStarted);

  // Idle memory: five seconds with no traffic, then the serve process's own RSS.
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const rssKb = Number(
    execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
      encoding: "utf8",
    }).trim(),
  );

  // Memory after real work: dirty the worktree, then run status and diff — the reads a
  // person's first minute actually costs — and measure again.
  const repositoryId = repositories.repositories[0]?.repositoryId;
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(
      join(repo.root, "bench-dirty.txt"),
      "dirty for the memory measurement\n",
    ),
  );
  await fetch(`${readiness.url}/api/v1/status?repositoryId=${repositoryId}`, {
    headers: auth,
  });
  await fetch(
    `${readiness.url}/api/v1/diff?repositoryId=${repositoryId}&kind=unstaged`,
    { headers: auth },
  );
  const rssAfterWorkKb = Number(
    execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], {
      encoding: "utf8",
    }).trim(),
  );

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(stateDir, { recursive: true, force: true });
  return { readyMs, firstStatusMs, historyMs, rssKb, rssAfterWorkKb };
}

async function launchAppOnce(
  binDir: string,
  home: string,
  stateDir: string,
): Promise<number | null> {
  // The desktop app prints nothing on a good start, so "ready" is the moment the
  // process is registered as a running application — the same signal Dock and
  // Cmd+Tab react to. Driving the window afterwards needs UI automation, which is not
  // scripted here and is named as such in the results.
  const executable = join(
    ROOT,
    "apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app/Contents/MacOS/refyard-desktop",
  );
  const startedAt = performance.now();
  const child = spawn(executable, [], {
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: tmpdir(),
      LANG: "C",
      REFYARD_STATE_DIR: stateDir,
    },
    stdio: "ignore",
  });
  let registeredMs: number | null = null;
  for (let waited = 0; waited < 15_000; waited += 50) {
    try {
      const listing = execFileSync(
        "lsappinfo",
        ["info", "-only", "pid", "dev.refyard.desktop"],
        {
          encoding: "utf8",
        },
      );
      if (listing.includes(String(child.pid))) {
        registeredMs = Math.round(performance.now() - startedAt);
        break;
      }
    } catch {
      // Not registered yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGTERM");
  return registeredMs;
}

const staging = await mkdtemp(join(tmpdir(), "refyard-bench-"));
const binDir = minimalBinDir(staging);
const repo = await createRepo({ initialCommit: true });
const stateDir = await mkdtemp(join(tmpdir(), "refyard-bench-state-"));
const home = await mkdtemp(join(tmpdir(), "refyard-bench-home-"));

const runs: Run[] = [];
for (let index = 0; index < RUNS; index += 1) {
  runs.push(await oneRun(binDir, repo));
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const appRegisteredMs = await launchAppOnce(binDir, home, stateDir);

const summary = {
  measuredAt: new Date().toISOString(),
  platform: `${process.platform} ${process.arch}`,
  binary: CLI,
  runs,
  app: {
    registeredMs: appRegisteredMs,
    note: "launch-to-registered-application only; window-ready latency needs UI automation and is not scripted",
  },
  method: {
    ready: "spawn → first JSON readiness line on stdout",
    firstStatus: "paired → repositories → status",
    history: "paired → history page 1",
    rss: "serve process RSS after 5s idle; the CLI has no WebView, so no shared-page double counting applies",
    rssAfterWork:
      "serve process RSS after dirtying the worktree and running status + unstaged diff",
  },
};

const evidenceDir = join(ROOT, "docs/evidence");
mkdirSync(evidenceDir, { recursive: true });
await writeFile(
  join(evidenceDir, "native-runtime.json"),
  JSON.stringify(summary, null, 2),
  "utf8",
);

console.log("native:bench");
for (const [index, run] of runs.entries()) {
  console.log(
    `  run ${index + 1}: ready ${run.readyMs}ms · first status ${run.firstStatusMs}ms · history ${run.historyMs}ms · idle rss ${run.rssKb} kB · after work ${run.rssAfterWorkKb} kB${run.note ? ` · ${run.note}` : ""}`,
  );
}
console.log(
  `  app:  registered ${appRegisteredMs}ms after spawn (window-ready not scripted)`,
);
console.log(`  json: docs/evidence/native-runtime.json`);

await rm(staging, { recursive: true, force: true });
await rm(stateDir, { recursive: true, force: true });
await rm(home, { recursive: true, force: true });
await rm(repo.scratchRoot, { recursive: true, force: true });
