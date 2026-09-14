/**
 * Shared pieces of the mutation effects: resolving what a request points at, and
 * turning outcomes into the shapes the job engine records.
 *
 * Every effect starts the same way — find the worktree the target names (a
 * repository target uses its primary worktree), read Head and status against it
 * *now*, and refuse before doing anything if that fails. Two effects doing this
 * differently is exactly how one of them ends up acting on a repository the request
 * never named, so it lives here once.
 */
import type { OperationResult, ParsedMutationRequest, Problem } from "@refyard/git-contract";
import {
  readHeadFacts,
  readStatusFacts,
  type GitEngine,
  type GitFailureCode,
  type HeadFacts,
  type StatusFacts,
} from "@refyard/git-core";
import type { RepositoryRegistry } from "../registry/repositories.js";
import { createGitDirLookup, readOperationMarkers } from "./read-support.js";
import { repositoryIdOfTarget } from "./submit.js";
import type { EffectOutcome } from "./jobs.js";

export interface WorktreeFacts {
  readonly worktreeId: string;
  readonly repositoryId: string;
  /** Handle of the worktree the target resolves to; commands run here. */
  readonly cwdHandle: string;
  readonly worktreePath: string;
  readonly head: HeadFacts;
  readonly status: StatusFacts;
}

export type Resolution<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: Problem };

function problemOf(
  code: Problem["code"],
  message: string,
  operationId: string,
): Problem {
  return { code, message, retryable: false, operationId };
}

export function failed(problem: Problem): EffectOutcome {
  return { kind: "failed", problem };
}

export function failedOp(
  operationId: string,
  code: Problem["code"],
  message: string,
): EffectOutcome {
  return failed(problemOf(code, message, operationId));
}

export function unknownOutcome(
  operationId: string,
  message: string,
): EffectOutcome {
  return {
    kind: "unknown",
    problem: problemOf("UncertainOutcome", message, operationId),
  };
}

export function resultOf(input: {
  readonly summary: string;
  readonly changedPaths?: number | null;
  readonly changedRefs?: readonly string[];
  readonly newHeadOid: string | null;
}): OperationResult {
  return {
    summary: input.summary,
    changedRefs: [...(input.changedRefs ?? [])],
    changedPaths: input.changedPaths ?? null,
    snapshotInvalidated: true,
    newHeadOid: input.newHeadOid,
  };
}

/**
 * How a Git failure of a *writing* command maps to an outcome.
 *
 * A clean non-zero exit failed without ambiguity. A timeout, a signal or any
 * other odd termination may have half-applied the change, and calling that
 * "failed" would hide it; those are unknown.
 */
export function writeOutcomeFromGit(
  operationId: string,
  outcome: {
    readonly code: GitFailureCode;
    readonly exitCode: number | null;
    readonly diagnostic: string;
  },
): EffectOutcome {
  return gitFailureOutcome(operationId, "the operation", outcome);
}

export function gitFailureOutcome(
  operationId: string,
  what: string,
  outcome: {
    readonly code: GitFailureCode;
    readonly exitCode: number | null;
    readonly diagnostic: string;
  },
): EffectOutcome {
  if (
    outcome.code === "GitTimedOut" ||
    outcome.code === "GitTerminatedBySignal" ||
    outcome.code === "GitOutputIncomplete"
  ) {
    return unknownOutcome(
      operationId,
      `${what} did not finish cleanly (${outcome.code}); whether it changed anything is not known and nothing was retried`,
    );
  }
  const message =
    outcome.diagnostic.trim().length > 0
      ? `git refused the operation: ${outcome.diagnostic}`
      : `git refused the operation (exit ${outcome.exitCode ?? "unknown"})`;
  return failedOp(operationId, "GitCommandFailed", message.slice(0, 2000));
}

export interface FactsResolverOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

/**
 * Build the resolver. A repository target resolves to the repository's primary
 * worktree — that is where `git branch`, `remote` and `push` run — while a worktree
 * target resolves to the worktree it named.
 */
export function createFactsResolver(
  options: FactsResolverOptions,
): (
  request: ParsedMutationRequest,
  operationId: string,
) => Promise<Resolution<WorktreeFacts>> {
  const gitDirs = createGitDirLookup(options.engine);

  return async function resolveFacts(request, operationId) {
    const repositoryId = repositoryIdOfTarget(request.target);
    if (repositoryId === null) {
      return {
        ok: false,
        problem: problemOf(
          "InvalidOperationPayload",
          "this operation must target a repository or a worktree",
          operationId,
        ),
      };
    }
    let record;
    try {
      record = await options.repositories.require(repositoryId);
    } catch {
      return {
        ok: false,
        problem: problemOf(
          "NotFound",
          "that request names a repository this service does not know",
          operationId,
        ),
      };
    }
    const worktreeId =
      request.target.kind === "worktree" ? request.target.worktreeId : null;
    let worktree;
    try {
      worktree = await options.repositories.worktree(repositoryId, worktreeId);
    } catch {
      return {
        ok: false,
        problem: problemOf(
          "NotFound",
          "that request names a worktree this service does not know; reload and retry",
          operationId,
        ),
      };
    }
    if (worktree.handle === null) {
      return {
        ok: false,
        problem: problemOf(
          "Forbidden",
          `${worktree.displayPath.text} is outside every approved root`,
          operationId,
        ),
      };
    }
    const gitDir = await gitDirs.gitDirFor({
      worktreeId: worktree.worktreeId,
      handle: worktree.handle,
      isMain: worktree.isMain,
      primaryGitDir: record.gitDir,
    });
    const [head, status] = await Promise.all([
      readHeadFacts(options.engine, worktree.handle),
      readStatusFacts(options.engine, {
        cwdHandle: worktree.handle,
        layout: {
          gitDir: record.gitDir,
          commonDir: record.commonDir,
          topLevel: record.bare ? null : record.displayPath.text,
          bare: record.bare,
          shallow: record.shallow,
          objectFormat: record.objectFormat,
        },
        operationMarkers: await readOperationMarkers(gitDir),
      }),
    ]);
    return {
      ok: true,
      value: {
        worktreeId: worktree.worktreeId,
        repositoryId,
        cwdHandle: worktree.handle,
        worktreePath: worktree.path,
        head,
        status,
      },
    };
  };
}

/** Re-read Head after a successful command so the result names the real tip. */
export async function headAfter(
  engine: GitEngine,
  cwdHandle: string,
): Promise<HeadFacts | null> {
  try {
    return await readHeadFacts(engine, cwdHandle);
  } catch {
    return null;
  }
}
