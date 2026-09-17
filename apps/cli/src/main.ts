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
import { runService, type RunningService } from "./serve.js";
import { CLI_VERSION, reportedVersion } from "./version.js";
import { localWebRoot } from "./web-root.js";

export interface MainIO {
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
  /** Directory the CLI package lives in, used to find a packaged web build. */
  readonly cliDirectory: string;
  readonly gitPath: string;
  readonly cwd: string;
  /** Optional hosted pairing secret supplied by the process environment, never argv. */
  readonly hostedPassword?: string;
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
  let running: RunningService;
  try {
    const webRoot =
      command.kind === "open" ? await localWebRoot(io.cliDirectory) : null;
    if (command.kind === "open" && webRoot === null) {
      throw new Error(
        "the local workbench assets are missing beside this CLI; reinstall refyard, or use `refyard serve` for API-only mode",
      );
    }
    running = await runService({
      repositoryPaths: command.paths,
      gitPath: io.gitPath,
      port: command.port,
      portExplicit: command.portExplicit,
      openBrowser: command.openBrowser,
      ticketTtlSeconds: command.ticketTtlSeconds,
      webRoot,
      allowedOrigins: command.allowedOrigins,
      ...(command.uiOrigin === null ? {} : { uiOrigin: command.uiOrigin }),
      ...(io.hostedPassword === undefined
        ? {}
        : { hostedPassword: io.hostedPassword }),
      allowRoot: command.allowRoot,
      json: command.json,
      write: io.write,
      writeError: io.writeError,
    });
  } catch (error) {
    // One line, no stack, and a non-zero exit: every failure this command raises is a
    // sentence a person can act on — the port you asked for is busy, this is not a
    // repository, refyard will not run as root. An uncaught `PortInUseError:` with a
    // stack under it buries the sentence, which is how the busy-port message read
    // before this.
    io.writeError(
      `refyard: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { exitCode: EXIT_FAILED };
  }
  return { exitCode: EXIT_OK, running };
}

export { CLI_VERSION };
