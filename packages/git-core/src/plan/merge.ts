/**
 * Planners for merging, continuing a merge and aborting one.
 *
 * The three commands are deliberately thin, because the interesting part of a merge
 * is not the argv but what Git leaves behind when it stops:
 *
 * - **`merge` never picks a strategy or a message policy on the user's behalf.** The
 *   request's `mode` chooses between Git's default (fast-forward when it can) and an
 *   explicit merge commit (`--no-ff`); the message is either the one the request
 *   carried or Git's own default via `--no-edit`. No editor is ever started — the
 *   service has no terminal, and `--no-edit` is what makes that a property of the
 *   command rather than of the environment.
 * - **The source is one object name, never a branch name.** A branch that moves
 *   between the snapshot the user saw and the request they sent must not silently
 *   become a different merge, so the planner takes the commit the UI resolved and
 *   nothing else.
 * - **`continueMerge` is `git commit` and that is all.** After a conflict the resolved
 *   index already holds the merge; committing it is the continue step. There is no
 *   path through this planner that stages files, edits messages or resolves anything.
 * - **`abortMerge` is `git merge --abort`.** There is no `reset --hard` here and
 *   there must never be one: a reset is a different, larger action that would also
 *   touch work Git deliberately refuses to touch during an abort.
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

/** `git merge [--no-ff] [--no-edit | -m <message>] <object>` — a network-free but hook-running command. */
export function planMerge(
  context: PlanContext,
  input: {
    readonly sourceOid: string;
    readonly mode: "default" | "no-ff";
    readonly message: string | null;
  },
): GitCommandSpec {
  const argv = ["merge"];
  if (input.mode === "no-ff") {
    argv.push("--no-ff");
  }
  if (input.message === null) {
    argv.push("--no-edit");
  } else {
    argv.push("-m", input.message);
  }
  // A leading dash cannot change the meaning of the source: it is a validated object
  // name, and `--` would be read by Git as "the rest are paths", which a merge does
  // not take. The validation above is what makes this safe, not a separator.
  argv.push(input.sourceOid);
  return spec(context, argv, "merge", "hook");
}

/**
 * `git commit [--no-edit | -m <message>]` — the continue step of a stopped merge.
 *
 * No `--no-verify`: the user's hooks run on a merge commit exactly as they do on any
 * other commit, and a hook that refuses is reported as a refusal.
 */
export function planMergeContinue(
  context: PlanContext,
  input: { readonly message: string | null },
): GitCommandSpec {
  const argv = ["commit"];
  if (input.message === null) {
    argv.push("--no-edit");
  } else {
    argv.push("-m", input.message);
  }
  return spec(context, argv, "commit (merge continue)", "hook");
}

/** `git merge --abort` — restore the state the merge started from. */
export function planMergeAbort(context: PlanContext): GitCommandSpec {
  return spec(context, ["merge", "--abort"], "merge --abort", "hook");
}

/** `git rev-parse --verify --quiet <rev>^{commit}` — resolve a revision to a commit. */
export function planResolveCommit(
  context: PlanContext,
  revision: string,
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
    "rev-parse --verify (commit)",
    "readonly",
  );
}

/**
 * `git rev-parse --verify --quiet MERGE_HEAD` — is a merge in progress?
 *
 * The marker is read through Git rather than from the Git directory on disk because
 * core is host-free: asking Git is both allowed and more accurate, since Git resolves
 * the marker through the same worktree and common-directory rules it will use to
 * finish the merge.
 */
export function planMergeInProgress(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
    "rev-parse --verify MERGE_HEAD",
    "readonly",
  );
}
