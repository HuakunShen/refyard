/**
 * Start the built CLI bundle for an e2e spec, with that spec's own private state.
 *
 * Two things here are not cosmetic:
 *
 * - **The service runs on the fixture's environment**, so it has its own `HOME`, its own Git
 *   config, and no network — the same isolation the fixture gives to `git` itself. Without
 *   it the service writes its journal and backups into the developer's real refyard state
 *   directory, and the operation list a spec reads starts out holding records from other
 *   runs. That is how "did this page cause a write?" silently becomes a coin flip: once the
 *   list reaches its page limit, the count before and after a click are the same number.
 * - **Every spec uses `--json`**, so the readiness object (port, service instance id) is
 *   machine-readable, and the pairing ticket is read from the human channel rather than
 *   parsed out of prose. The ticket stays single-use: one service per spec.
 */
import { spawn } from "node:child_process";
import { test } from "@playwright/test";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitFixtureRepo } from "./repo.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CLI_BUNDLE = join(REPO_ROOT, ".refyard-dev", "cli.mjs");

/**
 * Every service started during the current test, with what it printed.
 *
 * Two e2e failures so far — one in Firefox, one in WebKit, the same case both times —
 * left the question "was the service unreachable, or was it the page?" unanswerable:
 * the harness kept the service's stderr for its own readiness check and then dropped it,
 * so a spec that failed on a `NetworkError` said nothing about whether the request ever
 * reached the service. The output survives the service now, and a failing test prints it.
 */
const started = new Set<{
  readonly label: string;
  output(): string;
}>();

/** Registers a Playwright hook in every spec file that imports this module. */
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) {
    started.clear();
    return;
  }
  for (const service of started) {
    console.error(
      `\n--- ${service.label} output (test ${testInfo.status}) ---\n${service.output()}`,
    );
  }
  started.clear();
});

export interface E2eService {
  /** The URL to open: the service origin with its single-use ticket. */
  readonly pairingUrl: string;
  readonly origin: string;
  readonly port: number;
  readonly instanceId: string;
  stop(): Promise<void>;
}

export interface E2eServiceOptions {
  readonly repo: GitFixtureRepo;
  /** 0 asks the OS for a free port, which is what a spec normally wants. */
  readonly port?: number;
}

export async function startE2eService(
  options: E2eServiceOptions,
): Promise<E2eService> {
  const repositoryPath = await realpath(options.repo.root);
  const child = spawn(
    process.execPath,
    [
      CLI_BUNDLE,
      "serve",
      "--no-open",
      "--port",
      String(options.port ?? 0),
      "--repo",
      repositoryPath,
      "--json",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...options.repo.env,
        // The journal, the backups and the registry live beside the fixture, so a spec
        // can never read another run's state — or leave any behind.
        REFYARD_STATE_DIR: join(options.repo.scratchRoot, "state"),
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  let stopping = false;
  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }
    // A service that exits before the spec stopped it is a failure nobody asked for, and its
    // stderr is the only place the reason is written. Printing it here is what turns the next
    // occurrence from "NetworkError when attempting to fetch resource" in the browser into an
    // explanation in the test output — one Firefox case failed exactly that way once, and the
    // service's own words were lost because this listener did not exist.
    console.error(
      `e2e service exited early (code ${code ?? "null"}, signal ${signal ?? "none"}):\n${stderr.slice(-2000)}`,
    );
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    const line = stdout
      .split("\n")
      .find((candidate) => candidate.trim().startsWith("{"));
    const ticket = /pair=([A-Za-z0-9_-]+)/.exec(stderr)?.[1];
    if (line !== undefined && ticket !== undefined) {
      const ready = JSON.parse(line) as {
        serviceInstanceId: string;
        port: number;
        url: string;
        ui: string | null;
      };
      // A service with no web build serves a placeholder page, and every spec then
      // fails on a panel that does not exist — thirty confusing failures for one
      // missing directory. This is the clear failure instead: the e2e suite must never
      // run against the placeholder.
      if (ready.ui === null || ready.ui === undefined) {
        throw new Error(
          "the service found no web build, so it is serving the placeholder page; " +
            "run `pnpm build && bun scripts/bundle-cli.ts` first",
        );
      }
      const handle: E2eService = {
        pairingUrl: `${ready.url}/?pair=${ticket}`,
        origin: ready.url,
        port: ready.port,
        instanceId: ready.serviceInstanceId,
        async stop(): Promise<void> {
          stopping = true;
          if (child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          const exited = new Promise<void>((resolve) => {
            child.once("exit", () => {
              resolve();
            });
          });
          child.kill("SIGTERM");
          await exited;
        },
      };
      started.add({
        label: `service on port ${ready.port} for ${options.repo.root}`,
        output: () =>
          `stdout:\n${stdout.slice(-4000)}\nstderr:\n${stderr.slice(-4000)}`,
      });
      return handle;
    }
    if (child.exitCode !== null) {
      throw new Error(
        `the service exited with ${child.exitCode}:\n${stderr}${stdout}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the service never reported readiness:\n${stderr}${stdout}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
