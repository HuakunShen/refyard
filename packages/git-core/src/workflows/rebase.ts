/**
 * Rebase workflows: replay the checked-out branch onto a commit, continue a
 * stopped rebase, abort one.
 *
 * The lifecycle is the cherry-pick family's scaled up to a range of commits,
 * and the classification decisions are the same:
 *
 * - **A conflict stop is `conflicted`, not a failure.** The `rebase-merge`
 *   state and unmerged index stages mean the rebase is unfinished, not undone;
 *   the names come from the status read, the count from the record.
 * - **A stop with no unmerged path is a stop this build cannot finish** — an
 *   empty patch or a skipped-command pause. It is aborted before it is
 *   reported, because a paused state nothing here can advance is a trap.
 * - **A timeout or a signal is `unknown`.** Whether the branch moved is
 *   genuinely not known, and nothing here retries it.
 * - **Another sequencer operation in progress is refused before Git runs.**
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import { parseLsFilesStage } from "../parse/ls-files.js";
import {
  planRebase,
  planRebaseAbort,
  planRebaseContinue,
  planRebaseInProgress,
} from "../plan/rebase.js";
import { planLsFilesUnmerged } from "../plan/status.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";
import { revertInProgress } from "./revert.js";
import { cherryPickInProgress } from "./cherry-pick.js";

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

/** True when the worktree currently has a rebase it would have to finish. */
export async function rebaseInProgress(
  engine: GitEngine,
  cwdHandle: string,
): Promise<boolean> {
  const result = await engine.run(planRebaseInProgress({ cwdHandle }));
  return result.termination === "exit" && result.exitCode === 0;
}

export type RebaseOutcome =
  | { readonly kind: "rebased"; readonly head: HeadFacts | null }
  | {
      /** The rebase stopped with conflicts; the names come from the status read. */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
      readonly diagnostic: string;
    }
  | {
      /**
       * The rebase stopped for something other than a conflict — an empty patch,
       * a pause this build cannot advance. It was aborted, so the branch is
       * exactly as it was before the request.
       */
      readonly kind: "stopAborted";
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

async function anySequencerOperationInProgress(
  engine: GitEngine,
  cwdHandle: string,
): Promise<string | null> {
  if (await mergeInProgress(engine, cwdHandle)) {
    return "a merge";
  }
  if (await revertInProgress(engine, cwdHandle)) {
    return "a revert";
  }
  if (await cherryPickInProgress(engine, cwdHandle)) {
    return "a cherry-pick";
  }
  return null;
}

export async function rebase(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly upstreamOid: string },
): Promise<RebaseOutcome> {
  const open = await anySequencerOperationInProgress(
    engine,
    context.cwdHandle,
  );
  if (open !== null) {
    return {
      kind: "refused",
      reason: `${open} is already in progress in this worktree; continue or abort it first`,
    };
  }
  if (await rebaseInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a rebase is already in progress in this worktree; continue or abort it first",
    };
  }

  const result = await engine.run(planRebase(context, input));
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "rebased",
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
    // A stop with a clean index is a pause nothing here can advance (an empty
    // patch, a skipped command). Left alone it is a trap; the abort restores
    // the branch exactly as the request found it.
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

export type ContinueRebaseOutcome =
  | { readonly kind: "rebased"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      /** Some conflicted paths are still unmerged; the rebase did not advance. */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
    }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function continueRebase(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<ContinueRebaseOutcome> {
  if (!(await rebaseInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no rebase is in progress in this worktree, so there is nothing to continue",
    };
  }

  const result = await engine.run(planRebaseContinue(context));
  const code = failureCodeOf(result.termination);
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "rebased",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }

  // A failed continue leaves the rebase where it was; whether that is still in
  // progress is re-read, because a hook could have finished it another way.
  if (!(await rebaseInProgress(engine, context.cwdHandle))) {
    return {
      kind: "rebased",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  const conflictedPaths = await countConflictedPaths(engine, context.cwdHandle);
  if (conflictedPaths > 0) {
    return { kind: "conflicted", conflictedPaths };
  }
  return {
    kind: "gitRefused",
    refusal: {
      code,
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    },
  };
}

export type AbortRebaseOutcome =
  | { readonly kind: "aborted"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function abortRebase(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<AbortRebaseOutcome> {
  if (!(await rebaseInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no rebase is in progress in this worktree, so there is nothing to abort",
    };
  }

  const result = await engine.run(planRebaseAbort(context));
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "aborted",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  return {
    kind: "gitRefused",
    refusal: {
      code,
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    },
  };
}
