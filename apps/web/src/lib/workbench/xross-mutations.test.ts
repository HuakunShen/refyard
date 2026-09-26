/** Native approval and recovery state tests; no JavaScript submission ledger. */
import { describe, expect, it, vi } from "vitest";
import { parseRefyardViewId } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";
import type { ApprovalResultV1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import { parseUInt64V1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import type { MutationJobV1, MutationRecoveryV1 } from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { assertMutationJobBinding, canOfferFreshPreview, canPreviewWithRecoveries, recoveryForPreview, submitXrossPreview } from "./xross-mutations.svelte.js";
import { previewXrossMutation } from "./xross-mutations.svelte.js";
import { createXrossSession } from "./xross-session.svelte.js";
import vectors from "../../../../../integrations/xross/contracts/view-v1/vectors/method-responses.json";
import { REFYARD_VIEW_METHODS_V1 } from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { parseRefyardId } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";

describe("Xross mutations", () => {
  it("asks the native host once and does not read a job after denial", async () => {
    const host = {
      requestMutationSubmission: vi.fn(async (): Promise<ApprovalResultV1<MutationJobV1>> => ({ decision: "denied" })),
      getMutationJob: vi.fn(),
    };
    const previewId = parseRefyardViewId("mutationPreview", "rpreview_00000000000000000000000000000001");
    if (previewId === null) throw new Error("invalid fixture preview ID");
    const result = await submitXrossPreview(host, previewId);
    expect(result.decision).toBe("denied");
    expect(host.requestMutationSubmission).toHaveBeenCalledTimes(1);
    expect(host.getMutationJob).not.toHaveBeenCalled();
  });

  it("trusts only the native aggregate fence, including for a terminal found job", () => {
    const jobId = parseRefyardViewId("job", "rjob_00000000000000000000000000000001");
    const zero = parseUInt64V1("0");
    if (jobId === null || zero === null) throw new Error("invalid job fixture");
    const job: MutationJobV1 = { jobId, state: "succeeded", sequence: zero,
      createdAtUnixMs: zero, updatedAtUnixMs: zero, problemCode: null };
    expect(canOfferFreshPreview({ writeFence: "blocked", state: { kind: "found", job } })).toBe(false);
    expect(canOfferFreshPreview({ writeFence: "released", state: { kind: "found", job } })).toBe(true);
    expect(canOfferFreshPreview({ writeFence: "released", state: { kind: "found", job: { ...job, state: "needsAttention" } } })).toBe(false);
    expect(canOfferFreshPreview({ writeFence: "released", state: { kind: "unknown" } })).toBe(false);
  });

  it("returns only the native approved job and makes exactly one submission request", async () => {
    const previewId = parseRefyardViewId("mutationPreview", "rpreview_00000000000000000000000000000001");
    const jobId = parseRefyardViewId("job", "rjob_00000000000000000000000000000001");
    const zero = parseUInt64V1("0");
    if (previewId === null || jobId === null || zero === null) throw new Error("invalid fixture IDs");
    const job: MutationJobV1 = { jobId, state: "accepted", sequence: zero,
      createdAtUnixMs: zero, updatedAtUnixMs: zero, problemCode: null };
    const host = { requestMutationSubmission: vi.fn(async (): Promise<ApprovalResultV1<MutationJobV1>> => ({ decision: "approved", outcome: job })) };
    const result = await submitXrossPreview(host, previewId);
    expect(result).toEqual({ decision: "approved", outcome: job });
    expect(host.requestMutationSubmission).toHaveBeenCalledExactlyOnceWith({ previewId });
  });

  it("matches reverse-order same-label rows by recovery id and permits only that released row", () => {
    const first = parseRefyardViewId("mutationRecovery", "rrecovery_00000000000000000000000000000001");
    const second = parseRefyardViewId("mutationRecovery", "rrecovery_00000000000000000000000000000002");
    if (first === null || second === null) throw new Error("invalid recovery IDs");
    const rows: readonly Pick<MutationRecoveryV1, "recoveryId" | "writeFence" | "state">[] = [
      { recoveryId: second, writeFence: "blocked", state: { kind: "unknown" } },
      { recoveryId: first, writeFence: "released", state: { kind: "notAccepted" } },
    ];
    expect(recoveryForPreview({ recoveryId: first }, rows)).toBe(rows[1]);
    expect(recoveryForPreview({ recoveryId: second }, rows)).toBe(rows[0]);
    const safe = { ready: true, loading: false, problem: null, nextCursor: null, unresolvedSubmission: false };
    expect(canPreviewWithRecoveries({ ...safe, unresolvedSubmission: true, recoveries: rows })).toBe(false);
    expect(canPreviewWithRecoveries({ ...safe, recoveries: rows, releasedRecoveryId: first })).toBe(true);
    expect(canPreviewWithRecoveries({ ...safe, recoveries: rows, releasedRecoveryId: second })).toBe(false);
    expect(canPreviewWithRecoveries({ ...safe, problem: "RecoveryUnavailable", recoveries: rows,
      releasedRecoveryId: first })).toBe(false);
    expect(canPreviewWithRecoveries({ ...safe, nextCursor: "cur_more", recoveries: rows,
      releasedRecoveryId: first })).toBe(false);
  });

  it("refuses a job read or stream value that is not the exact recovery job", () => {
    const expectedId = parseRefyardViewId("job", "rjob_00000000000000000000000000000001");
    const otherId = parseRefyardViewId("job", "rjob_00000000000000000000000000000002");
    const zero = parseUInt64V1("0");
    if (expectedId === null || otherId === null || zero === null) throw new Error("invalid fixture IDs");
    const job: MutationJobV1 = { jobId: otherId, state: "running", sequence: zero,
      createdAtUnixMs: zero, updatedAtUnixMs: zero, problemCode: null };
    expect(() => assertMutationJobBinding(expectedId, job)).toThrow("job identity mismatch");
    expect(() => assertMutationJobBinding(expectedId, { ...job, jobId: expectedId })).not.toThrow();
  });

  it("does not preview a mutation after the target generation changes", async () => {
    const methods = Object.fromEntries(REFYARD_VIEW_METHODS_V1.map((method) => [method, vi.fn()]));
    const context = vi.fn(async () => vectors.responses.refyard.context.value);
    const previewMutation = vi.fn();
    const session = await createXrossSession(async () => ({ ...methods, context, previewMutation,
      capabilities: vi.fn(async () => ({ ...vectors.responses.refyard.capabilities.value,
        operations: [{ operationKind: "commit", targets: ["worktree"] }] })),
    }));
    context.mockResolvedValueOnce({ ...vectors.responses.refyard.context.value, bridgeGeneration: "3".repeat(32) });
    const repositoryId = parseRefyardId("repo", "repo_demo");
    const worktreeId = parseRefyardId("wt", "wt_main");
    const expectedSnapshotId = parseRefyardViewId("snapshot", "rsnapshot_00000000000000000000000000000001");
    if (repositoryId === null || worktreeId === null || expectedSnapshotId === null) throw new Error("invalid IDs");
    await expect(previewXrossMutation(session, { target: { kind: "worktree", repositoryId, worktreeId, expectedSnapshotId },
      operation: { kind: "commit", message: "hello" } })).rejects.toMatchObject({ code: "StaleGeneration" });
    expect(previewMutation).not.toHaveBeenCalled();
  });
});
