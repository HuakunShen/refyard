/**
 * The rebase mutation effects: replay the branch onto a commit, continue a
 * stopped rebase, abort one.
 *
 * These mirror the merge and cherry-pick families because the lifecycle is the
 * same sequencer shape:
 *
 * - **Conflicts are `needsAttention`.** Git stopped mid-replay with unmerged
 *   index stages; the record says how many paths are conflicted, and the status
 *   read names them.
 * - **A stop this build cannot advance is `failed` with what it means**: the
 *   stop was aborted, and the branch is exactly as it was.
 * - **A refusal before Git touched anything is `failed`** with Git's diagnostic.
 * - **An abort Git refuses is also a refusal, and the rebase state stays.** No
 *   reset fallback anywhere in this file.
 */
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  abortRebase,
  continueRebase,
  rebase,
  type AbortRebaseOutcome,
  type ContinueRebaseOutcome,
  type GitEngine,
  type RebaseOutcome,
} from "@refyard/git-core";
import type { RepositoryRegistry } from "../registry/repositories.js";
import {
  createEffect,
  type EffectOutcome,
  type MutationEffect,
} from "./jobs.js";
import {
  createFactsResolver,
  failedOp,
  gitFailureOutcome,
  resultOf,
  unknownOutcome,
} from "./effects-support.js";

export interface RebaseEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

function rebaseOutcomeOf(
  operationId: string,
  outcome: RebaseOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "rebased": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "rebased the current branch onto the target commit",
          changedRefs: [],
          newHeadOid: outcome.head?.oid ?? null,
        }),
      };
    }
    case "conflicted": {
      return {
        kind: "needsAttention",
        problem: {
          code: "GitCommandFailed",
          message:
            `the rebase stopped with ${outcome.conflictedPaths} conflicted path(s); ` +
            `resolve them, stage the results and continue, or abort the rebase` +
            (outcome.diagnostic.trim().length === 0
              ? ""
              : ` (git: ${outcome.diagnostic.trim().slice(0, 600)})`),
          details: { conflictedPaths: outcome.conflictedPaths },
          retryable: false,
          operationId,
        },
      };
    }
    case "stopAborted": {
      return failedOp(
        operationId,
        "Conflict",
        `the rebase stopped for a reason other than a conflict and was aborted, so the branch is unchanged: ${outcome.diagnostic.trim().slice(0, 600)}`,
      );
    }
    case "refused": {
      return failedOp(operationId, "Conflict", outcome.reason);
    }
    case "gitRefused": {
      return gitFailureOutcome(operationId, "the rebase", outcome.refusal);
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `the rebase did not finish cleanly (${outcome.code}); whether Git changed anything is not known and nothing was retried`,
      );
    }
  }
}

function continueOutcomeOf(
  operationId: string,
  outcome: ContinueRebaseOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "rebased": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "continued the rebase and committed the resolved index",
          changedRefs: [],
          newHeadOid: outcome.head?.oid ?? null,
        }),
      };
    }
    case "conflicted": {
      return {
        kind: "needsAttention",
        problem: {
          code: "GitCommandFailed",
          message: `the rebase is still stopped: ${outcome.conflictedPaths} conflicted path(s) remain unresolved`,
          details: { conflictedPaths: outcome.conflictedPaths },
          retryable: false,
          operationId,
        },
      };
    }
    case "refused": {
      return failedOp(operationId, "GitCommandFailed", outcome.reason);
    }
    case "gitRefused": {
      return failedOp(
        operationId,
        "GitCommandFailed",
        outcome.refusal.diagnostic.trim().length === 0
          ? `git refused to continue the rebase (exit ${outcome.refusal.exitCode ?? "unknown"})`
          : `git refused to continue the rebase: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — the rebase is still in progress`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `continuing the rebase did not finish cleanly (${outcome.code}); whether the commit was created is not known and nothing was retried`,
      );
    }
  }
}

function abortOutcomeOf(
  operationId: string,
  outcome: AbortRebaseOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "aborted": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "aborted the rebase and restored the branch it started from",
          changedRefs: [],
          newHeadOid: outcome.head?.oid ?? null,
        }),
      };
    }
    case "refused": {
      return failedOp(operationId, "GitCommandFailed", outcome.reason);
    }
    case "gitRefused": {
      return failedOp(
        operationId,
        "GitCommandFailed",
        outcome.refusal.diagnostic.trim().length === 0
          ? "git could not abort this rebase; the rebase state was left exactly as it is"
          : `git could not abort this rebase: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — nothing was reset`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `aborting the rebase did not finish cleanly (${outcome.code}); the repository may be halfway between the rebase and the abort, and nothing was retried`,
      );
    }
  }
}

export function createRebaseEffects(
  options: RebaseEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  return [
    createEffect({
      kind: "rebase",
      schema: OPERATION_SCHEMAS.rebase,
      async run({ operation, request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await rebase(
          options.engine,
          { cwdHandle: facts.value.cwdHandle },
          { upstreamOid: operation.upstreamOid },
        );
        return rebaseOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "continueRebase",
      schema: OPERATION_SCHEMAS.continueRebase,
      async run({ request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await continueRebase(options.engine, {
          cwdHandle: facts.value.cwdHandle,
        });
        return continueOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "abortRebase",
      schema: OPERATION_SCHEMAS.abortRebase,
      async run({ request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await abortRebase(options.engine, {
          cwdHandle: facts.value.cwdHandle,
        });
        return abortOutcomeOf(operationId, outcome);
      },
    }),
  ];
}

/** The kinds this module implements, for the capability list. */
export const REBASE_MUTATION_KINDS = [
  "rebase",
  "continueRebase",
  "abortRebase",
] as const;
