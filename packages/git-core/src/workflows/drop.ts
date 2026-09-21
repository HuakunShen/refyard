/**
 * Drop workflows: remove one commit from the checked-out branch.
 *
 * A drop is a rebase under the hood (`rebase --onto <parent> <oid>`), so the
 * classification is the rebase workflow's with three refusals in front — each
 * one prevents a rewrite Git would perform but the user did not ask for:
 *
 * - **another sequencer operation in progress is refused.** Finishing the open
 *   operation first is an answer a human can act on.
 * - **the commit must be on the checked-out branch** (`merge-base --is-ancestor`).
 *   Dropping somebody else's commit would rewrite this branch onto a base it
 *   never had.
 * - **a merge commit and the branch's root are refused.** A linear replay cannot
 *   represent a merge, and a root has no parent to replay onto.
 *
 * A conflict during the replay is `conflicted` — the existing rebase continue
 * and abort finish it. A descendant that becomes empty is dropped by Git
 * silently (measured: "patch contents already upstream"), so a stop with no
 * unmerged path is still the unknown-shape trap it is for rebase, and it is
 * aborted before it is reported. A timeout or a signal is `unknown`.
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import { parseLsFilesStage } from "../parse/ls-files.js";
import {
  planDropCommitAncestry,
  planDropCommitParent,
  planDropCommitRebase,
  planDropCommitSecondParent,
} from "../plan/drop.js";
import { planLsFilesUnmerged } from "../plan/status.js";
import { planRebaseAbort } from "../plan/rebase.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";
import { revertInProgress } from "./revert.js";
import { cherryPickInProgress } from "./cherry-pick.js";
import { rebaseInProgress } from "./rebase.js";

/** Distinct paths with unmerged index stages. */
async function countConflictedPaths(
  engine: GitEngine,
  cwdHandle: string,
): Promise<number> {
  const result = await engine.run(planLsFilesUnmerged({ cwdHandle }));
  if (result.termination !== "exit" || result.exitCode !== 0) {
    return 0;
  }
  const paths = new Set<string>();
  for (const entry of parseLsFilesStage(result.stdout)) {
    // The path is raw bytes; decoding first would let two different byte sequences
    // that render alike collapse into one count, so the bytes are the key.
    let key = "";
    for (const byte of entry.path) {
      key += byte.toString(16).padStart(2, "0");
    }
    paths.add(key);
  }
  return paths.size;
}

/** ASCII extraction with whitespace bytes dropped, for a single-line oid. */
function asciiTrimmed(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    if (byte === 0x0a || byte === 0x0d || byte === 0x20 || byte === 0x09) {
      continue;
    }
    out += String.fromCharCode(byte);
  }
  return out;
}

export type DropCommitOutcome =
  | {
      /** The commit is gone; the descendants were replayed onto its parent. */
      readonly kind: "dropped";
      readonly head: HeadFacts | null;
    }
  | {
      /** The replay stopped with conflicts; the rebase continue/abort finish it. */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
      readonly diagnostic: string;
    }
  | {
      /** A stop nothing here can advance; it was aborted, branch as it was. */
      readonly kind: "stopAborted";
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function dropCommit(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly oid: string },
): Promise<DropCommitOutcome> {
  if (await mergeInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a merge is already in progress in this worktree; continue or abort it first",
    };
  }
  if (await revertInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a revert is already in progress in this worktree; finish or abort it with git first",
    };
  }
  if (await cherryPickInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a cherry-pick is already in progress in this worktree; continue or abort it first",
    };
  }
  if (await rebaseInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a rebase is already in progress in this worktree; continue or abort it first",
    };
  }

  // The commit must be this branch's history: dropping a foreign commit would
  // rewrite the branch onto a base it never had.
  const ancestry = await engine.run(planDropCommitAncestry(context, input));
  if (!(ancestry.termination === "exit" && ancestry.exitCode === 0)) {
    return {
      kind: "refused",
      reason:
        "that commit is not on the checked-out branch, so it cannot be dropped from it",
    };
  }

  // A merge cannot be replayed linearly; a second parent is the merge marker.
  const secondParent = await engine.run(
    planDropCommitSecondParent(context, input),
  );
  if (secondParent.termination === "exit" && secondParent.exitCode === 0) {
    return {
      kind: "refused",
      reason:
        "that commit is a merge; dropping it is not a decision this build makes",
    };
  }

  // The parent is what the descendants replay onto; the branch root has none.
  const parent = await engine.run(planDropCommitParent(context, input));
  if (!(parent.termination === "exit" && parent.exitCode === 0)) {
    return {
      kind: "refused",
      reason:
        "that commit has no parent — it is the branch's first commit, and dropping it would remove the branch's base",
    };
  }
  // git-core never decodes with TextDecoder; the parent oid is ASCII hex plus
  // one newline, so byte-level extraction is exact.
  const parentOid = asciiTrimmed(parent.stdout);

  const result = await engine.run(
    planDropCommitRebase(context, { oid: input.oid, parentOid }),
  );
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "dropped",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }

  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  const diagnostic = boundedDiagnostic(result.stderr);
  if (await rebaseInProgress(engine, context.cwdHandle)) {
    const conflictedPaths = await countConflictedPaths(engine, context.cwdHandle);
    if (conflictedPaths > 0) {
      return { kind: "conflicted", conflictedPaths, diagnostic };
    }
    const abort = await engine.run(planRebaseAbort(context));
    if (!(abort.termination === "exit" && abort.exitCode === 0)) {
      return { kind: "unknown", code };
    }
    return { kind: "stopAborted", diagnostic };
  }
  return {
    kind: "gitRefused",
    refusal: { code, exitCode: result.exitCode, diagnostic },
  };
}
