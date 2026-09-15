#!/usr/bin/env bun
/**
 * `pnpm pack:smoke` — install the tarball the way a user would, and use it.
 *
 * The point is to prove the *packaged* thing works, not that the repository does. So
 * this runs in a temporary directory with:
 *
 * - an isolated `npm` cache and `HOME`, so nothing is reused from this checkout;
 * - `--offline`, so a missing piece fails instead of being fetched — and, more
 *   importantly, so a package named `refyard` can never come from the registry;
 * - no `node_modules` and no workspace, because that is the state a real install
 *   starts from.
 *
 * Every step prints the command it ran and its exit status, and the script exits
 * non-zero on the first failure. Nothing here publishes, installs a service, or
 * touches the user's Git configuration.
 */
import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { cp, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(repoRoot, "packages", "npm-dist");

interface Step {
  readonly name: string;
  readonly command: string;
  readonly status: string;
}

const steps: Step[] = [];

function record(name: string, command: string, status: string): void {
  steps.push({ name, command, status });
  const label = status === "ok" ? "ok  " : status === "skip" ? "skip" : "FAIL";
  console.log(`  ${label} ${name}  [${command}]`);
}

async function step<T>(
  name: string,
  command: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    const value = await action();
    record(name, command, "ok");
    return value;
  } catch (error) {
    record(name, command, "failed");
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`\npack:smoke: ${name} failed\n${detail}\n`);
    console.error(
      steps.map((entry) => `  ${entry.status}\t${entry.name}`).join("\n"),
    );
    process.exit(1);
  }
}

// Resolved from PATH, not from `process.execPath`: this script runs under bun, whose
// execPath and version describe bun, not the Node that `npm exec` will spawn.
const node = "node";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const isWindows = process.platform === "win32";

/**
 * `npm exec …` as a child process that keeps running.
 *
 * Windows cannot start a `.cmd` directly: Node's `spawn` throws EINVAL for it, and
 * under bun the same call produced a child with no output and no exit — the smoke then
 * waited its full timeout for a readiness line that could never come. So the wrapper is
 * started through `cmd.exe` there, with the arguments quoted here and passed verbatim
 * (`windowsVerbatimArguments`), because Node's `shell: true` concatenates arguments
 * without quoting and these ones contain a temporary directory that may have a space.
 */
