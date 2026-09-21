/**
 * The real mutation effects for path staging, discarding, committing and
 * amending — the T08 operations, wired from the same substrate the reads use.
 *
 * Every effect follows the same order, and the order is the safety model:
 *
 * 1. resolve every named path id to raw bytes (one unknown or unrepresentable
 *    path refuses the whole batch);
 * 2. re-read Head and status so decisions run against the repository as it is
 *    *now*, never as the request remembered it;
 * 3. classify what may happen to each path (discard refuses untracked, ignored,
 *    unmerged, submodule and special-type entries before anything runs);
 * 4. consume preview tokens against freshly computed content fingerprints —
 *    all-or-nothing, single-use, so a replayed or stale request cannot act;
 * 5. for a discard, write verified backups of everything about to be destroyed;
 *    a backup failure means the operation does not run;
 * 6. run the core workflow and report the outcome honestly, including `unknown`.
 */
import { join } from "node:path";
import type { MutationKind, Problem } from "@refyard/git-contract";
import { OPERATION_SCHEMAS } from "@refyard/git-contract";
import {
  pathKey,
  commitIndex,
  resetBranch,
  revertCommit,
  restoreSelectedPaths,
  selectDiscardablePaths,
  stageSelectedPaths,
  unstageSelectedPaths,
  type GitEngine,
  type StatusRecord,
} from "@refyard/git-core";
import {
  fingerprintFile,
  PathRefusedError,
  readPathMetadata,
  type BackupOutcome,
} from "../filesystem/metadata.js";
import type { PreviewStore } from "../filesystem/preview.js";
import type { PathRegistry } from "../registry/paths.js";
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
  resultOf,
  unknownOutcome,
  writeOutcomeFromGit,
  type Resolution,
  type WorktreeFacts,
} from "./effects-support.js";

interface ResolvedPath {
  readonly pathId: string;
  readonly executionBytes: Uint8Array;
  readonly executionText: string;
}

/** The one recovery-store method the discard effect depends on. */
export interface RecoveryBackupWriter {
  backUp(input: {
    readonly originalPath: string;
    readonly contentRoot: string;
    readonly operationId: string;
  }): Promise<BackupOutcome>;
}

export interface StagingEffectsOptions {
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
  readonly paths: PathRegistry;
  readonly previews: PreviewStore;
  readonly backups: RecoveryBackupWriter;
}

