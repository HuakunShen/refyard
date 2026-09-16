/** Pure decisions shared by the workbench mutation controller. */
import { describe, expect, it } from "vitest";
import {
  mutationAvailabilityFor,
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
