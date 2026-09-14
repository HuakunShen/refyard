/**
 * The T09 mutation effects: branches, remotes, and fetch/push/pull.
 *
 * These are the operations where "it failed" is often not the whole truth, and the
 * classification here is the product decision:
 *
 * - a **push** is judged per ref from `--porcelain`: a rejected ref is `failed`
 *   with Git's own reason, an up-to-date ref is `succeeded` and says so, and a
 *   timeout is `unknown` because the remote may have received the objects;
 * - a **pull** that fetched successfully but could not fast-forward the branch is
 *   `failed` with a message that names *both* facts — the tracking refs moved, the
 *   working branch did not — because calling it `succeeded` would hide the second
 *   and calling the fetch change invisible would be the opposite lie;
 * - **URLs** are validated at the request boundary (`validate.ts`), so an `ext::`
 *   helper never reaches `git remote add`; this module never trusts a URL either —
 *   it only passes what the contract already accepted.
 *
 * All commands run through the same facts resolver: the target's worktree (a
 * repository target uses its primary worktree) is re-read before anything runs.
 */
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  addRemote,
  createBranch,
  deleteBranch,
  fetchRemote,
  pullFastForward,
  pushRef,
  removeRemote,
  renameBranch,
  setBranchUpstream,
  switchBranch,
  updateRemote,
  type GitEngine,
  type NetworkOutcome,
  type PushParseResult,
} from "@refyard/git-core";
import type { RepositoryRegistry } from "../registry/repositories.js";
import { createEffect, type EffectOutcome, type MutationEffect } from "./jobs.js";
import {
  createFactsResolver,
  failed,
  failedOp,
  headAfter,
  gitFailureOutcome,
  resultOf,
  unknownOutcome,
  writeOutcomeFromGit,
} from "./effects-support.js";

export interface RepositoryEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
}

/** A per-ref push summary a person can read: `refs/heads/main: new branch`. */
function pushSummary(result: PushParseResult): string {
  if (result.everythingUpToDate || result.refs.length === 0) {
    return "already up to date; nothing was pushed";
  }
  return result.refs
    .map((ref) => `${ref.to}: ${ref.summary}`)
    .join("; ");
}

