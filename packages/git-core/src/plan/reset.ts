/**
 * Planners for resetting the checked-out branch to another commit.
 *
 * Only the two modes that cannot lose content are planned, ever:
 *
 * - **`--soft`** moves the branch; the index stays exactly as it is.
 * - **`--mixed`** moves the branch and resets the index to the target; staged work
 *   becomes unstaged, but every byte stays in the working tree or the object store.
 *
 * `--hard` is not planned by anything in this build: discarding working-tree
 * content belongs to the discard machinery, which pre-checks paths and backs
 * them up first. The working tree is never an input to these commands.
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

/** `git reset --soft|--mixed <oid>` — the branch moves, the working tree does not. */
export function planResetBranch(
  context: PlanContext,
  input: {
    readonly oid: string;
    readonly mode: "soft" | "mixed";
  },
): GitCommandSpec {
  // The oid is a validated object name, so a leading dash cannot reinterpret the
  // rest of the command line.
  const flag = input.mode === "soft" ? "--soft" : "--mixed";
  // The "hook" class is this build's longest write deadline: reset rewrites the
  // index in place, which on a huge checkout is not a fast command even though
  // no hook ever runs.
  return spec(context, ["reset", flag, input.oid], `reset ${input.mode}`, "hook");
}
