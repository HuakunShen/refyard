/**
 * Reset workflows: move the checked-out branch to another commit.
 *
 * A reset cannot stop halfway the way a merge or a revert can — Git either moves
 * the branch or refuses — so the classification is about *refusals*, not stops:
 *
 * - **A merge or revert in progress is refused before Git runs.** Resetting away
 *   from the middle of either would discard the state that says how to finish it,
 *   and "finish your merge first" is an answer a human can act on.
 * - **A timeout or a signal is `unknown`.** Whether the branch moved is genuinely
 *   not known, and nothing here retries a mutation.
 * - **Anything else Git refuses is reported as Git said it.** A bad object name is
 *   the common case; the diagnostic is the answer.
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import { planResetBranch } from "../plan/reset.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";
import { revertInProgress } from "./revert.js";

export type ResetOutcome =
  | {
      /** The branch moved; the head facts describe the new position. */
      readonly kind: "reset";
      readonly head: HeadFacts | null;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function resetBranch(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly oid: string;
    readonly mode: "soft" | "mixed";
  },
): Promise<ResetOutcome> {
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

  const result = await engine.run(planResetBranch(context, input));
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "reset",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }

  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  return {
    kind: "gitRefused",
    refusal: { code, exitCode: result.exitCode, diagnostic: boundedDiagnostic(result.stderr) },
  };
}