export function createRepositoryEffects(
  options: RepositoryEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  /**
   * A branch command's outcome, mapped for the journal.
   *
   * Every branch effect follows this shape: resolve, run, re-read Head so the record
   * names the real tip, and describe what changed. The refusal path carries Git's own
   * diagnostic.
   */
  async function runBranchCommand(
    cwdHandle: string,
    operationId: string,
    run: () => Promise<
      | { readonly kind: "done" }
      | {
          readonly kind: "refused";
          readonly code: Parameters<
            typeof writeOutcomeFromGit
          >[1]["code"];
          readonly exitCode: number | null;
          readonly diagnostic: string;
        }
    >,
    describe: () => { readonly summary: string; readonly changedRefs: readonly string[] },
  ): Promise<EffectOutcome> {
    const outcome = await run();
    if (outcome.kind === "refused") {
      return writeOutcomeFromGit(operationId, outcome);
    }
    const head = await headAfter(options.engine, cwdHandle);
    const described = describe();
    return {
      kind: "succeeded",
      result: resultOf({
        summary: described.summary,
        changedRefs: described.changedRefs,
        newHeadOid: head?.oid ?? null,
      }),
    };
  }

  const createBranchEffect = createEffect({
    kind: "createBranch",
    schema: OPERATION_SCHEMAS.createBranch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      return runBranchCommand(
        facts.value.cwdHandle,
        operationId,
        () =>
          createBranch(options.engine, facts.value, {
            name: operation.branchName,
            startOid: operation.startOid,
            switchToIt: operation.switchToIt,
          }),
        () => ({
          summary: operation.switchToIt
            ? `created and switched to ${operation.branchName}`
            : `created branch ${operation.branchName}`,
          changedRefs: [`refs/heads/${operation.branchName}`],
        }),
      );
    },
  });

  const switchBranchEffect = createEffect({
    kind: "switchBranch",
    schema: OPERATION_SCHEMAS.switchBranch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      return runBranchCommand(
        facts.value.cwdHandle,
        operationId,
        () => switchBranch(options.engine, facts.value, operation.branchName),
        () => ({
          summary: `switched to ${operation.branchName}`,
          changedRefs: [`refs/heads/${operation.branchName}`],
        }),
      );
    },
  });

  const renameBranchEffect = createEffect({
    kind: "renameBranch",
    schema: OPERATION_SCHEMAS.renameBranch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      return runBranchCommand(
        facts.value.cwdHandle,
        operationId,
        () =>
          renameBranch(options.engine, facts.value, {
            name: operation.branchName,
            newName: operation.newName,
          }),
        () => ({
          summary: `renamed ${operation.branchName} to ${operation.newName}`,
          changedRefs: [
            `refs/heads/${operation.branchName}`,
            `refs/heads/${operation.newName}`,
          ],
        }),
      );
    },
  });

  const deleteBranchEffect = createEffect({
    kind: "deleteBranch",
    schema: OPERATION_SCHEMAS.deleteBranch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      return runBranchCommand(
        facts.value.cwdHandle,
        operationId,
        () => deleteBranch(options.engine, facts.value, operation.branchName),
        () => ({
          summary: `deleted branch ${operation.branchName}`,
          changedRefs: [`refs/heads/${operation.branchName}`],
        }),
      );
    },
  });

  const setUpstreamEffect = createEffect({
    kind: "setBranchUpstream",
    schema: OPERATION_SCHEMAS.setBranchUpstream,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      return runBranchCommand(
        facts.value.cwdHandle,
        operationId,
        () =>
          setBranchUpstream(options.engine, facts.value, {
            branchName: operation.branchName,
            upstream: operation.upstream,
          }),
        () =>
          operation.upstream === null
            ? {
                summary: `cleared the upstream of ${operation.branchName}`,
                changedRefs: [],
              }
            : {
                summary: `set ${operation.branchName} to track ${operation.upstream.remoteName}/${operation.upstream.branchName}`,
                changedRefs: [],
              },
      );
    },
  });

  const addRemoteEffect = createEffect({
    kind: "addRemote",
    schema: OPERATION_SCHEMAS.addRemote,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await addRemote(options.engine, facts.value, {
        name: operation.remoteName,
        fetchUrl: operation.fetchUrl,
        pushUrl: operation.pushUrl,
      });
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary:
            operation.pushUrl === null
              ? `added remote ${operation.remoteName}`
              : `added remote ${operation.remoteName} with a separate push URL`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const updateRemoteEffect = createEffect({
    kind: "updateRemote",
    schema: OPERATION_SCHEMAS.updateRemote,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await updateRemote(options.engine, facts.value, {
        name: operation.remoteName,
        newName: operation.newName,
        fetchUrl: operation.fetchUrl,
        pushUrl: operation.pushUrl,
      });
      if (outcome.kind === "refused") {
        // A rename that succeeded before a URL change failed is a partial state;
        // the re-read a client does after this will show the name it now has, and
        // the message says a change may have been applied.
        return {
          kind: "needsAttention",
          problem: {
            code: "NeedsAttention",
            message: `the remote update did not complete: ${outcome.diagnostic.trim().length > 0 ? outcome.diagnostic : `git exited ${outcome.exitCode ?? "unknown"}`}; the remote may have been renamed before the change failed — re-read the remotes`,
            retryable: false,
            operationId,
          },
        };
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `updated remote ${operation.remoteName}`,
          changedRefs:
            operation.newName === null
              ? []
              : [`remote:${operation.remoteName}`, `remote:${operation.newName}`],
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const removeRemoteEffect = createEffect({
    kind: "removeRemote",
    schema: OPERATION_SCHEMAS.removeRemote,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await removeRemote(
        options.engine,
        facts.value,
        operation.remoteName,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `removed remote ${operation.remoteName}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  /** Shared classification for the three network outcomes. */
  function networkFailure(
    operationId: string,
    what: string,
    outcome: Exclude<NetworkOutcome<unknown>, { kind: "done" }>,
  ): EffectOutcome {
    if (outcome.kind === "uncertain") {
      return unknownOutcome(operationId, outcome.reason);
    }
    return gitFailureOutcome(operationId, what, {
      code: outcome.code,
      exitCode: outcome.exitCode,
      diagnostic: outcome.diagnostic,
    });
  }

  const fetchEffect = createEffect({
    kind: "fetch",
    schema: OPERATION_SCHEMAS.fetch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await fetchRemote(options.engine, facts.value, {
        remoteName: operation.remoteName,
        prune: operation.prune,
        tags: operation.tags,
      });
      if (outcome.kind !== "done") {
        return networkFailure(operationId, "the fetch", outcome);
      }
      const moved = outcome.result.refs.map((ref) => ref.localRef);
      return {
        kind: "succeeded",
        result: resultOf({
          summary:
            moved.length === 0
              ? `fetched ${operation.remoteName}; nothing changed`
              : `fetched ${operation.remoteName}; ${moved.length} remote-tracking ref${moved.length === 1 ? "" : "s"} updated`,
          changedRefs: moved,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const pushEffect = createEffect({
    kind: "push",
    schema: OPERATION_SCHEMAS.push,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await pushRef(options.engine, facts.value, {
        remoteName: operation.remoteName,
        sourceRef: operation.sourceRef,
        destinationRef: operation.destinationRef,
        setUpstream: operation.setUpstream,
      });
      if (outcome.kind === "done") {
        return {
          kind: "succeeded",
          result: resultOf({
            summary: `pushed ${operation.sourceRef} to ${operation.remoteName}/${operation.destinationRef}: ${pushSummary(outcome.result)}`,
            changedRefs:
              outcome.result.refs.length === 0
                ? []
                : [operation.destinationRef],
            newHeadOid: facts.value.head.oid,
          }),
        };
      }
      if (outcome.kind === "partial") {
        // One ref per request, so a partial table means the selected ref was
        // rejected — with Git's own reason in the summary.
        return failedOp(
          operationId,
          "GitCommandFailed",
          `the push was rejected: ${pushSummary(outcome.result)}${outcome.diagnostic.trim().length > 0 ? ` (${outcome.diagnostic.trim()})` : ""}`.slice(
            0,
            2000,
          ),
        );
      }
      return networkFailure(operationId, "the push", outcome);
    },
  });

  const pullEffect = createEffect({
    kind: "pull",
    schema: OPERATION_SCHEMAS.pull,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const branchName = facts.value.head.branchName;
      if (branchName === null) {
        return failedOp(
          operationId,
          "Conflict",
          "a pull needs a checked-out branch; HEAD is detached or unborn",
        );
      }
      const outcome = await pullFastForward(options.engine, facts.value, {
        remoteName: operation.remoteName,
        branchName,
      });
      if (outcome.kind === "done") {
        const head = await headAfter(options.engine, facts.value.cwdHandle);
        return {
          kind: "succeeded",
          result: resultOf({
            summary: `pulled ${operation.remoteName} (fast-forward only); ${outcome.result.fetchRefs.length} tracking ref${outcome.result.fetchRefs.length === 1 ? "" : "s"} updated`,
            changedRefs: outcome.result.fetchRefs.map((ref) => ref.localRef),
            newHeadOid: head?.oid ?? facts.value.head.oid,
          }),
        };
      }
      if (outcome.kind === "partial") {
        return failedOp(
          operationId,
          "GitCommandFailed",
          `the pull fetched but could not fast-forward the branch (the local branch was not moved, and no merge or rebase was performed): ${
            outcome.diagnostic.trim().length > 0
              ? outcome.diagnostic.trim()
              : `git exited ${outcome.exitCode ?? "unknown"}`
          }`.slice(0, 2000),
        );
      }
      return networkFailure(operationId, "the pull", outcome);
    },
  });

  return [
    createBranchEffect,
    switchBranchEffect,
    renameBranchEffect,
    deleteBranchEffect,
    setUpstreamEffect,
    addRemoteEffect,
    updateRemoteEffect,
    removeRemoteEffect,
    fetchEffect,
    pushEffect,
    pullEffect,
  ];
}

/** The kinds this module implements, in capabilities order. */
export const REPOSITORY_MUTATION_KINDS = [
  "createBranch",
  "switchBranch",
  "renameBranch",
  "deleteBranch",
  "setBranchUpstream",
  "addRemote",
  "updateRemote",
  "removeRemote",
  "fetch",
  "push",
  "pull",
] as const;
