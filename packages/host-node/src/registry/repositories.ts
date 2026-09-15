/**
 * Repository identity.
 *
 * A repository *instance* is one common Git directory. Linked worktrees share it —
 * they have their own HEAD and index but the same object database and refs — while
 * a second clone of the same project, even at a similar path on the same machine,
 * is a different instance with a different id. Nothing here derives an id from a
 * path, a remote URL or a project name.
 *
 * Two rules make registration meaningful:
 *
 * 1. **Registration is explicit and root-scoped.** Only a directory inside an
 *    approved root can be registered, and the request names a *relative* path, so a
 *    browser cannot aim the service at `/etc` or at a symlink that leaves the root.
 * 2. **A grant does not survive replacement.** The common directory's device and
 *    inode are recorded when the repository is registered, together with the
 *    descriptor that pins it; if the path now holds a different directory (deleted
 *    and re-cloned, or swapped), reads fail with "re-register" instead of silently
 *    operating on an unapproved repository. `identity.ts` explains why the numbers
 *    alone were not enough on Linux.
 *
 * The registry also owns the per-repository directory handles: every Git command
 * runs in a worktree whose handle the registry minted, and the handle registry
 * re-proves containment on each use.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  TextCodec,
  WorktreeRecord as GitWorktreeRecord,
} from "@refyard/git-core";
import {
  readLayout,
  readWorktreeFacts,
  type GitEngine,
  type LayoutFacts,
} from "@refyard/git-core";
import { HandleError, type HandleRegistry } from "../filesystem/handles.js";
import { createDirectoryPins, type DirectoryPin } from "./identity.js";
import type { RootRegistry } from "./roots.js";
import type { HostWorktree, WorktreeRegistry } from "./worktrees.js";

export interface RepositoryRecord {
  readonly repositoryId: string;
  readonly allowedRootId: string;
  readonly displayPath: {
    readonly text: string;
    readonly representable: boolean;
  };
  readonly displayName: string;
  /** Common Git directory: the identity of this instance. */
  readonly commonDir: string;
  /** Per-worktree Git directory of the primary worktree. */
  readonly gitDir: string;
  readonly objectFormat: LayoutFacts["objectFormat"];
  readonly bare: boolean;
  readonly shallow: boolean;
  /** Device and inode of the common directory at registration time. */
  readonly identity: { readonly dev: number; readonly ino: number };
  readonly registeredAtMs: number;
  readonly primaryWorktreeId: string;
  readonly worktreeIds: readonly string[];
  readonly lastFetchedAt: string | null;
}

export interface RegisterRepositoryInput {
  readonly allowedRootId: string;
  /** Path relative to the approved root; never an absolute path from a client. */
  readonly relativePath: string;
  readonly handles: HandleRegistry;
}

export interface RepositoryRegistryOptions {
  readonly roots: RootRegistry;
  readonly worktrees: WorktreeRegistry;
  readonly codec: TextCodec;
  readonly engine: GitEngine;
  readonly nextRepositoryId: () => string;
  readonly now?: () => number;
}

export interface RepositoryRegistry {
  register(input: RegisterRepositoryInput): Promise<RepositoryRecord>;
  /** Re-verify and return a registered repository. */
  require(repositoryId: string): Promise<RepositoryRecord>;
  get(repositoryId: string): RepositoryRecord | null;
  list(): readonly RepositoryRecord[];
  worktreesOf(repositoryId: string): Promise<readonly HostWorktree[]>;
  worktree(
    repositoryId: string,
    worktreeId: string | null,
  ): Promise<HostWorktree>;
  /** Forget a repository; used when a directory is gone for good. */
  unregister(repositoryId: string): void;
}

