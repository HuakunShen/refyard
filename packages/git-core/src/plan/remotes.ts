/**
 * Planners for remote configuration and the network operations.
 *
 * Three rules decide the shape of every command here:
 *
 * - **Explicit refs, always.** A push names exactly one source and one destination
 *   and passes them as `<src>:<dst>`. There is no form that pushes "everything", no
 *   `--mirror`, no `--force`, and no bare `<refspec>` from a client. Fetch names one
 *   remote; pull is `--ff-only` with no merge, rebase or autostash.
 * - **Machine output.** `--porcelain` on push/fetch/pull is not decoration: the
 *   workflow reads per-ref outcomes from it, and a non-zero exit with a partial
 *   success must not collapse into "failed".
 * - **No prompting.** `GIT_TERMINAL_PROMPT=0` is set by the host, not here, but the
 *   planners avoid commands that would open an editor or a pager. A missing
 *   credential is a failure to report, never a prompt to sit on.
 *
 * Network commands run with the `network` deadline class (minutes, not seconds).
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

/** `git remote add <name> <url>` (config change, not a network operation). */
export function planRemoteAdd(
  context: PlanContext,
  input: { readonly name: string; readonly fetchUrl: string },
): GitCommandSpec {
  return spec(
    context,
    ["remote", "add", input.name, input.fetchUrl],
    "remote add",
    "hook",
  );
}

/** `git remote set-url [--push] <name> <url>`. */
export function planRemoteSetUrl(
  context: PlanContext,
  input: { readonly name: string; readonly url: string; readonly push: boolean },
): GitCommandSpec {
  const argv = ["remote", "set-url"];
  if (input.push) {
    argv.push("--push");
  }
  argv.push(input.name, input.url);
  return spec(context, argv, "remote set-url", "hook");
}

/** `git remote rename <old> <new>` — remote-tracking refs move with it. */
export function planRemoteRename(
  context: PlanContext,
  input: { readonly name: string; readonly newName: string },
): GitCommandSpec {
  return spec(
    context,
    ["remote", "rename", input.name, input.newName],
    "remote rename",
    "hook",
  );
}

/** `git remote remove <name>` — local branches are untouched by Git itself. */
export function planRemoteRemove(
  context: PlanContext,
  name: string,
): GitCommandSpec {
  return spec(context, ["remote", "remove", name], "remote remove", "hook");
}

/**
 * `git fetch --porcelain <remote>`.
 *
 * `tags` is explicit in both directions: `following` allows the default follow
 * behaviour, `none` disables it, so a fetch never sweeps in tags the user did not
 * ask about. `--prune` is only added when asked.
 */
export function planFetch(
  context: PlanContext,
  input: {
    readonly remoteName: string;
    readonly prune: boolean;
    readonly tags: "none" | "following";
  },
): GitCommandSpec {
  const argv = ["fetch", "--porcelain"];
  if (input.prune) {
    argv.push("--prune");
  }
  argv.push(input.tags === "none" ? "--no-tags" : "--tags");
  argv.push(input.remoteName);
  return spec(context, argv, "fetch --porcelain", "network");
}

/**
 * `git push --porcelain <remote> <src>:<dst>`.
 *
 * `--set-upstream` only when the request asked. `--no-follow-tags` is passed
 * explicitly: the user's `push.followTags` configuration must not turn one selected
 * ref into a tag sweep.
 */
export function planPush(
  context: PlanContext,
  input: {
    readonly remoteName: string;
    readonly sourceRef: string;
    readonly destinationRef: string;
    readonly setUpstream: boolean;
  },
): GitCommandSpec {
  const argv = ["push", "--porcelain", "--no-follow-tags"];
  if (input.setUpstream) {
    argv.push("--set-upstream");
  }
  argv.push(input.remoteName, `${input.sourceRef}:${input.destinationRef}`);
  return spec(context, argv, "push --porcelain", "network");
}

/**
 * Resolve a branch's upstream to `remote/branch`, or fail with exit 128.
 *
 * Pull is implemented as its two real halves — fetch, then fast-forward — because
 * `git pull` has no machine-readable form and its single exit code collapses
 * "tracking refs updated" into "the branch did not move". This planner is how the
 * second half knows what to fast-forward to; the caller treats a non-zero exit as
 * "no upstream configured", which is a refusal with Git's own message.
 */
export function planBranchUpstreamRef(
  context: PlanContext,
  branchName: string,
): GitCommandSpec {
  return spec(
    context,
    [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      `${branchName}@{upstream}`,
    ],
    "rev-parse branch upstream",
    "readonly",
  );
}

/**
 * `git merge --ff-only <ref>` — the branch half of a pull.
 *
 * `--ff-only` is not configurable: a divergence fails, and the workflow reports
 * "remote-tracking refs updated" separately from "the branch did not move". No
 * `--autostash`, no editor, and `--no-edit` in case a merge message would otherwise
 * be requested.
 */
export function planFastForwardMerge(
  context: PlanContext,
  ref: string,
): GitCommandSpec {
  return spec(
    context,
    ["merge", "--ff-only", "--no-edit", ref],
    "merge --ff-only",
    "hook",
  );
}
