/**
 * Planners for cherry-picking one commit onto the checked-out branch.
 *
 * A cherry-pick shares the merge's lifecycle — start, stop into conflicts,
 * continue or abort — so its planners are the merge family's with `CHERRY_PICK_HEAD`
 * deciding the stop instead of `MERGE_HEAD`:
 *
 * - **the pick is `--no-edit` and nothing else.** The message is the original
 *   commit's; no `-m` is ever guessed, so Git itself refuses a merge commit the
 *   same way it refuses one for a revert.
 * - **`--continue` commits the resolved index with the original message.** Measured
 *   on this repository's Git: no editor opens, and the sequencer state is cleared.
 * - **`--abort` is the only way back.** No `reset --hard` substitute, ever.
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

/** `git cherry-pick --no-edit <oid>` — applies the commit's change as a new commit. */
export function planCherryPick(
  context: PlanContext,
  input: { readonly oid: string },
): GitCommandSpec {
  // The oid is a validated object name, so a leading dash cannot reinterpret the
  // rest of the command line.
  return spec(context, ["cherry-pick", "--no-edit", input.oid], "cherry-pick", "hook");
}

/** `git rev-parse --verify --quiet CHERRY_PICK_HEAD` — is a cherry-pick stopped? */
export function planCherryPickInProgress(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"],
    "rev-parse --verify CHERRY_PICK_HEAD",
    "readonly",
  );
}

/** `git cherry-pick --continue` — commit the resolved index. */
export function planCherryPickContinue(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["cherry-pick", "--continue"],
    "cherry-pick continue",
    "hook",
  );
}

/** `git cherry-pick --abort` — restore the state the pick started from. */
export function planCherryPickAbort(context: PlanContext): GitCommandSpec {
  return spec(context, ["cherry-pick", "--abort"], "cherry-pick abort", "hook");
}
