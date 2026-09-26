/** Semantic Xross mutation previews and native-owned submission/recovery. */
import type {
  MutationJobV1,
  MutationRecoveryV1,
  MutationPreviewV1,
  RefyardMutationIntentV1,
  RefyardViewApiV1,
} from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import type { MutationPreviewIdV1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";
import type { ApprovalResultV1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import { assertCurrentXrossContext, xrossOperationAvailable, type XrossSession } from "./xross-session.svelte.js";

export function canOfferFreshPreview(row: Pick<MutationRecoveryV1, "writeFence" | "state">): boolean {
  // The native projection already accounts for every exact-resource blocker.
  return row.writeFence === "released" && row.state.kind !== "unknown" &&
    (row.state.kind !== "found" || ["succeeded", "failed", "cancelled"].includes(row.state.job.state));
}

/** An uncertain submission can be matched only by its output-only recovery id. */
export function recoveryForPreview(
  preview: Pick<MutationPreviewV1, "recoveryId">,
  rows: readonly Pick<MutationRecoveryV1, "recoveryId" | "writeFence" | "state">[],
): Pick<MutationRecoveryV1, "recoveryId" | "writeFence" | "state"> | undefined {
  return rows.find((row) => row.recoveryId === preview.recoveryId);
}

/** This gates the WebView affordance; native preview admission is authoritative. */
export function canPreviewWithRecoveries(state: {
  readonly ready: boolean;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly nextCursor: string | null;
  readonly unresolvedSubmission: boolean;
  readonly recoveries: readonly Pick<MutationRecoveryV1, "recoveryId" | "writeFence" | "state">[];
  readonly releasedRecoveryId?: MutationRecoveryV1["recoveryId"] | null;
}): boolean {
  if (!state.ready || state.loading || state.problem !== null || state.nextCursor !== null) return false;
  if (state.releasedRecoveryId !== undefined && state.releasedRecoveryId !== null) {
    return state.recoveries.some((row) => row.recoveryId === state.releasedRecoveryId && canOfferFreshPreview(row));
  }
  return !state.unresolvedSubmission && state.recoveries.every(canOfferFreshPreview);
}

/** A native job read/stream must never substitute a different job for this exact id. */
export function assertMutationJobBinding(expectedJobId: MutationJobV1["jobId"], job: MutationJobV1): MutationJobV1 {
  if (job.jobId !== expectedJobId) throw new Error("job identity mismatch");
  return job;
}

export async function submitXrossPreview(
  host: Pick<RefyardViewApiV1, "requestMutationSubmission">,
  previewId: MutationPreviewIdV1,
): Promise<ApprovalResultV1<MutationJobV1>> {
  // The native host owns confirmation, one-use submission and the durable ledger.
  return host.requestMutationSubmission({ previewId });
}

export async function previewXrossMutation(session: XrossSession, intent: RefyardMutationIntentV1) {
  if (!xrossOperationAvailable(session, intent.operation.kind, intent.target.kind)) {
    throw new Error("operation unavailable for this exact target kind");
  }
  assertCurrentXrossContext(session.context, await session.host.context());
  const preview = await session.host.previewMutation({ intent });
  assertCurrentXrossContext(session.context, await session.host.context());
  return preview;
}
