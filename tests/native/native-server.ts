/**
 * A running native service for the HTTP suites.
 *
 * The tests start the real release binary against a fully isolated fixture repository —
 * its own `HOME`, its own state directory, no network beyond loopback — and read the
 * readiness line and the pairing URL from its output, exactly as a supervisor would. The
 * pairing URL is a secret in transit: the CLI prints it on stderr in machine mode, and
 * these tests read it from there rather than from stdout, which is the property the
 * product promises a log scraper.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

export interface RunningNativeService {
  readonly baseUrl: string;
  readonly origin: string;
  readonly port: number;
  readonly serviceInstanceId: string;
  readonly pairingUrl: string;
  readonly ticket: string;
  readonly repo: GitFixtureRepo;
  /**
   * The exchange the browser makes: the ticket spent from its own origin, once, with the
   * token cached. A test that needs to replay a *spent* ticket uses `ticket` directly.
   */
  pair(): Promise<string>;
  stop(): Promise<void>;
}

/** The binary under test, or the name of the task that forgot to build it. */
function binaryPath(): string {
  const override = process.env["REFYARD_NATIVE_BIN"];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  // Relative to this file, not the process's working directory: vitest's cwd is not a
  // property a test should depend on.
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../target/release/refyard-native",
  );
}

export async function startNativeService(): Promise<RunningNativeService> {
  // Identity goes into the fixture's global Git config, the way a person's machine is
// actually configured: the native host strips Git environment overrides on purpose, so
// an env-only identity would leave `git commit` auto-detecting one.
const repo = await createRepo({
  initialCommit: true,
  config: {
    "user.name": "Refyard Fixture",
    "user.email": "fixture@refyard.invalid",
  },
});
  const stateDir = await mkdtemp(join(tmpdir(), "refyard-native-state-"));
  const child: ChildProcess = spawn(
    binaryPath(),
    ["serve", "--port", "0", "--json", "--no-open", repo.root],
    {
      // The fixture's whole isolated environment — its own HOME, its own config, its
      // own commit identity — with the private state directory added. Without the
      // identity, a commit would send `git` looking up a hostname for a default email,
      // which is a fixture bug, not a service one.
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
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk.toString("utf8")));

  const ready = await new Promise<string>((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`the native binary did not start: ${error}`)));
    const started = Date.now();
    const poll = (): void => {
      const line = stdoutChunks.join("").split("\n").find((line) => line.startsWith("{"));
      if (line !== undefined) {
        resolve(line);
        return;
      }
      if (Date.now() - started > 15_000) {
        reject(
          new Error(
            `the native service never answered. stdout: ${stdoutChunks
              .join("")
              .slice(0, 800)} | stderr: ${stderrChunks.join("").slice(0, 800)}`,
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
    throw new Error(`the native service printed no pairing URL: ${stderrChunks.join("")}`);
  }
  const pairingUrl = pairingLine.split("pairing URL (single use): ")[1]?.trim();
  const ticket = pairingUrl?.split("pair=")[1];
  if (pairingUrl === undefined || ticket === undefined || ticket.length === 0) {
    throw new Error(`the native service printed an unusable pairing URL: ${pairingLine}`);
  }

  let cachedToken: string | null = null;
  return {
    baseUrl: readiness.url,
    origin: readiness.url,
    port: readiness.port,
    serviceInstanceId: readiness.serviceInstanceId,
    pairingUrl,
    ticket,
    repo,
    async pair(): Promise<string> {
      if (cachedToken !== null) {
        return cachedToken;
      }
      const response = await fetch(`${readiness.url}/api/v1/session/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: readiness.url },
        body: JSON.stringify({ ticket }),
      });
      if (response.status !== 200) {
        throw new Error(`the pairing exchange failed: ${response.status} ${await response.text()}`);
      }
      const answer = (await response.json()) as { token: string };
      cachedToken = answer.token;
      return cachedToken;
    },
    async stop(): Promise<void> {
      await new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      });
      await rm(stateDir, { recursive: true, force: true });
    },
  };
}
