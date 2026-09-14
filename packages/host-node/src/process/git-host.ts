/**
 * The Node implementation of `GitHostPort`.
 *
 * This is the boundary the design calls privileged: it is the only code in the
 * product that knows how to start a process, and the only place a `cwdHandle`
 * becomes a filesystem path. It is constructed by the service at startup and
 * handed to trusted core; it is never reachable from HTTP, SSE or a browser
 * bridge, and the browser-facing layer has no type that could carry a `argv`,
 * a `cwd` or an environment entry.
 *
 * Two rules make the scope real rather than decorative:
 *
 * 1. A spec's `cwdHandle` must resolve through the handle registry, which re-proves
 *    containment on every call. An unknown handle is refused, and a handle whose
 *    directory has been replaced by a symlink to somewhere else is refused too.
 * 2. Core planners produce argv, so no caller can inject a subcommand. The runner
 *    still refuses to run with `shell: true` and rejects argv entries containing
 *    NUL bytes, which would otherwise truncate silently inside a C string.
 */
import type {
  GitCommandSpec,
  GitHostPort,
  GitRunContext,
  GitRunResult,
} from "@refyard/git-core";
import { defaultLimits, runGit, type RunGitOptions } from "./runner.js";
import type { HandleRegistry } from "../filesystem/handles.js";
import { HandleError } from "../filesystem/handles.js";

/**
 * The seam a test replaces.
 *
 * It returns `GitRunResult` rather than the runner's `RunGitOutcome`: the host only
 * ever reads the result fields, and the cleanup report is the runner's business.
 * Keeping the narrower type here means a double does not have to fabricate a
 * cleanup verdict it never performed.
 */
export type GitRunInvocation = (
  spec: GitCommandSpec,
  context: GitRunContext,
  options: RunGitOptions,
) => Promise<GitRunResult>;

export interface GitHostOptions {
  /** Absolute path or PATH-resolved name of the Git executable. */
  readonly gitPath: string;
  readonly registry: HandleRegistry;
  /** Injectable for tests: a process runner with the same contract. */
  readonly run?: GitRunInvocation;
  readonly now?: () => number;
  readonly setTimer?: RunGitOptions["setTimer"];
  readonly clearTimer?: RunGitOptions["clearTimer"];
  /** Per-invocation override, used by tests to force a small output bound. */
  readonly limitsFor?: (spec: GitCommandSpec) => RunGitOptions["limits"];
  /** Environment entries added for tests; production passes none. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface GitHost extends GitHostPort {
  /** Resolve a handle without running Git; used for path work outside a command. */
  resolveWorkdir(handle: string): Promise<string>;
  gitPath: string;
}

/** NUL truncates inside the OS's C string handling, so it is refused up front. */
function argvIsRunnable(argv: readonly string[]): string | null {
  if (argv.length === 0) {
    return "a Git command must have at least one argument";
  }
  for (const [index, entry] of argv.entries()) {
    if (entry.includes("\u0000")) {
      return `argv[${index}] contains a NUL byte`;
    }
    if (entry.includes("\n") && index === 0) {
      return "the subcommand must not contain a newline";
    }
  }
  return null;
}

export function createGitHost(options: GitHostOptions): GitHost {
  const run = options.run ?? runGit;

  return {
    gitPath: options.gitPath,

    async resolveWorkdir(handle: string): Promise<string> {
      const resolved = await options.registry.resolve(handle);
      return resolved.absolutePath;
    },

    async runGit(
      spec: GitCommandSpec,
      context: GitRunContext,
    ): Promise<GitRunResult> {
      const argvProblem = argvIsRunnable(spec.argv);
      if (argvProblem !== null) {
        return refuse(spec, argvProblem);
      }
      let cwd: string;
      try {
        const resolved = await options.registry.resolve(spec.cwdHandle);
        cwd = resolved.absolutePath;
      } catch (error) {
        const message =
          error instanceof HandleError
            ? `${error.code}: ${error.message}`
            : "the working directory handle could not be resolved";
        return refuse(spec, message);
      }
      const limits =
        options.limitsFor?.(spec) ?? defaultLimits(spec.deadlineClass);
      const outcome: GitRunResult = await run(spec, context, {
        gitPath: options.gitPath,
        cwd,
        limits,
        ...(options.env === undefined ? {} : { env: options.env }),
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.setTimer === undefined
          ? {}
          : { setTimer: options.setTimer }),
        ...(options.clearTimer === undefined
          ? {}
          : { clearTimer: options.clearTimer }),
      });
      return outcome;
    },
  };
}

/**
 * A spec the host refuses to run.
 *
 * It is reported as a `spawn-error` with an empty result rather than thrown,
 * because every caller already handles "Git did not run" and a thrown error here
 * would have to be re-handled at each call site. The reason travels on stderr so
 * it reaches the journal, and the exit code stays `null`: nothing ran, so there is
 * no exit status to report.
 */
function refuse(spec: GitCommandSpec, reason: string): GitRunResult {
  return {
    termination: "spawn-error",
    exitCode: null,
    stdout: new Uint8Array(0),
    stderr: new TextEncoder().encode(`${spec.description}: ${reason}\n`),
    stderrTruncated: false,
    durationMs: 0,
  };
}
