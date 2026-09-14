/**
 * The public error envelope.
 *
 * Every failure a client can see is one of these codes plus a human message. The
 * code set is closed on purpose: `GitCommandFailed` carries limited, redacted
 * diagnostics rather than a regex-guessed classification, and an outcome that
 * could not be determined is `UncertainOutcome`, never a success and never a
 * silent retry.
 */
import { z } from "zod";
import { operationIdSchema } from "./ids.js";

export const PROBLEM_CODES = [
  /** No usable bearer, or the session expired. Pair again. */
  "Unauthenticated",
  /** Authenticated, but this actor or scope may not touch the resource. */
  "Forbidden",
  /** Unknown resource, operation or path. */
  "NotFound",
  /** The request itself is malformed: shape, unknown key, bad field type. */
  "InvalidRequest",
  /** The operation or target is not supported by this build. */
  "UnsupportedOperation",
  /** A combination that is structurally valid but semantically impossible. */
  "InvalidOperationPayload",
  /** A path exists but its raw bytes cannot be represented for execution on this host. */
  "UnsupportedPathEncoding",
  /** The state moved since the snapshot the request was planned against. */
  "StaleSnapshot",
  /** A preview token no longer matches the file's content fingerprint. */
  "StalePreview",
  /** A precondition the operation depends on is not met (Git lock, dirty worktree, conflict). */
  "Conflict",
  /** The same client request id was used with a different payload. */
  "IdempotencyConflict",
  /** The queue or the repository writer is busy. */
  "ResourceBusy",
  /** A configured limit was exceeded (patch size, page size, queue depth, body size). */
  "LimitExceeded",
  /** Git exited non-zero. Diagnostics are included, but not a guessed cause. */
  "GitCommandFailed",
  /** Git stopped on a state a human must resolve (conflict, hook failure, external process). */
  "NeedsAttention",
  /** Git may have changed things, but the outcome could not be confirmed. Never auto-retried. */
  "UncertainOutcome",
  /** A deadline elapsed. Timeout is not rollback. */
  "Timeout",
  /** The operation was cancelled while queued. A running mutation is never relabelled this way. */
  "Cancelled",
  /** This service build cannot serve the request (missing Git, unsupported filesystem semantics). */
  "Unavailable",
  /** A defect in this service. Includes a correlation id, not a stack trace. */
  "InternalError",
] as const;

export const problemCodeSchema = z.enum(PROBLEM_CODES).meta({
  id: "ProblemCode",
  description:
    "Closed set of failure codes. Clients branch on these, not on message text.",
});

export const problemSchema = z
  .strictObject({
    code: problemCodeSchema,
    message: z.string().min(1).max(2000),
    /** Flat, redacted facts: field names, limits, Git exit codes. Never file contents. */
    details: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    retryable: z.boolean(),
    /** Present when the failure belongs to a submitted operation. */
    operationId: operationIdSchema.optional(),
  })
  .meta({
    id: "Problem",
    description: "One failure, with enough detail for a UI decision.",
  });

export const problemResponseSchema = z
  .strictObject({ problem: problemSchema })
  .meta({
    id: "ProblemResponse",
    description: "The body of any 4xx/5xx JSON response.",
  });

export type ProblemCode = z.infer<typeof problemCodeSchema>;
export type Problem = z.infer<typeof problemSchema>;
export type ProblemResponse = z.infer<typeof problemResponseSchema>;

/**
 * An internal validation finding. `path` points at the offending field so a form
 * can highlight it; it never contains the value that failed (which may be a
 * secret such as a credential-bearing URL).
 */
export interface ValidationProblem {
  readonly code: ProblemCode;
  readonly message: string;
  readonly path?: string;
}

/** Result of validating untrusted input at the contract boundary. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly ValidationProblem[] };

export function invalid<T = never>(
  code: ProblemCode,
  message: string,
  path?: string,
): ValidationResult<T> {
  return {
    ok: false,
    problems: [
      path === undefined ? { code, message } : { code, message, path },
    ],
  };
}

export function invalidMany<T = never>(
  problems: readonly ValidationProblem[],
): ValidationResult<T> {
  return { ok: false, problems };
}