function spawnNpmExec(
  args: readonly string[],
): ChildProcessByStdio<null, Readable, Readable> {
  // Written out in each branch so the stdio tuple selects the overload whose stdout and
  // stderr are streams rather than `null`. Its own process group, so the smoke can send
  // the signal a terminal's Ctrl+C sends: the whole foreground group, because signalling
  // only the npm wrapper is a different test (see the evidence file).
  if (!isWindows) {
    return spawn(npm, [...args], {
      cwd: consumer,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
  }
  const line = [npm, ...args].map(quoteForCommandPrompt).join(" ");
  return spawn(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", line], {
    cwd: consumer,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    windowsVerbatimArguments: true,
  });
}

/** Quote one argument for `cmd.exe`: only what it would otherwise split or expand. */
function quoteForCommandPrompt(argument: string): string {
  if (argument.length > 0 && !/[\s"&|<>^()]/.test(argument)) {
    return argument;
  }
  return `"${argument.replaceAll('"', '""')}"`;
}

const workspace = await mkdtemp(join(tmpdir(), "refyard-pack-"));
const home = join(workspace, "home");
const cache = join(workspace, "npm-cache");
const consumer = join(workspace, "consumer");
const repository = join(workspace, "repository");
await mkdir(home, { recursive: true });
await mkdir(cache, { recursive: true });
await mkdir(consumer, { recursive: true });

/** A clean environment: no reference to this checkout, no npm config inherited. */
const env: Record<string, string> = {
  PATH: process.env["PATH"] ?? "",
  HOME: home,
  npm_config_cache: cache,
  npm_config_offline: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  NO_COLOR: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  ...(process.env["TMPDIR"] === undefined
    ? {}
    : { TMPDIR: process.env["TMPDIR"] }),
};

async function npmRun(
  args: readonly string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await run(npm, [...args], {
    cwd: options.cwd ?? consumer,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { stdout, stderr };
}

console.log(`pack:smoke: workspace ${workspace}\n`);

// The staging must be built; a tarball of an unbuilt directory would pass while
// shipping nothing that runs.
await step(
  "staged build exists",
  "stat packages/npm-dist/dist/cli.mjs",
  async () => {
    const info = await stat(join(staging, "dist", "cli.mjs"));
    if (!info.isFile() || info.size === 0) {
      throw new Error(
        "the CLI bundle is missing or empty; run `pnpm build:release`",
      );
    }
    const web = await stat(join(staging, "web"));
    if (!web.isDirectory()) {
      throw new Error("the web build is missing; run `pnpm build` first");
    }
  },
);

const { snapshot } = await (async () => {
  // `npm pack` writes to stdout and to stderr; the file name is what matters. The
  // tarball is produced from a *copy* so the staging tree itself stays untouched.
  const packRoot = join(workspace, "pack-root");
  await cp(staging, packRoot, { recursive: true });
  return { snapshot: packRoot };
})();
const packed = await step(
  "npm pack",
  `npm pack ${snapshot} --pack-destination ${workspace}`,
  () => npmRun(["pack", snapshot, "--pack-destination", workspace]),
);
const tarball = packed.stdout
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.endsWith(".tgz"))
  .at(-1);
if (tarball === undefined) {
  console.error(
    `pack:smoke: npm pack printed no tarball name:\n${packed.stdout}${packed.stderr}`,
  );
  process.exit(1);
}
const tarballPath = join(workspace, tarball);
const tarballInfo = await stat(tarballPath);
console.log(`  tarball: ${tarball} (${tarballInfo.size} bytes)`);

const executor = (
  args: readonly string[],
): Promise<{ stdout: string; stderr: string }> =>
  npmRun(["exec", "--yes", "--package", tarballPath, "--", "refyard", ...args]);

// 1. A machine-readable readiness report, from the installed tarball.
const doctor = await step(
  "refyard doctor --json (installed via npm exec)",
  "npm exec --package <tarball> -- refyard doctor --json",
  async () => executor(["doctor", "--json"]),
);
const doctorReport = JSON.parse(doctor.stdout) as {
  nodeVersion?: string;
  gitVersion?: string;
  probes?: { name?: string; supported?: boolean }[];
};
if (
  typeof doctorReport.gitVersion !== "string" ||
  doctorReport.gitVersion.length === 0
) {
  console.error("pack:smoke: doctor reported no Git version");
  process.exit(1);
}
const probes = doctorReport.probes ?? [];
if (
  probes.length === 0 ||
  probes.some((probe) => typeof probe.name !== "string")
) {
  console.error(
    `pack:smoke: doctor reported no probes: ${doctor.stdout.slice(0, 200)}`,
  );
  process.exit(1);
}
const installed = await step(
  "the Node on PATH is the supported major",
  "node --version",
  async () => {
    const printed = await run(node, ["--version"], { env });
    return printed.stdout.trim();
  },
);
if (doctorReport.nodeVersion !== installed) {
  console.error(
    `pack:smoke: the installed CLI reported node ${doctorReport.nodeVersion ?? "unknown"}, but \`node --version\` says ${installed}`,
  );
  process.exit(1);
}
if (!/^v26\./.test(installed)) {
  console.error(
    `pack:smoke: this machine's Node is ${installed}; refyard publishes engines ">=26 <27" and the smoke test must run the supported major`,
  );
  process.exit(1);
}
console.log(
  `  doctor: node ${doctorReport.nodeVersion}, git ${doctorReport.gitVersion}, ${probes.length} probes (${probes.filter((probe) => probe.supported === true).length} supported)`,
);

// 2. `serve` against a real repository, with a machine-readable ready line that must
//    not contain pairing material.
await step("create a repository for serve", "git init", async () => {
  await mkdir(repository, { recursive: true });
  await run("git", ["init", "--quiet", "--initial-branch=main", repository], {
    env,
  });
  await run(
    "git",
    ["-C", repository, "commit", "--allow-empty", "--quiet", "-m", "base"],
    {
      env: {
        ...env,
        GIT_AUTHOR_NAME: "refyard pack smoke",
        GIT_AUTHOR_EMAIL: "smoke@localhost",
        GIT_COMMITTER_NAME: "refyard pack smoke",
        GIT_COMMITTER_EMAIL: "smoke@localhost",
      },
    },
  );
});

const serving = spawnNpmExec([
  "exec",
  "--yes",
  "--package",
  tarballPath,
  "--",
  "refyard",
  "serve",
  "--no-open",
  "--port",
  "0",
  "--repo",
  repository,
  "--json",
]);
let stdout = "";
let stderr = "";
serving.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString("utf8");
});
serving.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString("utf8");
});

