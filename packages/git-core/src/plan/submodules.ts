/**
 * Planners for submodule operations.
 *
 * The commands are deliberately narrow:
 *
 * - **`update` is `--checkout` of the recorded commit.** `--remote`, `--force` and
 *   `--merge` are not spelled anywhere, so a submodule cannot drift to a newer
 *   remote commit or discard local work through this path; the design also forbids
 *   honouring a configured `submodule.<name>.update` shell command, and the only
 *   defense against that is passing none of the switches that would consult it —
 *   which is what happens here.
 * - **`sync` copies URLs from the parent configuration**, recursing only when asked.
 * - **`add` clones from the URL the request carried.** The URL was validated at the
 *   boundary (no transport helpers) and is shown to the user before the connection
 *   is made; the planner's job is only to place it as argv.
 *
 * Paths after `--` are the submodule paths the user selected, bounded by the
 * contract's selection limit.
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

/** `git submodule add [-b <branch>] <url> <path>` — a network operation. */
export function planSubmoduleAdd(
  context: PlanContext,
  input: {
    readonly url: string;
    readonly path: string;
    readonly branchName: string | null;
  },
): GitCommandSpec {
  const argv = ["submodule", "add"];
  if (input.branchName !== null) {
    argv.push("-b", input.branchName);
  }
  argv.push("--", input.url, input.path);
  return spec(context, argv, "submodule add", "network");
}

/**
 * `git submodule update --checkout [--init] [--recursive] -- <paths>`.
 *
 * No `--remote`, no `--force`, no `--merge`, no `--rebase`: the recorded commit is
 * the target, always.
 */
export function planSubmoduleUpdate(
  context: PlanContext,
  input: {
    readonly paths: readonly string[];
    readonly initialize: boolean;
    readonly recursive: boolean;
  },
): GitCommandSpec {
  const argv = ["submodule", "update", "--checkout"];
  if (input.initialize) {
    argv.push("--init");
  }
  if (input.recursive) {
    argv.push("--recursive");
  }
  argv.push("--", ...input.paths);
  return spec(context, argv, "submodule update --checkout", "network");
}

/** `git submodule sync [--recursive] -- <paths>`. */
export function planSubmoduleSync(
  context: PlanContext,
  input: { readonly paths: readonly string[]; readonly recursive: boolean },
): GitCommandSpec {
  const argv = ["submodule", "sync"];
  if (input.recursive) {
    argv.push("--recursive");
  }
  argv.push("--", ...input.paths);
  return spec(context, argv, "submodule sync", "hook");
}
