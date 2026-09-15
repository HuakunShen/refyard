/**
 * Planners for creating a repository: `git init` and `git clone`.
 *
 * These are the two commands whose subject does not exist yet, which is why they are
 * planned differently from the rest of the suite:
 *
 * - **the destination is absolute and already proven inside an approved root.** The
 *   host resolved the workspace target (root plus relative destination) and proved
 *   containment; a planner that guessed at roots could not be tested, and a planner
 *   that built a path from client text would be an injection waiting to happen.
 * - **the branch name is the request's or Git's**, never a name invented here. Both
 *   commands therefore take the destination after `--`: an argument that begins with
 *   `-` is a path, not a switch.
 * - **there is no `--porcelain` and no cleanup.** `git clone` has no machine-readable
 *   mode, so the workflow classifies by exit status and by what the destination
 *   contains afterwards, and nothing here ever removes a path the user chose.
 *
 * `init` takes the write deadline (it installs templates and writes configuration;
 * it runs no hook, because a directory that is not yet a repository has none to run)
 * and `clone` takes the network deadline, which is the longest the contract allows.
 */
import type { GitCommandSpec } from "../ports.js";
import type { PlanContext } from "./status.js";

/**
 * `git init` at an absolute destination.
 *
 * `--quiet` keeps Git's advice text ("Using 'master' as the name for the initial
 * branch…") out of the diagnostic, which matters because the workflow reports that
 * diagnostic when the command fails: advice in the middle of it reads as a warning
 * about a failure that did not happen.
 */
export function planRepositoryInit(
  context: PlanContext,
  input: {
    readonly destination: string;
    /** Git's own default when null: the target machine decides the name. */
    readonly initialBranch: string | null;
  },
): GitCommandSpec {
  const argv =
    input.initialBranch === null
      ? ["init", "--quiet", "--", input.destination]
      : [
          "init",
          "--quiet",
          `--initial-branch=${input.initialBranch}`,
          "--",
          input.destination,
        ];
  return {
    argv,
    cwdHandle: context.cwdHandle,
    deadlineClass: "hook",
    description: "init",
  };
}

/**
 * `git clone` into an absolute destination.
 *
 * Submodules are initialised only when the request asked: `--recurse-submodules`
 * fetches more than the user asked for, and doing that by default would make the
 * first clone of a large project unexpectedly expensive.
 */
export function planRepositoryClone(
  context: PlanContext,
  input: {
    readonly remoteUrl: string;
    readonly destination: string;
    readonly initializeSubmodules: boolean;
  },
): GitCommandSpec {
  const argv = [
    "clone",
    "--quiet",
    ...(input.initializeSubmodules ? ["--recurse-submodules"] : []),
    "--",
    input.remoteUrl,
    input.destination,
  ];
  return {
    argv,
    cwdHandle: context.cwdHandle,
    deadlineClass: "network",
    description: "clone",
  };
}
