/**
 * Stage and unstage workflows.
 *
 * The planners in `plan/paths.ts` already know the safe argv; this module adds the
 * run-and-classify half: execute the plan and report what happened without ever
 * interpreting English diagnostics as meaning. A failure carries the bounded
 * diagnostic for a human; the exit code and termination kind are the evidence.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  GitWorkflowError,
  runRequired,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { planStage, planUnstage, planUnstageUnborn } from "../plan/paths.js";

/** One finished staging attempt. `refused` means Git said no and nothing moved. */
export type StageOutcome =
  | { readonly kind: "staged" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

async function runStageSpec(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<StageOutcome> {
  try {
    await runRequired(engine, spec);
    return { kind: "staged" };
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

/** `git add` exactly these paths. Empty selections never reach Git. */
export function stageSelectedPaths(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  paths: readonly Uint8Array[],
): Promise<StageOutcome> {
  return runStageSpec(engine, planStage(context, paths));
}

/**
 * Unstage: index only. Which planner runs depends on whether HEAD exists, which
 * the caller reads fresh — an unborn branch has nothing to restore the index from.
 */
export function unstageSelectedPaths(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly paths: readonly Uint8Array[]; readonly headBorn: boolean },
): Promise<StageOutcome> {
  const spec = input.headBorn
    ? planUnstage(context, input.paths)
    : planUnstageUnborn(context, input.paths);
  return runStageSpec(engine, spec);
}
