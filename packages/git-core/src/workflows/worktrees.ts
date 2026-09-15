/**
 * Worktree and submodule workflows: run one planned command and classify it.
 *
 * The classification is the same evidence-only rule the other workflows use: a
 * clean non-zero exit is a refusal with Git's diagnostic, and a timeout or a signal
 * may have half-applied (a worktree registered but not checked out, a submodule
 * cloned but not placed), so those are `unknown` rather than `failed`.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  boundedDiagnostic,
  GitWorkflowError,
  runRequired,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import {
  planWorktreeAdd,
  planWorktreeLock,
  planWorktreeRemove,
  planWorktreeUnlock,
  type WorktreeReference,
} from "../plan/worktrees.js";
import {
  planSubmoduleAdd,
  planSubmoduleSync,
  planSubmoduleUpdate,
} from "../plan/submodules.js";

export type RepositoryWriteOutcome =
  | { readonly kind: "done" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

async function runSpec(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<RepositoryWriteOutcome> {
  try {
    await runRequired(engine, spec);
    return { kind: "done" };
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      return {
        kind: "refused",
        code: error.code,
        exitCode: error.exitCode,
        diagnostic:
          error.diagnostic.length > 0
            ? error.diagnostic
            : boundedDiagnostic(new Uint8Array(0)),
      };
    }
    throw error;
  }
}

export function addWorktree(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly destination: string;
    readonly reference: WorktreeReference;
  },
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planWorktreeAdd(context, input));
}

export function removeWorktree(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  absolutePath: string,
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planWorktreeRemove(context, absolutePath));
}

export function lockWorktree(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly absolutePath: string; readonly reason: string | null },
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planWorktreeLock(context, input));
}

export function unlockWorktree(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  absolutePath: string,
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planWorktreeUnlock(context, absolutePath));
}

export function addSubmodule(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly url: string;
    readonly path: string;
    readonly branchName: string | null;
    readonly initialize: boolean;
  },
): Promise<RepositoryWriteOutcome> {
  // `initialize` is carried by `submodule add` itself for a fresh submodule: it
  // registers the URL and checks the working tree out. When it is false the entry
  // is still added to .gitmodules, which is Git's own behaviour for `add` and the
  // honest thing to report rather than pretend otherwise.
  return runSpec(
    engine,
    planSubmoduleAdd(context, {
      url: input.url,
      path: input.path,
      branchName: input.branchName,
    }),
  );
}

export function updateSubmodules(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly paths: readonly string[];
    readonly initialize: boolean;
    readonly recursive: boolean;
  },
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planSubmoduleUpdate(context, input));
}

export function syncSubmodules(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly paths: readonly string[]; readonly recursive: boolean },
): Promise<RepositoryWriteOutcome> {
  return runSpec(engine, planSubmoduleSync(context, input));
}
