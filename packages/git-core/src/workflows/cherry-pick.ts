/**
 * Cherry-pick workflows: apply one commit, continue a stopped pick, abort one.
 *
 * The classification is the merge workflow's, transplanted onto the sequencer:
 * a cherry-pick is the second write that legitimately ends *in the middle*, and
 * unlike a revert its stopped state is worth finishing — resolution happens in
 * the staging panel, and `--continue` commits with the original message.
 *
 * - **A stop with conflicts is `conflicted`, not a failure.** `CHERRY_PICK_HEAD`
 *   and unmerged index stages mean the pick is unfinished, not undone.
 * - **A stop with no unmerged path is an empty pick.** Applying the patch would
 *   produce nothing (the change is already present), and Git refuses to write an
 *   empty commit; the stop is aborted before it is reported, so the branch is
 *   exactly as it was.
 * - **A timeout or a signal is `unknown`.** Whether the pick applied is genuinely
 *   not known, and nothing here retries it.
 * - **A merge or revert in progress is refused before Git runs** — finishing the
 *   open operation first is an answer a human can act on.
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import { parseLsFilesStage } from "../parse/ls-files.js";
import {
  planCherryPick,
  planCherryPickAbort,
  planCherryPickContinue,
  planCherryPickInProgress,
} from "../plan/cherry-pick.js";
import { planLsFilesUnmerged } from "../plan/status.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";
import { revertInProgress } from "./revert.js";

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

/** True when the worktree currently has a cherry-pick it would have to finish. */
export async function cherryPickInProgress(
  engine: GitEngine,
  cwdHandle: string,
): Promise<boolean> {
  const result = await engine.run(planCherryPickInProgress({ cwdHandle }));
  return result.termination === "exit" && result.exitCode === 0;
}

export type CherryPickOutcome =
  | { readonly kind: "picked"; readonly head: HeadFacts | null }
  | {
      /** The commit is a merge; Git asked for `-m` and this build does not pick. */
      readonly kind: "mergeRefused";
      readonly diagnostic: string;
    }
  | {
      /**
       * The pick stopped with conflicts: `CHERRY_PICK_HEAD` exists and the index
       * holds unmerged stages. The names come from the status read.
       */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
      readonly diagnostic: string;
    }
  | {
      /**
       * The pick would produce an empty commit — the change is already present.
       * The stop was aborted, so the branch is exactly as it was before.
       */
      readonly kind: "emptyAborted";
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function cherryPick(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly oid: string },
): Promise<CherryPickOutcome> {
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

  const result = await engine.run(planCherryPick(context, input));
  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "picked", head: await readHeadFacts(engine, context.cwdHandle) };
  }

  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  const diagnostic = boundedDiagnostic(result.stderr);
  if (diagnostic.includes("is a merge but no -m option")) {
    return { kind: "mergeRefused", diagnostic };
  }
  if (await cherryPickInProgress(engine, context.cwdHandle)) {
    const conflictedPaths = await countConflictedPaths(engine, context.cwdHandle);
    if (conflictedPaths > 0) {
      return { kind: "conflicted", conflictedPaths, diagnostic };
    }
    // A stop with a clean index is Git's "the previous cherry-pick is now empty":
    // the change is already there. Nothing can be committed, so the stop is
    // aborted — leaving the branch exactly as it was beats leaving a trap.
    const abort = await engine.run(planCherryPickAbort(context));
    if (!(abort.termination === "exit" && abort.exitCode === 0)) {
      return { kind: "unknown", code };
    }
    return { kind: "emptyAborted", diagnostic };
  }
  return {
    kind: "gitRefused",
    refusal: { code, exitCode: result.exitCode, diagnostic },
  };
}

export type ContinueCherryPickOutcome =
  | { readonly kind: "picked"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      /** Some conflicted paths are still unmerged; nothing was committed. */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
    }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function continueCherryPick(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<ContinueCherryPickOutcome> {
  if (!(await cherryPickInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no cherry-pick is in progress in this worktree, so there is nothing to continue",
    };
  }

  const result = await engine.run(planCherryPickContinue(context));
  const code = failureCodeOf(result.termination);
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "picked",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }

  // A failed continue leaves the pick where it was; whether that is still in
  // progress is re-read, because a hook could have finished it another way.
  if (!(await cherryPickInProgress(engine, context.cwdHandle))) {
    return {
      kind: "picked",
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

export type AbortCherryPickOutcome =
  | { readonly kind: "aborted"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function abortCherryPick(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<AbortCherryPickOutcome> {
  if (!(await cherryPickInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no cherry-pick is in progress in this worktree, so there is nothing to abort",
    };
  }

  const result = await engine.run(planCherryPickAbort(context));
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
  // Git could not restore the pre-pick state. Reported with its diagnostic and
  // the state left alone: no reset fallback anywhere in this build.
  return {
    kind: "gitRefused",
    refusal: {
      code,
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    },
  };
}
