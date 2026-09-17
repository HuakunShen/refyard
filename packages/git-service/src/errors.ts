/**
 * One error type for every adapter.
 *
 * The HTTP status is diagnostic only: an adapter that turned `403` into a different
 * class than the native adapter's `Forbidden` would make every caller branch on
 * where the data came from. What crosses this boundary is the contract's `Problem`
 * code, its retryability, and its redacted details — nothing about the transport.
 */
import { problemSchema, type Problem, type ProblemCode } from "@refyard/git-contract";

export interface BackendErrorOptions {
  /** Transport-level status, for diagnostics. Never the basis of a decision. */
  readonly status?: number | null;
  /** Correlation id the host attached, if the transport carried one. */
  readonly correlationId?: string | null;
}

export class BackendError extends Error {
  readonly problem: Problem;
  readonly code: ProblemCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  readonly retryable: boolean;
  readonly correlationId: string | null;
  readonly status: number | null;

  constructor(problem: Problem, options: BackendErrorOptions = {}) {
    super(problem.message);
    this.name = "BackendError";
    this.problem = problem;
    this.code = problem.code;
    this.details = problem.details ?? {};
    this.retryable = problem.retryable;
    this.correlationId = options.correlationId ?? null;
    this.status = options.status ?? null;
  }

  isUnauthenticated(): boolean {
    return this.code === "Unauthenticated";
  }
}

export function isBackendError(value: unknown): value is BackendError {
  return value instanceof BackendError;
}

/**
 * Turns an unvalidated failure value into a `Problem`.
 *
 * A transport that answers with something that is not a problem body must not be
 * interpreted by reading its message: guessing `Forbidden` from English text is how
 * a compatibility layer invents permissions. The result is an explicit
 * InternalError that names the correlation id instead.
 */
export function normalizeProblem(
  input: unknown,
  fallback: { readonly message: string; readonly correlationId?: string | null },
): Problem {
  const direct = problemSchema.safeParse(input);
  if (direct.success) return direct.data;

  // A `{ problem: … }` envelope is what both the HTTP error body and the native
  // command rejection carry, so unwrapping is safe without asserting a type.
  const wrapped = problemSchema.safeParse(
    typeof input === "object" && input !== null ? Reflect.get(input, "problem") : undefined,
  );
  if (wrapped.success) return wrapped.data;

  return {
    code: "InternalError",
    message:
      fallback.correlationId === undefined || fallback.correlationId === null
        ? fallback.message
        : `${fallback.message} (correlation ${fallback.correlationId})`,
    retryable: false,
  };
}
