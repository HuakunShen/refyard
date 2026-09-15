/**
 * The mutation coordinator: the glue between a validated request and the job engine.
 *
 * It supplies the facts the engine cannot know on its own, and it is the module that
 * decides what "the repository this request touches" means:
 *
 * - **`repositoryIdFor`.** A worktree or repository target names its repository
 *   directly. A workspace target (init, clone) names a destination instead — the
 *   operation is what brings a repository into being — so the key is the approved root
 *   it writes into. That key is what serializes the operation in the queue and what a
 *   restart blocks: two creations in one approved tree do not run at once, and a
 *   creation that died mid-write blocks further creations there until someone
 *   resolves it. The journal's `repositoryId` column holds this key; the client-facing
 *   record does not carry it at all (a client sees the target).
 * - **`preconditionsFor`.** Snapshot freshness, index state and the post-restart
 *   write block come from a *fresh* read taken at submit time, not from whatever the
 *   client believed when it planned the request.
 *
 * The third thing it does is smaller and easier to miss: it subscribes the job
 * engine to the event ring, so a state change reaches connected clients through the
 * same path a re-read would take.
 */
import type {
  MutationKind,
  ParsedMutationRequest,
} from "@refyard/git-contract";
import type { GitEngine } from "@refyard/git-core";
import {
  readHeadFacts,
  readStatusFacts,
  type StatusFacts,
} from "@refyard/git-core";
import { HandleError } from "../filesystem/handles.js";
import type { EventRing } from "../http/events.js";
import type { Recovery } from "../journal/recovery.js";
import type { JournalStore } from "../journal/store.js";
import type { RepositoryRegistry } from "../registry/repositories.js";
import type { SnapshotStore } from "./snapshots.js";
import type { WorktreeRegistry } from "../registry/worktrees.js";
import { createGitDirLookup, readOperationMarkers } from "./read-support.js";
import {
  createJobEngine,
  type JobEngine,
  type MutationEffect,
} from "./jobs.js";
import {
  mayRunDuringOperation,
  statusIndexKey,
  type PreconditionContext,
} from "./preconditions.js";

export interface MutationCoordinatorOptions {
  readonly journal: JournalStore;
  readonly repositories: RepositoryRegistry;
  readonly worktrees: WorktreeRegistry;
  readonly engine: GitEngine;
  readonly recovery: Recovery;
  readonly snapshots: SnapshotStore;
  readonly events: EventRing;
  readonly effects: readonly MutationEffect[];
  readonly nextOperationId: () => string;
  readonly nextSequence: () => number;
  readonly now?: () => number;
}

export interface MutationCoordinator {
  readonly jobs: JobEngine;
  /** The kinds this build can actually run; published in `capabilities`. */
  implementedKinds(): readonly MutationKind[];
  /** Repositories blocked by an unresolved operation after a restart. */
  blockedRepositories(): readonly string[];
}

/** Where a target's repository comes from, or null when there is none yet. */
/**
 * The key an operation is serialized, blocked and journalled under.
 *
 * One writer per resource: a repository (its common Git directory is the thing Git
 * locks), or — for the two operations that create one — the approved root the
 * destination lives in. The `root:` prefix is deliberate: it cannot collide with a
 * minted `repositoryId`, so a log line or a stored key says which kind of resource it
 * names without a second field.
 */
export function writeKeyOfTarget(
  target: ParsedMutationRequest["target"],
): string | null {
  if (target.kind === "workspace") {
    return target.allowedRootId.length === 0
      ? null
      : `root:${target.allowedRootId}`;
  }
  return target.repositoryId;
}

export function repositoryIdOfTarget(
  target: ParsedMutationRequest["target"],
): string | null {
  // Narrowed by the target's own discriminant rather than by a cast: a workspace
  // target has no repository yet by definition, and inventing one would let a
  // request name a repository the caller was never granted.
  if (target.kind === "workspace") {
    return null;
  }
  return target.repositoryId;
}

/**
 * The index fingerprint of a worktree right now.
 *
 * It is built from the paths Git already reported as changed plus the Head, so a
 * request that confirms three files is not invalidated by an unrelated file
 * elsewhere — while a change to one of the confirmed paths always invalidates it.
 */
export function currentIndexKey(facts: StatusFacts): string {
  return statusIndexKey(facts);
}

