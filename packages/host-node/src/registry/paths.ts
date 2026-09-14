/**
 * Path identities.
 *
 * A `pathId` is the only way a client can name a path in a mutation, and this is
 * where they are minted and resolved. The rules:
 *
 * - a `pathId` is bound to **raw path bytes** in exactly one worktree; the display
 *   string is a rendering and is never accepted as an input;
 * - the same bytes in the same worktree always produce the same id, so a UI that
 *   re-reads status does not accumulate a new id for an unchanged file;
 * - the same bytes in a *different* worktree produce a different id, because a
 *   mutation must not be replayable across worktrees;
 * - a path whose bytes cannot be represented exactly is still given an id (it can
 *   be listed and described) but is marked `unrepresentable`, and the mutation
 *   layer refuses it with `UnsupportedPathEncoding` rather than guessing.
 *
 * The binding store is bounded: ids are cheap, but an unbounded map keyed by
 * filesystem content is a slow leak in a long-running service.
 */
import type { DisplayPath, TextCodec } from "@refyard/git-core";
import { encodeExecutionPath } from "../filesystem/codec.js";

export interface PathBinding {
  readonly pathId: string;
  readonly repositoryId: string;
  readonly worktreeId: string;
  /** Raw bytes as Git reported them. */
  readonly bytes: Uint8Array;
  readonly displayPath: DisplayPath;
  readonly encoding: "utf8" | "unrepresentable";
  /**
   * The text form to hand to Git, or null when the bytes cannot be represented.
   * Never derived from `displayPath.text` by decoding an escape — that is the whole
   * point of the split — and only non-null when the bytes round-trip exactly.
   */
  readonly executionText: string | null;
  /** The same text as bytes, which is what a pathspec list or stdin needs. */
  readonly executionBytes: Uint8Array | null;
  readonly mintedAtMs: number;
}

export interface PathRegistryOptions {
  readonly codec: TextCodec;
  readonly nextPathId: () => string;
  readonly now?: () => number;
  readonly maxEntries?: number;
}

export interface PathRegistry {
  /** Mint or reuse the binding for these bytes in this worktree. */
  bind(input: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly bytes: Uint8Array;
  }): PathBinding;
  get(pathId: string): PathBinding | null;
  /** Look up a binding and prove it belongs to the worktree the request named. */
  getForWorktree(input: {
    readonly pathId: string;
    readonly repositoryId: string;
    readonly worktreeId: string;
  }): PathBinding | null;
  clearWorktree(worktreeId: string): void;
  size(): number;
}

const DEFAULT_MAX_ENTRIES = 200_000;

export function createPathRegistry(options: PathRegistryOptions): PathRegistry {
  const byId = new Map<string, PathBinding>();
  const byKey = new Map<string, string>();
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  function keyFor(
    repositoryId: string,
    worktreeId: string,
    bytes: Uint8Array,
  ): string {
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return `${repositoryId}\u0000${worktreeId}\u0000${hex}`;
  }

  function evictIfNeeded(): void {
    if (byId.size <= maxEntries) {
      return;
    }
    // Insertion order, so the oldest bindings go first. Dropping a binding does not
    // invalidate anything a client holds: a later request for the same bytes simply
    // mints the id again, and a request naming a dropped id is refused as unknown
    // rather than resolved to a different path.
    const excess = byId.size - maxEntries;
    let removed = 0;
    for (const [pathId, binding] of byId) {
      if (removed >= excess) {
        break;
      }
      byId.delete(pathId);
      byKey.delete(
        keyFor(binding.repositoryId, binding.worktreeId, binding.bytes),
      );
      removed += 1;
    }
  }

  return {
    bind(input): PathBinding {
      const key = keyFor(input.repositoryId, input.worktreeId, input.bytes);
      const existingId = byKey.get(key);
      if (existingId !== undefined) {
        const existing = byId.get(existingId);
        if (existing !== undefined) {
          return existing;
        }
      }
      const displayPath = options.codec.toDisplayPath(input.bytes);
      const executionBytes = encodeExecutionPath(displayPath.text);
      const binding: PathBinding = {
        pathId: options.nextPathId(),
        repositoryId: input.repositoryId,
        worktreeId: input.worktreeId,
        bytes: new Uint8Array(input.bytes),
        displayPath,
        encoding: executionBytes === null ? "unrepresentable" : "utf8",
        executionText: executionBytes === null ? null : displayPath.text,
        executionBytes,
        mintedAtMs: now(),
      };
      byId.set(binding.pathId, binding);
      byKey.set(key, binding.pathId);
      evictIfNeeded();
      return binding;
    },

    get(pathId): PathBinding | null {
      return byId.get(pathId) ?? null;
    },

    getForWorktree(input): PathBinding | null {
      const binding = byId.get(input.pathId);
      if (binding === undefined) {
        return null;
      }
      if (
        binding.repositoryId !== input.repositoryId ||
        binding.worktreeId !== input.worktreeId
      ) {
        return null;
      }
      return binding;
    },

    clearWorktree(worktreeId): void {
      for (const [pathId, binding] of byId) {
        if (binding.worktreeId === worktreeId) {
          byId.delete(pathId);
          byKey.delete(
            keyFor(binding.repositoryId, binding.worktreeId, binding.bytes),
          );
        }
      }
    },

    size(): number {
      return byId.size;
    },
  };
}
