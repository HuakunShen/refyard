/**
 * Planners for rebasing the checked-out branch onto another commit.
 *
 * - **the pick of upstream is the only input.** No `--onto`, no interactive
 *   todo list, no force: those are history-rewrite powers this build does not
 *   hand out.
 * - **`--continue` runs with `core.editor=true`.** Measured on this machine's
 *   Git: a bare `git rebase --continue` opens the message editor for the
 *   replayed commit. The `-c` override is process-scoped — no config file is
 *   read or written, no hook or signing setting is touched — and the commit
 *   keeps its original message, which is what the operation's promise is.
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

/** `git rebase <upstreamOid>` — replay this branch's own commits. */
export function planRebase(
  context: PlanContext,
  input: { readonly upstreamOid: string },
): GitCommandSpec {
  // The oid is a validated object name, so a leading dash cannot reinterpret the
  // rest of the command line.
  return spec(context, ["rebase", input.upstreamOid], "rebase", "hook");
}

/** `git rev-parse --verify REBASE_HEAD` — is a rebase stopped mid-way? */
export function planRebaseInProgress(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "REBASE_HEAD"],
    "rev-parse --verify REBASE_HEAD",
    "readonly",
  );
}

/** `git -c core.editor=true rebase --continue` — resume, editor suppressed. */
export function planRebaseContinue(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["-c", "core.editor=true", "rebase", "--continue"],
    "rebase continue",
    "hook",
  );
}

/** `git rebase --abort` — restore the branch to where the rebase started. */
export function planRebaseAbort(context: PlanContext): GitCommandSpec {
  return spec(context, ["rebase", "--abort"], "rebase abort", "hook");
}
