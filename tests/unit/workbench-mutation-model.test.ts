/** Pure decisions shared by the workbench mutation controller. */
import { describe, expect, it } from "vitest";
import {
  branchCreateOperation,
  conflictRecoveryFor,
  mutationAvailabilityFor,
  tagCreateOperation,
  operationIdFromSubmission,
  writeRefusalMessage,
} from "../../apps/web/src/lib/workbench/mutation-model.js";

const READ_ONLY = {
  kind: "readOnlyCompatibility" as const,
  message: "writes disabled for contract skew",
  serviceContractVersion: "1.1.0",
  uiContractVersion: "1.0.0",
};

describe("workbench mutation model", () => {
  it("derives panel availability from the service operation list", () => {
    const model = mutationAvailabilityFor([
      { kind: "stagePaths" },
      { kind: "commit" },
      { kind: "createBranch" },
      { kind: "fetch" },
      { kind: "createStash" },
      { kind: "createTag" },
      { kind: "createWorktree" },
      { kind: "addSubmodule" },
      { kind: "merge" },
      { kind: "initRepository" },
    ]);

    expect(model).toMatchObject({
      staging: true,
      commit: true,
      branch: true,
      network: true,
      stash: true,
      tag: true,
      worktree: true,
      submodule: true,
      merge: true,
      repositoryCreation: { init: true, clone: false },
    });
  });

  it("derives each recovery action from its own capability without requiring the start operation", () => {
    // Prevents recovery-only hosts from hiding controls, or assuming one action implies its sibling.
    for (const pair of [
      {
        state: "merge",
        continueKind: "continueMerge",
        abortKind: "abortMerge",
      },
      {
        state: "cherry-pick",
        continueKind: "continueCherryPick",
        abortKind: "abortCherryPick",
      },
      {
        state: "rebase",
        continueKind: "continueRebase",
        abortKind: "abortRebase",
      },
    ]) {
      expect(
        conflictRecoveryFor(pair.state, [{ kind: pair.continueKind }]),
      ).toEqual({ canContinue: true, canAbort: false });
      expect(
        conflictRecoveryFor(pair.state, [{ kind: pair.abortKind }]),
      ).toEqual({ canContinue: false, canAbort: true });
      expect(
        conflictRecoveryFor(pair.state, [
          { kind: pair.continueKind },
          { kind: pair.abortKind },
        ]),
      ).toEqual({ canContinue: true, canAbort: true });
      expect(conflictRecoveryFor(pair.state, [{ kind: pair.state }])).toEqual({
        canContinue: false,
        canAbort: false,
      });
    }
  });

  it("fails closed for pending capabilities and unrelated sequencer states", () => {
    // Prevents a revert/bisect or stale capability response from being routed to merge recovery.
    expect(conflictRecoveryFor("rebase", undefined)).toEqual({
      canContinue: false,
      canAbort: false,
    });
    const operations = [{ kind: "continueMerge" }, { kind: "abortMerge" }];
    for (const state of [
      null,
      "revert",
      "bisect",
      "apply-mailbox",
      "unknown",
      "rebase",
    ]) {
      expect(conflictRecoveryFor(state, operations)).toEqual({
        canContinue: false,
        canAbort: false,
      });
    }
  });

  it("keeps repository creation unknown until capabilities arrive", () => {
    const model = mutationAvailabilityFor(undefined);
    expect(model.repositoryCreation).toBe("unknown");
    expect(model.staging).toBe(false);
  });

  it("names offline, unpaired, and compatibility write refusals exactly", () => {
    expect(
      writeRefusalMessage({
        browserOnline: false,
        hasToken: false,
        negotiation: { kind: "ok" },
        action: "write",
      }),
    ).toBe(
      "this browser is offline; nothing was sent and nothing will be retried",
    );

    expect(
      writeRefusalMessage({
        browserOnline: true,
        hasToken: false,
        negotiation: { kind: "ok" },
        action: "write",
      }),
    ).toBe("not paired with the service; pair before writing");

    expect(
      writeRefusalMessage({
        browserOnline: true,
        hasToken: false,
        negotiation: { kind: "ok" },
        action: "repositoryAccess",
      }),
    ).toBe(
      "not paired with the service; pair before changing repository access",
    );

    expect(
      writeRefusalMessage({
        browserOnline: true,
        hasToken: true,
        negotiation: READ_ONLY,
        action: "write",
      }),
    ).toBe("writes disabled for contract skew");

    expect(
      writeRefusalMessage({
        browserOnline: true,
        hasToken: true,
        negotiation: { kind: "ok" },
        action: "write",
      }),
    ).toBeNull();
  });

  it("builds branch and tag operations at an explicit historical commit", () => {
    expect(branchCreateOperation("topic", "abc123")).toEqual({
      kind: "createBranch",
      branchName: "topic",
      startOid: "abc123",
      switchToIt: false,
    });
    expect(tagCreateOperation("v1", "release note", "def456")).toEqual({
      kind: "createTag",
      tagName: "v1",
      targetOid: "def456",
      annotation: { message: "release note" },
    });
    expect(branchCreateOperation("head", null).startOid).toBeNull();
    expect(tagCreateOperation("lightweight", null, null).targetOid).toBeNull();
  });

  it("extracts the operation id from fresh and duplicate submissions", () => {
    expect(
      operationIdFromSubmission({
        kind: "accepted",
        accepted: { operationId: "op_new" },
      }),
    ).toBe("op_new");
    expect(
      operationIdFromSubmission({
        kind: "duplicate",
        record: { operationId: "op_existing" },
      }),
    ).toBe("op_existing");
  });
});
