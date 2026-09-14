/**
 * Discard workflow: which paths may be restored, and the restore itself.
 *
 * Discard restores tracked working-tree files to the *index*. The safety-critical
 * half of the operation is the selection check: a path that is not a changed,
 * ordinary, merged, non-submodule entry is refused here, before any backup or
 * restore runs, because `git restore` on such a path either does nothing or means
 * something the user did not ask for.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  GitWorkflowError,
  runRequired,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { planRestoreWorktree } from "../plan/paths.js";
import { pathKey } from "./diff.js";
import type { StatusRecord } from "../parse/status.js";

/** Why one selected path may not be discarded. The whole batch stops on a refusal. */
export type DiscardRefusalReason =
  | "untracked"
  | "ignored"
  | "unmerged"
  | "submodule"
  | "special-type"
  | "unchanged";

export interface DiscardRefusal {
  readonly pathKey: string;
  readonly reason: DiscardRefusalReason;
  readonly detail: string;
}

export type DiscardSelection =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: DiscardRefusal };

/**
 * Check every selected path against fresh status records before anything runs.
 *
 * One unsupported path refuses the whole batch: a partially applied discard is
 * the one outcome this operation must never produce. The modes come from Git's
 * own report, so a path that has become a symlink or a gitlink is refused by
 * mode, not by a filesystem guess.
 */
export function selectDiscardablePaths(
  records: readonly StatusRecord[],
  selected: readonly Uint8Array[],
): DiscardSelection {
  const byKey = new Map<string, StatusRecord>();
  for (const record of records) {
    byKey.set(pathKey(record.path), record);
    if (record.originalPath !== null) {
      byKey.set(pathKey(record.originalPath), record);
    }
  }
  for (const bytes of selected) {
    const key = pathKey(bytes);
    const record = byKey.get(key);
    if (record === undefined) {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "unchanged",
          detail:
            "the path is not reported as changed, so there is nothing to discard",
        },
      };
    }
    if (record.kind === "untracked") {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "untracked",
          detail:
            "untracked files are never discarded or cleaned by this service",
        },
      };
    }
    if (record.kind === "ignored") {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "ignored",
          detail: "ignored files are never removed by this service",
        },
      };
    }
    if (record.kind === "unmerged") {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "unmerged",
          detail:
            "a path with unresolved merge stages cannot be restored from the index",
        },
      };
    }
    if (
      record.submoduleCommitChanged ||
      record.submoduleModified ||
      record.submoduleUntracked
    ) {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "submodule",
          detail: "submodule working trees are not discarded from the parent",
        },
      };
    }
    const worktreeMode = record.modes.worktree;
    if (worktreeMode === "120000") {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "special-type",
          detail:
            "the worktree entry is a symbolic link; restoring through it could write outside the worktree",
        },
      };
    }
    if (worktreeMode === "160000") {
      return {
        ok: false,
        refusal: {
          pathKey: key,
          reason: "special-type",
          detail: "the worktree entry is a submodule gitlink",
        },
      };
    }
  }
  return { ok: true };
}

export type RestoreOutcome =
  | { readonly kind: "restored" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

/** Restore exactly these paths from the index. Backups are the caller's duty. */
export async function restoreSelectedPaths(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  paths: readonly Uint8Array[],
): Promise<RestoreOutcome> {
  const spec: GitCommandSpec = planRestoreWorktree(context, paths);
  try {
    await runRequired(engine, spec);
    return { kind: "restored" };
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      return {
        kind: "refused",
        code: error.code,
        exitCode: error.exitCode,
        diagnostic: error.diagnostic,
      };
    }
    throw error;
  }
}
