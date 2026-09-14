/**
 * `refyard` — the command-line entry point.
 *
 * It parses, dispatches and reports. Nothing here touches Git or the filesystem
 * directly: `doctor` and `serve` do that, and they are the only two commands.
 *
 * Error handling is deliberately plain: a failure prints one line to stderr and
 * exits non-zero, with an exit code a script can branch on. No failure prints a
 * stack trace to a user, and none prints a path the user did not supply.
 *
 * `serve` and `open` run in the foreground and return as soon as the listener is
 * up: the open server keeps the process alive by itself, and Ctrl+C closes it,
 * which is the whole lifecycle in this version.
 */
import { parseArgs, helpText, type CliCommand } from "./args.js";
import { runDoctorCommand } from "./doctor.js";
import { findWebRoot, runService, type RunningService } from "./serve.js";
import { CLI_VERSION, reportedVersion } from "./version.js";

export interface MainIO {
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
  /** Directory the CLI package lives in, used to find a packaged web build. */
  readonly cliDirectory: string;
  readonly gitPath: string;
  readonly cwd: string;
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 64;
export const EXIT_ENVIRONMENT = 2;
export const EXIT_FAILED = 1;

export interface MainResult {
  readonly exitCode: number;
  /** Present after a successful `open`/`serve`, for tests and embedded hosts. */
  readonly running?: RunningService;
}

export async function main(
  argv: readonly string[],
  io: MainIO,
): Promise<MainResult> {
  const parsed = parseArgs(argv, io.cwd);
  if (!parsed.ok) {
    io.writeError(`refyard: ${parsed.message}`);
    io.writeError("run `refyard --help` for usage");
    return { exitCode: EXIT_USAGE };
  }

  switch (parsed.command.kind) {
    case "help":
      io.write(helpText());
      return { exitCode: EXIT_OK };
    case "version":
      io.write(`refyard ${await reportedVersion()}`);
      return { exitCode: EXIT_OK };
    case "doctor": {
      const exitCode = await runDoctorCommand({
        json: parsed.command.json,
        gitPath: io.gitPath,
        write: io.write,
      });
      return { exitCode };
    }
    case "open":
    case "serve":
      return runServeCommand(parsed.command, io);
    default:
      io.writeError("refyard: unknown command");
      return { exitCode: EXIT_USAGE };
  }
}

async function runServeCommand(
  command: Extract<CliCommand, { kind: "open" | "serve" }>,
  io: MainIO,
): Promise<MainResult> {
  const webRoot = await findWebRoot(io.cliDirectory);
  const running = await runService({
    repositoryPath: command.path,
    gitPath: io.gitPath,
    port: command.port,
    openBrowser: command.openBrowser,
    ticketTtlSeconds: command.ticketTtlSeconds,
    webRoot,
    allowRoot: command.allowRoot,
    json: command.json,
    write: io.write,
    writeError: io.writeError,
  });
  return { exitCode: EXIT_OK, running };
}

export { CLI_VERSION };