const ready = await step(
  "refyard serve --json prints a ready object",
  "npm exec --package <tarball> -- refyard serve --no-open --port 0 --repo <dir> --json",
  async () => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const line = stdout
        .split("\n")
        .find((candidate) => candidate.trim().startsWith("{"));
      if (line !== undefined) {
        return JSON.parse(line) as {
          serviceInstanceId: string;
          port: number;
          url: string;
          repositoryId: string;
        };
      }
      if (serving.exitCode !== null) {
        throw new Error(
          `the service exited with ${serving.exitCode} before printing readiness\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `no readiness object within 30s\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  },
);

await step(
  "stdout carries no pairing ticket",
  "grep pair= <stdout>",
  async () => {
    if (stdout.includes("pair=")) {
      throw new Error(
        `the machine-readable stdout carried a pairing URL:\n${stdout}`,
      );
    }
    // The ready object is written to stdout first and the pairing URL a moment later, so
    // this waits for it instead of reading stderr once. The difference is not cosmetic: on
    // a loaded machine the one-shot check failed with "the pairing URL did not go to
    // stderr", which reads exactly like a product defect and is a race in this harness.
    const deadline = Date.now() + 10_000;
    while (!stderr.includes("pair=") && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!stderr.includes("pair=")) {
      throw new Error(
        "the pairing URL did not go to stderr, where the user can still read it",
      );
    }
  },
);

await step("the installed build serves the packaged UI", "GET /", async () => {
  const response = await fetch(`${ready.url}/`);
  const body = await response.text();
  if (response.status !== 200 || !body.includes("<div")) {
    throw new Error(
      `GET / answered ${response.status} with ${body.slice(0, 120)}`,
    );
  }
});

await step(
  "the API stays authenticated",
  "GET /api/v1/capabilities",
  async () => {
    const response = await fetch(`${ready.url}/api/v1/capabilities`);
    if (response.status !== 401) {
      throw new Error(
        `an unauthenticated capabilities read answered ${response.status}`,
      );
    }
  },
);

if (isWindows) {
  // Windows has no SIGTERM: `process.kill` there is TerminateProcess and there is no
  // process group to signal, so the graceful path this step is about does not exist.
  // Recorded as skipped rather than passed — a user stopping the service on Windows
  // gets whatever TerminateProcess gives, which is not this claim.
  record(
    "SIGTERM stops the service cleanly",
    "kill -TERM (Windows has no signals)",
    "skip",
  );
} else {
  await step(
    "SIGTERM stops the service cleanly",
    "kill -TERM, then the address must stop answering",
    async () => {
      // What this asserts is the *service*, not npm's exit status. The service here is a
      // grandchild — `npm exec` spawns it — and the status the wrapper reports after the
      // signal is npm's business: on Linux npm dies by the signal itself, on macOS it has
      // exited 0, and neither answer says whether refyard stopped. What a user can observe is
      // the address: after Ctrl+C (or a supervisor's SIGTERM) it must stop answering.
      const exited = new Promise<void>((resolvePromise) => {
        serving.once("exit", () => resolvePromise());
      });
      // The group, not the wrapper: `npm exec` spawns the service as a grandchild, and a
      // signal aimed at npm alone is not what a user's Ctrl+C or a shell's job control does.
      if (serving.pid === undefined) {
        throw new Error("the service wrapper has no pid");
      }
      process.kill(-serving.pid, "SIGTERM");

      const deadline = Date.now() + 15_000;
      for (;;) {
        let answered = false;
        try {
          const response = await fetch(`${ready.url}/`, {
            signal: AbortSignal.timeout(2_000),
          });
          answered = response.status > 0;
        } catch {
          answered = false;
        }
        if (!answered) {
          break;
        }
        if (Date.now() > deadline) {
          throw new Error(
            "the address still answered 15s after SIGTERM; the service did not stop",
          );
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      }

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("the wrapper did not exit within 15s")),
          15_000,
        ),
      );
      await Promise.race([exited, timeout]);
      // A death by signal is npm's own exit path — the address is already gone, which is the
      // claim this step makes. What must not happen is an unexplained non-zero code.
      if (serving.signalCode === null && serving.exitCode !== 0) {
        throw new Error(`the wrapper exited with ${serving.exitCode}`);
      }
    },
  );
}

