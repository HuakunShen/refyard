/**
 * A `GitHostPort` wired to a real fixture repository.
 *
 * This is what a test uses when it needs the whole chain — core planner, spec,
 * handle registry, environment, process — against a repository that really exists.
 * Two properties make the fixture trustworthy:
 *
 * - the only approved root is the fixture's own scratch directory, so a test that
 *   accidentally asks for another directory fails the same way production would;
 * - the child environment comes from the fixture's isolated HOME, so Git reads the
 *   scratch global config rather than the developer's.
 */
import type { GitCommandSpec, GitRunResult } from "@refyard/git-core";
import {
  createGitHost,
  createHandleRegistry,
  type GitHost,
  type HandleRegistry,
} from "@refyard/host-node";
import { fixtureGitPath, type GitFixtureRepo } from "./repo.js";

export interface FixtureGitHost {
  readonly host: GitHost;
  readonly registry: HandleRegistry;
  readonly allowedRootId: string;
  /** Handle for the repository root, the working directory of most commands. */
  readonly cwdHandle: string;
  readonly gitPath: string;
  /** Run one raw Git command through the host, for test setup and assertions. */
  git(
    args: readonly string[],
    options?: { readonly stdin?: Uint8Array; readonly handle?: string },
  ): Promise<GitRunResult>;
  dispose(): Promise<void>;
}

export interface CreateFixtureGitHostOptions {
  readonly repo: GitFixtureRepo;
  /** Override the executable, e.g. to point at a program that is not Git. */
  readonly gitPath?: string;
  /** Force a limit, e.g. a tiny stdout bound to exercise `output-limit`. */
  readonly limitsFor?: (spec: GitCommandSpec) => {
    readonly stdoutMaxBytes: number;
    readonly stderrMaxBytes: number;
    readonly deadlineMs: number;
    readonly killGraceMs: number;
  };
}

export async function createFixtureGitHost(
  options: CreateFixtureGitHostOptions,
): Promise<FixtureGitHost> {
  const registry = createHandleRegistry();
  const allowedRootId = "root_test1";
  await registry.approveRoot({ allowedRootId, path: options.repo.root });
  const cwdHandle = registry.handleFor(allowedRootId, "");
  const gitPath = options.gitPath ?? fixtureGitPath();
  const host = createGitHost({
    gitPath,
    registry,
    // The fixture's own environment wins over the ambient one, so Git never reads
    // the developer's global config during a test. `buildGitEnvironment` applies
    // these last, after the allow-list and the host-set values.
    env: { ...options.repo.env },
    ...(options.limitsFor === undefined
      ? {}
      : { limitsFor: options.limitsFor }),
  });

  return {
    host,
    registry,
    allowedRootId,
    cwdHandle,
    gitPath,
    async git(args, runOptions = {}) {
      const spec: GitCommandSpec = {
        argv: args,
        cwdHandle: runOptions.handle ?? cwdHandle,
        ...(runOptions.stdin === undefined ? {} : { stdin: runOptions.stdin }),
        deadlineClass: "readonly",
        description: args.join(" "),
      };
      return host.runGit(spec, { runId: "test" });
    },
    async dispose() {
      await options.repo.dispose();
    },
  };
}
