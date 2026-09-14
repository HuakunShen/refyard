/**
 * Approved roots: the directories a user has explicitly handed to the service.
 *
 * Everything the service can reach is inside one of these, and a root carries two
 * facts that are deliberately separate:
 *
 * - the **resolved path**, because a containment check on an unresolved path is
 *   not a check at all (a symlinked `~/src` and its target are the same directory
 *   to Git and different strings to a comparison);
 * - the **execution trust** flag. Reading or writing a repository can run code the
 *   repository itself supplies — hooks, filters, `core.fsmonitor`, a credential
 *   helper — so "the user pointed the tool at this directory" is recorded here
 *   rather than assumed later. An untrusted root can be listed, but operations that
 *   run repository-supplied code are refused on it.
 *
 * The private state root (recovery backups, the operation journal) is also minted
 * here: it lives outside every approved root, and nothing under it is ever served
 * to a client.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import type { DisplayPath } from "@refyard/git-core";
import { HandleError, type HandleRegistry } from "../filesystem/handles.js";
import {
  encodeExecutionPath,
  type createTextCodec,
} from "../filesystem/codec.js";

export interface RegisterRootOptions {
  readonly path: string;
  /** True when the user asked for this directory to be operable, not just listed. */
  readonly executionTrusted?: boolean;
  readonly handles: HandleRegistry;
  readonly codec: ReturnType<typeof createTextCodec>;
  readonly nextRootId: () => string;
}

export interface RootRecord {
  readonly allowedRootId: string;
  /** Real path, after symlinks; the only form used for containment checks. */
  readonly path: string;
  readonly displayPath: DisplayPath;
  readonly executionTrusted: boolean;
  /** Repositories registered under this root, in registration order. */
  readonly repositoryIds: readonly string[];
  /** Device and inode at approval time, so a replaced directory is detectable. */
  readonly identity: { readonly dev: number; readonly ino: number };
  readonly approvedAtMs: number;
}

export interface RootRegistry {
  approve(options: {
    readonly path: string;
    readonly executionTrusted?: boolean;
  }): Promise<RootRecord>;
  list(): readonly RootRecord[];
  get(allowedRootId: string): RootRecord | null;
  /** Re-prove that a root still exists and is the same directory. */
  requireIntact(allowedRootId: string): Promise<RootRecord>;
  attachRepository(allowedRootId: string, repositoryId: string): void;
  detachRepository(allowedRootId: string, repositoryId: string): void;
  /** Directory for recovery backups and private state; created on demand. */
  stateRoot(): Promise<string>;
  handles: HandleRegistry;
}

export interface RootRegistryOptions {
  readonly handles: HandleRegistry;
  readonly codec: ReturnType<typeof createTextCodec>;
  readonly nextRootId?: () => string;
  /** Overrides where the private state directory lives; see `defaultStateRoot`. */
  readonly stateRootPath?: string;
  readonly now?: () => number;
}