export function createStagingEffects(
  options: StagingEffectsOptions,
): readonly MutationEffect[] {
  const resolveFacts = createFactsResolver({
    engine: options.engine,
    repositories: options.repositories,
  });

  /**
   * Resolve every path id to raw bytes. One unknown or unrepresentable path
   * refuses the batch: a partially addressed mutation is never built.
   */
  function resolveBindings(
    pathIds: readonly string[],
    facts: WorktreeFacts,
    operationId: string,
  ): Resolution<readonly ResolvedPath[]> {
    const resolved: ResolvedPath[] = [];
    for (const pathId of pathIds) {
      const binding = options.paths.getForWorktree({
        pathId,
        repositoryId: facts.repositoryId,
        worktreeId: facts.worktreeId,
      });
      if (
        binding === null ||
        binding.executionBytes === null ||
        binding.executionText === null
      ) {
        return {
          ok: false,
          problem: {
            code: binding === null ? "NotFound" : "UnsupportedPathEncoding",
            message:
              binding === null
                ? "a selected path is unknown in this worktree; reload the status and retry"
                : "a selected path's bytes cannot be represented exactly on this host, so the whole batch is refused",
            retryable: false,
            operationId,
          },
        };
      }
      resolved.push({
        pathId,
        executionBytes: binding.executionBytes,
        executionText: binding.executionText,
      });
    }
    return { ok: true, value: resolved };
  }

  /**
   * Consume the request's preview tokens against freshly hashed content.
   * redeem() verifies the whole batch before consuming any of it.
   */
  async function consumePreviews(
    pathIds: readonly string[],
    previewTokens: readonly string[],
    facts: WorktreeFacts,
    operationId: string,
  ): Promise<Problem | null> {
    const requests = [];
    for (let index = 0; index < pathIds.length; index += 1) {
      const pathId = pathIds[index] ?? "";
      const binding = options.paths.getForWorktree({
        pathId,
        repositoryId: facts.repositoryId,
        worktreeId: facts.worktreeId,
      });
      let fingerprintHex = "";
      if (binding !== null && binding.executionText !== null) {
        try {
          const fingerprint = await fingerprintFile(
            join(facts.worktreePath, binding.executionText),
          );
          fingerprintHex = fingerprint.hex;
        } catch {
          // An unreadable file fingerprints to the empty string, which is what
          // its preview issued too: both sides agree there is nothing to compare.
          fingerprintHex = "";
        }
      }
      requests.push({
        previewToken: previewTokens[index] ?? "",
        pathId,
        fingerprintHex,
      });
    }
    const check = options.previews.redeem(requests);
    if (check.ok) {
      return null;
    }
    return {
      code: "StalePreview",
      message: `${check.message}; re-preview the selected paths and confirm again`,
      retryable: false,
      operationId,
    };
  }

  function recordForPath(
    records: readonly StatusRecord[],
    bytes: Uint8Array,
  ): StatusRecord | null {
    const key = pathKey(bytes);
    for (const record of records) {
      if (pathKey(record.path) === key) {
        return record;
      }
    }
    return null;
  }

  /**
   * Stage: a selected rename stages the origin path as well, so the index holds
   * the rename rather than a copy plus a lingering old entry.
   */
  const stageEffect = createEffect({
    kind: "stagePaths",
    schema: OPERATION_SCHEMAS.stagePaths,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const bindings = resolveBindings(
        operation.pathIds,
        facts.value,
        operationId,
      );
      if (!bindings.ok) {
        return failed(bindings.problem);
      }
      const paths: Uint8Array[] = [];
      const seen = new Set<string>();
      for (const binding of bindings.value) {
        const key = pathKey(binding.executionBytes);
        if (!seen.has(key)) {
          seen.add(key);
          paths.push(binding.executionBytes);
        }
        const record = recordForPath(
          facts.value.status.records,
          binding.executionBytes,
        );
        if (
          record !== null &&
          (record.kind === "renamed" || record.kind === "copied") &&
          record.originalPath !== null
        ) {
          const originKey = pathKey(record.originalPath);
          if (!seen.has(originKey)) {
            seen.add(originKey);
            paths.push(record.originalPath);
          }
        }
      }
      const stale = await consumePreviews(
        operation.pathIds,
        operation.previewTokens,
        facts.value,
        operationId,
      );
      if (stale !== null) {
        return failed(stale);
      }
      const outcome = await stageSelectedPaths(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        paths,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `staged ${bindings.value.length} path${bindings.value.length === 1 ? "" : "s"}`,
          changedPaths: bindings.value.length,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const unstageEffect = createEffect({
    kind: "unstagePaths",
    schema: OPERATION_SCHEMAS.unstagePaths,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const bindings = resolveBindings(
        operation.pathIds,
        facts.value,
        operationId,
      );
      if (!bindings.ok) {
        return failed(bindings.problem);
      }
      const outcome = await unstageSelectedPaths(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          paths: bindings.value.map((binding) => binding.executionBytes),
          headBorn: facts.value.head.kind === "born",
        },
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `unstaged ${bindings.value.length} path${bindings.value.length === 1 ? "" : "s"} (working tree untouched)`,
          changedPaths: bindings.value.length,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const discardEffect = createEffect({
    kind: "discardTrackedPaths",
    schema: OPERATION_SCHEMAS.discardTrackedPaths,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const bindings = resolveBindings(
        operation.pathIds,
        facts.value,
        operationId,
      );
      if (!bindings.ok) {
        return failed(bindings.problem);
      }
      const selected = bindings.value.map((binding) => binding.executionBytes);
      // Token authority is checked before anything else about the batch: a
      // replayed or stale request is refused as stale, whatever the paths are.
      const stale = await consumePreviews(
        operation.pathIds,
        operation.previewTokens,
        facts.value,
        operationId,
      );
      if (stale !== null) {
        return failed(stale);
      }
      const selection = selectDiscardablePaths(
        facts.value.status.records,
        selected,
      );
      if (!selection.ok) {
        return failedOp(
          operationId,
          selection.refusal.reason === "unchanged"
            ? "NotFound"
            : "UnsupportedOperation",
          `the discard was refused: ${selection.refusal.detail}`,
        );
      }
      let backedUp = 0;
      for (const binding of bindings.value) {
        const absolute = join(facts.value.worktreePath, binding.executionText);
        let metadata;
        try {
          metadata = await readPathMetadata(absolute);
        } catch (error) {
          if (error instanceof PathRefusedError && error.code === "NotFound") {
            // The file is gone from the worktree; the restore recreates it from
            // the index and nothing can be lost, so there is nothing to back up.
            continue;
          }
          throw error;
        }
        if (metadata.kind !== "regularFile") {
          return failedOp(
            operationId,
            "UnsupportedOperation",
            `the discard was refused: ${binding.executionText} is a ${metadata.kind}, and only regular files are discarded`,
          );
        }
        const backup = await options.backups.backUp({
          originalPath: absolute,
          contentRoot: facts.value.worktreePath,
          operationId,
        });
        if (backup.kind === "refused") {
          // The design rule: a backup failure means the operation does not run.
          return failedOp(
            operationId,
            "Conflict",
            `the discard was refused because a backup could not be written: ${backup.reason}`,
          );
        }
        backedUp += 1;
      }
      const outcome = await restoreSelectedPaths(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        selected,
      );
      if (outcome.kind === "refused") {
        return writeOutcomeFromGit(operationId, outcome);
      }
      return {
        kind: "succeeded",
        result: resultOf({
          summary: `discarded ${bindings.value.length} path${bindings.value.length === 1 ? "" : "s"} (restored to the index; ${backedUp} backed up)`,
          changedPaths: bindings.value.length,
          newHeadOid: facts.value.head.oid,
        }),
      };
    },
  });

  const commitEffect = createEffect({
    kind: "commit",
    schema: OPERATION_SCHEMAS.commit,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const hasStagedChange = facts.value.status.records.some(
        (record) => record.indexStatus !== ".",
      );
      if (!hasStagedChange) {
        return failedOp(
          operationId,
          "Conflict",
          "the index holds no change to commit; stage something first",
        );
      }
      const outcome = await commitIndex(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          message: new TextEncoder().encode(operation.message),
          amend: false,
        },
      );
      return commitOutcomeToEffect(operationId, outcome, "created commit");
    },
  });

  const amendEffect = createEffect({
    kind: "amendCommit",
    schema: OPERATION_SCHEMAS.amendCommit,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await commitIndex(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        {
          message:
            operation.message === null
              ? null
              : new TextEncoder().encode(operation.message),
          amend: true,
        },
      );
      return commitOutcomeToEffect(
        operationId,
        outcome,
        "amended commit, new head",
      );
    },
  });

  function commitOutcomeToEffect(
    operationId: string,
    outcome: Awaited<ReturnType<typeof commitIndex>>,
    verb: string,
  ): EffectOutcome {
    switch (outcome.kind) {
      case "committed":
        return {
          kind: "succeeded",
          result: resultOf({
            summary: `${verb} ${outcome.newHeadOid}`,
            changedPaths: null,
            newHeadOid: outcome.newHeadOid,
          }),
        };
      case "committedWithComplaint":
        return {
          kind: "needsAttention",
          problem: {
            code: "NeedsAttention",
            message: `the commit exists (${outcome.newHeadOid}) but git exited non-zero afterwards: ${outcome.diagnostic}`,
            retryable: false,
            operationId,
          },
        };
      case "notCommitted":
        return writeOutcomeFromGit(operationId, {
          code: outcome.code,
          exitCode: outcome.exitCode,
          diagnostic: outcome.diagnostic,
        });
      default:
        return unknownOutcome(operationId, outcome.reason);
    }
  }

  const revertEffect = createEffect({
    kind: "revertCommit",
    schema: OPERATION_SCHEMAS.revertCommit,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await revertCommit(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        { oid: operation.oid },
      );
      switch (outcome.kind) {
        case "reverted":
          return {
            kind: "succeeded",
            result: resultOf({
              summary: `reverted commit, new head ${outcome.head?.oid ?? "unknown"}`,
              changedPaths: null,
              newHeadOid: outcome.head?.oid ?? null,
            }),
          };
        case "refused":
          return failedOp(operationId, "Conflict", outcome.reason);
        case "mergeRefused":
          return failedOp(
            operationId,
            "InvalidRequest",
            "that commit is a merge; reverting it needs a choice of parent that this build does not make",
          );
        case "conflictAborted":
          return failedOp(
            operationId,
            "Conflict",
            `the revert conflicted with your working tree and was aborted, so nothing was written: ${outcome.diagnostic}`,
          );
        case "gitRefused":
          return writeOutcomeFromGit(operationId, outcome.refusal);
        case "unknown":
          return unknownOutcome(
            operationId,
            "whether the revert ran is not established; look at the repository with git before writing again",
          );
      }
    },
  });

  const resetEffect = createEffect({
    kind: "resetBranch",
    schema: OPERATION_SCHEMAS.resetBranch,
    async run({ request, operation, operationId }) {
      const facts = await resolveFacts(request, operationId);
      if (!facts.ok) {
        return failed(facts.problem);
      }
      const outcome = await resetBranch(
        options.engine,
        { cwdHandle: facts.value.cwdHandle },
        { oid: operation.oid, mode: operation.mode },
      );
      switch (outcome.kind) {
        case "reset":
          return {
            kind: "succeeded",
            result: resultOf({
              summary: `branch reset to ${outcome.head?.oid ?? "unknown"}`,
              changedPaths: null,
              newHeadOid: outcome.head?.oid ?? null,
            }),
          };
        case "refused":
          return failedOp(operationId, "Conflict", outcome.reason);
        case "gitRefused":
          return writeOutcomeFromGit(operationId, outcome.refusal);
        case "unknown":
          return unknownOutcome(
            operationId,
            "whether the branch moved is not established; look at the repository with git before writing again",
          );
      }
    },
  });

  return [
    stageEffect,
    unstageEffect,
    discardEffect,
    commitEffect,
    amendEffect,
    revertEffect,
    resetEffect,
  ];
}

/** The mutation kinds this module turns on, in capabilities order. */
export const STAGING_MUTATION_KINDS: readonly MutationKind[] = [
  "stagePaths",
  "unstagePaths",
  "discardTrackedPaths",
  "commit",
  "amendCommit",
  "revertCommit",
  "resetBranch",
];
