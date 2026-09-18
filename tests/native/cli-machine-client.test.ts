/**
 * The machine-client contract: a supervisor — the VS Code extension, or any parent
 * process — spawns `refyard-native serve --machine --json --port 0`, reads the readiness
 * object from stdout, and spends the single-use pairing ticket from stderr over a plain
 * Node fetch that sends **no Origin header**, because a supervisor is not a browser.
 *
 * The rule pinned here: a `--machine` ticket is bound to the empty origin. A request
 * with no Origin header matches it; a request carrying any browser origin is refused,
 * and a spent ticket replays as refused. The browser pairing path keeps its own
 * origin-bound ticket, unchanged, and is covered by the HTTP contract suites.
 *
 * Measured before this existed (the spike that justified `--machine`): the same exchange
 * against a non-machine service answered 403 "that pairing ticket was issued for a
 * different origin" — a supervisor simply could not pair.
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

const BINARY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../target/release/refyard-native",
);

interface MachineService {
  readonly url: string;
  readonly ticket: string;
  readonly repo: GitFixtureRepo;
  readonly stateDir: string;
  child: ChildProcess | null;
}

const services: MachineService[] = [];

async function startMachineService(): Promise<MachineService> {
  // Identity lives in the fixture's global Git config for the same reason the other
  // native suites give: the host strips Git environment overrides on purpose.
  const repo = await createRepo({
    initialCommit: true,
    config: {
      "user.name": "Refyard Fixture",
      "user.email": "fixture@refyard.invalid",
    },
  });
  const stateDir = await mkdtemp(join(tmpdir(), "refyard-machine-state-"));
  const child: ChildProcess = spawn(
    BINARY,
    ["serve", "--machine", "--port", "0", "--json", "--no-open", repo.root],
    {
      env: {
        ...repo.env,
        TMPDIR: tmpdir(),
        REFYARD_STATE_DIR: stateDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(String(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(String(chunk)));

  const ready = await new Promise<string>((resolve, reject) => {
    child.once("error", (error) =>
      reject(new Error(`the native binary did not start: ${error}`)),
    );
    child.once("exit", (code) =>
      reject(
        new Error(
          `the native binary exited early with ${code}: stdout ${stdoutChunks
            .join("")
            .slice(0, 300)} | stderr ${stderrChunks.join("").slice(0, 300)}`,
        ),
      ),
    );
    const started = Date.now();
    const poll = (): void => {
      const line = stdoutChunks
        .join("")
        .split("\n")
        .find((candidate) => candidate.startsWith("{"));
      if (line !== undefined) {
        resolve(line);
        return;
      }
      if (Date.now() - started > 15_000) {
        reject(
          new Error(
            `the native service never answered. stdout: ${stdoutChunks
              .join("")
              .slice(0, 500)} | stderr: ${stderrChunks.join("").slice(0, 500)}`,
          ),
        );
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  });

  const readiness = JSON.parse(ready) as {
    serviceInstanceId: string;
    port: number;
    url: string;
  };
  const pairingLine = stderrChunks
    .join("")
    .split("\n")
    .find((line) => line.includes("pairing URL (single use): "));
  if (pairingLine === undefined) {
    throw new Error(`no pairing URL printed: ${stderrChunks.join("")}`);
  }
  const ticket = pairingLine.split("pair=")[1]?.trim();
  if (ticket === undefined || ticket.length === 0) {
    throw new Error(`an unusable pairing URL: ${pairingLine}`);
  }

  const service: MachineService = {
    url: readiness.url,
    ticket,
    repo,
    stateDir,
    child,
  };
  services.push(service);
  return service;
}

afterAll(async () => {
  for (const service of services) {
    service.child?.kill("SIGTERM");
  }
  await Promise.all(
    services.map(async (service) => {
      await rm(service.stateDir, { recursive: true, force: true });
      await service.repo.dispose();
    }),
  );
});

describe("the machine-client contract", () => {
  it("a supervisor exchanges its machine ticket with no Origin header and reads", async () => {
    const service = await startMachineService();

    // The exchange a supervisor makes: no Origin header at all — a supervisor is not a
    // browser, and Node does not fabricate one.
    const exchange = await fetch(`${service.url}/api/v1/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: service.ticket }),
    });
    expect(exchange.status).toBe(200);
    const session = (await exchange.json()) as {
      token: string;
      tokenType: string;
      grants: { repositoryIds: string[] };
    };
    expect(session.tokenType).toBe("Bearer");
    expect(session.grants.repositoryIds.length).toBeGreaterThan(0);

    // An authenticated read with the session the machine exchange minted.
    const repositories = await fetch(`${service.url}/api/v1/repositories`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(repositories.status).toBe(200);
    const listing = (await repositories.json()) as {
      repositories: { displayPath: string }[];
    };
    const realRoot = await realpath(service.repo.root);
    expect(
      listing.repositories.some((record) => record.displayPath === realRoot),
    ).toBe(true);

    // Single use means single use for the supervisor too: the spent ticket replays as
    // refused even from the same headerless client that legitimately spent it.
    const replay = await fetch(`${service.url}/api/v1/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket: service.ticket }),
    });
    expect(replay.ok).toBe(false);
  });

  it("a browser origin cannot spend a machine ticket", async () => {
    const service = await startMachineService();

    const attempt = await fetch(`${service.url}/api/v1/session/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: service.url,
      },
      body: JSON.stringify({ ticket: service.ticket }),
    });
    expect(attempt.ok).toBe(false);
    const answer = (await attempt.json()) as { problem: { code: string } };
    expect(answer.problem.code).toBe("Forbidden");
  });
});
