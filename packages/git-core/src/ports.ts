/**
 * The private host interface that portable core is allowed to use.
 *
 * This file is the whole point of the architecture: core plans Git commands and
 * parses their output, but it cannot spawn, read, encode, time or cancel anything
 * itself. Those arrive through `GitHostPort`, which only the trusted Node host
 * implements. Nothing here is a public JSON schema — a browser never sees a
 * `GitCommandSpec`, an argv vector, a working directory or an environment.
 */
import type { ObjectFormat } from "@refyard/git-contract";

/**
 * One Git invocation: an argument vector, never a shell string.
 *
 * `argv` excludes the executable — the host decides which `git` binary to run and
 * resolves `cwdHandle` to a real, authorised directory. `stdin` is bytes because
 * commit messages and pathspec lists are bytes; nothing is interpolated into a
 * shell, and there is no `env` field on purpose: the host owns the environment so
 * a planner cannot smuggle a redirect through it.
 */
export interface GitCommandSpec {
  readonly argv: readonly string[];
  readonly cwdHandle: string;
  readonly stdin?: Uint8Array;
  /**
   * Which deadline the host should apply. Reads are seconds, network operations
   * minutes, and hook-running writes get their own class because a user's hook may
   * legitimately be slow.
   */
  readonly deadlineClass: "readonly" | "network" | "hook";
  /** Human-readable label for journals and diagnostics, e.g. `status --porcelain=v2`. */
  readonly description: string;
}

/** Why a Git process stopped. `timeout` and `output-limit` are not rollbacks. */
export type GitTermination =
  "exit" | "signal" | "timeout" | "output-limit" | "spawn-error" | "unknown";

/** The raw outcome of one Git process: bytes, exit status, and how it ended. */
export interface GitRunResult {
  readonly termination: GitTermination;
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  /** Bounded and redacted by the host; may be truncated. */
  readonly stderr: Uint8Array;
  readonly stderrTruncated: boolean;
  /** Milliseconds the process ran, reported by the host clock (never measured in core). */
  readonly durationMs: number | null;
}

/** Context for one run: an id for diagnostics and journal correlation. */
export interface GitRunContext {
  readonly runId: string;
}

/**
 * Privileged, scope-bound capability. Implemented only by the Node host, and
 * never exposed over HTTP, SSE or any browser bridge.
 */
export interface GitHostPort {
  runGit(spec: GitCommandSpec, context: GitRunContext): Promise<GitRunResult>;
}

/**
 * Path bytes and their display form.
 *
 * Core keeps raw bytes: Git reports paths as bytes, and a POSIX path is not
 * necessarily valid UTF-8. Decoding for *display* is the host's job, and the
 * result is marked representable or not — an unrepresentable path may be shown
 * but must never be sent back as an operation input.
 */
export interface DisplayPath {
  readonly text: string;
  readonly representable: boolean;
}

export interface TextCodec {
  /** Escape a raw path for display. Never used to build an execution argument. */
  toDisplayPath(bytes: Uint8Array): DisplayPath;
  /** Decode object contents (commit messages) for display. */
  decodeText(bytes: Uint8Array): string;
}

/** Object format of a repository, as detected from Git, never assumed. */
export interface RepositoryObjectFormat {
  readonly format: ObjectFormat;
  readonly oidLength: number;
}

/**
 * A parse failure. Parsers throw this instead of returning a partial result: a
 * half-read status is worse than an error, because the UI would show it as fact.
 */
export class GitOutputParseError extends Error {
  readonly format: string;
  readonly offset: number | null;

  constructor(format: string, message: string, offset: number | null = null) {
    super(offset === null ? message : `${message} (at byte ${offset})`);
    this.name = "GitOutputParseError";
    this.format = format;
    this.offset = offset;
  }
}

/** ASCII space, the only separator Git's machine formats use between fields. */
export const SP = 0x20;
/** NUL, the record separator of every `-z` format. */
export const NUL = 0x00;
/** Line feed. */
export const LF = 0x0a;
/** Tab, used as a field separator by numstat and `ls-files --stage`. */
export const TAB = 0x09;
