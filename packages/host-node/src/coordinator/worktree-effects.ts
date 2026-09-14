/**
 * The T11 mutation effects: worktrees and submodules.
 *
 * Two decisions live here rather than in the planners, because they need the
 * registry and the filesystem:
 *
 * - **destinations are proven inside an approved root.** A worktree or submodule
 *   path is built from the root's real path plus the request's relative
 *   destination, and containment is re-checked after resolution — the same rule the
 *   handle registry enforces for every other path.
 * - **the primary worktree is refused before Git is asked.** Git would refuse it
 *   too, but the refusal here can say *why* in one sentence, and it happens before
 *   anything else could run.
 *
 * A submodule path that is not inside the parent worktree is refused as well: the
 * request names a submodule of this worktree, not an arbitrary directory.
 */
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  addSubmodule,
  addWorktree,
  lockWorktree,
  removeWorktree,
  syncSubmodules,
  unlockWorktree,
  updateSubmodules,
  type GitEngine,
} from "@refyard/git-core";
import type { PathRegistry } from "../registry/paths.js";
import type { RepositoryRegistry } from "../registry/repositories.js";
import type { RootRegistry } from "../registry/roots.js";
import { createEffect, type EffectOutcome, type MutationEffect } from "./jobs.js";
import {
  createFactsResolver,
  failed,
  failedOp,
  resultOf,
  writeOutcomeFromGit,
} from "./effects-support.js";

export interface WorktreeEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
  readonly roots: RootRegistry;
  readonly paths: PathRegistry;
}

