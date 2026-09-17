/**
 * The unified backend error: what an adapter is allowed to tell a caller.
 *
 * The point of these cases is that no caller has to know which transport produced
 * a failure — and that a transport answering with junk cannot be read as a
 * permission problem.
 */
import { describe, expect, it } from "vitest";
import { BackendError, isBackendError, normalizeProblem } from "@refyard/git-service";
import { problemSchema } from "@refyard/git-contract";

describe("BackendError", () => {
  const forbidden = {
    code: "Forbidden" as const,
    message: "the repository is not in this session's scope",
    retryable: false,
    details: { repositoryId: "repo_abc" },
  };

  it("carries the contract problem code rather than a transport status", () => {
    const error = new BackendError(forbidden, { status: 403 });
    expect(error.code).toBe("Forbidden");
    expect(error.retryable).toBe(false);
    expect(error.details).toEqual({ repositoryId: "repo_abc" });
    // The status is kept for diagnostics only; nothing branches on it.
    expect(error.status).toBe(403);
    expect(error.message).toBe(forbidden.message);
  });

  it("recognises an unauthenticated failure so a UI can re-pair instead of failing forever", () => {
    const error = new BackendError({
      code: "Unauthenticated",
      message: "no session",
      retryable: false,
    });
    expect(error.isUnauthenticated()).toBe(true);
    expect(isBackendError(error)).toBe(true);
    expect(isBackendError(new Error("plain"))).toBe(false);
  });

  it("treats missing details as an empty map instead of undefined", () => {
    // A caller reading `error.details.field` should not need a null check.
    const error = new BackendError({ code: "NotFound", message: "gone", retryable: false });
    expect(error.details).toEqual({});
    expect(error.correlationId).toBeNull();
  });

  it("keeps a native command rejection indistinguishable from an HTTP problem body", () => {
    // Both transports hand over the same `{ problem }` envelope; if one of them
    // produced a different shape the conformance suite would be the only thing
    // noticing, at the wrong time.
    const problem = normalizeProblem({ problem: forbidden }, { message: "unused" });
    expect(problemSchema.safeParse(problem).success).toBe(true);
    expect(problem.code).toBe("Forbidden");
  });
});

describe("normalizeProblem", () => {
  it("does not guess a permission problem from an unrecognised error body", () => {
    // A proxy or a crash can answer 403 with HTML. Reading that as Forbidden would
    // hide a broken deployment behind a permission message.
    const problem = normalizeProblem("<html>403</html>", {
      message: "the service returned 403 without a problem body",
      correlationId: "err_abc123",
    });
    expect(problem.code).toBe("InternalError");
    expect(problem.message).toContain("err_abc123");
  });

  it("falls back to InternalError when the problem body itself is malformed", () => {
    const problem = normalizeProblem({ problem: { code: "NotACode", message: "x" } }, {
      message: "unreadable failure",
    });
    expect(problem.code).toBe("InternalError");
    expect(problem.retryable).toBe(false);
  });

  it("accepts a bare problem object as well as an envelope", () => {
    const problem = normalizeProblem(
      { code: "StalePreview", message: "content changed", retryable: false },
      { message: "unused" },
    );
    expect(problem.code).toBe("StalePreview");
  });

  it("does not invent a retryable result", () => {
    // Only the host may say a failure is safe to retry.
    const problem = normalizeProblem(undefined, { message: "no body" });
    expect(problem.retryable).toBe(false);
  });
});
