/**
 * Planners for dropping one commit from the checked-out branch.
 *
 * The whole operation is one `rebase --onto <parent> <oid>` — replay every
 * descendant of the dropped commit onto its parent — plus the three read-only
 * probes that refuse a drop before Git rewrites anything: the commit is on the
 * branch, it has a parent to replay onto, and it is not a merge (a merge cannot
 * be replayed linearly, so dropping one is not a decision this build makes).
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
  deadlineClass: GitCommandSpec["deadlineClass"],
): GitCommandSpec {
  return { argv, cwdHandle: context.cwdHandle, deadlineClass, description };
}

/** `git merge-base --is-ancestor <oid> HEAD` — is the commit on this branch? */
export function planDropCommitAncestry(
  context: PlanContext,
  input: { readonly oid: string },
): GitCommandSpec {
  return spec(
    context,
    ["merge-base", "--is-ancestor", input.oid, "HEAD"],
    "merge-base --is-ancestor",
    "readonly",
  );
}

/**
 * `git rev-parse --verify <oid>^2` — does the commit have a second parent?
 * Exit 0 means it is a merge, which a linear replay cannot represent.
 */
export function planDropCommitSecondParent(
  context: PlanContext,
  input: { readonly oid: string },
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", `${input.oid}^2`],
    "rev-parse --verify oid^2",
    "readonly",
  );
}

/** `git rev-parse --verify <oid>^` — the parent the descendants replay onto. */
export function planDropCommitParent(
  context: PlanContext,
  input: { readonly oid: string },
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", `${input.oid}^`],
    "rev-parse --verify oid^",
    "readonly",
  );
}

/** `git rebase --onto <parent> <oid>` — replay descendants without the commit. */
export function planDropCommitRebase(
  context: PlanContext,
  input: { readonly oid: string; readonly parentOid: string },
): GitCommandSpec {
  return spec(
    context,
    ["rebase", "--onto", input.parentOid, input.oid],
    "drop commit rebase",
    "hook",
  );
}