// 3. The failure a user is most likely to hit: two servers, one port.
const portHolder = spawn(
  node,
  [
    "-e",
    "const net=require('node:net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port)});setTimeout(()=>process.exit(0),20000);",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const busyPort = await step(
  "reserve a port for the conflict case",
  "node -e (listen)",
  () =>
    new Promise<number>((resolvePromise, rejectPromise) => {
      let out = "";
      portHolder.stdout.on("data", (chunk: Buffer) => {
        out += chunk.toString("utf8");
        const parsed = Number.parseInt(out.trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          resolvePromise(parsed);
        }
      });
      portHolder.on("error", rejectPromise);
      setTimeout(
        () => rejectPromise(new Error("the helper never printed a port")),
        10_000,
      );
    }),
);

await step(
  "a busy port fails with a clear message, not a crash",
  "serve --port <busy>",
  async () => {
    try {
      await executor([
        "serve",
        "--no-open",
        "--port",
        String(busyPort),
        "--repo",
        repository,
        "--json",
      ]);
      throw new Error(
        "the service started on a port another process was holding",
      );
    } catch (error) {
      const failure = error as {
        stderr?: string;
        stdout?: string;
        code?: number;
      };
      const text = `${failure.stderr ?? ""}${failure.stdout ?? ""}`;
      if (!/EADDRINUSE|already in use|in use/i.test(text)) {
        throw new Error(`the failure did not name the port conflict:\n${text}`);
      }
    }
  },
);
portHolder.kill("SIGKILL");

const tarballFiles = await step(
  "the tarball carries no sources or fixtures",
  "tar -tzf",
  async () => {
    const listed = await run("tar", ["-tzf", tarballPath], { env });
    const entries = listed.stdout.split("\n").filter((line) => line.length > 0);
    const forbidden = entries.filter((entry) =>
      /(^|\/)(src|tests?|fixtures?|references|docs|\.git)(\/|$)|\.ts$|\.svelte$|\.tgz$/.test(
        entry,
      ),
    );
    if (forbidden.length > 0) {
      throw new Error(
        `the tarball ships files it should not:\n${forbidden.slice(0, 10).join("\n")}`,
      );
    }
    return entries.length;
  },
);
console.log(`  tarball entries: ${tarballFiles}`);

await step(
  "the tarball's manifest declares no dependencies",
  "tar -xzOf package.json",
  async () => {
    const extract = await run(
      "tar",
      ["-xzOf", tarballPath, "package/package.json"],
      { env },
    );
    const manifest = JSON.parse(extract.stdout) as Record<string, unknown>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]) {
      const value = manifest[field];
      if (
        value !== undefined &&
        Object.keys(value as Record<string, unknown>).length > 0
      ) {
        throw new Error(`the published manifest declares ${field}`);
      }
    }
    const scripts = manifest["scripts"] as Record<string, string> | undefined;
    if (scripts !== undefined && Object.keys(scripts).length > 0) {
      throw new Error(
        `the published manifest declares install scripts: ${JSON.stringify(scripts)}`,
      );
    }
  },
);

await rm(workspace, { recursive: true, force: true });
console.log(`\npack:smoke: ${steps.length} steps passed`);
