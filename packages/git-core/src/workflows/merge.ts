/**
 * Merge workflows: start a merge, continue a stopped one, abort one.
 *
 * A merge is the one write in this build that can legitimately end *in the middle*,
 * so the classification is the whole job:
 *
 * - **A stop with conflicts is `needsAttention`, not `failed`.** Git leaves
 *   `MERGE_HEAD` and a three-way index behind; the merge is unfinished, not undone,
 *   and reporting "failed" would tell a UI that nothing happened.
 * - **A non-zero exit without `MERGE_HEAD` is a refusal.** Git lost nothing and
 *   changed nothing, so the diagnostic is the answer.
 * - **A timeout or a signal is `unknown`.** Whether the merge applied is genuinely
 *   not known, and nothing here retries it.
 * - **`MERGE_HEAD` decides between those two, and it is re-read after the command**
 *   rather than predicted from the exit code: a merge that stops for a reason this
 *   build does not model still leaves a state the next request must not walk into.
 *
 * Nothing here fetches, resets, force-applies or resolves a conflict. A path that
 * cannot be merged is a path a human has to look at, and the workflow's answer is to
 * say so with the index stages Git recorded.
 */
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { readHeadFacts, type HeadFacts } from "./status.js";
import { parseLsFilesStage } from "../parse/ls-files.js";
import {
  planMerge,
  planMergeAbort,
  planMergeContinue,
  planMergeInProgress,
  planResolveCommit,
} from "../plan/merge.js";
import { planLsFilesUnmerged } from "../plan/status.js";

export interface CommandRefusal {
  readonly code: GitFailureCode;
  readonly exitCode: number | null;
  readonly diagnostic: string;
}

export type MergeOutcome =
  | {
      readonly kind: "merged";
      readonly alreadyUpToDate: boolean;
      readonly head: HeadFacts | null;
    }
  | {
      /**
       * The merge started and stopped with conflicts: `MERGE_HEAD` exists and the
       * index holds unmerged stages. `conflictedPaths` counts distinct paths, which
       * is what the record reports; the names come from the status read.
       */
      readonly kind: "conflicted";
      readonly conflictedPaths: number;
      readonly diagnostic: string;
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

function failureCodeOf(termination: string): GitFailureCode {
  switch (termination) {
    case "timeout":
      return "GitTimedOut";
    case "signal":
      return "GitTerminatedBySignal";
    case "spawn-error":
      return "GitNotStarted";
    case "output-limit":
      return "GitOutputLimitExceeded";
    default:
      return "GitCommandFailed";
  }
}

function isUncertain(code: GitFailureCode): boolean {
  return (
    code === "GitTimedOut" ||
    code === "GitTerminatedBySignal" ||
    code === "GitOutputLimitExceeded" ||
    code === "GitOutputIncomplete"
  );
}

/** True when the worktree currently has a merge it would have to finish first. */
export async function mergeInProgress(
  engine: GitEngine,
  cwdHandle: string,
): Promise<boolean> {
  const result = await engine.run(planMergeInProgress({ cwdHandle }));
  return result.termination === "exit" && result.exitCode === 0;
}

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
    paths.add(bytesKey(entry.path));
  }
  return paths.size;
}

/** A hex key for raw path bytes, without decoding them. */
function bytesKey(bytes: Uint8Array): string {
  let key = "";
  for (const byte of bytes) {
    key += byte.toString(16).padStart(2, "0");
  }
  return key;
}

export async function mergeSource(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly sourceOid: string;
    readonly mode: "default" | "no-ff";
    readonly message: string | null;
  },
): Promise<MergeOutcome> {
  const before = await readHeadFacts(engine, context.cwdHandle);
  if (before.kind === "unborn") {
    return {
      kind: "refused",
      reason:
        "this repository has no commit yet, so there is nothing to merge into",
    };
  }
  if (await mergeInProgress(engine, context.cwdHandle)) {
    return {
      kind: "refused",
      reason:
        "a merge is already in progress in this worktree; continue or abort it first",
    };
  }

  // The source must be a commit *now*: an object name that is missing, or one that
  // names a blob or a tree, is refused before Git is asked to merge it.
  const resolved = await engine.run(
    planResolveCommit(context, input.sourceOid),
  );
  if (resolved.termination !== "exit" || resolved.exitCode !== 0) {
    return {
      kind: "refused",
      reason:
        "that merge source is not a commit in this repository; refresh the branch list and choose again",
    };
  }

  const result = await engine.run(planMerge(context, input));
  if (result.termination === "exit" && result.exitCode === 0) {
    const after = await readHeadFacts(engine, context.cwdHandle);
    return {
      kind: "merged",
      alreadyUpToDate: before.oid !== null && before.oid === after.oid,
      head: after,
    };
  }

  const code = failureCodeOf(result.termination);
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }
  const diagnostic = boundedDiagnostic(result.stderr);
  if (await mergeInProgress(engine, context.cwdHandle)) {
    return {
      kind: "conflicted",
      conflictedPaths: await countConflictedPaths(engine, context.cwdHandle),
      diagnostic,
    };
  }
  return {
    kind: "gitRefused",
    refusal: { code, exitCode: result.exitCode, diagnostic },
  };
}

export type ContinueOutcome =
  | { readonly kind: "committed"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function continueMerge(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly message: string | null },
): Promise<ContinueOutcome> {
  if (!(await mergeInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no merge is in progress in this worktree, so there is nothing to continue",
    };
  }

  const result = await engine.run(planMergeContinue(context, input));
  const code = failureCodeOf(result.termination);
  if (result.termination === "exit" && result.exitCode === 0) {
    return {
      kind: "committed",
      head: await readHeadFacts(engine, context.cwdHandle),
    };
  }
  if (isUncertain(code)) {
    return { kind: "unknown", code };
  }

  // A failed continue leaves the merge exactly where it was; whether that is still
  // in progress is re-read, because a hook could have finished it another way.
  const stillMerging = await mergeInProgress(engine, context.cwdHandle);
  if (!stillMerging) {
    const head = await readHeadFacts(engine, context.cwdHandle);
    return { kind: "committed", head };
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

export type AbortOutcome =
  | { readonly kind: "aborted"; readonly head: HeadFacts | null }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "gitRefused"; readonly refusal: CommandRefusal }
  | { readonly kind: "unknown"; readonly code: GitFailureCode };

export async function abortMerge(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
): Promise<AbortOutcome> {
  if (!(await mergeInProgress(engine, context.cwdHandle))) {
    return {
      kind: "refused",
      reason:
        "no merge is in progress in this worktree, so there is nothing to abort",
    };
  }

  const result = await engine.run(planMergeAbort(context));
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
  // Git could not restore the pre-merge state. That is reported with its diagnostic
  // and the merge state is left alone: this build never substitutes a `reset --hard`
  // for an abort Git refused to perform.
  return {
    kind: "gitRefused",
    refusal: {
      code,
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    },
  };
}
