/**
 * Stash and tag workflows.
 *
 * Two lookups are the safety-critical part of the stash half:
 *
 * - **the locator is re-resolved before every write.** `stash@{0}` is a position in a
 *   reflog, and anyone's `git stash` — including the user's own terminal — shifts
 *   every position after it. Each workflow re-runs `rev-parse <locator>^{commit}`
 *   and compares the object name to the one the request carried; a mismatch refuses
 *   the operation instead of touching a different entry.
 * - **a conflicted pop is not a failed pop.** Git applies the stash, leaves the
 *   conflict in the working tree, and *does not drop* the entry. The workflow
 *   re-checks that the stash still resolves and reports `conflict` with
 *   `stashPreserved`, which the effect maps to `needsAttention`.
 *
 * Tag creation checks for an existing name first: refusing to overwrite is the
 * behaviour, and doing it as a pre-check produces a clear message instead of Git's
 * `already exists` after the object was prepared.
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
  planStashApply,
  planStashDrop,
  planStashPop,
  planStashPush,
  planStashResolve,
} from "../plan/commit.js";
import {
  planTagCreateAnnotated,
  planTagCreateLightweight,
  planTagDelete,
  planTagExists,
} from "../plan/tags.js";

export type SimpleOutcome =
  | { readonly kind: "done" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

function refusalOf(
  error: unknown,
): Extract<SimpleOutcome, { kind: "refused" }> | null {
  if (error instanceof GitWorkflowError) {
    return {
      kind: "refused",
      code: error.code,
      exitCode: error.exitCode,
      diagnostic: error.diagnostic,
    };
  }
  return null;
}

async function runSimple(
  engine: GitEngine,
  spec: GitCommandSpec,
): Promise<SimpleOutcome> {
  try {
    await runRequired(engine, spec);
    return { kind: "done" };
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal !== null) {
      return refusal;
    }
    throw error;
  }
}

/** Create a stash; the message (if any) travels in argv as `--message=`. */
export function createStash(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly message: string | null;
    readonly includeUntracked: boolean;
    readonly keepIndex: boolean;
  },
): Promise<SimpleOutcome> {
  return runSimple(engine, planStashPush(context, input));
}

export type LocatorCheck =
  | { readonly kind: "matches" }
  | { readonly kind: "moved"; readonly resolvedOid: string | null }
  | { readonly kind: "unresolvable" };

/** Resolve the locator and compare it to the object the request named. */
export async function checkStashLocator(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly locator: string; readonly oid: string },
): Promise<LocatorCheck> {
  const result = await engine.run(planStashResolve(context, input.locator));
  if (result.termination !== "exit" || result.exitCode !== 0) {
    return { kind: "unresolvable" };
  }
  let text = "";
  for (const byte of result.stdout) {
    if (byte === 0x0a || byte === 0x0d) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text.trim() === input.oid
    ? { kind: "matches" }
    : { kind: "moved", resolvedOid: text.trim() === "" ? null : text.trim() };
}

export type PopOutcome =
  | { readonly kind: "done" }
  | {
      readonly kind: "conflict";
      readonly diagnostic: string;
      /** True when the stash entry is still present after the conflict. */
      readonly stashPreserved: boolean;
    }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

/**
 * Pop a stash: apply, and drop only when Git applied it cleanly.
 *
 * On a non-zero exit the stash is re-checked by object name: Git's own rule is that
 * a conflicted pop leaves it in place, and the re-check is what makes the report
 * evidence rather than a belief about Git's behaviour.
 */
export async function popStash(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly locator: string;
    readonly oid: string;
    readonly restoreIndex: boolean;
  },
): Promise<PopOutcome> {
  const spec = planStashPop(context, {
    locator: input.locator,
    restoreIndex: input.restoreIndex,
  });
  const result = await engine.run(spec);
  if (result.termination === "exit" && result.exitCode === 0) {
    return { kind: "done" };
  }
  const diagnostic = boundedDiagnostic(result.stderr);
  if (result.termination !== "exit") {
    // A timeout or a signal: whether the stash was applied (or dropped) is not
    // known, and the caller must not continue to any further step.
    return {
      kind: "refused",
      code:
        result.termination === "timeout"
          ? "GitTimedOut"
          : result.termination === "signal"
            ? "GitTerminatedBySignal"
            : "GitNotStarted",
      exitCode: result.exitCode,
      diagnostic,
    };
  }
  const after = await checkStashLocator(engine, context, {
    locator: input.locator,
    oid: input.oid,
  });
  return {
    kind: "conflict",
    diagnostic:
      diagnostic.trim().length > 0
        ? diagnostic
        : "the pop did not apply cleanly",
    stashPreserved: after.kind === "matches",
  };
}

export function applyStash(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly locator: string; readonly restoreIndex: boolean },
): Promise<SimpleOutcome> {
  return runSimple(
    engine,
    planStashApply(context, {
      locator: input.locator,
      restoreIndex: input.restoreIndex,
    }),
  );
}

export function dropStash(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  locator: string,
): Promise<SimpleOutcome> {
  return runSimple(engine, planStashDrop(context, locator));
}

export type TagCreateOutcome =
  | { readonly kind: "created" }
  | { readonly kind: "exists" }
  | {
      readonly kind: "refused";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    };

/** Create a tag, refusing to overwrite an existing name. */
export async function createTag(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: {
    readonly name: string;
    readonly targetOid: string | null;
    readonly annotation: { readonly message: Uint8Array } | null;
  },
): Promise<TagCreateOutcome> {
  const existing = await engine.run(planTagExists(context, input.name));
  if (existing.termination === "exit" && existing.exitCode === 0) {
    return { kind: "exists" };
  }
  if (existing.termination !== "exit" || existing.exitCode !== 1) {
    // Anything other than the "no such tag" exit is a real failure to look it up,
    // and creating on top of an unreadable state is not safe.
    return {
      kind: "refused",
      code: "GitCommandFailed",
      exitCode: existing.exitCode,
      diagnostic: boundedDiagnostic(existing.stderr),
    };
  }
  const spec =
    input.annotation === null
      ? planTagCreateLightweight(context, {
          name: input.name,
          targetOid: input.targetOid,
        })
      : planTagCreateAnnotated(context, {
          name: input.name,
          targetOid: input.targetOid,
          message: input.annotation.message,
        });
  const created = await runSimple(engine, spec);
  return created.kind === "done" ? { kind: "created" } : created;
}

export function deleteTag(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  name: string,
): Promise<SimpleOutcome> {
  return runSimple(engine, planTagDelete(context, name));
}
