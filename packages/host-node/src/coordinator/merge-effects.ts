/**
 * The T12 mutation effects: merge, continue a merge, abort a merge.
 *
 * These three are one workflow seen from three sides, and the classification is
 * where a merge can be reported wrongly:
 *
 * - **Conflicts are `needsAttention`.** Git stopped with `MERGE_HEAD` set and an
 *   index carrying three stages per conflicted path; the merge is unfinished. The
 *   record says how many paths are conflicted and carries Git's own diagnostic, and
 *   the status read is what names the paths — a record is not a place for a file
 *   list, and the UI already has the read.
 * - **A refusal before Git touched anything is `failed`**, with Git's diagnostic
 *   bounded and included: "your local changes would be overwritten" is a refusal to
 *   answer, not a bug to retry.
 * - **An abort Git refuses is also a refusal, and the merge state stays.** There is
 *   no reset fallback anywhere in this file: if Git will not restore the pre-merge
 *   state, the honest answer is the diagnostic plus the state that still exists.
 * - **A continue while the index is still unmerged is `failed`** and leaves the
 *   merge in place, so the next attempt starts from the same evidence.
 */
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  abortMerge,
  continueMerge,
  mergeSource,
  type AbortOutcome,
  type ContinueOutcome,
  type GitEngine,
  type MergeOutcome,
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

export interface MergeEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

/**
 * Turn a merge-family outcome into what the journal records.
 *
 * The three workflows return their own unions rather than one shared shape, because
 * what "this did not happen" means differs: a merge that stopped for a conflict, a
 * continue that Git refused, and an abort Git could not perform are three different
 * states of the repository.
 */
function mergeOutcomeOf(
  operationId: string,
  outcome: MergeOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "merged": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: outcome.alreadyUpToDate
            ? "already up to date; nothing to merge"
            : "merged the source into the current branch",
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
            `the merge stopped with ${outcome.conflictedPaths} conflicted path(s); ` +
            `resolve them, stage the results and continue, or abort the merge` +
            (outcome.diagnostic.trim().length === 0
              ? ""
              : ` (git: ${outcome.diagnostic.trim().slice(0, 600)})`),
          // The count is a fact a UI can act on without parsing the message; the
          // names of the paths come from the status read, which owns file lists.
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
      return gitFailureOutcome(operationId, "the merge", outcome.refusal);
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `the merge did not finish cleanly (${outcome.code}); whether Git changed anything is not known and nothing was retried`,
      );
    }
  }
}

function continueOutcomeOf(
  operationId: string,
  outcome: ContinueOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "committed": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "continued the merge and committed the resolved index",
          changedRefs: [],
          newHeadOid: outcome.head?.oid ?? null,
        }),
      };
    }
    case "refused": {
      return failedOp(operationId, "GitCommandFailed", outcome.reason);
    }
    case "gitRefused": {
      if (outcome.refusal.diagnostic.trim().length === 0) {
        return failedOp(
          operationId,
          "GitCommandFailed",
          `git refused to continue the merge (exit ${outcome.refusal.exitCode ?? "unknown"})`,
        );
      }
      return failedOp(
        operationId,
        "GitCommandFailed",
        `git refused to continue the merge: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — the merge is still in progress`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `continuing the merge did not finish cleanly (${outcome.code}); whether the commit was created is not known and nothing was retried`,
      );
    }
  }
}

function abortOutcomeOf(
  operationId: string,
  outcome: AbortOutcome,
): EffectOutcome {
  switch (outcome.kind) {
    case "aborted": {
      return {
        kind: "succeeded",
        result: resultOf({
          summary: "aborted the merge and restored the pre-merge state",
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
          ? "git could not abort this merge; the merge state was left exactly as it is"
          : `git could not abort this merge: ${outcome.refusal.diagnostic.trim().slice(0, 1500)} — nothing was reset`,
      );
    }
    case "unknown": {
      return unknownOutcome(
        operationId,
        `aborting the merge did not finish cleanly (${outcome.code}); the repository may be halfway between the merge and the abort, and nothing was retried`,
      );
    }
  }
}

export function createMergeEffects(
  options: MergeEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  return [
    createEffect({
      kind: "merge",
      schema: OPERATION_SCHEMAS.merge,
      async run({ operation, request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await mergeSource(
          options.engine,
          { cwdHandle: facts.value.cwdHandle },
          {
            sourceOid: operation.sourceOid,
            mode: operation.mode,
            message: operation.message,
          },
        );
        return mergeOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "continueMerge",
      schema: OPERATION_SCHEMAS.continueMerge,
      async run({ operation, request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await continueMerge(
          options.engine,
          { cwdHandle: facts.value.cwdHandle },
          { message: operation.message },
        );
        return continueOutcomeOf(operationId, outcome);
      },
    }),
    createEffect({
      kind: "abortMerge",
      schema: OPERATION_SCHEMAS.abortMerge,
      async run({ request, operationId }): Promise<EffectOutcome> {
        const facts = await resolveFacts(request, operationId);
        if (!facts.ok) {
          return { kind: "failed", problem: facts.problem };
        }
        const outcome = await abortMerge(options.engine, {
          cwdHandle: facts.value.cwdHandle,
        });
        return abortOutcomeOf(operationId, outcome);
      },
    }),
  ];
}

/** The kinds this module implements, for the capability list. */
export const MERGE_MUTATION_KINDS = [
  "merge",
  "continueMerge",
  "abortMerge",
] as const;
