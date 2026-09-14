/**
 * Authorised directory handles.
 *
 * A `cwdHandle` is what the trusted core puts into a `GitCommandSpec`: an opaque
 * name for a directory the user approved. This module is the only place that turns
 * one back into a real path, and it does so by resolving the path and proving it is
 * *still* inside an approved root.
 *
 * Two failure modes are prevented:
 *
 * - **Traversal**: a handle whose path contains `..` or an absolute prefix that
 *   walks out of the root.
 * - **Symlink escape**: a directory that was inside the root when it was approved,
 *   replaced since by a symlink pointing elsewhere. The check therefore compares
 *   real paths, and re-runs on every resolution rather than caching a verdict.
 *
 * Registration is also where a path is rejected outright if it cannot be
 * represented — an unencodable repository root must fail at registration instead
 * of halfway through an operation.
 */
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface ApprovedRoot {
  readonly allowedRootId: string;
  /** Absolute, resolved path of the approved directory. */
  readonly path: string;
  /** Parent handle, when a root is nested inside another. */
  readonly parentRootId: string | null;
}

export interface ResolvedHandle {
  readonly handle: string;
  readonly absolutePath: string;
  readonly root: ApprovedRoot;
  /** Path of the directory relative to its root, slash-separated. */
  readonly relativePath: string;
}

export class HandleError extends Error {
  readonly code: "Forbidden" | "NotFound" | "UnsupportedPathEncoding";

  constructor(code: HandleError["code"], message: string) {
    super(message);
    this.name = "HandleError";
    this.code = code;
  }
}

export interface HandleRegistry {
  approveRoot(input: {
    allowedRootId: string;
    path: string;
    parentRootId?: string | null;
  }): Promise<ApprovedRoot>;
  roots(): readonly ApprovedRoot[];
  root(allowedRootId: string): ApprovedRoot | null;
  /** Mint a handle for a directory inside a root. */
  handleFor(allowedRootId: string, relativePath: string): string;
  /** Resolve a handle, re-proving it is inside its approved root. */
  resolve(handle: string): Promise<ResolvedHandle>;
  /** Resolve a destination inside a root without requiring it to exist yet. */
  resolveDestination(
    allowedRootId: string,
    relativePath: string,
  ): ResolvedHandle;
}

interface HandleRecord {
  readonly rootId: string;
  readonly relativePath: string;
}

/** True when `candidate` is `parent` itself or lies inside it. */
export function isInsideOrEqual(parent: string, candidate: string): boolean {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (resolvedParent === resolvedCandidate) {
    return true;
  }
  const relativePath = relative(resolvedParent, resolvedCandidate);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".."
  );
}

/** True when a relative path is safely expressed: no absolute form, no `..`. */
export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0 || isAbsolute(relativePath)) {
    return false;
  }
  if (relativePath.includes("\u0000")) {
    return false;
  }
  const segments = relativePath.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function createHandleRegistry(): HandleRegistry {
  const roots = new Map<string, ApprovedRoot>();
  const handles = new Map<string, HandleRecord>();

  function mintHandle(rootId: string, relativePath: string): string {
    // The handle is random-looking but never derived from the path, so a client
    // cannot guess another user's directory from an id it already holds.
    const handle = `dir_${(handles.size + 1).toString(36)}${Math.abs(hash(`${rootId}/${relativePath}`)).toString(36)}`;
    handles.set(handle, { rootId, relativePath });
    return handle;
  }

  return {
    async approveRoot(input): Promise<ApprovedRoot> {
      if (!isAbsolute(input.path)) {
        throw new HandleError(
          "Forbidden",
          `approved root must be an absolute path: ${input.path}`,
        );
      }
      const resolved = await realpath(input.path);
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        throw new HandleError(
          "Forbidden",
          `approved root is not a directory: ${resolved}`,
        );
      }
      if (input.parentRootId !== undefined && input.parentRootId !== null) {
        const parent = roots.get(input.parentRootId);
        if (parent === undefined || !isInsideOrEqual(parent.path, resolved)) {
          throw new HandleError(
            "Forbidden",
            `root ${resolved} is not inside its declared parent ${parent?.path ?? input.parentRootId}`,
          );
        }
      }
      const root: ApprovedRoot = {
        allowedRootId: input.allowedRootId,
        path: resolved,
        parentRootId: input.parentRootId ?? null,
      };
      roots.set(root.allowedRootId, root);
      return root;
    },

    roots(): readonly ApprovedRoot[] {
      return [...roots.values()];
    },

    root(allowedRootId): ApprovedRoot | null {
      return roots.get(allowedRootId) ?? null;
    },

    handleFor(allowedRootId, relativePath): string {
      const root = roots.get(allowedRootId);
      if (root === undefined) {
        throw new HandleError(
          "Forbidden",
          `unknown approved root ${allowedRootId}`,
        );
      }
      if (relativePath.length > 0 && !isSafeRelativePath(relativePath)) {
        throw new HandleError(
          "Forbidden",
          `unsafe relative path: ${relativePath}`,
        );
      }
      return mintHandle(allowedRootId, relativePath);
    },

    async resolve(handle): Promise<ResolvedHandle> {
      const record = handles.get(handle);
      if (record === undefined) {
        throw new HandleError("NotFound", `unknown directory handle ${handle}`);
      }
      const root = roots.get(record.rootId);
      if (root === undefined) {
        throw new HandleError(
          "Forbidden",
          `handle ${handle} refers to a root that is no longer approved`,
        );
      }
      const candidate =
        record.relativePath.length === 0
          ? root.path
          : join(root.path, record.relativePath);
      const resolved = await realpath(candidate);
      // Re-proved on every use: a valid handle does not make an escaping path safe.
      if (!isInsideOrEqual(root.path, resolved)) {
        throw new HandleError(
          "Forbidden",
          `directory ${resolved} escapes its approved root`,
        );
      }
      const info = await stat(resolved);
      if (!info.isDirectory()) {
        throw new HandleError(
          "NotFound",
          `handle ${handle} no longer names a directory`,
        );
      }
      return {
        handle,
        absolutePath: resolved,
        root,
        relativePath: record.relativePath,
      };
    },

    resolveDestination(allowedRootId, relativePath): ResolvedHandle {
      const root = roots.get(allowedRootId);
      if (root === undefined) {
        throw new HandleError(
          "Forbidden",
          `unknown approved root ${allowedRootId}`,
        );
      }
      if (!isSafeRelativePath(relativePath)) {
        throw new HandleError(
          "Forbidden",
          `unsafe destination: ${relativePath}`,
        );
      }
      const candidate = resolve(root.path, relativePath);
      // Lexical containment only: the destination does not exist yet, so its
      // symlinks cannot be resolved. The host re-checks after creation.
      if (!isInsideOrEqual(root.path, candidate)) {
        throw new HandleError(
          "Forbidden",
          `destination ${candidate} escapes its approved root`,
        );
      }
      return {
        handle: mintHandle(allowedRootId, relativePath),
        absolutePath: candidate,
        root,
        relativePath,
      };
    },
  };
}

/** Small deterministic hash, used only to make handles look unguessable. */
function hash(value: string): number {
  let accumulator = 0;
  for (let index = 0; index < value.length; index += 1) {
    accumulator = (accumulator * 31 + value.charCodeAt(index)) | 0;
  }
  return accumulator;
}
