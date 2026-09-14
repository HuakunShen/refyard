/**
 * The core's copies of published limits must equal the contract's.
 *
 * `packages/git-core` may not import the contract's runtime (that would link Zod
 * into a portable bundle), so the byte/entry bounds it enforces are duplicated as
 * plain numbers. That duplication is only acceptable because this test fails the
 * moment the two disagree — the alternative, a silently different bound on each
 * side of the host boundary, is exactly the kind of drift that turns into a
 * "the UI says 500 but the server refuses at 200" bug report.
 */
import { describe, expect, it } from "vitest";
import { LIMITS, RUNTIME_LIMITS } from "@refyard/git-contract";
import { CORE_LIMITS } from "@refyard/git-core";

describe("limits shared between the contract and the portable core", () => {
  it("agrees on every bound the core enforces", () => {
    expect(CORE_LIMITS.patchMaxBytesPerFile).toBe(LIMITS.patchMaxBytesPerFile);
    expect(CORE_LIMITS.patchMaxLinesPerFile).toBe(LIMITS.patchMaxLinesPerFile);
    expect(CORE_LIMITS.objectMaxBytes).toBe(LIMITS.objectMaxBytes);
    expect(CORE_LIMITS.structuredStdoutMaxBytes).toBe(
      LIMITS.structuredStdoutMaxBytes,
    );
    expect(CORE_LIMITS.stderrDiagnosticMaxBytes).toBe(
      LIMITS.stderrDiagnosticMaxBytes,
    );
    expect(CORE_LIMITS.refListMaxEntries).toBe(LIMITS.refListMaxEntries);
    expect(CORE_LIMITS.stashListMaxEntries).toBe(LIMITS.stashListMaxEntries);
    expect(CORE_LIMITS.statusMaxEntries).toBeGreaterThanOrEqual(
      LIMITS.refListMaxEntries,
    );
  });

  it("publishes the same numbers in capabilities as the contract declares", () => {
    expect(RUNTIME_LIMITS.patchMaxBytesPerFile).toBe(
      LIMITS.patchMaxBytesPerFile,
    );
    expect(RUNTIME_LIMITS.objectMaxBytes).toBe(LIMITS.objectMaxBytes);
  });
});
