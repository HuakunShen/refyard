/**
 * Planners for path-scoped reads and writes.
 *
 * Path handling is where a Git client gets dangerous. Two rules are implemented
 * here and tested:
 *
 * 1. Paths are never interpolated into a shell string — they go into argv as
 *    separate elements, or into stdin as NUL-separated bytes.
 * 2. `--literal-pathspecs` is set whenever a path came from the user, so a file
 *    called `:(glob)**` is a file, not a pathspec that expands to everything.
 *    `--` separates paths from revisions, and the leading `-` problem is handled
 *    by the same literal mode plus `--`.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

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

/** NUL-join raw path bytes for a `--pathspec-from-file=… --pathspec-file-nul` stdin. */
export function pathspecStdin(paths: readonly Uint8Array[]): Uint8Array {
  if (paths.length === 0) {
    throw new Error("pathspecStdin requires at least one path");
  }
  let total = 0;
  for (const path of paths) {
    total += path.byteLength + 1;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const path of paths) {
    bytes.set(path, offset);
    offset += path.byteLength;
    bytes[offset] = 0x00;
    offset += 1;
  }
  return bytes;
}

/**
 * `git add` for exactly the selected paths.
 *
 * --literal-pathspecs: do not interpret `*`, `:(glob)`, etc. in our paths.
 * --pathspec-from-file with --pathspec-file-nul: the path list arrives as bytes on
 * stdin, so no path length or character limits apply and no quoting is needed.
 * --: ends options, so a path named `-n` cannot become a flag.
 */
export function planStage(
  context: PlanContext,
  paths: readonly Uint8Array[],
): GitCommandSpec {
  return spec(
    context,
    [
      "--literal-pathspecs",
      "add",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--",
    ],
    "add paths",
    "hook",
    pathspecStdin(paths),
  );
}

/**
 * `git restore --staged` for the selected paths: index only, working tree
 * untouched. `--source=HEAD` is deliberately absent — unstage means "make the index
 * match HEAD", and when there is no HEAD the caller uses `planUnstageUnborn`.
 */
export function planUnstage(
  context: PlanContext,
  paths: readonly Uint8Array[],
): GitCommandSpec {
  return spec(
    context,
    [
      "--literal-pathspecs",
      "restore",
      "--staged",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--",
    ],
    "restore --staged paths",
    "hook",
    pathspecStdin(paths),
  );
}

/**
 * Unstage in a repository with no commits: remove the entries from the index.
 *
 * `git restore --staged` needs a HEAD to restore from, and an unborn branch has
 * none, so this is a separate planner rather than a flag on the previous one —
 * the difference is exactly the kind of thing that silently produces an empty
 * repository if it is inferred.
 */
export function planUnstageUnborn(
  context: PlanContext,
  paths: readonly Uint8Array[],
): GitCommandSpec {
  return spec(
    context,
    [
      "--literal-pathspecs",
      "rm",
      "--cached",
      "-r",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--",
    ],
    "rm --cached paths (unborn HEAD)",
    "hook",
    pathspecStdin(paths),
  );
}

/**
 * Restore working-tree files from the index.
 *
 * This is the "discard changes" primitive. It restores from the *index*, not from
 * HEAD — the design keeps those separate, and the caller is responsible for the
 * backup step before this runs.
 */
export function planRestoreWorktree(
  context: PlanContext,
  paths: readonly Uint8Array[],
): GitCommandSpec {
  return spec(
    context,
    [
      "--literal-pathspecs",
      "restore",
      "--worktree",
      "--pathspec-from-file=-",
      "--pathspec-file-nul",
      "--",
    ],
    "restore --worktree paths",
    "hook",
    pathspecStdin(paths),
  );
}

/** Changed paths between two revisions, with rename detection off (we report R/C). */
export function planDiffNameStatus(
  context: PlanContext,
  options: {
    readonly cached?: boolean;
    readonly from?: string;
    readonly to?: string;
  },
): GitCommandSpec {
  const argv = [
    "diff",
    "--name-status",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
  ];
  if (options.cached === true) {
    argv.push("--cached");
  }
  if (options.from !== undefined) {
    argv.push(options.from);
  }
  if (options.to !== undefined) {
    argv.push(options.to);
  }
  return spec(context, argv, "diff --name-status -z");
}

export function planDiffNumstat(
  context: PlanContext,
  options: {
    readonly cached?: boolean;
    readonly from?: string;
    readonly to?: string;
  },
): GitCommandSpec {
  const argv = ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv"];
  if (options.cached === true) {
    argv.push("--cached");
  }
  if (options.from !== undefined) {
    argv.push(options.from);
  }
  if (options.to !== undefined) {
    argv.push(options.to);
  }
  return spec(context, argv, "diff --numstat -z");
}

/**
 * Text patch for the whole change set (bounded by the caller's byte limit).
 *
 * `--submodule=short` makes a submodule change print its object names instead of
 * attempting to diff the submodule's contents.
 */
export function planDiffPatchAll(
  context: PlanContext,
  options: {
    readonly cached?: boolean;
    readonly from?: string;
    readonly to?: string;
  } = {},
): GitCommandSpec {
  const argv = [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--patch",
    "--submodule=short",
  ];
  if (options.cached === true) {
    argv.push("--cached");
  }
  if (options.from !== undefined) {
    argv.push(options.from);
  }
  if (options.to !== undefined) {
    argv.push(options.to);
  }
  return spec(context, argv, "diff patch (change set)");
}

/**
 * Text patch for exactly one path.
 *
 * The path is a string here because Git's argv is a string vector on this host;
 * the byte-level rule lives one level up: the host refuses a path whose bytes are
 * not representable, and the caller never substitutes a display form. The path is
 * also the *only* thing after `--`, and `--literal-pathspecs` keeps a file called
 * `:(glob)**` from expanding into every path in the repository.
 */
export function planDiffPatchForPath(
  context: PlanContext,
  options: {
    readonly path: string;
    readonly cached?: boolean;
    readonly from?: string;
    readonly to?: string;
  },
): GitCommandSpec {
  const argv = [
    "--literal-pathspecs",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--patch",
    "--submodule=short",
  ];
  if (options.cached === true) {
    argv.push("--cached");
  }
  if (options.from !== undefined) {
    argv.push(options.from);
  }
  if (options.to !== undefined) {
    argv.push(options.to);
  }
  argv.push("--", options.path);
  return spec(context, argv, "diff patch for one path");
}

/** Content of one blob, framed by the object protocol. Used for previews. */
export function planCatFileBlob(
  context: PlanContext,
  objectName: string,
): GitCommandSpec {
  const stdin = new Uint8Array(
    [...`${objectName}\n`].map((character) => character.charCodeAt(0)),
  );
  return spec(
    context,
    ["cat-file", "--batch"],
    "cat-file blob",
    "readonly",
    stdin,
  );
}
