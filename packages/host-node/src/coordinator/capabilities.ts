/**
 * What this build does not implement, said out loud.
 *
 * `capabilities` advertises an operation exactly when an effect for it is registered,
 * and everything the contract defines but this build cannot run is named here with a
 * reason. The rule lives in one function because it was previously written inline in
 * the CLI: the test harness, which claims to be wired the way the CLI is, then had no
 * `unavailable` list at all — so a harness case that wanted to prove the 501 path
 * could not, and the two wirings could drift apart without anything failing.
 *
 * The input is the coordinator's own registry, never a second list of "supported
 * kinds": adding an effect moves a kind out of this answer automatically, and the
 * message cannot outlive the fact.
 */
import {
  MUTATION_KINDS,
  type MutationKind,
  type UnavailableReason,
} from "@refyard/git-contract";

/** The mutations `implemented` does not cover, or an empty array when it covers all. */
export function unavailableMutations(
  implemented: readonly MutationKind[],
): UnavailableReason[] {
  const covered = new Set(implemented);
  const missing = MUTATION_KINDS.filter((kind) => !covered.has(kind));
  if (missing.length === 0) {
    // An empty list, not a sentence: there is nothing to explain.
    return [];
  }
  return [
    {
      code: "not-implemented",
      message: `this build does not implement ${missing.length} of the contract's mutations; each is named here and none of them is reported as available`,
      operations: [...missing],
    },
  ];
}
