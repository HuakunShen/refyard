/**
 * Explicit runtime repository approval and revocation.
 *
 * A browser supplies one absolute path chosen by a person. This module either places it
 * under an already approved root or approves that exact directory as a new root; it never
 * scans, infers a parent grant, follows a lexical symlink escape or turns a Git directory
 * into a repository. The registry remains the authority for repository identity and the
 * access journal records the completed grant change.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { ProblemCode } from "@refyard/git-contract";
import {
  HandleError,
  isInsideOrEqual,
  type HandleRegistry,
} from "../filesystem/handles.js";
import type { AccessJournal } from "../journal/access.js";
import type { RepositoryRecord, RepositoryRegistry } from "./repositories.js";
import type { RootRecord, RootRegistry } from "./roots.js";

export interface RepositoryApproval {
  readonly repositoryId: string;
  readonly allowedRootId: string;
  readonly path: string;
}

export type RepositoryApprovalResult =
  | { readonly ok: true; readonly approval: RepositoryApproval }
  | {
      readonly ok: false;
      readonly code: ProblemCode;
      readonly message: string;
    };

export type RepositoryRevocationResult =
  | {
      readonly ok: true;
      readonly repositoryId: string;
      readonly allowedRootId: string;
      readonly rootHasRepositories: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ProblemCode;
      readonly message: string;
    };

export interface RepositoryApprovalManager {
  register(input: {
    readonly path: string;
    readonly actor: string;
  }): Promise<RepositoryApprovalResult>;
  revoke(input: {
    readonly repositoryId: string;
    readonly actor: string;
  }): Promise<RepositoryRevocationResult>;
}

export interface RepositoryApprovalManagerOptions {
  readonly roots: RootRegistry;
  readonly repositories: RepositoryRegistry;
  readonly handles: HandleRegistry;
  readonly journal: AccessJournal;
  readonly now?: () => number;
}

export function createRepositoryApprovalManager(
  options: RepositoryApprovalManagerOptions,
): RepositoryApprovalManager {
  const now = options.now ?? Date.now;

  return {
    async register(input): Promise<RepositoryApprovalResult> {
      if (!isAbsolute(input.path)) {
        return {
          ok: false,
          code: "InvalidRequest",
          message:
            "repository path must be absolute; the host will not resolve a browser path against its own cwd",
        };
      }

      let resolvedPath: string;
      try {
        resolvedPath = await realpath(input.path);
      } catch {
        return {
          ok: false,
          code: "NotFound",
          message: `the selected repository path does not exist: ${input.path}`,
        };
      }
      if (containsGitDirectory(resolvedPath)) {
        return {
          ok: false,
          code: "Forbidden",
          message: "a path inside .git is not a repository registration target",
        };
      }

      const roots = options.roots.list();
      const lexicalRoot = containingRoot(input.path, roots);
      if (
        lexicalRoot !== null &&
        !isInsideOrEqual(lexicalRoot.path, resolvedPath)
      ) {
        return {
          ok: false,
          code: "Forbidden",
          message: "the selected path resolves outside its approved root",
        };
      }

      const existing = options.repositories
        .list()
        .find((record) => record.displayPath.text === resolvedPath);
      if (existing !== undefined) {
        return {
          ok: false,
          code: "Conflict",
          message: `that repository is already registered as ${existing.repositoryId}`,
        };
      }

      const physicalRoot = containingRoot(resolvedPath, roots);
      let root: RootRecord;
      try {
        root =
          physicalRoot === null
            ? await options.roots.approve({
                path: resolvedPath,
                executionTrusted: true,
              })
            : physicalRoot;
      } catch (error) {
        return registrationProblem(error, resolvedPath);
      }
      const relativePath = relative(root.path, resolvedPath)
        .split(sep)
        .join("/");
      const before = new Set(
        options.repositories.list().map((record) => record.repositoryId),
      );
      let record: RepositoryRecord;
      try {
        record = await options.repositories.register({
          allowedRootId: root.allowedRootId,
          relativePath,
          handles: options.handles,
        });
      } catch (error) {
        return registrationProblem(error, resolvedPath);
      }
      if (before.has(record.repositoryId)) {
        return {
          ok: false,
          code: "Conflict",
          message: `that repository is already registered as ${record.repositoryId}`,
        };
      }

      try {
        await options.journal.append({
          action: "register",
          path: resolvedPath,
          allowedRootId: root.allowedRootId,
          repositoryId: record.repositoryId,
          actor: input.actor,
          atMs: now(),
        });
      } catch (error) {
        options.repositories.unregister(record.repositoryId);
        return {
          ok: false,
          code: "Unavailable",
          message: `the repository was not approved because its access record could not be written: ${error instanceof Error ? error.message : "unknown journal error"}`,
        };
      }
      return {
        ok: true,
        approval: {
          repositoryId: record.repositoryId,
          allowedRootId: root.allowedRootId,
          path: resolvedPath,
        },
      };
    },

    async revoke(input): Promise<RepositoryRevocationResult> {
      const record = options.repositories.get(input.repositoryId);
      if (record === null) {
        return {
          ok: false,
          code: "NotFound",
          message: `no registered repository ${input.repositoryId}`,
        };
      }
      const remaining = options.repositories
        .list()
        .some(
          (candidate) =>
            candidate.repositoryId !== record.repositoryId &&
            candidate.allowedRootId === record.allowedRootId,
        );
      try {
        // The audit is durable before the in-memory grant disappears. If the disk is
        // unavailable, the user gets a refusal and the repository remains readable.
        await options.journal.append({
          action: "revoke",
          path: record.displayPath.text,
          allowedRootId: record.allowedRootId,
          repositoryId: record.repositoryId,
          actor: input.actor,
          atMs: now(),
        });
      } catch (error) {
        return {
          ok: false,
          code: "Unavailable",
          message: `the repository was not revoked because its access record could not be written: ${error instanceof Error ? error.message : "unknown journal error"}`,
        };
      }
      options.repositories.unregister(record.repositoryId);
      return {
        ok: true,
        repositoryId: record.repositoryId,
        allowedRootId: record.allowedRootId,
        rootHasRepositories: remaining,
      };
    },
  };
}

function containingRoot(
  path: string,
  roots: readonly RootRecord[],
): RootRecord | null {
  return (
    roots
      .filter((root) => isInsideOrEqual(root.path, path))
      .sort((left, right) => right.path.length - left.path.length)[0] ?? null
  );
}

function containsGitDirectory(path: string): boolean {
  return path
    .split(/[\\/]/u)
    .some((segment) => segment.toLowerCase() === ".git");
}

function registrationProblem(
  error: unknown,
  path: string,
): {
  readonly ok: false;
  readonly code: ProblemCode;
  readonly message: string;
} {
  if (error instanceof HandleError) {
    return {
      ok: false,
      code:
        error.code === "UnsupportedPathEncoding"
          ? "UnsupportedPathEncoding"
          : error.code,
      message: error.message,
    };
  }
  return {
    ok: false,
    code: "NotFound",
    message: `${path} is not a readable Git repository: ${error instanceof Error ? error.message : "Git did not recognise it"}`,
  };
}
