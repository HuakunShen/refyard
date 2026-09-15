/**
 * The T09 mutation effects: branches, remotes, fetch/push/pull — and the two
 * operations that create a repository where there was none.
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
 *
 * `initRepository` and `cloneRepository` are the exception to that, and they are here
 * rather than in their own module because they share the interface: their target is a
 * **workspace** — an approved root plus a destination inside it — so there is no
 * repository to resolve yet, and the repository registry only learns about the result
 * *after* the command succeeded. Three rules follow, and all three are load-bearing:
 *
 * - **the destination is proven inside the approved root** by the handle registry
 *   (lexical containment before the command, symlinks re-proven after it), never by
 *   joining strings here;
 * - **a failed command registers nothing.** Registration is what makes a repository
 *   visible to this session, so a refusal or an uncertain outcome must leave the
 *   registry exactly as it was;
 * - **nothing is cleaned up.** A failed clone may have left a directory behind; the
 *   outcome says so and names the path, and no code here removes anything the user
 *   chose. That is the difference between a workbench and a script that deletes.
 *
 * For `cloneRepository` the contract carries the destination twice — in the operation
 * payload and in the workspace target — and accepts a request where the two differ.
 * The operation's own field decides where the clone goes, and the result names the
 * destination that was used, so a client that sent two different values can see which
 * one happened. The UI sends the same value in both. Changing that would mean editing
 * a frozen schema, which is a decision with its own evidence, not a detail to settle
 * inside an effect.
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
import { readdir } from "node:fs/promises";
import type { CreationOutcome, DestinationState } from "@refyard/git-core";
import { cloneRepository, initRepository } from "@refyard/git-core";
import type { HandleRegistry } from "../filesystem/handles.js";
import type { RepositoryRegistry } from "../registry/repositories.js";
import type { RootRegistry } from "../registry/roots.js";
import {
  createEffect,
  type EffectOutcome,
  type MutationEffect,
} from "./jobs.js";
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
import type { ParsedMutationRequest } from "@refyard/git-contract";

export interface RepositoryEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
  /** Needed by the two creation effects: a workspace target names a root, not a repo. */
  readonly roots: RootRegistry;
  readonly handles: HandleRegistry;
}

/** The errno of a failed directory read, without casting the error. */
function errorCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const code: unknown = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
}

/**
 * What a destination holds right now, as the host sees it.
 *
 * `absent` and `empty` are different answers — `git clone` accepts an existing empty
 * directory and refuses one with content — and that pair, before and after the
 * command, is what separates "Git refused" from "a failed command left a directory
 * behind". A destination that cannot be read at all is reported as occupied: Git will
 * refuse it anyway, and calling an unreadable directory empty would invite a retry
 * into something this service could not look at.
 */
async function observeDestination(
  destination: string,
): Promise<DestinationState> {
  try {
    const entries = await readdir(destination);
    return entries.length === 0 ? "empty" : "nonEmpty";
  } catch (error) {
    return errorCodeOf(error) === "ENOENT" ? "absent" : "nonEmpty";
  }
}