/** True when `candidate` is inside (or equal to) `parent`, after resolving both. */
function containedBy(parent: string, candidate: string): boolean {
  const from = resolve(parent);
  const to = resolve(candidate);
  if (from === to) {
    return true;
  }
  const rel = relative(from, to);
  return rel.length > 0 && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

export function createWorktreeEffects(
  options: WorktreeEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  /** Resolve a destination inside the repository's approved root. */
  async function resolveDestination(
    repositoryId: string,
    relativeDestination: string,
    operationId: string,
  ): Promise<
    | { readonly ok: true; readonly absolute: string }
    | { readonly ok: false; readonly problem: EffectOutcome }
  > {
    const record = await options.repositories.require(repositoryId);
    const root = options.roots.get(record.allowedRootId);
    if (root === null) {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "Forbidden",
          "the repository's approved root is no longer registered",
        ),
      };
    }
    // The root's real path plus the request's relative destination; the contract
    // already refused absolute paths and `..` components, and this re-proves the
    // result is still inside the root.
    const candidate = join(root.path, relativeDestination);
    if (!containedBy(root.path, candidate)) {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "Forbidden",
          "the destination would be outside the approved root",
        ),
      };
    }
    return { ok: true, absolute: candidate };
  }

  /**
   * Find the worktree a lock/unlock/remove request names, with the handle of the
   * repository's primary worktree as the command's working directory.
   */
  async function resolveWorktreeCommand(
    repositoryId: string,
    worktreeId: string,
    operationId: string,
  ): Promise<
    | {
        readonly ok: true;
        readonly cwdHandle: string;
        readonly targetPath: string;
        readonly isMain: boolean;
      }
    | { readonly ok: false; readonly problem: EffectOutcome }
  > {
    let primary;
    let target;
    try {
      primary = await options.repositories.worktree(repositoryId, null);
      target = await options.repositories.worktree(repositoryId, worktreeId);
    } catch {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "NotFound",
          "that worktree is not known to this service; reload the worktree list",
        ),
      };
    }
    if (primary.handle === null) {
      return {
        ok: false,
        problem: failedOp(
          operationId,
          "Forbidden",
          "the primary worktree is outside every approved root",
        ),
      };
    }
    return {
      ok: true,
      cwdHandle: primary.handle,
      targetPath: target.path,
      isMain: target.isMain,
    };
  }

  const createWorktreeEffect = createEffect({
    kind: "createWorktree",
    schema: OPERATION_SCHEMAS.createWorktree,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const destination = await resolveDestination(
        facts.value.repositoryId,
        operation.relativeDestination,
        operationId,
      );
      if (!destination.ok) {
        return destination.problem;
      }
      const reference = operation.reference;
      const outcome = await addWorktree(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          destination: destination.absolute,
          reference:
            reference.kind === "existingBranch"
              ? { kind: "existingBranch", branchName: reference.branchName }
              : reference.kind === "newBranch"
                ? {
                    kind: "newBranch",
                    branchName: reference.branchName,
                    startOid: reference.startOid,
                  }
                : { kind: "detached", oid: reference.oid },
        },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      // Reconcile so the new worktree is registered and readable immediately.
      await options.repositories.worktreesOf(facts.value.repositoryId);
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `created worktree at ${destination.absolute}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const removeWorktreeEffect = createEffect({
    kind: "removeWorktree",
    schema: OPERATION_SCHEMAS.removeWorktree,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const target = await resolveWorktreeCommand(
        facts.value.repositoryId,
        operation.worktreeId,
        operationId,
      );
      if (!target.ok) {
        return target.problem;
      }
      if (target.isMain) {
        return failedOp(
          operationId,
          "Conflict",
          "the primary worktree cannot be removed through this service",
        );
      }
      const outcome = await removeWorktree(
        options.engine,
        { cwdHandle: target.cwdHandle },
        target.targetPath,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      await options.repositories.worktreesOf(facts.value.repositoryId);
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `removed worktree at ${target.targetPath}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const lockWorktreeEffect = createEffect({
    kind: "lockWorktree",
    schema: OPERATION_SCHEMAS.lockWorktree,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const target = await resolveWorktreeCommand(
        facts.value.repositoryId,
        operation.worktreeId,
        operationId,
      );
      if (!target.ok) {
        return target.problem;
      }
      const outcome = await lockWorktree(
        options.engine,
        { cwdHandle: target.cwdHandle },
        {
          absolutePath: target.targetPath,
          reason: operation.reason,
        },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      await options.repositories.worktreesOf(facts.value.repositoryId);
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `locked worktree at ${target.targetPath}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const unlockWorktreeEffect = createEffect({
    kind: "unlockWorktree",
    schema: OPERATION_SCHEMAS.unlockWorktree,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const target = await resolveWorktreeCommand(
        facts.value.repositoryId,
        operation.worktreeId,
        operationId,
      );
      if (!target.ok) {
        return target.problem;
      }
      const outcome = await unlockWorktree(
        options.engine,
        { cwdHandle: target.cwdHandle },
        target.targetPath,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      await options.repositories.worktreesOf(facts.value.repositoryId);
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `unlocked worktree at ${target.targetPath}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  /**
   * The submodule paths a request names, as execution text, all-or-nothing.
   *
   * A submodule path is a normal path in the worktree: the same byte rule applies,
   * and one unrepresentable path refuses the batch.
   */
  function resolveSubmodulePaths(
    pathIds: readonly string[],
    facts: { readonly repositoryId: string; readonly worktreeId: string },
    operationId: string,
  ):
    | { readonly ok: true; readonly paths: readonly string[] }
    | { readonly ok: false; readonly problem: EffectOutcome } {
    const paths: string[] = [];
    for (const pathId of pathIds) {
      const binding = options.paths.getForWorktree({
        pathId,
        repositoryId: facts.repositoryId,
        worktreeId: facts.worktreeId,
      });
      if (binding === null || binding.executionText === null) {
        return {
          ok: false,
          problem: failedOp(
            operationId,
            binding === null ? "NotFound" : "UnsupportedPathEncoding",
            binding === null
              ? "a selected submodule path is unknown in this worktree; reload the list"
              : "a selected submodule path cannot be represented exactly on this host",
          ),
        };
      }
      paths.push(binding.executionText);
    }
    return { ok: true, paths };
  }

  const addSubmoduleEffect = createEffect({
    kind: "addSubmodule",
    schema: OPERATION_SCHEMAS.addSubmodule,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      // The destination is inside this worktree, proven the same way as a worktree
      // destination is proven inside its root.
      const candidate = join(facts.value.worktreePath, operation.relativePath);
      if (!containedBy(facts.value.worktreePath, candidate)) {
        return failedOp(
          operationId,
          "Forbidden",
          "the submodule path would be outside the worktree",
        );
      }
      const outcome = await addSubmodule(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          url: operation.remoteUrl,
          path: operation.relativePath,
          branchName: operation.branchName,
          initialize: operation.initialize,
        },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `added submodule ${operation.relativePath} from ${operation.remoteUrl}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const updateSubmoduleEffect = createEffect({
    kind: "updateSubmodule",
    schema: OPERATION_SCHEMAS.updateSubmodule,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const resolved = resolveSubmodulePaths(
        operation.pathIds,
        facts.value,
        operationId,
      );
      if (!resolved.ok) {
        return resolved.problem;
      }
      const outcome = await updateSubmodules(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          paths: resolved.paths,
          initialize: operation.initialize,
          recursive: operation.recursive,
        },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `updated ${resolved.paths.length} submodule${resolved.paths.length === 1 ? "" : "s"} to the recorded commit`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const syncSubmoduleEffect = createEffect({
    kind: "syncSubmodule",
    schema: OPERATION_SCHEMAS.syncSubmodule,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const resolved = resolveSubmodulePaths(
        operation.pathIds,
        facts.value,
        operationId,
      );
      if (!resolved.ok) {
        return resolved.problem;
      }
      const outcome = await syncSubmodules(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        { paths: resolved.paths, recursive: operation.recursive },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `synced URLs for ${resolved.paths.length} submodule${resolved.paths.length === 1 ? "" : "s"}`,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  return [
    createWorktreeEffect,
    removeWorktreeEffect,
    lockWorktreeEffect,
    unlockWorktreeEffect,
    addSubmoduleEffect,
    updateSubmoduleEffect,
    syncSubmoduleEffect,
  ];
}

/** The kinds this module implements, in capabilities order. */
export const WORKTREE_MUTATION_KINDS = [
  "createWorktree",
  "removeWorktree",
  "lockWorktree",
  "unlockWorktree",
  "addSubmodule",
  "updateSubmodule",
  "syncSubmodule",
] as const;
