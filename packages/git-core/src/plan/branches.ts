/**
 * Planners for branch operations.
 *
 * Every command here is deliberately non-forcing: `switch` has no `--force`,
 * `branch --delete` has no `-D` form, and the delete planner does not offer one at
 * all — an unmerged branch that a caller wants gone is a fact for a human to face,
 * not a flag to pass. `--` separates names from options so a name that slipped
 * through as something option-shaped still cannot become one.
 *
 * Deadlines are `hook` class: creating or switching a branch runs the user's
 * `post-checkout`/`reference-transaction` hooks, and those are the user's code.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

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

/** `git branch <name> [<startOid>]` — create without moving HEAD. */
export function planBranchCreate(
  context: PlanContext,
  input: { readonly name: string; readonly startOid: string | null },
): GitCommandSpec {
  const argv = ["branch", "--", input.name];
  if (input.startOid !== null) {
    argv.push(input.startOid);
  }
  return spec(context, argv, "branch create");
}

/** `git switch --create <name> [<startOid>]` — create and check out. */
export function planBranchCreateAndSwitch(
  context: PlanContext,
  input: { readonly name: string; readonly startOid: string | null },
): GitCommandSpec {
  const argv = ["switch", "--create", input.name];
  if (input.startOid !== null) {
    argv.push(input.startOid);
  }
  return spec(context, argv, "switch --create");
}

/** `git switch <name>` — never forced; a conflict with local changes is Git's to report. */
export function planBranchSwitch(
  context: PlanContext,
  name: string,
): GitCommandSpec {
  return spec(context, ["switch", "--", name], "switch branch");
}

/** `git branch --move <old> <new>`. */
export function planBranchRename(
  context: PlanContext,
  input: { readonly name: string; readonly newName: string },
): GitCommandSpec {
  return spec(
    context,
    ["branch", "--move", input.name, input.newName],
    "branch --move",
  );
}

/** `git branch --delete <name>` — merged branches only; there is no force form. */
export function planBranchDelete(
  context: PlanContext,
  name: string,
): GitCommandSpec {
  return spec(context, ["branch", "--delete", name], "branch --delete");
}

/**
 * Set or clear a branch's upstream.
 *
 * `--set-upstream-to=<remote>/<branch>` is spelled with the literal `remote/branch`
 * because that is what Git resolves; the schema already constrained both parts. The
 * unset form is a separate flag rather than an empty value.
 */
export function planBranchSetUpstream(
  context: PlanContext,
  input: {
    readonly branchName: string;
    readonly upstream: {
      readonly remoteName: string;
      readonly branchName: string;
    } | null;
  },
): GitCommandSpec {
  if (input.upstream === null) {
    return spec(
      context,
      ["branch", "--unset-upstream", input.branchName],
      "branch --unset-upstream",
    );
  }
  return spec(
    context,
    [
      "branch",
      `--set-upstream-to=${input.upstream.remoteName}/${input.upstream.branchName}`,
      input.branchName,
    ],
    "branch --set-upstream-to",
  );
}
