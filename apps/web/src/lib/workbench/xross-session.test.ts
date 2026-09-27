/** Fake-host contract tests for the Xross-only session boundary. */
import { describe, expect, it, vi } from "vitest";
import vectors from "../../../../../integrations/xross/contracts/view-v1/vectors/method-responses.json";
import { REFYARD_OPERATION_TARGETS_V1, REFYARD_TARGET_KINDS_V1 } from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { createXrossSession, xrossOperationAvailable } from "./xross-session.svelte.js";

function fakeHost(operations: readonly { readonly operationKind: (typeof REFYARD_OPERATION_TARGETS_V1)[number][0]; readonly targets: readonly (typeof REFYARD_TARGET_KINDS_V1)[number][] }[] = []) {
  const responses = vectors.responses.refyard;
  return {
    context: vi.fn(async () => responses.context.value),
    capabilities: vi.fn(async () => ({ ...responses.capabilities.value, operations })),
    listWorkspaceRoots: vi.fn(async () => responses.listWorkspaceRoots.value),
    listRepositories: vi.fn(async () => responses.listRepositories.value),
    getStatus: vi.fn(),
    historyPage: vi.fn(),
    listRefs: vi.fn(),
    listWorktrees: vi.fn(),
    listStashes: vi.fn(),
    listSubmodules: vi.fn(),
    getPathPreviews: vi.fn(),
    readDiff: vi.fn(),
    previewMutation: vi.fn(),
    requestMutationSubmission: vi.fn(),
    getMutationJob: vi.fn(),
    listMutationRecoveries: vi.fn(async () => ({
      snapshotId: "rrecoverysnapshot_00000000000000000000000000000001",
      items: [],
      nextCursor: null,
    })),
    watchRepository: vi.fn(),
    watchMutation: vi.fn(),
  };
}

describe("Xross session", () => {
  it("refuses missing facade and never opens a local transport", async () => {
    await expect(createXrossSession(async () => undefined)).rejects.toMatchObject({ code: "HostUnavailable" });
  });

  it("accepts the exact method set and scopes identity by target, service and bridge", async () => {
    const host = fakeHost();
    const session = await createXrossSession(async () => host);
    expect(session.cacheNamespace).toContain(session.context.targetDeviceId);
    expect(session.cacheNamespace).toContain(session.capabilities.serviceInstanceId);
    expect(session.cacheNamespace).toContain(session.context.bridgeGeneration);
    expect(session.context.locale).toBe("en");
  });

  it("refuses an incompatible context or missing recovery method", async () => {
    const host = fakeHost();
    await expect(createXrossSession(async () => ({ ...host, listMutationRecoveries: undefined }))).rejects.toMatchObject({ code: "IncompatibleContract" });
    host.context.mockResolvedValueOnce({ ...vectors.responses.refyard.context.value, packId: "space-lens" });
    await expect(createXrossSession(async () => host)).rejects.toMatchObject({ code: "IncompatibleContract" });
  });

  it("refuses a malformed capability payload before any read can mount", async () => {
    const host = fakeHost();
    await expect(createXrossSession(async () => ({ ...host,
      capabilities: vi.fn(async () => ({ ...vectors.responses.refyard.capabilities.value, reads: null, operations: [] })),
    }))).rejects.toMatchObject({ code: "IncompatibleContract" });
  });

  it("refuses invalid host, Git feature and runtime-limit metadata during the handshake", async () => {
    // A malformed native capability is not permission to render an invented host or use unsafe limits.
    const host = fakeHost();
    const original = vectors.responses.refyard.capabilities.value;
    for (const capabilities of [
      { ...original, host: { ...original.host, kind: "browser" } },
      { ...original, git: { ...original.git, features: { ...original.git.features, catFileBatch: "yes" } } },
      { ...original, limits: { ...original.limits, historyMaxPageSize: -1 } },
    ]) {
      await expect(createXrossSession(async () => ({ ...host,
        capabilities: vi.fn(async () => capabilities),
      }))).rejects.toMatchObject({ code: "IncompatibleContract" });
    }
  });

  it("refuses an operation advertised for an invalid target pair", async () => {
    const host = fakeHost([{ operationKind: "commit", targets: ["repository"] }]);
    await expect(createXrossSession(async () => host)).rejects.toMatchObject({ code: "IncompatibleContract" });
  });

  it("refuses a bridge generation that changes during the handshake", async () => {
    const host = fakeHost();
    host.context.mockResolvedValueOnce(vectors.responses.refyard.context.value)
      .mockResolvedValueOnce({ ...vectors.responses.refyard.context.value, bridgeGeneration: "3".repeat(32) });
    await expect(createXrossSession(async () => host)).rejects.toMatchObject({ code: "StaleGeneration" });
  });

  it("uses only the advertised operation-target pair", async () => {
    const session = await createXrossSession(async () => fakeHost());
    expect(xrossOperationAvailable(session, "commit", "worktree")).toBe(false);
    expect(xrossOperationAvailable(session, "commit", "repository")).toBe(false);
  });

  it("honors every pinned operation-target pair and refuses its other target kinds", async () => {
    const operations = REFYARD_OPERATION_TARGETS_V1.map(([operationKind, target]) => ({ operationKind, targets: [target] }));
    const session = await createXrossSession(async () => fakeHost(operations));
    for (const [operation, target] of REFYARD_OPERATION_TARGETS_V1) {
      expect(xrossOperationAvailable(session, operation, target)).toBe(true);
      for (const other of REFYARD_TARGET_KINDS_V1) {
        if (other !== target) expect(xrossOperationAvailable(session, operation, other)).toBe(false);
      }
    }
  });
});