export function createMutationCoordinator(
  options: MutationCoordinatorOptions,
): MutationCoordinator {
  const gitDirs = createGitDirLookup(options.engine);

  async function preconditionsFor(
    request: ParsedMutationRequest,
  ): Promise<PreconditionContext> {
    if (request.target.kind === "workspace") {
      // Nothing to compare a snapshot against: the destination has no repository yet,
      // no index and no in-progress operation. The restart block is still consulted,
      // under the same key the queue and the journal use, so a creation that died
      // mid-write is not restarted into the directory it left behind.
      const block = options.recovery.blockFor(
        writeKeyOfTarget(request.target) ?? "",
      );
      return {
        snapshotHeadOid: null,
        currentHeadOid: null,
        indexUnchanged: true,
        operationInProgress: null,
        restartBlock:
          block === null
            ? null
            : {
                reason: block.reason,
                operationIds: [...block.operationIds],
              },
      };
    }

    const repositoryId = repositoryIdOfTarget(request.target);
    if (repositoryId === null) {
      // Unreachable in practice: the engine refuses a request without a repository
      // before preconditions are consulted. The value is fail-closed anyway.
      return {
        snapshotHeadOid: null,
        currentHeadOid: null,
        indexUnchanged: false,
        operationInProgress: null,
        restartBlock: {
          reason: "this request does not name a repository",
          operationIds: [],
        },
      };
    }
    const block = options.recovery.blockFor(repositoryId);
    let record;
    try {
      record = await options.repositories.require(repositoryId);
    } catch (error) {
      if (error instanceof HandleError && error.code === "NotFound") {
        return {
          snapshotHeadOid: null,
          currentHeadOid: null,
          indexUnchanged: false,
          operationInProgress: null,
          restartBlock: null,
          refusal: {
            code: "NotFound" as const,
            message:
              "that request names a repository this service does not know",
          },
        };
      }
      throw error;
    }
    const worktreeId =
      request.target.kind === "worktree" ? request.target.worktreeId : null;
    let worktree;
    try {
      worktree = await options.repositories.worktree(repositoryId, worktreeId);
    } catch (error) {
      if (error instanceof HandleError && error.code === "NotFound") {
        return {
          snapshotHeadOid: null,
          currentHeadOid: null,
          indexUnchanged: false,
          operationInProgress: null,
          restartBlock: null,
          refusal: {
            code: "NotFound" as const,
            message:
              "that request names a worktree this service does not know; reload and retry",
          },
        };
      }
      throw error;
    }
    if (worktree.handle === null) {
      return {
        snapshotHeadOid: null,
        currentHeadOid: null,
        indexUnchanged: false,
        operationInProgress: null,
        restartBlock:
          block === null
            ? {
                reason: `${worktree.displayPath.text} is outside every approved root`,
                operationIds: [],
              }
            : { reason: block.reason, operationIds: [...block.operationIds] },
      };
    }
    const handle = worktree.handle;
    const gitDir = await gitDirs.gitDirFor({
      worktreeId: worktree.worktreeId,
      handle,
      isMain: worktree.isMain,
      primaryGitDir: record.gitDir,
    });
    const [head, status] = await Promise.all([
      readHeadFacts(options.engine, handle),
      readStatusFacts(options.engine, {
        cwdHandle: handle,
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

    const snapshot = options.snapshots.get(request.target.expectedSnapshotId);
    return {
      snapshotHeadOid: snapshot?.headOid ?? null,
      currentHeadOid: head.oid,
      // An expired or unknown snapshot fails the comparison above; when it is known,
      // its index key is what the request was planned against.
      indexUnchanged:
        snapshot === null
          ? false
          : snapshot.indexKey === null ||
            snapshot.indexKey === currentIndexKey(status),
      operationInProgress: status.operationInProgress,
      // Continuing or aborting a merge is how a merge ends; every other kind — a
      // second merge included — is blocked while one is unfinished.
      mayRunDuring: mayRunDuringOperation(request.operation.kind),
      restartBlock:
        block === null
          ? null
          : { reason: block.reason, operationIds: [...block.operationIds] },
    };
  }

  const jobs = createJobEngine({
    journal: options.journal,
    recovery: options.recovery,
    effects: options.effects,
    nextOperationId: options.nextOperationId,
    nextSequence: options.nextSequence,
    ...(options.now === undefined ? {} : { now: options.now }),
    repositoryIdFor: (request) => writeKeyOfTarget(request.target),
    preconditionsFor,
    onEvent: (event) => {
      if (event.kind === "operation" && event.operation !== null) {
        options.events.publish({
          kind: "operation",
          operation: event.operation,
        });
        return;
      }
      options.events.publish({
        kind: "repositoryChanged",
        repositoryId: event.repositoryId,
        worktreeIds: [...event.worktreeIds],
        snapshotInvalidated: true,
      });
    },
  });

  return {
    jobs,
    implementedKinds: () => jobs.implementedKinds(),
    blockedRepositories: () => options.recovery.blockedRepositories(),
  };
}
