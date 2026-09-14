/**
 * Branch workflows: run one planned command and classify what happened.
 *
 * Classification is evidence-only, exactly as in the staging workflows: a non-zero
 * exit is a refusal carrying the bounded diagnostic, an odd termination (timeout,
 * signal) may have half-applied and is reported as unknown, and everything else is
 * the caller's to interpret against a fresh read.
 */
import type { GitCommandSpec } from "../ports.js";
import {
  boundedDiagnostic,
  GitWorkflowError,
  runRequired,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import {
  planBranchCreate,
  planBranchCreateAndSwitch,
  planBranchDelete,
  planBranchRename,
  planBranchSetUpstream,
  planBranchSwitch,
} from "../plan/branches.js";

export type BranchOutcome =
  | { readonly kind: "done" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

async function runSpec(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<BranchOutcome> {
  try {
    await runRequired(engine, spec);
    return { kind: "done" };
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      return {
        kind: "refused",
        code: error.code,
        exitCode: error.exitCode,
        diagnostic:
          error.diagnostic.length > 0
            ? error.diagnostic
            : boundedDiagnostic(new Uint8Array(0)),
      };
    }
    throw error;
  }
}

export function createBranch(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly name: string;
    readonly startOid: string | null;
    readonly switchToIt: boolean;
  },
): Promise<BranchOutcome> {
  const spec = input.switchToIt
    ? planBranchCreateAndSwitch(context, input)
    : planBranchCreate(context, input);
  return runSpec(engine, spec);
}

export function switchBranch(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  name: string,
): Promise<BranchOutcome> {
  return runSpec(engine, planBranchSwitch(context, name));
}

export function renameBranch(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly name: string; readonly newName: string },
): Promise<BranchOutcome> {
  return runSpec(engine, planBranchRename(context, input));
}

export function deleteBranch(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  name: string,
): Promise<BranchOutcome> {
  return runSpec(engine, planBranchDelete(context, name));
}

export function setBranchUpstream(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly branchName: string;
    readonly upstream: {
      readonly remoteName: string;
      readonly branchName: string;
    } | null;
  },
): Promise<BranchOutcome> {
  return runSpec(engine, planBranchSetUpstream(context, input));
}