export function createRootRegistry(options: RootRegistryOptions): RootRegistry {
  const records = new Map<string, RootRecord>();
  const now = options.now ?? Date.now;
  let counter = 0;
  const nextRootId =
    options.nextRootId ?? ((): string => `root_${(counter += 1).toString(36)}`);

  return {
    handles: options.handles,

    async approve(input): Promise<RootRecord> {
      // An unrepresentable root is refused at registration: a repository whose
      // own path cannot be handed to Git would fail halfway through an operation,
      // and every path inside it would be unactionable anyway.
      const bytes = encodeExecutionPath(input.path);
      if (bytes === null) {
        throw new HandleError(
          "UnsupportedPathEncoding",
          "the root path cannot be represented exactly; register a parent directory with a representable path",
        );
      }
      const resolved = await realpath(input.path);
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        throw new HandleError(
          "Forbidden",
          `root is not a directory: ${resolved}`,
        );
      }
      const allowedRootId = nextRootId();
      await options.handles.approveRoot({ allowedRootId, path: resolved });
      const display = options.codec.toDisplayPath(
        new TextEncoder().encode(resolved),
      );
      const record: RootRecord = {
        allowedRootId,
        path: resolved,
        displayPath: display,
        executionTrusted: input.executionTrusted === true,
        repositoryIds: [],
        identity: { dev: Number(info.dev), ino: Number(info.ino) },
        approvedAtMs: now(),
      };
      records.set(allowedRootId, record);
      return record;
    },

    list(): readonly RootRecord[] {
      return [...records.values()];
    },

    get(allowedRootId): RootRecord | null {
      return records.get(allowedRootId) ?? null;
    },

    async requireIntact(allowedRootId): Promise<RootRecord> {
      const record = records.get(allowedRootId);
      if (record === undefined) {
        throw new HandleError(
          "Forbidden",
          `unknown approved root ${allowedRootId}`,
        );
      }
      let info;
      try {
        info = await stat(record.path);
      } catch {
        throw new HandleError(
          "NotFound",
          `the approved root ${record.path} no longer exists`,
        );
      }
      if (!info.isDirectory()) {
        throw new HandleError(
          "NotFound",
          `the approved root ${record.path} is no longer a directory`,
        );
      }
      if (
        Number(info.dev) !== record.identity.dev ||
        Number(info.ino) !== record.identity.ino
      ) {
        // The path exists but is a different directory: a grant must not survive
        // delete-and-recreate, because the new directory was never approved.
        throw new HandleError(
          "Forbidden",
          `the approved root ${record.path} was replaced; approve the directory again`,
        );
      }
      return record;
    },

    attachRepository(allowedRootId, repositoryId): void {
      const record = records.get(allowedRootId);
      if (record === undefined) {
        return;
      }
      if (!record.repositoryIds.includes(repositoryId)) {
        records.set(allowedRootId, {
          ...record,
          repositoryIds: [...record.repositoryIds, repositoryId],
        });
      }
    },

    detachRepository(allowedRootId, repositoryId): void {
      const record = records.get(allowedRootId);
      if (record === undefined) {
        return;
      }
      records.set(allowedRootId, {
        ...record,
        repositoryIds: record.repositoryIds.filter((id) => id !== repositoryId),
      });
    },

    async stateRoot(): Promise<string> {
      const root = options.stateRootPath ?? defaultStateRoot();
      await mkdir(root, { recursive: true, mode: 0o700 });
      return root;
    },
  };
}

/**
 * Where the journal and recovery backups live when nothing says otherwise.
 *
 * It used to be `$TMPDIR/refyard-state`, which was wrong for what is stored there:
 * a recovery backup exists so a discard can be undone *later*, and the system is
 * free to clear a temporary directory in between — on macOS `TMPDIR` is per-user and
 * purgeable. The state directory is therefore a per-user, durable location, chosen
 * the way each platform expects, and `REFYARD_STATE_DIR` overrides it (which is how a
 * test or a portable install pins it).
 */
export function defaultStateRoot(): string {
  const override = process.env["REFYARD_STATE_DIR"];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  switch (process.platform) {
    case "darwin": {
      return home === undefined
        ? join(process.env["TMPDIR"] ?? "/tmp", "refyard-state")
        : join(home, "Library", "Application Support", "refyard");
    }
    case "win32": {
      const localAppData = process.env["LOCALAPPDATA"];
      if (localAppData !== undefined && localAppData.length > 0) {
        return join(localAppData, "refyard");
      }
      return home === undefined
        ? join(process.env["TMPDIR"] ?? ".", "refyard-state")
        : join(home, "AppData", "Local", "refyard");
    }
    default: {
      const xdg = process.env["XDG_STATE_HOME"];
      if (xdg !== undefined && xdg.length > 0) {
        return join(xdg, "refyard");
      }
      return home === undefined
        ? join(process.env["TMPDIR"] ?? "/tmp", "refyard-state")
        : join(home, ".local", "state", "refyard");
    }
  }
}
