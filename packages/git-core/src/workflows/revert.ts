/**
 * Revert workflows: undo one completed commit with a new commit.
 *
 * The classification mirrors the merge workflow, because a revert is the one other
 * write that can legitimately end *in the middle* — and this build's answer to that
 * is the opposite of a merge's, on purpose:
 *
 * - **A conflict stop is aborted before it is reported.** A merge stops into a state
 *   a human finishes ("resolve, stage, continue"); a revert's conflict state offers
 *   nothing to finish that a plain new commit would not, so leaving `REVERT_HEAD`
 *   and a staged inverse patch behind would only hand the user a trap. The abort
 *   restores the exact pre-revert state, and the diagnostic says what conflicted.
 * - **Reverting a merge is refused, not attempted.** Git asks for `-m`, and picking
 *   which parent's history to keep is a decision this build does not make.
 * - **A timeout or a signal is `unknown`.** Whether the revert applied is genuinely
 *   not known, and nothing here retries it.
 * - **`REVERT_HEAD` decides whether a stop happened**, re-read after the command
 *   rather than predicted from the exit code.
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import {
  planRevertAbort,
  planRevertCommit,
  planRevertInProgress,
} from "../plan/revert.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";

export type RevertOutcome =
  | { readonly kind: "reverted"; readonly head: HeadFacts | null }
  | {
      /** The commit is a merge; Git asked for `-m` and this build does not pick. */
      readonly kind: "mergeRefused";
      readonly diagnostic: string;
    }
  | {
      /**
       * The inverse patch conflicted. The stop was aborted, so the repository is
       * exactly as it was before the request; the diagnostic names the paths.
       */
      readonly kind: "conflictAborted";
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

/** True when the worktree currently has a revert it would have to finish first. */
export async function revertInProgress(
  engine: GitEngine,
  cwdHandle: string,
): Promise<boolean> {
  const result = await engine.run(planRevertInProgress({ cwdHandle }));
  return result.termination === "exit" && result.exitCode === 0;
}

export async function revertCommit(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly oid: string },
): Promise<RevertOutcome> {
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

  const result = await engine.run(planRevertCommit(context, input));
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "reverted",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }

  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  const diagnostic = boundedDiagnostic(result.stderr);
  if (diagnostic.includes("is a merge but no -m option")) {
    return { kind: "mergeRefused", diagnostic };
  }
  if (await revertInProgress(engine, context.cwdHandle)) {
    const abort = await engine.run(planRevertAbort(context));
    if (!(abort.termination === "exit" && abort.exitCode === 0)) {
      // The abort itself failed, so whether the working tree is mid-revert is not
      // established. Reported as unknown: nothing here force-resets to fake an answer.
      return { kind: "unknown", code };
    }
    return { kind: "conflictAborted", diagnostic };
  }
  return {
    kind: "gitRefused",
    refusal: { code, exitCode: result.exitCode, diagnostic },
  };
}
