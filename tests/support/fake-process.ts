/**
 * Test doubles for the process boundary.
 *
 * Two different kinds of fake live here, and the difference matters:
 *
 * - `nodeScriptSpec` runs a *real* child process (this Node binary with `-e`), so
 *   runner tests exercise real pipes, real exit codes and real signals. A fake
 *   process object would prove nothing about the deadlock and settlement rules
 *   that the runner exists to enforce.
 * - `scriptedRun` replaces `runGit` when the subject is the *host* rather than the
 *   runner: those tests assert which argv and which working directory a spec
 *   produced, and no process needs to exist for that.
 */
import type {
  GitCommandSpec,
  GitRunContext,
  GitRunResult,
} from "@refyard/git-core";
import type { RunGitOptions } from "@refyard/host-node/process/runner";

export const nodeBinary = process.execPath;

/** A spec that runs `node -e <script>` through the real process runner. */
export function nodeScriptSpec(
  script: string,
  overrides: Partial<GitCommandSpec> = {},
): GitCommandSpec {
  return {
    argv: ["-e", script],
    cwdHandle: "dir_test",
    deadlineClass: "readonly",
    description: "node -e (test script)",
    ...overrides,
  };
}

export interface RecordedCall {
  readonly spec: GitCommandSpec;
  readonly context: GitRunContext;
  readonly options: RunGitOptions;
}

export interface ScriptedRun {
  readonly calls: readonly RecordedCall[];
  readonly run: (
    spec: GitCommandSpec,
    context: GitRunContext,
    options: RunGitOptions,
  ) => Promise<GitRunResult>;
  lastCall(): RecordedCall | undefined;
}

function resultFrom(input: {
  termination: GitRunResult["termination"];
  exitCode: number | null;
  stdout?: Uint8Array;
  stderr?: string;
}): GitRunResult {
  return {
    termination: input.termination,
    exitCode: input.exitCode,
    stdout: input.stdout ?? new Uint8Array(0),
    stderr: new TextEncoder().encode(input.stderr ?? ""),
    stderrTruncated: false,
    durationMs: 1,
  };
}

export function scriptedRun(
  script: (spec: GitCommandSpec) => GitRunResult,
): ScriptedRun {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async run(spec, context, options) {
      calls.push({ spec, context, options });
      return script(spec);
    },
    lastCall() {
      return calls[calls.length - 1];
    },
  };
}

/** The common script: every command succeeds and prints nothing. */
export function alwaysSucceed(stdout = new Uint8Array(0)): ScriptedRun {
  return scriptedRun(() =>
    resultFrom({ termination: "exit", exitCode: 0, stdout }),
  );
}

export function exitWith(
  exitCode: number,
  options: { stdout?: Uint8Array; stderr?: string } = {},
): ScriptedRun {
  return scriptedRun(() =>
    resultFrom({
      termination: exitCode === 0 ? "exit" : "exit",
      exitCode,
      ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
      ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
    }),
  );
}
