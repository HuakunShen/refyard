/**
 * The T10 mutation effects: stash and tag operations.
 *
 * The classification decisions, all made from evidence rather than from Git's exit
 * code alone:
 *
 * - **apply/pop/drop re-resolve the locator** to the object name the request carried
 *   and refuse a mismatch. A `stash@{1}` that now points somewhere else is a stale
 *   request, not a different stash to act on.
 * - **a conflicted pop is `needsAttention`, never `failed`.** The stash is still
 *   there (the workflow re-checks by object name), the working tree holds the
 *   conflict, and a human has work to do — "failed" would suggest nothing happened.
 * - **an existing tag is a `Conflict`**, because the refusal is the operation's
 *   whole point; creating a tag never moves one that already exists.
 */
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  applyStash,
  checkStashLocator,
  createStash,
  createTag,
  deleteTag,
  dropStash,
  popStash,
  pushRef,
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
  failed,
  failedOp,
  gitFailureOutcome,
  resultOf,
  unknownOutcome,
  writeOutcomeFromGit,
} from "./effects-support.js";

export interface StashTagEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

export function createStashTagEffects(
  options: StashTagEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  /**
   * A locator mismatch is a stale request. The message names what happened so the
   * UI can tell the user to re-read the list rather than retry blindly.
   */
  function locatorProblem(
    operationId: string,
    check: Awaited<ReturnType<typeof checkStashLocator>>,
  ): EffectOutcome | null {
    if (check.kind === "matches") {
      return null;
    }
    return failedOp(
      operationId,
      check.kind === "unresolvable" ? "NotFound" : "Conflict",
      check.kind === "unresolvable"
        ? "that stash entry no longer exists; reload the stash list"
        : "the stash list moved since this request was prepared, and the locator now points at a different entry; reload and select the stash again",
    );
  }

  const createStashEffect = createEffect({
    kind: "createStash",
    schema: OPERATION_SCHEMAS.createStash,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await createStash(options.engine, facts.value, {
        message: operation.message,
        includeUntracked: operation.includeUntracked,
        keepIndex: operation.keepIndex,
      });
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `created a stash${operation.message === null ? "" : ` (${operation.message.split("\n")[0] ?? ""})`}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const applyStashEffect = createEffect({
    kind: "applyStash",
    schema: OPERATION_SCHEMAS.applyStash,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const check = await checkStashLocator(options.engine, facts.value, {
        locator: operation.stash.locator,
        oid: operation.stash.oid,
      });
      const mismatch = locatorProblem(operationId, check);
      if (mismatch !== null) {
        return mismatch;
      }
      const outcome = await applyStash(options.engine, facts.value, {
        locator: operation.stash.locator,
        restoreIndex: operation.restoreIndex,
      });
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `applied ${operation.stash.locator}; the stash is kept`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const popStashEffect = createEffect({
    kind: "popStash",
    schema: OPERATION_SCHEMAS.popStash,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const check = await checkStashLocator(options.engine, facts.value, {
        locator: operation.stash.locator,
        oid: operation.stash.oid,
      });
      const mismatch = locatorProblem(operationId, check);
      if (mismatch !== null) {
        return mismatch;
      }
      const outcome = await popStash(options.engine, facts.value, {
        locator: operation.stash.locator,
        oid: operation.stash.oid,
        restoreIndex: operation.restoreIndex,
      });
      switch (outcome.kind) {
        case "done":
          return {
            kind: "succeeded",
            result: resultOf({
              summary: `popped ${operation.stash.locator}; the entry was dropped`,
              newHeadOid: facts.value.head.oid,
            }),
          };
        case "conflict":
          return {
            kind: "needsAttention",
            problem: {
              code: "NeedsAttention",
              message: outcome.stashPreserved
                ? `the pop left conflicts in the working tree and the stash is still there (nothing was dropped): ${outcome.diagnostic.trim().slice(0, 1500)}`
                : `the pop left conflicts and the stash could no longer be found afterwards — check the stash list before retrying: ${outcome.diagnostic.trim().slice(0, 1500)}`,
              retryable: false,
              operationId,
            },
          };
        default:
          return writeOutcomeFromGit(operationId, outcome);
      }
    },
  });

  const dropStashEffect = createEffect({
    kind: "dropStash",
    schema: OPERATION_SCHEMAS.dropStash,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const check = await checkStashLocator(options.engine, facts.value, {
        locator: operation.stash.locator,
        oid: operation.stash.oid,
      });
      const mismatch = locatorProblem(operationId, check);
      if (mismatch !== null) {
        return mismatch;
      }
      const outcome = await dropStash(
        options.engine,
        facts.value,
        operation.stash.locator,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `dropped ${operation.stash.locator}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const createTagEffect = createEffect({
    kind: "createTag",
    schema: OPERATION_SCHEMAS.createTag,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await createTag(options.engine, facts.value, {
        name: operation.tagName,
        targetOid: operation.targetOid,
        annotation:
          operation.annotation === null
            ? null
            : {
                message: new TextEncoder().encode(operation.annotation.message),
              },
      });
      switch (outcome.kind) {
        case "created":
          return {
            kind: "succeeded",
            result: resultOf({
              summary: `${operation.annotation === null ? "created" : "created annotated"} tag ${operation.tagName}`,
              changedRefs: [`refs/tags/${operation.tagName}`],
              newHeadOid: facts.value.head.oid,
            }),
          };
        case "exists":
          return failedOp(
            operationId,
            "Conflict",
            `the tag ${operation.tagName} already exists; this build never overwrites a tag`,
          );
        default:
          return writeOutcomeFromGit(operationId, outcome);
      }
    },
  });

  const deleteTagEffect = createEffect({
    kind: "deleteTag",
    schema: OPERATION_SCHEMAS.deleteTag,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await deleteTag(
        options.engine,
        facts.value,
        operation.tagName,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `deleted local tag ${operation.tagName}; a remote tag would not be touched`,
          changedRefs: [`refs/tags/${operation.tagName}`],
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const pushTagEffect = createEffect({
    kind: "pushTag",
    schema: OPERATION_SCHEMAS.pushTag,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const ref = `refs/tags/${operation.tagName}`;
      const outcome = await pushRef(options.engine, facts.value, {
        remoteName: operation.remoteName,
        sourceRef: ref,
        destinationRef: ref,
        setUpstream: false,
      });
      if (outcome.kind === "done") {
        return {
          kind: "succeeded",
          result: resultOf({
            summary: `pushed tag ${operation.tagName}`,
            changedRefs: [ref],
            newHeadOid: facts.value.head.oid,
          }),
        };
      }
      if (outcome.kind === "partial") {
        return failedOp(
          operationId,
          "GitCommandFailed",
          `the tag push was rejected: ${outcome.result.refs.map((entry) => `${entry.to}: ${entry.summary}`).join("; ")}${outcome.diagnostic.trim().length > 0 ? ` (${outcome.diagnostic.trim()})` : ""}`.slice(
            0,
            2000,
          ),
        );
      }
      if (outcome.kind === "uncertain") {
        return unknownOutcome(operationId, outcome.reason);
      }
      return gitFailureOutcome(operationId, "the tag push", outcome);
    },
  });

  return [
    createStashEffect,
    applyStashEffect,
    popStashEffect,
    dropStashEffect,
    createTagEffect,
    deleteTagEffect,
    pushTagEffect,
  ];
}

/** The kinds this module implements, in capabilities order. */
export const STASH_TAG_MUTATION_KINDS = [
  "createStash",
  "applyStash",
  "popStash",
  "dropStash",
  "createTag",
  "deleteTag",
  "pushTag",
] as const;
