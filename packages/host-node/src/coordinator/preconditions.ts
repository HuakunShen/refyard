/**
 * Preconditions: what must be true before an operation may run.
 *
 * These are the checks that turn "the user asked" into "the user asked about the
 * state that still exists". Each one exists because of a specific way a Git
 * operation silently affects the wrong thing:
 *
 * - **Snapshot freshness.** The request names a `snapshotId`; if the repository's
 *   Head or index moved since, the plan the user confirmed is not the plan that
 *   would run.
 * - **Preview fingerprints.** For stage and discard, the content fingerprint must
 *   match what was previewed. A `git status` marker is not evidence: the file can be
 *   edited and still show `M`.
 * - **No operation in progress.** A merge, rebase or cherry-pick in flight means Git
 *   will refuse or, worse, do something surprising; the user must resolve it first.
 * - **Write block after a restart.** A repository with an unresolved operation is
 *   blocked until a human confirms its state.
 *
 * Every check returns a `Problem` or null, and the caller stops at the first
 * failure: preconditions are all-or-nothing, so a batch is never half-authorised.
 */
import type { Problem } from "@refyard/git-contract";

export type PreconditionOutcome =
  { readonly ok: true } | { readonly ok: false; readonly problem: Problem };

export interface PreconditionContext {
  /** Head object name the snapshot was taken with, or null when unborn. */
  readonly snapshotHeadOid: string | null;
  /** Current Head object name. */
  readonly currentHeadOid: string | null;
  /** True when the snapshot's index fingerprint still matches. */
  readonly indexUnchanged: boolean;
  /** Operation Git reports as in progress, if any. */
  readonly operationInProgress: string | null;
  /**
   * In-progress operations this request is allowed to run alongside.
   *
   * Only the merge family passes anything here, and only `merge`: continuing or
   * aborting a merge *is* the way to finish it, so refusing those because a merge is
   * in progress would leave the repository with no way out. A rebase, cherry-pick,
   * bisect or mailbox apply is not on any list — this build did not start it and
   * must not be the thing that ends it.
   */
  readonly mayRunDuring?: readonly string[];
  /** A restart left an unresolved operation for this repository. */
  readonly restartBlock: {
    readonly reason: string;
    readonly operationIds: readonly string[];
  } | null;
  /** Preview fingerprints that must still match, by path id. */
  readonly previewChecks?: readonly {
    readonly pathId: string;
    readonly expectedFingerprint: string;
    readonly currentFingerprint: string | null;
  }[];
  /**
   * A refusal established while gathering the facts themselves — an unknown
   * repository or worktree, for instance. Checked before anything else, so the
   * submit path can answer with the real code instead of an internal error.
   */
  readonly refusal?: {
    readonly code: Problem["code"];
    readonly message: string;
  };
}

export function checkPreconditions(
  context: PreconditionContext,
): PreconditionOutcome {
  if (context.refusal !== undefined) {
    return {
      ok: false,
      problem: {
        code: context.refusal.code,
        message: context.refusal.message,
        retryable: false,
      },
    };
  }

  if (context.restartBlock !== null) {
    return {
      ok: false,
      problem: {
        code: "UncertainOutcome",
        message: `${context.restartBlock.reason}; confirm the repository state before submitting new work`,
        details: {
          reason: context.restartBlock.reason,
          operations: context.restartBlock.operationIds.join(","),
        },
        retryable: false,
      },
    };
  }

  if (
    context.operationInProgress !== null &&
    !(context.mayRunDuring ?? []).includes(context.operationInProgress)
  ) {
    return {
      ok: false,
      problem: {
        code: "Conflict",
        message: `a ${context.operationInProgress} is in progress in this worktree; finish or abort it before other operations`,
        details: { operation: context.operationInProgress },
        retryable: false,
      },
    };
  }

  if (context.snapshotHeadOid !== context.currentHeadOid) {
    return {
      ok: false,
      problem: {
        code: "StaleSnapshot",
        message:
          "the repository moved since this request was prepared; reload and confirm again",
        details: {
          expectedHead: context.snapshotHeadOid ?? "(unborn)",
          currentHead: context.currentHeadOid ?? "(unborn)",
        },
        retryable: false,
      },
    };
  }

  if (!context.indexUnchanged) {
    return {
      ok: false,
      problem: {
        code: "StaleSnapshot",
        message:
          "the index changed since this request was prepared; reload and confirm again",
        retryable: false,
      },
    };
  }

  for (const check of context.previewChecks ?? []) {
    if (check.currentFingerprint === null) {
      return {
        ok: false,
        problem: {
          code: "StalePreview",
          message:
            "a selected path could no longer be read; re-preview it before changing it",
          details: { pathId: check.pathId },
          retryable: false,
        },
      };
    }
    if (check.currentFingerprint !== check.expectedFingerprint) {
      return {
        ok: false,
        problem: {
          code: "StalePreview",
          message:
            "the content of a selected path changed since it was previewed; re-preview it before changing it",
          details: { pathId: check.pathId },
          retryable: false,
        },
      };
    }
  }

  return { ok: true };
}

