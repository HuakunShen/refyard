/**
 * The Git process runner.
 *
 * Every Git invocation in the product goes through `runGit`. The rules it
 * implements exist because each of them is a way a process runner silently loses
 * data:
 *
 * - **Both pipes are drained at once.** Writing to stderr while nobody reads
 *   stdout deadlocks at 64 KiB; `git fetch` on a slow link will do it.
 * - **Exactly one settlement.** A process can emit `error` and `close`, or a
 *   timeout can fire just as it exits. The first outcome wins and the others are
 *   ignored, so a result is never reported twice or overwritten.
 * - **stdout stays bytes.** Core parsers unframe by format, and a decode here
 *   would destroy a path that is not UTF-8 before the parser ever sees it.
 * - **No shell.** `shell: false` with an argument vector; nothing from a request
 *   is ever concatenated into a command line.
 * - **Bounded output.** A repository can produce gigabytes; the runner stops at a
 *   limit and says so (`output-limit`), instead of growing until the host dies.
 * - **stdin ends.** Git reads stdin until EOF for `--pathspec-from-file=-` and
 *   `-F -`; leaving it open hangs the command. A reader that exits early produces
 *   EPIPE, which is reported rather than thrown into an unhandled rejection.
 *
 * A timeout is not a rollback: the result says `timeout`, and the caller decides
 * what the repository state now is. This module never retries.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type {
  GitCommandSpec,
  GitRunContext,
  GitRunResult,
  GitTermination,
} from "@refyard/git-core";
import { CORE_LIMITS } from "@refyard/git-core";
import { buildGitEnvironment } from "./environment.js";
import { signalProcessGroup, type CleanupReport } from "./cleanup.js";

export interface RunnerLimits {
  readonly stdoutMaxBytes: number;
  readonly stderrMaxBytes: number;
  readonly deadlineMs: number;
  /** Grace period between SIGTERM and SIGKILL for the process group. */
  readonly killGraceMs: number;
}

export const DEFAULT_DEADLINES_MS: Readonly<
  Record<GitCommandSpec["deadlineClass"], number>
> = {
  readonly: 15_000,
  network: 600_000,
  hook: 120_000,
};

export function defaultLimits(
  deadlineClass: GitCommandSpec["deadlineClass"],
): RunnerLimits {
  return {
    stdoutMaxBytes: CORE_LIMITS.structuredStdoutMaxBytes,
    stderrMaxBytes: CORE_LIMITS.stderrDiagnosticMaxBytes,
    deadlineMs: DEFAULT_DEADLINES_MS[deadlineClass],
    killGraceMs: 2_000,
  };
}

export interface RunGitOptions {
  /** Absolute path of the Git executable. */
  readonly gitPath: string;
  /** Working directory, already resolved and authorised by the registry. */
  readonly cwd: string;
  readonly limits: RunnerLimits;
  /** Environment entries for tests; production callers pass none. */
  readonly env?: Readonly<Record<string, string>>;
  /** Injectable clock, so a test can drive a deadline without waiting for it. */
  readonly now?: () => number;
  /** Injectable timer factory, so tests do not rely on real time passing. */
  readonly setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  readonly clearTimer?: (handle: NodeJS.Timeout) => void;
}

export interface RunGitOutcome extends GitRunResult {
  /** What the host did about the process tree, and how sure it is. */
  readonly cleanup: CleanupReport;
}

/**
 * Run one planned Git command.
 *
 * The returned result always describes how the process ended. `termination` is
 * `exit` only when Git exited on its own; a signal, a deadline, a failed spawn or
 * a size limit each have their own value, because "it stopped" and "it finished"
 * are different facts and only one of them can be trusted as a completed read.
 *
 * The run id in `context` is carried by the caller's journal; the runner itself
 * never writes anywhere, which is what keeps it testable without a filesystem.
 */