export function createRepositoryRegistry(
  options: RepositoryRegistryOptions,
): RepositoryRegistry {
  const pinner = createDirectoryPins();
  // Record and pin travel together: everything that returns a record has already
  // proved, or is about to prove, that the directory it names is the same one.
  const records = new Map<
    string,
    { readonly record: RepositoryRecord; readonly pin: DirectoryPin }
  >();
  const repositoryIdByCommonDir = new Map<string, string>();
  const now = options.now ?? Date.now;

  function entryOf(repositoryId: string): {
    readonly record: RepositoryRecord;
    readonly pin: DirectoryPin;
  } {
    const entry = records.get(repositoryId);
    if (entry === undefined) {
      throw new HandleError("NotFound", `unknown repository ${repositoryId}`);
    }
    return entry;
  }

  async function readWorktreeList(
    engine: GitEngine,
    worktree: HostWorktree,
  ): Promise<readonly GitWorktreeRecord[]> {
    if (worktree.handle === null) {
      throw new HandleError(
        "Forbidden",
        `${worktree.displayPath.text} is outside every approved root; approve it before reading this repository`,
      );
    }
    return readWorktreeFacts(engine, { cwdHandle: worktree.handle });
  }

  async function reconcileWorktrees(
    record: RepositoryRecord,
  ): Promise<readonly HostWorktree[]> {
    const primary = options.worktrees.require(
      record.repositoryId,
      record.primaryWorktreeId,
    );
    const listed = await readWorktreeList(options.engine, primary);
    const { worktrees } = await options.worktrees.reconcile({
      repositoryId: record.repositoryId,
      allowedRootId: record.allowedRootId,
      records: listed,
      primaryPath: record.bare ? null : record.displayPath.text,
    });
    return worktrees;
  }

  return {
    async register(input): Promise<RepositoryRecord> {
      const root = await options.roots.requireIntact(input.allowedRootId);
      // The handle is minted from a relative path and re-proved on resolution, so a
      // symlink that leaves the approved root is refused here rather than later.
      const handle = input.handles.handleFor(
        input.allowedRootId,
        input.relativePath,
      );
      const resolved = await input.handles.resolve(handle);
      const layout = await readLayout(options.engine, { cwdHandle: handle });

      let info;
      try {
        info = await stat(layout.commonDir);
      } catch {
        throw new HandleError(
          "NotFound",
          `the Git common directory ${layout.commonDir} could not be read`,
        );
      }

      const existingId = repositoryIdByCommonDir.get(layout.commonDir);
      if (existingId !== undefined) {
        const existing = records.get(existingId);
        if (existing !== undefined) {
          // Re-registering the same instance returns the same id: two paths to one
          // repository must not become two repositories in the list.
          await reconcileWorktrees(existing.record);
          return existing.record;
        }
      }

      const repositoryId = options.nextRepositoryId();
      const pin = await pinner.pin(layout.commonDir, info);
      const displayPath = options.codec.toDisplayPath(
        new TextEncoder().encode(resolved.absolutePath),
      );
      const record: RepositoryRecord = {
        repositoryId,
        allowedRootId: input.allowedRootId,
        displayPath,
        displayName: baseName(resolved.absolutePath),
        commonDir: layout.commonDir,
        gitDir: layout.gitDir,
        objectFormat: layout.objectFormat,
        bare: layout.bare,
        shallow: layout.shallow,
        identity: { dev: pin.dev, ino: pin.ino },
        registeredAtMs: now(),
        // Filled in below, once the worktree list has been read.
        primaryWorktreeId: "",
        worktreeIds: [],
        lastFetchedAt: null,
      };
      records.set(repositoryId, { record, pin });
      repositoryIdByCommonDir.set(layout.commonDir, repositoryId);

      try {
        const listed = await readWorktreeFacts(options.engine, {
          cwdHandle: handle,
        });
        const { worktrees } = await options.worktrees.reconcile({
          repositoryId,
          allowedRootId: input.allowedRootId,
          records: listed,
          primaryPath: layout.bare ? null : resolved.absolutePath,
        });
        const primary =
          worktrees.find((worktree) => worktree.isMain) ??
          worktrees.find(
            (worktree) => worktree.path === resolved.absolutePath,
          ) ??
          worktrees[0];
        if (primary === undefined) {
          throw new HandleError(
            "NotFound",
            `${resolved.absolutePath} is not a Git worktree`,
          );
        }
        const registered: RepositoryRecord = {
          ...record,
          primaryWorktreeId: primary.worktreeId,
          worktreeIds: worktrees.map((worktree) => worktree.worktreeId),
        };
        records.set(repositoryId, { record: registered, pin });
        options.roots.attachRepository(input.allowedRootId, repositoryId);
        void root;
        return registered;
      } catch (error) {
        records.delete(repositoryId);
        pin.release();
        repositoryIdByCommonDir.delete(layout.commonDir);
        throw error;
      }
    },

    async require(repositoryId): Promise<RepositoryRecord> {
      const { record, pin } = entryOf(repositoryId);
      await options.roots.requireIntact(record.allowedRootId);
      const state = await pin.check();
      if (state === "missing") {
        throw new HandleError(
          "NotFound",
          `the Git directory of ${record.displayName} is gone; register it again`,
        );
      }
      if (state === "replaced") {
        throw new HandleError(
          "Forbidden",
          `${record.displayName} was replaced since it was registered; register it again`,
        );
      }
      return record;
    },

    get(repositoryId): RepositoryRecord | null {
      return records.get(repositoryId)?.record ?? null;
    },

    list(): readonly RepositoryRecord[] {
      return [...records.values()].map((entry) => entry.record);
    },

    async worktreesOf(repositoryId) {
      const { pin } = entryOf(repositoryId);
      const record = await this.require(repositoryId);
      const worktrees = await reconcileWorktrees(record);
      records.set(repositoryId, {
        record: {
          ...record,
          worktreeIds: worktrees.map((worktree) => worktree.worktreeId),
        },
        pin,
      });
      return worktrees;
    },

    async worktree(repositoryId, worktreeId) {
      const record = await this.require(repositoryId);
      if (worktreeId !== null) {
        return options.worktrees.require(repositoryId, worktreeId);
      }
      // The primary worktree may not be known yet on the very first call after a
      // restart, so reconcile once before answering.
      const existing = options.worktrees.get(record.primaryWorktreeId);
      if (existing !== null) {
        return existing;
      }
      const worktrees = await reconcileWorktrees(record);
      const primary =
        worktrees.find((worktree) => worktree.isMain) ?? worktrees[0];
      if (primary === undefined) {
        throw new HandleError(
          "NotFound",
          `repository ${repositoryId} has no worktrees`,
        );
      }
      return primary;
    },

    unregister(repositoryId): void {
      const entry = records.get(repositoryId);
      if (entry === undefined) {
        return;
      }
      const { record } = entry;
      records.delete(repositoryId);
      entry.pin.release();
      repositoryIdByCommonDir.delete(record.commonDir);
      options.roots.detachRepository(record.allowedRootId, repositoryId);
    },
  };
}

function baseName(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  const name = index === -1 ? trimmed : trimmed.slice(index + 1);
  return name.length > 0 ? name : join("/");
}
