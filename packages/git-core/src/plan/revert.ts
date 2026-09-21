/**
 * Planners for reverting one completed commit.
 *
 * A revert is the second write in this build (after a merge) that can legitimately
 * end *in the middle*: a conflict stops with `REVERT_HEAD` and a staged inverse
 * patch behind. The planners are thin on purpose — the interesting decisions live
 * in the workflow, which classifies the stop and aborts before reporting.
 *
 * - **`revert` is `--no-edit` and nothing else.** The message is Git's own revert
 *   message, the user's hooks run as they do on any commit, and no `-m` is ever
 *   guessed: reverting a merge needs a parent choice this build does not make.
 * - **`REVERT_HEAD` decides whether a stop happened**, the same way `MERGE_HEAD`
 *   does for a merge, and it is re-read after the command rather than predicted
 *   from the exit code.
 * - **`abort` is `git revert --abort`.** No `reset --hard` substitute, ever.
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

/** `git revert --no-edit <oid>` — a network-free but hook-running command. */
export function planRevertCommit(
  context: PlanContext,
  input: { readonly oid: string },
): GitCommandSpec {
  // The oid is a validated object name, so a leading dash cannot reinterpret the
  // rest of the command line.
  return spec(context, ["revert", "--no-edit", input.oid], "revert", "hook");
}

/** `git rev-parse --verify --quiet REVERT_HEAD` — is a revert stopped mid-way? */
export function planRevertInProgress(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", "REVERT_HEAD"],
    "rev-parse --verify REVERT_HEAD",
    "readonly",
  );
}

/** `git revert --abort` — restore the state the revert started from. */
export function planRevertAbort(context: PlanContext): GitCommandSpec {
  return spec(context, ["revert", "--abort"], "revert abort", "hook");
}
