/** Typed Xross session identity, readiness, and operation-target availability. */
import {
  isCurrentViewContext,
  type ViewContextV1,
} from "../../../../../integrations/xross/view-contract/surfaces/view-context.js";
import type {
  RefyardOperationKindV1,
  RefyardTargetKindV1,
} from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { connectXrossView, XrossViewProblem, type XrossViewConnection } from "../runtime/xross.js";

export interface XrossSession extends XrossViewConnection {
  readonly cacheNamespace: string;
}

export async function createXrossSession(loadHost?: () => Promise<unknown>): Promise<XrossSession> {
  return createXrossSessionFromConnection(await connectXrossView(loadHost));
}

export function createXrossSessionFromConnection(connection: XrossViewConnection): XrossSession {
  const { context, capabilities } = connection;
  return {
    ...connection,
    cacheNamespace: ["xross", context.targetDeviceId, capabilities.serviceInstanceId,
      context.bridgeGeneration, context.targetPolicyRevision].join(":"),
  };
}

export function xrossOperationAvailable(
  session: XrossSession,
  operation: RefyardOperationKindV1,
  target: RefyardTargetKindV1,
): boolean {
  return session.capabilities.operations.some(
    (entry) => entry.operationKind === operation && entry.targets.includes(target),
  );
}

export function assertCurrentXrossContext(captured: ViewContextV1, current: ViewContextV1): void {
  if (!isCurrentViewContext(captured, current)) {
    throw new XrossViewProblem("StaleGeneration", "Xross view context changed; reload its scoped reads");
  }
}
