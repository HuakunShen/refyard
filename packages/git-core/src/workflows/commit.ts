/**
 * Commit and amend workflow: run the planner's command, then find out what
 * actually happened by re-reading Head.
 *
 * The exit code alone cannot classify a commit. A failing pre-commit hook exits
 * non-zero with nothing written; a post-commit hook can exit non-zero *after* the
 * commit landed. The evidence is the Head object name read before and after the
 * command, so the outcome distinguishes "the commit exists", "nothing was
 * written" and "whether anything changed is not known".
 */
import type { GitCommandSpec } from "../ports.js";
import {
  boundedDiagnostic,
  type GitEngine,
  type GitFailureCode,
} from "./engine.js";
import { planCommit, planAmendCommit } from "../plan/commit.js";
import { readHeadFacts, type HeadFacts } from "./status.js";

export type CommitOutcome =
  | { readonly kind: "committed"; readonly newHeadOid: string }
  | {
      readonly kind: "committedWithComplaint";
      readonly newHeadOid: string;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    }
  | {
      readonly kind: "notCommitted";
      readonly code: GitFailureCode;
      readonly exitCode: number | null;
      readonly diagnostic: string;
    }
  | { readonly kind: "uncertain"; readonly reason: string };

/**
 * Create a commit from the current index, or rewrite the tip when `amend`.
 *
 * `message` is the exact bytes the user wrote (empty is refused by the planner);
 * `null` means "keep the existing message", which only makes sense for amend.
 */
export async function commitIndex(
  engine: GitEngine,
  context: { readonly cwdHandle: string },
  input: { readonly message: Uint8Array | null; readonly amend: boolean },
): Promise<CommitOutcome> {
  const before: HeadFacts = await readHeadFacts(engine, context.cwdHandle);
  if (input.amend && before.kind === "unborn") {
    return {
      kind: "notCommitted",
      code: "GitCommandFailed",
      exitCode: null,
      diagnostic: "the branch has no commit to amend",
    };
  }
  if (input.message === null && !input.amend) {
    return {
      kind: "notCommitted",
      code: "GitCommandFailed",
      exitCode: null,
      diagnostic: "a commit requires a message",
    };
  }
  const spec: GitCommandSpec =
    input.message === null
      ? planAmendCommit(context, null)
      : input.amend
        ? planAmendCommit(context, input.message)
        : planCommit(context, input.message);
  const result = await engine.run(spec);
  let after: HeadFacts;
  try {
    after = await readHeadFacts(engine, context.cwdHandle);
  } catch {
    // Head cannot be re-read after the command: whether the commit landed is not
    // known, and guessing would be worse than saying so.
    return {
      kind: "uncertain",
      reason: "the repository head could not be read after the commit command",
    };
  }
  if (after.oid !== null && after.oid !== before.oid) {
    if (result.termination === "exit" && result.exitCode === 0) {
      return { kind: "committed", newHeadOid: after.oid };
    }
    return {
      kind: "committedWithComplaint",
      newHeadOid: after.oid,
      exitCode: result.exitCode,
      diagnostic: boundedDiagnostic(result.stderr),
    };
  }
  if (result.termination === "exit" && result.exitCode === 0) {
    if (input.amend && after.oid !== null) {
      // An amend can produce a byte-identical commit — same tree, author,
      // committer and timestamps — so the tip legitimately does not move.
      // Git said yes and the tip names the amended commit: that is success.
      return { kind: "committed", newHeadOid: after.oid };
    }
    return {
      kind: "uncertain",
      reason: "git reported success but the head did not move",
    };
  }
  if (result.termination !== "exit") {
    return {
      kind: "uncertain",
      reason: `the commit command ended by ${result.termination}; whether it changed anything is not known`,
    };
  }
  return {
    kind: "notCommitted",
    code: "GitCommandFailed",
    exitCode: result.exitCode,
    diagnostic: boundedDiagnostic(result.stderr),
  };
}
