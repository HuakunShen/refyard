/**
 * Planners for worktree operations.
 *
 * Two rules shape every command here:
 *
 * - **no destructive fallback.** `git worktree remove` has no `--force` in this
 *   build; a dirty or locked worktree is Git's refusal to report, and nothing here
 *   ever deletes files that Git would not. `prune` is not offered for the same
 *   reason.
 * - **the destination is absolute and already proven inside an approved root.** The
 *   planner receives a resolved path; the caller is what checked containment, and
 *   this split is deliberate — a planner that guessed at roots could not be tested.
 *
 * `worktree` class commands run hooks and touch the index, so they take the `hook`
 * deadline.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

/** What a new worktree checks out. Mirrors the contract's reference union. */
export type WorktreeReference =
  | { readonly kind: "existingBranch"; readonly branchName: string }
  | {
      readonly kind: "newBranch";
      readonly branchName: string;
      readonly startOid: string;
    }
  | { readonly kind: "detached"; readonly oid: string };

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
): GitCommandSpec {
  return {
    argv,
    cwdHandle: context.cwdHandle,
    deadlineClass: "hook",
    description,
  };
}

/**
 * `git worktree add` for one of the three reference kinds.
 *
 * The existing-branch form uses `--` before the destination so a path that begins
 * with `-` cannot be read as an option; the other two carry their own switches
 * first, and the branch name came through the schema.
 */
export function planWorktreeAdd(
  context: PlanContext,
  input: {
    readonly destination: string;
    readonly reference: WorktreeReference;
  },
): GitCommandSpec {
  const reference = input.reference;
  if (reference.kind === "existingBranch") {
    return spec(
      context,
      ["worktree", "add", "--", input.destination, reference.branchName],
      "worktree add (existing branch)",
    );
  }
  if (reference.kind === "newBranch") {
    return spec(
      context,
      [
        "worktree",
        "add",
        "-b",
        reference.branchName,
        "--",
        input.destination,
        reference.startOid,
      ],
      "worktree add (new branch)",
    );
  }
  return spec(
    context,
    ["worktree", "add", "--detach", "--", input.destination, reference.oid],
    "worktree add (detached)",
  );
}

/** `git worktree remove <absolute path>` — never forced. */
export function planWorktreeRemove(
  context: PlanContext,
  absolutePath: string,
): GitCommandSpec {
  return spec(context, ["worktree", "remove", absolutePath], "worktree remove");
}

/** `git worktree lock [--reason=<r>] <absolute path>`. */
export function planWorktreeLock(
  context: PlanContext,
  input: { readonly absolutePath: string; readonly reason: string | null },
): GitCommandSpec {
  const argv = ["worktree", "lock"];
  if (input.reason !== null) {
    argv.push(`--reason=${input.reason}`);
  }
  argv.push(input.absolutePath);
  return spec(context, argv, "worktree lock");
}

/** `git worktree unlock <absolute path>`. */
export function planWorktreeUnlock(
  context: PlanContext,
  absolutePath: string,
): GitCommandSpec {
  return spec(context, ["worktree", "unlock", absolutePath], "worktree unlock");
}
