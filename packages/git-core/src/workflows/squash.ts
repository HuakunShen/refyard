/**
 * Squash workflow: fold the checked-out branch's top commit into its parent.
 *
 * Two steps, and the classification has to be honest about the seam between
 * them:
 *
 * 1. **`git reset --soft HEAD^`** moves the branch to the parent; the combined
 *    change of both commits sits in the index.
 * 2. **the commit step** writes the single squashed commit — `--amend
 *    --no-edit` keeps the parent's message, a client-supplied message is sent
 *    on stdin like any commit. The user's hooks run as always.
 *
 * If the commit step fails, the state is *known* and reported that way: the
 * branch points at the parent and the combined change is staged — visible in
 * the status read, finishable with a plain commit. A timeout or a signal at
 * either step is `unknown`: whether the branch moved is genuinely not known.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import {
  planAmendCommit,
  planSquashSoftReset,
} from "../plan/commit.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import {
  failureCodeOf,
  isUncertain,
  mergeInProgress,
  type CommandRefusal,
} from "./merge.js";
import { revertInProgress } from "./revert.js";
import { cherryPickInProgress } from "./cherry-pick.js";
import { rebaseInProgress } from "./rebase.js";

export type SquashOutcome =
  | {
      /** One combined commit now sits where the parent and the top were. */
      readonly kind: "squashed";
      readonly head: HeadFacts | null;
    }
  | {
      /**
       * The soft reset landed but the commit step refused. The state is known
       * and visible: the branch points at the parent and the combined change
       * is staged, so a plain commit finishes what the hook or identity
       * problem interrupted.
       */
      readonly kind: "commitFailed";
      readonly exitCode: number | null;
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

function specForCommitStep(
  context: { readonly cwdHandle: string },
  message: Uint8Array | null,
): GitCommandSpec {
  // After the soft reset HEAD *is* the parent, so both message paths amend it:
  // a plain commit here would stack a third commit instead of combining.
  return planAmendCommit(context, message);
}

export async function squashTopCommit(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly message: Uint8Array | null },
): Promise<SquashOutcome> {
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

  const head = await readHeadFacts(engine, context.cwdHandle);
  if (head.kind !== "born") {
    return {
      kind: "refused",
      reason: "this branch has no commits yet, so there is nothing to squash",
    };
  }

  // A top commit whose tree equals its parent's would squash into a pointless
  // rewrite. The probe is quiet-diff: exit 0 (no change) refuses, exit 1
  // (changes) proceeds, and 128 means HEAD^ does not resolve — a single-commit
  // branch, which the soft reset below refuses in its own words.
  const emptyProbe: GitCommandSpec = {
    argv: ["diff", "--quiet", "HEAD^", "HEAD"],
    cwdHandle: context.cwdHandle,
    deadlineClass: "readonly",
    description: "diff HEAD^ HEAD",
  };
  const empty = await engine.run(emptyProbe);
  if (empty.termination === "exit" && empty.exitCode === 0) {
    return {
      kind: "refused",
      reason:
        "the top commit adds no changes over its parent, so there is nothing to squash",
    };
  }

  const reset = await engine.run(planSquashSoftReset(context));
  if (!(reset.termination === "exit" && reset.exitCode === 0)) {
    const code = failureCodeOf(reset.termination);
    if (isUncertain(code)) {
      return { kind: "unknown", code };
    }
    // `HEAD^` does not resolve on a single-commit branch; that refusal (and any
    // other) is Git's to state.
    return {
      kind: "gitRefused",
      refusal: {
        code,
        exitCode: reset.exitCode,
        diagnostic: boundedDiagnostic(reset.stderr),
      },
    };
  }

  const commitStep = await engine.run(
    specForCommitStep(context, input.message),
  );
  if (commitStep.termination === "exit" && commitStep.exitCode === 0) {
    return {
      kind: "squashed",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  const commitCode = failureCodeOf(commitStep.termination);
  if (isUncertain(commitCode)) {
    return { kind: "unknown", code: commitCode };
  }
  return {
    kind: "commitFailed",
    exitCode: commitStep.exitCode,
    diagnostic: boundedDiagnostic(commitStep.stderr),
  };
}