/** A per-ref push summary a person can read: `refs/heads/main: new branch`. */
function pushSummary(result: PushParseResult): string {
  if (result.everythingUpToDate || result.refs.length === 0) {
    return "already up to date; nothing was pushed";
  }
  return result.refs.map((ref) => `${ref.to}: ${ref.summary}`).join("; ");
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
          readonly code: Parameters<typeof writeOutcomeFromGit>[1]["code"];
          readonly exitCode: number | null;
          readonly diagnostic: string;
        }
    >,
    describe: () => {
      readonly summary: string;
      readonly changedRefs: readonly string[];
    },
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
              : [
                  `remote:${operation.remoteName}`,
                  `remote:${operation.newName}`,
                ],
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

  /* ------------------------------------------------------- repository creation */

  /**
   * The approved root and destination a workspace target names.
   *
   * The destination is resolved through the handle registry, which proves lexical
   * containment; the root itself is re-proved intact so a directory that was replaced
   * since it was approved is refused rather than written into.
   */
  async function resolveWorkspace(
    request: ParsedMutationRequest,
    relativeDestination: string,
    operationId: string,
  ): Promise<
    | {
        readonly ok: true;
        readonly allowedRootId: string;
        readonly relativeDestination: string;
        readonly destination: string;
        readonly cwdHandle: string;
      }
    | { readonly ok: false; readonly problem: EffectOutcome }
  > {
    const target = request.target;
    if (target.kind !== "workspace") {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "InvalidOperationPayload",
          "this operation must address a workspace (an approved root and a destination inside it)",
        ),
      };
    }
    try {
      await options.roots.requireIntact(target.allowedRootId);
    } catch {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "Forbidden",
          "the approved root is gone, or is not the directory it was approved as; approve it again",
        ),
      };
    }
    try {
      const resolved = options.handles.resolveDestination(
        target.allowedRootId,
        relativeDestination,
      );
      return {
        ok: true,
        allowedRootId: target.allowedRootId,
        relativeDestination: resolved.relativePath,
        destination: resolved.absolutePath,
        // Commands run from the approved root: the destination may not exist yet, and
        // a handle must resolve to a directory that does.
        cwdHandle: options.handles.handleFor(target.allowedRootId, ""),
      };
    } catch (error) {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "Forbidden",
          error instanceof Error
            ? error.message
            : "the destination is not usable inside its approved root",
        ),
      };
    }
  }

  /**
   * Turn a creation outcome into what the journal records, and register on success.
   *
   * Registration happens only for `done`, and a registration that fails is
   * `needsAttention` rather than `failed`: the repository exists on disk, and telling
   * the caller "it failed" would be telling them something untrue about their files.
   */
  async function finishCreation(
    outcome: CreationOutcome,
    input: {
      readonly operationId: string;
      readonly what: string;
      readonly allowedRootId: string;
      readonly relativeDestination: string;
      readonly summary: string;
    },
  ): Promise<EffectOutcome> {
    const operationId = input.operationId;
    const destination = input.relativeDestination;
    if (outcome.kind === "done") {
      try {
        await options.repositories.register({
          allowedRootId: input.allowedRootId,
          relativePath: destination,
          handles: options.handles,
        });
      } catch (error) {
        return {
          kind: "needsAttention",
          problem: {
            code: "NeedsAttention",
            message: `the ${input.what} finished, but this service could not register the repository at ${destination}: ${
              error instanceof Error
                ? error.message
                : "the directory could not be read"
            }; the files are there and nothing was removed`,
            retryable: false,
            operationId,
          },
        };
      }
      const head = await headAfter(
        options.engine,
        options.handles.handleFor(input.allowedRootId, destination),
      );
      return {
        kind: "succeeded",
        result: resultOf({
          summary: input.summary,
          newHeadOid: head?.oid ?? null,
        }),
      };
    }

    const diagnostic =
      outcome.diagnostic.trim().length > 0
        ? outcome.diagnostic.trim()
        : `git exited ${outcome.exitCode ?? "unknown"}`;
    if (outcome.kind === "uncertain") {
      return unknownOutcome(
        operationId,
        `the ${input.what} did not finish cleanly (${outcome.code}); what is at ${destination} is ${outcome.destinationAfter === "nonEmpty" ? "a directory with content" : "unchanged"}, and whether the command completed is not known — nothing was retried and nothing was removed`,
      );
    }
    if (outcome.kind === "leftBehind") {
      return {
        kind: "needsAttention",
        problem: {
          code: "NeedsAttention",
          message: `the ${input.what} failed and left files at ${destination}: ${diagnostic}; nothing was removed, so that path is the user's to inspect`,
          retryable: false,
          operationId,
        },
      };
    }
    return failedOp(
      operationId,
      "GitCommandFailed",
      `git refused the ${input.what}: ${diagnostic}`.slice(0, 2000),
    );
  }

  const initRepositoryEffect = createEffect({
    kind: "initRepository",
    schema: OPERATION_SCHEMAS.initRepository,
    async run({ request, operation, operationId }) {
      const target = request.target;
      // The destination of an init is the workspace target's own: the operation has no
      // field for it, because `git init` runs where the client points the root.
      const relativeDestination =
        target.kind === "workspace" ? target.relativeDestination : "";
      const workspace = await resolveWorkspace(
        request,
        relativeDestination,
        operationId,
      );
      if (!workspace.ok) {
        return workspace.problem;
      }
      const outcome = await initRepository(options.engine, {
        cwdHandle: workspace.cwdHandle,
        destination: workspace.destination,
        initialBranch: operation.initialBranch,
        observeDestination,
      });
      return finishCreation(outcome, {
        operationId,
        what: "init",
        allowedRootId: workspace.allowedRootId,
        relativeDestination: workspace.relativeDestination,
        summary:
          operation.initialBranch === null
            ? `created a repository at ${workspace.relativeDestination}`
            : `created a repository at ${workspace.relativeDestination} on ${operation.initialBranch}`,
      });
    },
  });

  const cloneRepositoryEffect = createEffect({
    kind: "cloneRepository",
    schema: OPERATION_SCHEMAS.cloneRepository,
    async run({ request, operation, operationId }) {
      const workspace = await resolveWorkspace(
        request,
        operation.relativeDestination,
        operationId,
      );
      if (!workspace.ok) {
        return workspace.problem;
      }
      const outcome = await cloneRepository(options.engine, {
        cwdHandle: workspace.cwdHandle,
        remoteUrl: operation.remoteUrl,
        destination: workspace.destination,
        initializeSubmodules: operation.initializeSubmodules,
        observeDestination,
      });
      return finishCreation(outcome, {
        operationId,
        what: "clone",
        allowedRootId: workspace.allowedRootId,
        relativeDestination: workspace.relativeDestination,
        summary: operation.initializeSubmodules
          ? `cloned ${operation.remoteUrl} into ${workspace.relativeDestination}, including submodules`
          : `cloned ${operation.remoteUrl} into ${workspace.relativeDestination}`,
      });
    },
  });

  return [
    initRepositoryEffect,
    cloneRepositoryEffect,
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
  "initRepository",
  "cloneRepository",
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
