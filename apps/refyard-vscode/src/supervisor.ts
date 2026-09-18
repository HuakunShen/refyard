/**
 * Spawning and pairing the local `refyard-native` service, exactly as a supervisor
 * would: the CLI answers with a readiness object on stdout and one single-use machine
 * ticket in its pairing URL on stderr, bound to the empty origin so that the headerless
 * exchange below is the only way to spend it. Every fetch in here is the extension
 * host's own; the webview never sees the token or the port.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createGitClient, type GitClient } from "@refyard/git-client";

export interface RunningService {
  readonly baseUrl: string;
  readonly client: GitClient;
  child: ChildProcess | null;
}

export interface SpawnOptions {
  readonly cliPath: string;
  readonly repositoryPath: string;
  readonly stateDir: string;
  readonly environment: NodeJS.ProcessEnv;
}

interface Readiness {
  readonly serviceInstanceId: string;
  readonly port: number;
  readonly url: string;
}

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export async function startMachineService(
  options: SpawnOptions,
): Promise<RunningService> {
  const child = spawn(
    options.cliPath,
    [
      "serve",
      "--machine",
      "--port",
      "0",
      "--json",
      "--no-open",
      options.repositoryPath,
    ],
    {
      env: { ...options.environment, REFYARD_STATE_DIR: options.stateDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(String(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(String(chunk)));

  const exited = new Promise<never>((_, reject) => {
    child.once("exit", (code) =>
      reject(
        new ServiceError(
          `the refyard service exited with ${code}. stdout: ${stdoutChunks
            .join("")
            .slice(0, 400)} stderr: ${stderrChunks.join("").slice(0, 400)}`,
        ),
      ),
    );
  });

  const ready = await Promise.race([
    readinessLine(stdoutChunks, stderrChunks),
    exited,
  ]);
  const readiness = JSON.parse(ready) as Readiness;
  const ticket = ticketFrom(stderrChunks.join(""));

  // The client is the shared typed surface: the same DTO validation the browser uses.
  let token: string | null = null;
  const client = createGitClient({
    baseUrl: readiness.url,
    fetch: (input, init) => fetch(input, init),
    token: () => token,
  });
  const session = await client.exchangeTicket(ticket);
  token = session.token;

  return {
    baseUrl: readiness.url,
    client,
    child,
  };
}

async function readinessLine(
  stdoutChunks: string[],
  stderrChunks: string[],
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    const line = stdoutChunks
      .join("")
      .split("\n")
      .find((candidate) => candidate.startsWith("{"));
    if (line !== undefined) {
      return line;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new ServiceError(
    `the refyard service never answered. stdout: ${stdoutChunks
      .join("")
      .slice(0, 400)} stderr: ${stderrChunks.join("").slice(0, 400)}`,
  );
}

function ticketFrom(stderr: string): string {
  const line = stderr
    .split("\n")
    .find((candidate) => candidate.includes("pairing URL (single use): "));
  if (line === undefined) {
    throw new ServiceError(
      `the refyard service printed no pairing URL: ${stderr.slice(0, 400)}`,
    );
  }
  const ticket = line.split("pair=")[1]?.trim();
  if (ticket === undefined || ticket.length === 0) {
    throw new ServiceError(`an unusable pairing URL: ${line}`);
  }
  return ticket;
}

export function stopService(service: RunningService): void {
  service.child?.kill("SIGTERM");
  service.child = null;
}