/**
 * The index fingerprint, from facts Git already reports.
 *
 * It is built from the index entries of the paths a request names plus the Head, so
 * an unrelated file changing elsewhere does not invalidate a confirmation the user
 * just gave — while a change to the confirmed paths always does.
 *
 * This is the single derivation for "the index as the request was planned
 * against": the read layer snapshots it and the submit-time freshness check
 * recomputes it. Two derivations that differed in encoding would make every
 * submission look stale (or, worse, hide a real change), so both call this.
 */
export function statusIndexKey(facts: {
  readonly head: { readonly oid: string | null };
  readonly records: readonly {
    readonly path: Uint8Array;
    readonly originalPath: Uint8Array | null;
    readonly modes: {
      readonly index: string | null;
      readonly worktree: string | null;
    };
    readonly oids: { readonly index: string | null };
    readonly stages: readonly unknown[];
  }[];
}): string {
  return indexFingerprint({
    headOid: facts.head.oid,
    entries: facts.records.map((entry) => ({
      pathKey: `${pathKeyOf(entry.path)}:${entry.originalPath === null ? "" : pathKeyOf(entry.originalPath)}`,
      mode: entry.modes.index ?? entry.modes.worktree ?? "-",
      oid: entry.oids.index ?? "-",
      stage: entry.stages.length,
    })),
  });
}

function pathKeyOf(bytes: Uint8Array): string {
  let key = "";
  for (const byte of bytes) {
    key += byte.toString(16).padStart(2, "0");
  }
  return key;
}

export function indexFingerprint(input: {
  readonly headOid: string | null;
  readonly entries: readonly {
    readonly pathKey: string;
    readonly mode: string;
    readonly oid: string;
    readonly stage: number;
  }[];
}): string {
  const rows = input.entries
    .map(
      (entry) =>
        `${entry.pathKey}\u0000${entry.mode}\u0000${entry.oid}\u0000${entry.stage}`,
    )
    .sort();
  return `${input.headOid ?? "(unborn)"}\n${rows.join("\n")}`;
}

/**
 * In-progress operations each mutation may run alongside.
 *
 * While `merge` is unfinished, four kinds stay available, because they are the
 * documented way through a conflict:
 *
 * - `stagePaths` **is** the resolution step. Git's own workflow is "resolve the
 *   files, `git add` them, commit", so blocking staging would leave the repository
 *   with no way to record the resolution the UI asks the user to perform.
 * - `unstagePaths` is that step in reverse — taking a wrong stage back out before
 *   continuing — and it cannot discard working-tree content.
 * - `continueMerge` and `abortMerge` are the two ways to end the merge.
 *
 * Everything else stays blocked, `commit` and `discardTrackedPaths` included: a plain
 * commit would write the wrong history in place of the merge commit, and a discard
 * fights the conflict state. A rebase, cherry-pick, bisect, revert or mailbox apply is
 * not on any list either — this build did not start it and must not be the thing that
 * ends it.
 */
export function mayRunDuringOperation(kind: string): readonly string[] {
  switch (kind) {
    case "stagePaths":
    case "unstagePaths":
    case "continueMerge":
    case "abortMerge":
      return ["merge"];
    default:
      return [];
  }
}
