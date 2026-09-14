/**
 * Planners for commit and stash creation.
 *
 * A commit message is bytes and it goes in on stdin (`-F -`), not in an argument:
 * an argument would be length-limited, would pass through the host's command line
 * (visible to other processes on some systems), and would need quoting rules that
 * differ per platform. The message also must not be sanitised — a message with
 * a trailing blank line is a message the user wrote.
 *
 * The planners here refuse to add anything to the index. `git commit` without
 * `-a`/`--include` commits the index as it stands, which is what the design
 * requires: no implicit staging, and no empty commit unless the user asks for one
 * (which this version does not offer).
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
  stdin?: Uint8Array,
): GitCommandSpec {
  return stdin === undefined
    ? { argv, cwdHandle: context.cwdHandle, deadlineClass: "hook", description }
    : {
        argv,
        cwdHandle: context.cwdHandle,
        deadlineClass: "hook",
        description,
        stdin,
      };
}

/**
 * `git commit -F -` with the message on stdin.
 *
 * `--cleanup=verbatim` keeps the message exactly as typed: Git's default cleanup
 * would strip trailing whitespace and comment lines, which silently changes what
 * the user wrote. Signature and hook behaviour are untouched — nothing here adds
 * `--no-verify` or `--no-gpg-sign`, and a hook that fails is reported.
 */
export function planCommit(
  context: PlanContext,
  message: Uint8Array,
): GitCommandSpec {
  if (message.byteLength === 0) {
    throw new Error("planCommit requires a non-empty message");
  }
  return spec(
    context,
    ["commit", "--cleanup=verbatim", "--file=-"],
    "commit -F -",
    message,
  );
}

/**
 * `git commit --amend -F -` (or `--no-edit` when the message is unchanged).
 *
 * Amending rewrites history. The request must have carried explicit confirmation
 * before this planner is reached; the planner's job is only to make the rewrite
 * unambiguous, so it always passes an explicit `--no-edit` when keeping the
 * message rather than relying on an editor being absent.
 */
export function planAmendCommit(
  context: PlanContext,
  message: Uint8Array | null,
): GitCommandSpec {
  if (message === null) {
    return spec(
      context,
      ["commit", "--amend", "--no-edit"],
      "commit --amend --no-edit",
    );
  }
  if (message.byteLength === 0) {
    throw new Error("planAmendCommit requires a non-empty message or null");
  }
  return spec(
    context,
    ["commit", "--amend", "--cleanup=verbatim", "--file=-"],
    "commit --amend -F -",
    message,
  );
}

/**
 * `git stash push` with explicit switches.
 *
 * The message travels in argv rather than stdin because `git stash` has no stdin
 * form for it (`-m/--message <message>` is the only way). The `--message=<value>`
 * spelling is used so a message that begins with `-` cannot be re-read as a
 * switch, and the message is the caller's text, bounded by the request schema.
 *
 * `--include-untracked` only when asked: stashing untracked files can sweep in
 * files the user never intended to touch, and ignored files are never included.
 * `--keep-index` is explicit too — stashing with a staged change and then popping
 * it back is one of the few ways to lose work with two commands.
 */
export function planStashPush(
  context: PlanContext,
  options: {
    readonly message: string | null;
    readonly includeUntracked: boolean;
    readonly keepIndex: boolean;
  },
): GitCommandSpec {
  const argv = ["stash", "push"];
  if (options.message !== null) {
    argv.push(`--message=${options.message}`);
  }
  if (options.includeUntracked) {
    argv.push("--include-untracked");
  }
  if (options.keepIndex) {
    argv.push("--keep-index");
  }
  return spec(context, argv, "stash push");
}

/**
 * Apply a stash without dropping it.
 *
 * The locator and the object name are both passed: Git resolves the locator, and
 * the workflow has already re-checked that the locator still points at the object
 * name the user saw. `--index` is only added when asked, because restoring the
 * index is a separate decision from restoring the files.
 */
export function planStashApply(
  context: PlanContext,
  options: { readonly locator: string; readonly restoreIndex: boolean },
): GitCommandSpec {
  const argv = ["stash", "apply"];
  if (options.restoreIndex) {
    argv.push("--index");
  }
  // The locator is a positional: the request schema pins it to `stash@{n}`, so it
  // cannot begin with `-` and cannot be read as an option.
  argv.push(options.locator);
  return spec(context, argv, "stash apply");
}

/**
 * `git stash pop`: apply, and drop only on success.
 *
 * Git's own semantics are used rather than "apply then drop" as two commands, so
 * a conflict leaves the stash in place. Nothing here drops a stash on failure.
 */
export function planStashPop(
  context: PlanContext,
  options: { readonly locator: string; readonly restoreIndex: boolean },
): GitCommandSpec {
  const argv = ["stash", "pop"];
  if (options.restoreIndex) {
    argv.push("--index");
  }
  argv.push(options.locator);
  return spec(context, argv, "stash pop");
}

/** `git stash drop` for one entry. Destructive, and confirmed by the caller. */
export function planStashDrop(
  context: PlanContext,
  locator: string,
): GitCommandSpec {
  return spec(context, ["stash", "drop", locator], "stash drop");
}

/**
 * Verify that a stash locator still resolves to an object name.
 *
 * Used immediately before apply/pop/drop: `stash@{2}` is a *position*, and another
 * `git stash` run by anyone — including the user in a terminal — shifts every
 * position after it. Comparing the object name is how a pop cannot land on the
 * wrong entry.
 */
export function planStashResolve(
  context: PlanContext,
  locator: string,
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", `${locator}^{commit}`],
    "rev-parse stash locator",
  );
}
