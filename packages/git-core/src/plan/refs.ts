/**
 * Planners for repository metadata that is not a status or a diff.
 *
 * These reads all share one property: they answer "what does this repository
 * *say* about itself" without touching the working tree — configured remotes,
 * `.gitmodules`, and the tree entry a commit recorded for a path.
 *
 * `.gitmodules` is read with `git config --file` rather than by parsing the file:
 * Git's config grammar allows includes, escapes and repeated keys, and a
 * hand-written parser would disagree with Git on exactly the repositories that use
 * those features. The read is scoped to one file inside the worktree and never
 * loads the system or global config.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

function spec(
  context: PlanContext,
  argv: readonly string[],
  description: string,
  deadlineClass: GitCommandSpec["deadlineClass"] = "readonly",
): GitCommandSpec {
  return { argv, cwdHandle: context.cwdHandle, deadlineClass, description };
}

/**
 * Configured remotes and their URLs.
 *
 * `-v` prints `<name>\t<url> (fetch|push)` per remote. URLs are read, never
 * echoed: the host redacts credentials before a URL reaches a response, and a
 * remote's URL is display data, never an argument the browser can supply.
 */
export function planRemotes(context: PlanContext): GitCommandSpec {
  return spec(context, ["remote", "-v"], "remote -v");
}

/**
 * Submodule names, paths and URLs, as written in the worktree's `.gitmodules`.
 *
 * `-z` frames `key\nvalue` records with NUL, so a URL or path containing a newline
 * cannot be split into two entries. The caller checks that the file exists first:
 * Git reports a missing config file as an error, and "no `.gitmodules`" is an
 * ordinary answer, not a failure.
 */
export function planSubmoduleConfig(context: PlanContext): GitCommandSpec {
  return spec(
    context,
    ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\."],
    "config --file .gitmodules --get-regexp",
  );
}

/**
 * The tree entry a commit recorded for one path.
 *
 * This is the parent repository's *recorded* object for a submodule, which is the
 * first of the three object names a submodule row must show. The path is
 * literal-pathspec'd and placed after `--`, and it arrives as text only because
 * the host has already refused any path whose bytes cannot be represented.
 */
export function planLsTreeEntry(
  context: PlanContext,
  options: { readonly revision: string; readonly path: string },
): GitCommandSpec {
  return spec(
    context,
    [
      "--literal-pathspecs",
      "ls-tree",
      "-z",
      options.revision,
      "--",
      options.path,
    ],
    "ls-tree for one path",
  );
}

/**
 * Verify that a name really resolves to an object of the expected kind.
 *
 * Snapshot tips are object names captured earlier; between capture and use a ref
 * may move or an object may be pruned. `--verify --quiet` makes that a non-zero
 * exit instead of a confusing parse error later, and `^{commit}` refuses a tag or
 * a tree that merely happens to be named like a commit.
 */
export function planRevParseCommit(
  context: PlanContext,
  objectName: string,
): GitCommandSpec {
  return spec(
    context,
    ["rev-parse", "--verify", "--quiet", `${objectName}^{commit}`],
    "rev-parse --verify <name>^{commit}",
  );
}

/**
 * Check whether one object name is present locally.
 *
 * Used for the "missing parent" question: a graph that draws a parent as a root
 * hides a shallow clone or a partially fetched repository. `cat-file -e` answers
 * presence without transferring the body.
 */
export function planCatFileExists(
  context: PlanContext,
  objectNames: readonly string[],
): GitCommandSpec {
  if (objectNames.length === 0) {
    throw new Error("planCatFileExists requires at least one object name");
  }
  const stdin = new Uint8Array(
    [...`${objectNames.join("\n")}\n`].map((character) =>
      character.charCodeAt(0),
    ),
  );
  return {
    argv: ["cat-file", "--batch-check=%(objectname)"],
    cwdHandle: context.cwdHandle,
    deadlineClass: "readonly",
    description: "cat-file --batch-check",
    stdin,
  };
}
