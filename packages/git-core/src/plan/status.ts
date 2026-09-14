/**
 * Planners for read-only commands.
 *
 * Every production `git` invocation in this project is built by a planner in
 * `packages/git-core/src/plan`. No other module constructs argv, which is what
 * makes "the browser cannot ask for arbitrary execution" checkable: a client
 * request maps to a planner, and a planner emits a fixed argument vector.
 *
 * Conventions that every planner here follows:
 *
 * - the executable is not included (the host chooses the `git` binary),
 * - `--no-optional-locks` on status so a read cannot take the index lock and
 *   interfere with a concurrent write elsewhere,
 * - `--no-ext-diff` and `--no-textconv` on every diff so a repository's
 *   configuration cannot turn a read into running an external program,
 * - `-z`/`--porcelain` where the format exists, with a comment naming why,
 * - and stdin for anything unstructured (tips, pathspecs, messages) rather than
 *   interpolating it into an argument.
 */
import type { GitCommandSpec } from "../ports.js";

export interface PlanContext {
  /** Host-issued handle for the authorised directory the command runs in. */
  readonly cwdHandle: string;
}

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
  deadlineClass: GitCommandSpec["deadlineClass"] = "readonly",
  stdin?: Uint8Array,
): GitCommandSpec {
  return stdin === undefined
    ? { argv, cwdHandle: context.cwdHandle, deadlineClass, description }
    : { argv, cwdHandle: context.cwdHandle, deadlineClass, description, stdin };
}

/** `git status --porcelain=v2 --branch -z [--ignored=matching] [--show-stash]`. */
export function planStatus(
  context: PlanContext,
  options: { includeIgnored?: boolean; showStash?: boolean } = {},
): GitCommandSpec {
  const argv = [
    "--no-optional-locks",
    "status",
    "--porcelain=v2",
    "--branch",
    "-z",
  ];
  if (options.showStash === true) {
    argv.push("--show-stash");
  }
  if (options.includeIgnored === true) {
    argv.push("--ignored=matching");
  }
  return spec(context, argv, "status --porcelain=v2 --branch -z");
}

/**
 * Repository layout facts, one per line: git dir, common dir, top level, bare,
 * object format, shallow.
 *
 * `--path-format=absolute` is required: without it `--git-common-dir` prints a
 * relative path that means something different depending on where Git was run.
 */
export function planRepositoryLayout(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    [
      "--no-optional-locks",
      "rev-parse",
      "--path-format=absolute",
      "--absolute-git-dir",
      "--git-common-dir",
      "--show-toplevel",
      "--is-bare-repository",
      "--show-object-format",
      "--is-shallow-repository",
    ],
    "rev-parse layout",
  );
}

/** HEAD state in one line: `HEAD` or a detached object name. */
export function planHeadRef(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["symbolic-ref", "--quiet", "HEAD"],
    "symbolic-ref HEAD",
  );
}

/**
 * Topology-only history for one fixed set of tips.
 *
 * Tips arrive on stdin (not argv) so a ref name can never be read as an option,
 * and `--parents` gives the edges the graph needs without reading commit bodies.
 * The caller records the tips it used: a page must be served from the snapshot it
 * started with, not from whatever the branch points at now.
 */
export function planRevList(
  context: PlanContext,
  options: {
    readonly tips: readonly string[];
    readonly maxCount: number;
    readonly skip: number;
    readonly firstParentOnly?: boolean;
  },
): GitCommandSpec {
  if (options.tips.length === 0) {
    throw new Error("planRevList requires at least one tip");
  }
  const argv = [
    "rev-list",
    "--topo-order",
    "--parents",
    `--max-count=${options.maxCount}`,
  ];
  if (options.skip > 0) {
    argv.push(`--skip=${options.skip}`);
  }
  if (options.firstParentOnly === true) {
    argv.push("--first-parent");
  }
  argv.push("--stdin");
  const stdin = new Uint8Array(
    [...`${options.tips.join("\n")}\n`].map((character) =>
      character.charCodeAt(0),
    ),
  );
  return spec(context, argv, "rev-list topology", "readonly", stdin);
}

/**
 * Object bodies by name, framed by `cat-file --batch`'s length protocol.
 *
 * Names go in on stdin, one per line, and the reply carries `<type> <size>` before
 * the body — which is the only reason a commit message containing a quote,
 * a newline or a backslash survives the trip.
 */
export function planCatFileBatch(
  context: PlanContext,
  objectNames: readonly string[],
): GitCommandSpec {
  if (objectNames.length === 0) {
    throw new Error("planCatFileBatch requires at least one object name");
  }
  const stdin = new Uint8Array(
    [...`${objectNames.join("\n")}\n`].map((character) =>
      character.charCodeAt(0),
    ),
  );
  return spec(
    context,
    ["cat-file", "--batch"],
    "cat-file --batch",
    "readonly",
    stdin,
  );
}

/** Local branches, remote-tracking branches, tags and remotes in one listing. */
export function planForEachRef(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)",
      "--sort=refname",
    ],
    "for-each-ref",
  );
}

/** Worktree list with NUL attributes, so a lock reason with a newline survives. */
export function planWorktreeList(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["worktree", "list", "--porcelain", "-z"],
    "worktree list --porcelain -z",
  );
}

/** The index, including gitlinks and unmerged stages. */
export function planLsFilesStage(context: PlanContext): GitCommandSpec {
  return spec(context, ["ls-files", "--stage", "-z"], "ls-files --stage -z");
}

/** Only the unmerged stages of conflicted paths. */
export function planLsFilesUnmerged(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["ls-files", "--unmerged", "--stage", "-z"],
    "ls-files --unmerged --stage -z",
  );
}

/**
 * Stash entries from the reflog, with the locator, object name, subject and
 * timestamp. The locator is a moving label, so the object name travels with it.
 */
export function planStashList(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["reflog", "show", "--format=%gd%x00%H%x00%gs%x00%ct", "refs/stash"],
    "reflog show refs/stash",
  );
}

/** True when the command is a read that must not take optional locks. */
export function isReadOnlySpec(command: GitCommandSpec): boolean {
  return command.deadlineClass === "readonly";
}
