/**
 * Core-side byte and line bounds.
 *
 * These are duplicated from the published contract on purpose: core may not
 * import the contract's runtime (it would link Zod into a portable bundle), and a
 * numeric limit is not a type. `tests/core/limits.test.ts` asserts that every value
 * here equals the contract's published limit, so the duplication cannot drift
 * silently — which is the only way duplication of a number is acceptable.
 */
export const CORE_LIMITS = {
  /** Bounded machine output the host will hand to a parser. */
  structuredStdoutMaxBytes: 16 * 1024 * 1024,
  stderrDiagnosticMaxBytes: 256 * 1024,
  /** Bounded text patching, per file. */
  patchMaxBytesPerFile: 2 * 1024 * 1024,
  patchMaxLinesPerFile: 20_000,
  /** Object bodies read through cat-file. */
  objectMaxBytes: 16 * 1024 * 1024,
  /** Ref lists and stash lists. */
  refListMaxEntries: 5_000,
  stashListMaxEntries: 1_000,
  /** A single status read. */
  statusMaxEntries: 100_000,
} as const;

export type CoreLimits = typeof CORE_LIMITS;
