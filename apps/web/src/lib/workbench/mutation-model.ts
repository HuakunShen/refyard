/** Pure decisions used by the workbench mutation application layer. */
import type { Negotiation } from "../session-negotiation.js";

export interface MutationAvailability {
  readonly staging: boolean;
  readonly commit: boolean;
  readonly branch: boolean;
  readonly network: boolean;
  readonly stash: boolean;
  readonly tag: boolean;
  readonly worktree: boolean;
  readonly submodule: boolean;
  readonly merge: boolean;
  readonly repositoryCreation:
    "unknown" | { readonly init: boolean; readonly clone: boolean };
}

export function mutationAvailabilityFor(
  operations: readonly { readonly kind: string }[] | undefined,
): MutationAvailability {
  const kinds = new Set((operations ?? []).map((entry) => entry.kind));
  return {
    staging: kinds.has("stagePaths"),
    commit: kinds.has("commit"),
    branch: kinds.has("createBranch"),
    network: kinds.has("fetch"),
    stash: kinds.has("createStash"),
    tag: kinds.has("createTag"),
    worktree: kinds.has("createWorktree"),
    submodule: kinds.has("addSubmodule"),
    merge: kinds.has("merge"),
    repositoryCreation:
      operations === undefined
        ? "unknown"
        : {
            init: kinds.has("initRepository"),
            clone: kinds.has("cloneRepository"),
          },
  };
}

export function writeRefusalMessage(input: {
  readonly browserOnline: boolean;
  /**
   * A live backend session exists. Named for the capability rather than a credential:
   * a native session has no bearer at all, so a rule keyed on one would refuse every
   * write in the desktop App.
   */
  readonly sessionReady?: boolean;
  /** The pre-adapter spelling of `sessionReady`, kept for callers written before the split. */
  readonly hasToken?: boolean;
  readonly negotiation: Negotiation;
  readonly action: "write" | "repositoryAccess";
}): string | null {
  const sessionReady = input.sessionReady ?? input.hasToken ?? false;
  if (input.browserOnline && sessionReady && input.negotiation.kind === "ok") {
    return null;
  }
  if (!input.browserOnline) {
    return "this browser is offline; nothing was sent and nothing will be retried";
  }
  if (input.negotiation.kind !== "ok") {
    return input.negotiation.message;
  }
  return input.action === "repositoryAccess"
    ? "not paired with the service; pair before changing repository access"
    : "not paired with the service; pair before writing";
}

export function operationIdFromSubmission(
  submission:
    | {
        readonly kind: "accepted";
        readonly accepted: { readonly operationId: string };
      }
    | {
        readonly kind: "duplicate";
        readonly record: { readonly operationId: string };
      },
): string {
  return submission.kind === "accepted"
    ? submission.accepted.operationId
    : submission.record.operationId;
}

export function branchCreateOperation(
  branchName: string,
  startOid: string | null = null,
) {
  return {
    kind: "createBranch" as const,
    branchName,
    startOid,
    switchToIt: false,
  };
}

export function tagCreateOperation(
  tagName: string,
  annotation: string | null,
  targetOid: string | null = null,
) {
  return {
    kind: "createTag" as const,
    tagName,
    targetOid,
    annotation: annotation === null ? null : { message: annotation },
  };
}
