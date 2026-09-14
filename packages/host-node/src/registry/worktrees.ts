/**
 * Worktree identities.
 *
 * A worktree is the unit that has a HEAD, an index and a working directory, and
 * several of them share one common Git directory. Two consequences shape this file:
 *
 * - **Identity is the resolved path.** A worktree that is unregistered and
 *   re-added at the same path is the same worktree; one at a different path is a
 *   different worktree even on the same branch. Ids are kept stable across
 *   re-reads so a UI selection survives a refresh.
 * - **Scope is the approved root, not the worktree.** A linked worktree can live
 *   anywhere; one outside every approved root is listed (its path is useful) but
 *   carries no directory handle, so no read or write can run in it until the user
 *   approves that directory.
 */
import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import type {
  DisplayPath,
  TextCodec,
  WorktreeRecord as GitWorktreeRecord,
} from "@refyard/git-core";
import {
  HandleError,
  isInsideOrEqual,
  type HandleRegistry,
} from "../filesystem/handles.js";

export interface HostWorktree {
  readonly worktreeId: string;
  readonly repositoryId: string;
  /** Resolved path of the working tree; for a bare repository, its Git directory. */
  readonly path: string;
  readonly displayPath: DisplayPath;
  /** Directory handle inside an approved root, or null when it is out of scope. */
  readonly handle: string | null;
  readonly isMain: boolean;
  readonly isBare: boolean;
  readonly headOid: string | null;
  readonly branchRef: string | null;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly lockReason: DisplayPath | null;
  readonly prunable: boolean;
}

export interface WorktreeRegistryOptions {
  readonly codec: TextCodec;
  readonly handles: HandleRegistry;
  readonly nextWorktreeId: () => string;
}

export interface WorktreeRegistry {
  /**
   * Reconcile Git's worktree list with the ids already minted.
   *
   * Returns the worktrees in Git's order, keeping ids for paths that are still
   * present. Worktrees that disappeared keep their id in `removed` so a caller can
   * invalidate per-worktree state (path id bindings, cached reads) explicitly.
   */
  reconcile(input: {
    readonly repositoryId: string;
    readonly allowedRootId: string;
    readonly records: readonly GitWorktreeRecord[];
    /** Path of the repository's primary worktree, as Git reported it. */
    readonly primaryPath: string | null;
  }): Promise<{
    readonly worktrees: readonly HostWorktree[];
    readonly removed: readonly string[];
  }>;
  get(worktreeId: string): HostWorktree | null;
  list(repositoryId: string): readonly HostWorktree[];
  /** The named worktree, or the primary one when no id was given. */
  require(repositoryId: string, worktreeId: string | null): HostWorktree;
}

export function createWorktreeRegistry(
  options: WorktreeRegistryOptions,
): WorktreeRegistry {
  const byId = new Map<string, HostWorktree>();
  const idByPath = new Map<string, string>();

  return {
    async reconcile(input) {
      const root = options.handles.root(input.allowedRootId);
      if (root === null) {
        throw new HandleError(
          "Forbidden",
          `unknown approved root ${input.allowedRootId}`,
        );
      }
      const seen = new Set<string>();
      const worktrees: HostWorktree[] = [];
      for (const record of input.records) {
        const displayPath = options.codec.toDisplayPath(record.pathBytes);
        let resolved: string;
        if (displayPath.representable) {
          try {
            resolved = await realpath(displayPath.text);
          } catch {
            // Git listed a worktree whose directory is gone (prunable). Its path is
            // still worth showing, but nothing can be read there.
            resolved = displayPath.text;
          }
        } else {
          resolved = displayPath.text;
        }
        const existingId = idByPath.get(resolved);
        const worktreeId =
          existingId ??
          ((): string => {
            const minted = options.nextWorktreeId();
            idByPath.set(resolved, minted);
            return minted;
          })();
        seen.add(worktreeId);

        const handle =
          displayPath.representable && isInsideOrEqual(root.path, resolved)
            ? (() => {
                const relativePath = relative(root.path, resolved)
                  .split(sep)
                  .join("/");
                try {
                  return options.handles.handleFor(
                    input.allowedRootId,
                    relativePath,
                  );
                } catch {
                  return null;
                }
              })()
            : null;

        const isMain =
          input.primaryPath !== null && input.primaryPath === resolved;
        const worktree: HostWorktree = {
          worktreeId,
          repositoryId: input.repositoryId,
          path: resolved,
          displayPath,
          handle,
          isMain,
          isBare: record.bare,
          headOid: record.headOid,
          branchRef: record.branchRef,
          detached: record.detached,
          locked: record.locked,
          lockReason:
            record.lockReasonBytes === null
              ? null
              : options.codec.toDisplayPath(record.lockReasonBytes),
          prunable: record.prunable,
        };
        byId.set(worktreeId, worktree);
        worktrees.push(worktree);
      }

      const removed: string[] = [];
      for (const [worktreeId, worktree] of byId) {
        if (worktree.repositoryId !== input.repositoryId) {
          continue;
        }
        if (!seen.has(worktreeId)) {
          removed.push(worktreeId);
          byId.delete(worktreeId);
          idByPath.delete(worktree.path);
        }
      }

      return { worktrees, removed };
    },

    get(worktreeId): HostWorktree | null {
      return byId.get(worktreeId) ?? null;
    },

    list(repositoryId): readonly HostWorktree[] {
      return [...byId.values()].filter(
        (worktree) => worktree.repositoryId === repositoryId,
      );
    },

    require(repositoryId, worktreeId): HostWorktree {
      const candidates = [...byId.values()].filter(
        (worktree) => worktree.repositoryId === repositoryId,
      );
      if (worktreeId === null) {
        const primary =
          candidates.find((worktree) => worktree.isMain) ?? candidates[0];
        if (primary === undefined) {
          throw new HandleError(
            "NotFound",
            `repository ${repositoryId} has no worktrees registered`,
          );
        }
        return primary;
      }
      const worktree = byId.get(worktreeId);
      if (worktree === undefined || worktree.repositoryId !== repositoryId) {
        throw new HandleError(
          "NotFound",
          `worktree ${worktreeId} is not part of repository ${repositoryId}`,
        );
      }
      return worktree;
    },
  };
}
