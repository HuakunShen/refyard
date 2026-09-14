/**
 * The mutation coordinator: the glue between a validated request and the job engine.
 *
 * It supplies the facts the engine cannot know on its own, and it is the module that
 * decides what "the repository this request touches" means:
 *
 * - **`repositoryIdFor`.** A worktree or repository target names its repository
 *   directly. A workspace target (init, clone) names a destination instead, and this
 *   build has no effect for those, so it answers `null` — the engine then refuses the
 *   request as unimplemented rather than guessing at an id.
 * - **`preconditionsFor`.** Snapshot freshness, index state and the post-restart
 *   write block come from a *fresh* read taken at submit time, not from whatever the
 *   client believed when it planned the request.
 *
 * The third thing it does is smaller and easier to miss: it subscribes the job
 * engine to the event ring, so a state change reaches connected clients through the
 * same path a re-read would take.
 */
import type { ParsedMutationRequest } from "@refyard/git-contract";
import type { GitEngine } from "@refyard/git-core";
import {
  pathKey,
  readHeadFacts,
  readStatusFacts,
  type StatusFacts,
} from "@refyard/git-core";
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
import { indexFingerprint, type PreconditionContext } from "./preconditions.js";

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
  implementedKinds(): readonly string[];
  /** Repositories blocked by an unresolved operation after a restart. */
  blockedRepositories(): readonly string[];
}

/** Where a target's repository comes from, or null when there is none yet. */
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
  return indexFingerprint({
    headOid: facts.head.oid,
    entries: facts.records.map((record) => ({
      pathKey: `${pathKey(record.path)}\u0000${pathKey(record.originalPath ?? new Uint8Array(0))}`,
      mode: record.modes.index ?? record.modes.worktree ?? "-",
      oid: record.oids.index ?? "-",
      stage: record.stages.length,
    })),
  });
}

export function createMutationCoordinator(
  options: MutationCoordinatorOptions,
): MutationCoordinator {
  const gitDirs = createGitDirLookup(options.engine);

  async function preconditionsFor(
    request: ParsedMutationRequest,
  ): Promise<PreconditionContext> {
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
    const record = await options.repositories.require(repositoryId);
    const worktreeId =
      request.target.kind === "worktree" ? request.target.worktreeId : null;
    const worktree = await options.repositories.worktree(
      repositoryId,
      worktreeId,
    );
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

    if (request.target.kind === "workspace") {
      // Not reachable today; kept so this function has no implicit fall-through.
      throw new Error("a workspace target has no preconditions");
    }
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
    repositoryIdFor: (request) => repositoryIdOfTarget(request.target),
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
