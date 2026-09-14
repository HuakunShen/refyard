/**
 * The engine that read workflows run commands through.
 *
 * A workflow is portable core code that knows *which* reads a question needs and
 * how to interpret their answers, but not how to start a process. The engine is
 * the single seam between the two: workflows call `runRequired`, and the Node host
 * supplies an engine backed by `GitHostPort`.
 *
 * Failure classification is deliberately evidence-only. A non-zero exit becomes
 * `GitCommandFailed` with the exit code and a bounded diagnostic — never a guess
 * parsed out of English output. "fatal: not a git repository" and "fatal: bad
 * revision" both exit 128, and a regex that tried to tell them apart would invent
 * certainty the process did not provide.
 */
import type { GitCommandSpec, GitHostPort, GitRunResult } from "../ports.js";
import { CORE_LIMITS } from "../bytes/limits.js";

export type GitFailureCode =
  | "GitCommandFailed"
  | "GitNotStarted"
  | "GitTimedOut"
  | "GitOutputLimitExceeded"
  | "GitTerminatedBySignal"
  | "GitOutputUnparsable"
  | "GitOutputIncomplete"
  | "ObjectMissing"
  | "NoRevisionFound"
  | "UnsupportedPathEncoding";

export class GitWorkflowError extends Error {
  readonly code: GitFailureCode;
  readonly exitCode: number | null;
  readonly command: string;
  /** Bounded, decoded diagnostic text. Never treated as the meaning of the failure. */
  readonly diagnostic: string;

  constructor(input: {
    code: GitFailureCode;
    command: string;
    message: string;
    exitCode?: number | null;
    diagnostic?: string;
  }) {
    super(input.message);
    this.name = "GitWorkflowError";
    this.code = input.code;
    this.command = input.command;
    this.exitCode = input.exitCode ?? null;
    this.diagnostic = input.diagnostic ?? "";
  }
}

export interface GitEngine {
  /** Run one planned command; the result describes how it ended, never throwing. */
  run(spec: GitCommandSpec): Promise<GitRunResult>;
}

/**
 * The production engine: one host port, one run-id prefix for diagnostics.
 *
 * The run id is a label, not a capability — core cannot mint authority, only name
 * the work so a journal can correlate it later.
 */
export function createHostEngine(
  host: GitHostPort,
  options: { readonly runIdPrefix: string },
): GitEngine {
  let counter = 0;
  return {
    run(spec: GitCommandSpec): Promise<GitRunResult> {
      counter += 1;
      return host.runGit(spec, {
        runId: `${options.runIdPrefix}-${counter.toString(36)}`,
      });
    },
  };
}

/** True when Git ran and exited with one of the accepted codes. */
export function isAcceptedExit(
  result: GitRunResult,
  acceptedExitCodes: readonly number[],
): boolean {
  return (
    result.termination === "exit" &&
    result.exitCode !== null &&
    acceptedExitCodes.includes(result.exitCode)
  );
}

/** Run a command where only exit code 0 is an answer. */
export async function runRequired(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<Uint8Array> {
  const result = await engine.run(spec);
  if (result.termination === "exit" && result.exitCode === 0) {
    return result.stdout;
  }
  throw failureFor(spec, result);
}

/**
 * Run a command where a specific non-zero exit code carries meaning.
 *
 * Returns null when Git exited with `meaningfulExitCodes` — the caller knows what
 * that means for this command (`symbolic-ref --quiet HEAD` exits 1 when HEAD is
 * detached, for instance). Every other non-zero timeout, signal or spawn failure is
 * still an error, and it is never reported as "the answer was no".
 */
export async function runMeaningfulExit(
  engine: GitEngine,
  spec: GitCommandSpec,
  meaningfulExitCodes: readonly number[],
): Promise<Uint8Array | null> {
  const result = await engine.run(spec);
  if (result.termination === "exit" && result.exitCode === 0) {
    return result.stdout;
  }
  if (isAcceptedExit(result, meaningfulExitCodes)) {
    return null;
  }
  throw failureFor(spec, result);
}

function failureFor(
  spec: GitCommandSpec,
  result: GitRunResult,
): GitWorkflowError {
  const diagnostic = boundedDiagnostic(result.stderr);
  const base = {
    command: spec.description,
    diagnostic,
    exitCode: result.exitCode,
  };
  switch (result.termination) {
    case "timeout":
      return new GitWorkflowError({
        ...base,
        code: "GitTimedOut",
        message: `${spec.description} did not finish within its deadline`,
      });
    case "output-limit":
      return new GitWorkflowError({
        ...base,
        code: "GitOutputLimitExceeded",
        message: `${spec.description} produced more output than the host will hold`,
      });
    case "spawn-error":
      return new GitWorkflowError({
        ...base,
        code: "GitNotStarted",
        message: `${spec.description} could not be started`,
      });
    case "signal":
      return new GitWorkflowError({
        ...base,
        code: "GitTerminatedBySignal",
        message: `${spec.description} was terminated by a signal`,
      });
    case "exit":
      return new GitWorkflowError({
        ...base,
        code: "GitCommandFailed",
        message: `${spec.description} exited with status ${result.exitCode ?? "?"}`,
      });
    default:
      return new GitWorkflowError({
        ...base,
        code: "GitCommandFailed",
        message: `${spec.description} ended without a usable result`,
      });
  }
}

/**
 * Diagnostic text for a failure.
 *
 * Truncated to the host's diagnostic bound and decoded leniently: these bytes are
 * for a human reading a journal, and a replacement character inside a Git message
 * is better than an exception thrown while reporting an exception.
 */
export function boundedDiagnostic(stderr: Uint8Array): string {
  const limited =
    stderr.byteLength > CORE_LIMITS.stderrDiagnosticMaxBytes
      ? stderr.subarray(0, CORE_LIMITS.stderrDiagnosticMaxBytes)
      : stderr;
  let text = "";
  for (const byte of limited) {
    if (byte === 0x0a) {
      text += "\n";
    } else if (byte >= 0x20 && byte < 0x7f) {
      text += String.fromCharCode(byte);
    } else if (byte >= 0x80) {
      // Multi-byte sequences are approximated rather than decoded: core has no
      // TextDecoder, and this text is diagnostic only.
      text += "\uFFFD";
    }
    if (text.length > 4000) {
      return `${text.slice(0, 4000)}…`;
    }
  }
  return text.trimEnd();
}

/** Wrap a parse failure so callers see one error type for every read. */
export function parseFailure(
  command: string,
  error: unknown,
): GitWorkflowError {
  const message =
    error instanceof Error ? error.message : "the output could not be parsed";
  return new GitWorkflowError({
    code: "GitOutputUnparsable",
    command,
    message: `${command}: ${message}`,
  });
}
