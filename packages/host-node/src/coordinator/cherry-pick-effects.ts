/**
 * The cherry-pick mutation effects: pick one commit, continue a stopped pick,
 * abort one.
 *
 * These mirror the merge family because the lifecycle is the merge family's:
 *
 * - **Conflicts are `needsAttention`.** Git stopped with `CHERRY_PICK_HEAD` set and
 *   unmerged index stages; the pick is unfinished. The record says how many paths
 *   are conflicted, and the status read names them.
 * - **An empty pick is `failed` with what it means**: the change is already
 *   present, the stop was aborted, and the branch is exactly as it was.
 * - **A refusal before Git touched anything is `failed`** with Git's diagnostic.
 * - **An abort Git refuses is also a refusal, and the pick state stays.** No reset
 *   fallback anywhere in this file.
 */
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  abortCherryPick,
  cherryPick,
  continueCherryPick,
  type AbortCherryPickOutcome,
  type CherryPickOutcome,
  type ContinueCherryPickOutcome,
  type GitEngine,
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

export interface CherryPickEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

function pickOutcomeOf(
  operationId: string,
  outcome: CherryPickOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "picked": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "cherry-picked the commit onto the current branch",
          changedRefs: [],
          newHeadOid: outcome.head?.oid ?? null,
        }),
      };
    }
    case "mergeRefused": {
      return failedOp(
        operationId,
        "InvalidRequest",
        "that commit is a merge; cherry-picking it needs a choice of parent that this build does not make",
      );
    }
    case "conflicted": {
      return {
        kind: "needsAttention",
        problem: {
          code: "GitCommandFailed",
          message:
            `the cherry-pick stopped with ${outcome.conflictedPaths} conflicted path(s); ` +
            `resolve them, stage the results and continue, or abort the cherry-pick` +
            (outcome.diagnostic.trim().length === 0
              ? ""
              : ` (git: ${outcome.diagnostic.trim().slice(0, 600)})`),
          details: { conflictedPaths: outcome.conflictedPaths },
          retryable: false,
          operationId,
        },
      };
    }
    case "emptyAborted": {
      return failedOp(
        operationId,
        "Conflict",
        `the cherry-pick would be empty — this change is already present — and was aborted, so the branch is unchanged: ${outcome.diagnostic.trim().slice(0, 600)}`,
      );
    }
    case "refused": {
      return failedOp(operationId, "Conflict", outcome.reason);
    }
    case "gitRefused": {
      return gitFailureOutcome(operationId, "the cherry-pick", outcome.refusal);
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `the cherry-pick did not finish cleanly (${outcome.code}); whether Git changed anything is not known and nothing was retried`,
      );
    }
  }
}

function continueOutcomeOf(
  operationId: string,
  outcome: ContinueCherryPickOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "picked": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "continued the cherry-pick and committed the resolved index",
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
          message: `the cherry-pick is still stopped: ${outcome.conflictedPaths} conflicted path(s) remain unresolved`,
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
          ? `git refused to continue the cherry-pick (exit ${outcome.refusal.exitCode ?? "unknown"})`
          : `git refused to continue the cherry-pick: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — the cherry-pick is still in progress`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `continuing the cherry-pick did not finish cleanly (${outcome.code}); whether the commit was created is not known and nothing was retried`,
      );
    }
  }
}

function abortOutcomeOf(
  operationId: string,
  outcome: AbortCherryPickOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "aborted": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "aborted the cherry-pick and restored the state it started from",
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
          ? "git could not abort this cherry-pick; the pick state was left exactly as it is"
          : `git could not abort this cherry-pick: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — nothing was reset`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `aborting the cherry-pick did not finish cleanly (${outcome.code}); the repository may be halfway between the pick and the abort, and nothing was retried`,
      );
    }
  }
}

export function createCherryPickEffects(
  options: CherryPickEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  return [
    createEffect({
      kind: "cherryPick",
      schema: OPERATION_SCHEMAS.cherryPick,
      async run({ operation, request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await cherryPick(
          options.engine,
          { cwdHandle: facts.value.cwdHandle },
          { oid: operation.oid },
        );
        return pickOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "continueCherryPick",
      schema: OPERATION_SCHEMAS.continueCherryPick,
      async run({ request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await continueCherryPick(options.engine, {
          cwdHandle: facts.value.cwdHandle,
        });
        return continueOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "abortCherryPick",
      schema: OPERATION_SCHEMAS.abortCherryPick,
      async run({ request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await abortCherryPick(options.engine, {
          cwdHandle: facts.value.cwdHandle,
        });
        return abortOutcomeOf(operationId, outcome);
      },
    }),
  ];
}

/** The kinds this module implements, for the capability list. */
export const CHERRY_PICK_MUTATION_KINDS = [
  "cherryPick",
  "continueCherryPick",
  "abortCherryPick",
] as const;
