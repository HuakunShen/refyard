/**
 * Failure responses and the mapping from a problem to an HTTP status.
 *
 * One place decides what a client sees when something fails, so a code can never
 * mean "401" in one handler and "500" in another. The rules behind the mapping:
 *
 * - authentication and authorization failures are distinguishable (401 vs 403)
 *   because the UI's response differs: pair again, or explain why not;
 * - a failure this build cannot serve is `UnsupportedOperation` (501), not a 202 or
 *   an empty success — a client that asked for an unimplemented mutation must be
 *   able to tell "not implemented" from "did nothing wrong but nothing happened";
 * - Git failures are 409 when the request conflicted with repository state and 500
 *   with a bounded diagnostic otherwise, never a 200 with an error field.
 *
 * Responses carry no stack trace, no filesystem path the client did not already
 * know, and no Git output beyond the bounded diagnostic the problem already holds.
 */
import { randomBytes } from "node:crypto";
import type { Problem, ProblemCode } from "@refyard/git-contract";

export const STATUS_BY_CODE: Readonly<Record<ProblemCode, number>> = {
  Unauthenticated: 401,
  Forbidden: 403,
  NotFound: 404,
  InvalidRequest: 400,
  UnsupportedOperation: 501,
  InvalidOperationPayload: 422,
  UnsupportedPathEncoding: 422,
  StaleSnapshot: 409,
  StalePreview: 409,
  Conflict: 409,
  IdempotencyConflict: 409,
  ResourceBusy: 429,
  LimitExceeded: 413,
  GitCommandFailed: 500,
  NeedsAttention: 409,
  UncertainOutcome: 500,
  Timeout: 504,
  Cancelled: 409,
  Unavailable: 503,
  InternalError: 500,
};

export function statusForProblem(problem: Problem): number {
  return STATUS_BY_CODE[problem.code];
}

/** JSON headers used by every response; no caching, no MIME sniffing. */
export const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function problemBody(problem: Problem): string {
  // The envelope is fixed by the contract: `{ problem: {...} }`.
  return JSON.stringify({ problem });
}

export function problemFor(
  code: ProblemCode,
  message: string,
  details?: Record<string, string | number | boolean>,
  retryable = false,
): Problem {
  return {
    code,
    message,
    ...(details === undefined ? {} : { details }),
    retryable,
  };
}

/**
 * A correlation id for an internal defect.
 *
 * It is random, it is not an id anything else uses, and it is the only thing an
 * internal failure tells the client — the stack stays in the service log, where a
 * log reader can join on it. It is not a stack trace smuggled into a message.
 */
export function newCorrelationId(): string {
  return `err_${randomBytes(8).toString("base64url")}`;
}
