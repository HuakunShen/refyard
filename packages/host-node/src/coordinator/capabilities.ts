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
 *
 * The second function is the other half of the same rule, learned on a machine whose
 * Git is older than the baseline: an operation can be implemented *and* unavailable,
 * because the porcelain it is built on is missing there. `refyard doctor` probes for
 * exactly that; this turns the probe answers into the same kind of entry, so the
 * capability list never offers an operation that Git would refuse with
 * "unknown option".
 */
import {
  MUTATION_KINDS,
  type MutationKind,
  type UnavailableReason,
} from "@refyard/git-contract";

/**
 * The mutations `implemented` does not cover, or an empty array when it covers all.
 *
 * `accountedFor` names kinds that are missing from `implemented` for a reason this
 * function must not claim: an operation this machine's Git cannot run is absent from the
 * registry too, and telling the reader "this build does not implement fetch" when the
 * truth is "your Git cannot report what a fetch moved" is exactly the kind of wrong
 * reason a capability list exists to avoid.
 */
export function unavailableMutations(
  implemented: readonly MutationKind[],
  options: { readonly accountedFor?: ReadonlySet<MutationKind> } = {},
): UnavailableReason[] {
  const covered = new Set(implemented);
  const accounted = options.accountedFor ?? new Set<MutationKind>();
  const missing = MUTATION_KINDS.filter(
    (kind) => !covered.has(kind) && !accounted.has(kind),
  );
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

/**
 * The mutations this machine's Git cannot run, given what the doctor probed.
 *
 * Only porcelain features gate anything: a missing `--porcelain` cannot be worked
 * around, while a missing *number* is not a capability question at all. `fetch
 * --porcelain` arrived in Git 2.41 and `push --porcelain` long before the baseline;
 * a Git that rejects either cannot report what moved, and an operation whose result
 * nobody can read is not offered.
 */
export function unavailableForGitFeatures(features: {
  readonly fetchPorcelain: boolean;
  readonly pushPorcelain: boolean;
}): UnavailableReason[] {
  const reasons: UnavailableReason[] = [];
  if (!features.fetchPorcelain) {
    reasons.push({
      code: "git-too-old",
      message:
        "this machine's Git does not support `fetch --porcelain`, which fetch and pull are built on; neither is offered here, and `refyard doctor` names the version it found",
      operations: ["fetch", "pull"],
    });
  }
  if (!features.pushPorcelain) {
    reasons.push({
      code: "git-too-old",
      message:
        "this machine's Git does not support `push --porcelain`, which push is built on; it is not offered here, and `refyard doctor` names the version it found",
      operations: ["push", "pushTag"],
    });
  }
  return reasons;
}

/** The kinds a feature-gated build must not register an effect for. */
export function kindsBlockedByGitFeatures(features: {
  readonly fetchPorcelain: boolean;
  readonly pushPorcelain: boolean;
}): ReadonlySet<MutationKind> {
  const blocked = new Set<MutationKind>();
  if (!features.fetchPorcelain) {
    blocked.add("fetch");
    blocked.add("pull");
  }
  if (!features.pushPorcelain) {
    blocked.add("push");
    blocked.add("pushTag");
  }
  return blocked;
}