export async function runGit(
  spec: GitCommandSpec,
  _context: GitRunContext,
  options: RunGitOptions,
): Promise<RunGitOutcome> {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setInterval;
  const clearTimer = options.clearTimer ?? clearInterval;
  const startedAt = now();
  const env = buildGitEnvironment({
    gitPath: options.gitPath,
    ...(options.env === undefined ? {} : { extra: options.env }),
  });

  return new Promise<RunGitOutcome>((resolve) => {
    let settled = false;
    let termination: GitTermination = "unknown";
    let timedOut = false;
    let outputLimitHit = false;
    let cleanup: CleanupReport = { kind: "not-needed" };
    const stdoutChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    const stderrChunks: Uint8Array[] = [];
    let stderrBytes = 0;
    let stderrTruncated = false;
    let deadlineHandle: NodeJS.Timeout | null = null;

    let child: ChildProcess;
    try {
      child = spawn(options.gitPath, [...spec.argv], {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        // A new process group on POSIX, so the whole tree (Git plus any hook,
        // SSH or credential helper it started) can be signalled together.
        detached: process.platform !== "win32",
        stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        termination: "spawn-error",
        exitCode: null,
        stdout: new Uint8Array(0),
        stderr: new Uint8Array(0),
        stderrTruncated: false,
        durationMs: now() - startedAt,
        cleanup: { kind: "not-needed" },
      });
      return;
    }

    const settle = (
      exitCode: number | null,
      finalTermination: GitTermination,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (deadlineHandle !== null) {
        clearTimer(deadlineHandle);
        deadlineHandle = null;
      }
      resolve({
        termination: finalTermination,
        exitCode,
        stdout: concatBytes(stdoutChunks, stdoutBytes),
        stderr: concatBytes(stderrChunks, stderrBytes),
        stderrTruncated,
        durationMs: now() - startedAt,
        cleanup,
      });
    };

    const stopFor = (reason: "timeout" | "output-limit"): void => {
      if (settled || termination !== "unknown") {
        return;
      }
      timedOut = reason === "timeout";
      outputLimitHit = reason === "output-limit";
      if (child.pid !== undefined) {
        cleanup = signalProcessGroup(child.pid, {
          graceMs: options.limits.killGraceMs,
        });
      }
      // The close event that follows carries the exit code; if it never arrives,
      // the watchdog below settles the result anyway.
      setTimeout(() => {
        settle(null, timedOut ? "timeout" : "output-limit");
      }, options.limits.killGraceMs + 250).unref?.();
    };

    deadlineHandle = setTimer(() => {
      stopFor("timeout");
    }, options.limits.deadlineMs);
    deadlineHandle.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      // Bytes are kept as they arrived; the parser unframes them. Only the total
      // is bounded, and going over the bound ends the process rather than
      // pretending the truncated output is complete.
      const view = new Uint8Array(chunk);
      if (stdoutBytes + view.byteLength > options.limits.stdoutMaxBytes) {
        const room = options.limits.stdoutMaxBytes - stdoutBytes;
        if (room > 0) {
          stdoutChunks.push(view.subarray(0, room));
          stdoutBytes += room;
        }
        stopFor("output-limit");
        return;
      }
      stdoutChunks.push(view);
      stdoutBytes += view.byteLength;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const view = new Uint8Array(chunk);
      const room = options.limits.stderrMaxBytes - stderrBytes;
      if (view.byteLength > room) {
        if (room > 0) {
          stderrChunks.push(view.subarray(0, room));
          stderrBytes += room;
        }
        // Diagnostics are bounded rather than fatal: a chatty hook must not be
        // able to make an otherwise successful command fail.
        stderrTruncated = true;
        return;
      }
      stderrChunks.push(view);
      stderrBytes += view.byteLength;
    });

    child.on("error", () => {
      settle(null, "spawn-error");
    });

    child.on("close", (code, signal) => {
      if (termination !== "unknown") {
        settle(code, termination);
        return;
      }
      termination = signal === null ? "exit" : "signal";
      settle(
        code,
        timedOut ? "timeout" : outputLimitHit ? "output-limit" : termination,
      );
    });

    if (spec.stdin !== undefined && child.stdin !== null) {
      child.stdin.on("error", () => {
        // Git may exit before reading the whole stdin (a rejected refspec, a
        // missing object). EPIPE is that case, not a failure of this run.
      });
      child.stdin.end(Buffer.from(spec.stdin));
    }
  });
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** True when the outcome means "Git finished by itself and said nothing went wrong". */
export function isCleanExit(outcome: GitRunResult): boolean {
  return outcome.termination === "exit" && outcome.exitCode === 0;
}

/** A one-line description of how a run ended, for journals and diagnostics. */
export function describeTermination(outcome: GitRunResult): string {
  switch (outcome.termination) {
    case "exit":
      return `exit ${outcome.exitCode ?? "?"}`;
    case "signal":
      return `signal ${outcome.exitCode ?? "?"}`;
    case "timeout":
      return "deadline exceeded";
    case "output-limit":
      return "output limit exceeded";
    case "spawn-error":
      return "could not start Git";
    default:
      return "unknown termination";
  }
}
