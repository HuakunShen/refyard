/**
 * What a failure to *read* a repository's facts means for a request.
 *
 * Two places need this answer and they must agree:
 *
 * - the submit-time preconditions, where a request whose state cannot be read is
 *   refused before anything is accepted — a boundary refusal with a code, never a
 *   `500` from an exception escaping into the HTTP layer;
 * - the effect resolver, where an effect that cannot read its preconditions reports
 *   `failed`. `unknown` means Git may have changed something and a human must check;
 *   a read that failed before any command ran changed nothing, and calling that
 *   uncertain would send the user to verify a repository that was never touched.
 *
 * The mapping mirrors the read service's (`coordinator/reads.ts`): a deadline is
 * `Timeout`, a missing `git` is `Unavailable`, and anything else Git refused is
 * `GitCommandFailed` with Git's own diagnostic attached — never a cause guessed from
 * English output.
 */
import type { Problem } from "@refyard/git-contract";
import { GitWorkflowError } from "@refyard/git-core";
import { HandleError } from "../filesystem/handles.js";

/** Git's diagnostic is bounded here; it is for a human reading a failure, not a log. */
const DIAGNOSTIC_MAX_CHARS = 500;

export interface ReadFailure {
  readonly code: Problem["code"];
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * Translate a failure to read facts, or null when it is not one this module knows.
 *
 * The diagnostic is appended rather than replacing the message: the message names the
 * command that failed, and Git's own words are what tells a user whether the cause was
 * a missing repository, a permissions problem or a bare working tree.
 */
export function readFailureOf(error: unknown): ReadFailure | null {
  if (error instanceof GitWorkflowError) {
    const code: Problem["code"] =
      error.code === "GitTimedOut"
        ? "Timeout"
        : error.code === "GitNotStarted"
          ? "Unavailable"
          : error.code === "GitOutputLimitExceeded"
            ? "LimitExceeded"
            : error.code === "GitOutputUnparsable" ||
                error.code === "GitOutputIncomplete" ||
                error.code === "ObjectMissing"
              ? "InternalError"
              : "GitCommandFailed";
    const diagnostic = error.diagnostic.trim();
    return {
      code,
      message:
        diagnostic.length === 0
          ? error.message
          : `${error.message}: ${diagnostic.slice(0, DIAGNOSTIC_MAX_CHARS)}`,
      retryable: code === "Timeout",
    };
  }
  if (error instanceof HandleError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  return null;
}

/**
 * The refusal for a request whose facts could not be read.
 *
 * An unrecognised error is still a refusal: nothing was attempted, so an
 * `InternalError` problem is both true and actionable, where letting it escape as a
 * `500` would lose the fact that no write happened.
 */
export function refusalOf(error: unknown): {
  readonly code: Problem["code"];
  readonly message: string;
} {
  const failure = readFailureOf(error);
  if (failure !== null) {
    return { code: failure.code, message: failure.message };
  }
  return {
    code: "InternalError",
    message:
      error instanceof Error
        ? error.message
        : "the repository's state could not be read",
  };
}

/**
 * The refusal for a write aimed at a bare repository.
 *
 * This build reads a bare repository — refs, history and its head — and does not write
 * to one. Its Git operations are the working-tree family (stage, commit, discard,
 * stash, worktree), which have nothing to act on there, and a refusal that names that
 * fact is more useful than the `fatal: this operation must be run in a work tree` that
 * Git would print for some of them and not others.
 */
export function bareRefusalOf(displayPath: string): {
  readonly code: Problem["code"];
  readonly message: string;
} {
  return {
    code: "UnsupportedOperation",
    message: `${displayPath} is a bare repository: it has no working tree, so this build refuses to write to it. Its refs and history can still be read.`,
  };
}
