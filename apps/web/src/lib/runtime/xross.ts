/** Validates the injected Xross Refyard facade without selecting another transport. */
import {
  REFYARD_VIEW_METHODS_V1,
  REFYARD_OPERATION_TARGETS_V1,
  type RefyardViewApiV1,
  type RefyardCapabilitiesV1,
} from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { parseRefyardId } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";
import {
  isCurrentViewContext,
  parseViewContextV1,
  type ViewContextV1,
} from "../../../../../integrations/xross/view-contract/surfaces/view-context.js";

export type XrossProblemCode = "HostUnavailable" | "IncompatibleContract" | "PermissionDenied" | "StaleGeneration";

export class XrossViewProblem extends Error {
  constructor(readonly code: XrossProblemCode, message: string) {
    super(message);
    this.name = "XrossViewProblem";
  }
}

export interface XrossViewConnection {
  readonly host: RefyardViewApiV1;
  readonly context: ViewContextV1;
  readonly capabilities: RefyardCapabilitiesV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFacade(value: unknown): value is RefyardViewApiV1 {
  if (!isRecord(value)) return false;
  const methods = new Set<string>(REFYARD_VIEW_METHODS_V1);
  const own = Reflect.ownKeys(value);
  return own.length === methods.size && own.every((key) => typeof key === "string" && methods.has(key)) &&
    REFYARD_VIEW_METHODS_V1.every((method) => typeof Reflect.get(value, method) === "function");
}

const readKinds = new Set([
  "capabilities", "filesystem", "repositories", "status", "history", "refs", "diff",
  "worktrees", "submodules", "stashes", "operations", "events",
]);
const hostKinds = new Set(["macos", "linux", "windows", "unknown"]);
const objectFormats = new Set(["sha1", "sha256"]);
const unavailableReasons = new Set(["notImplemented", "gitFeatureMissing", "unsupportedTarget", "unknown"]);
const gitFeatureFlags = ["porcelainV2Status", "worktreeListZ", "catFileBatch", "pushPorcelain", "fetchPorcelain"] as const;
const runtimeLimitFields = [
  "historyDefaultPageSize", "historyMaxPageSize", "patchMaxBytesPerFile", "patchMaxLinesPerFile",
  "objectMaxBytes", "logicalCacheMaxBytes", "previewTokenTtlSeconds", "readonlyDeadlineSeconds",
  "networkDeadlineSeconds", "hookDeadlineSeconds", "queuedOperationsPerActor", "concurrentGitProcesses",
  "concurrentReadersPerRepository", "eventRingMaxEvents", "eventRingMaxBytes", "pathSelectionMaxEntries",
  "historyTipsMax", "commitMessageMaxBytes", "branchNameMaxLength",
] as const;

function isGitFeatures(value: unknown): boolean {
  return isRecord(value) && gitFeatureFlags.every((key) => typeof value[key] === "boolean") &&
    Array.isArray(value.objectFormats) && value.objectFormats.every((format: unknown) =>
      typeof format === "string" && objectFormats.has(format));
}

function isRuntimeLimits(value: unknown): boolean {
  return isRecord(value) && runtimeLimitFields.every((key) =>
    typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function isCapabilities(value: unknown): value is RefyardCapabilitiesV1 {
  if (!isRecord(value) || !Array.isArray(value.reads) || !Array.isArray(value.operations) ||
    !isRecord(value.host) || !isRecord(value.git) || !isRuntimeLimits(value.limits) ||
    !Array.isArray(value.unavailable)) return false;
  if (!value.reads.every((read: unknown) => typeof read === "string" && readKinds.has(read))) return false;
  if (!value.operations.every((entry: unknown) => isRecord(entry) &&
    typeof entry.operationKind === "string" && Array.isArray(entry.targets) &&
    entry.targets.every((target: unknown) => typeof target === "string" &&
      REFYARD_OPERATION_TARGETS_V1.some(([operation, allowed]) => operation === entry.operationKind && allowed === target)))) return false;
  if (!value.unavailable.every((entry: unknown) => isRecord(entry) &&
    typeof entry.reasonKey === "string" && unavailableReasons.has(entry.reasonKey) &&
    Array.isArray(entry.operationIds) && entry.operationIds.every((operation: unknown) =>
      typeof operation === "string" && REFYARD_OPERATION_TARGETS_V1.some(([allowed]) => allowed === operation)))) return false;
  return typeof value.apiMajor === "number" && typeof value.contractVersion === "string" &&
    typeof value.serviceInstanceId === "string" && typeof value.host.kind === "string" &&
    hostKinds.has(value.host.kind) && typeof value.host.version === "string" &&
    typeof value.git.version === "string" && isGitFeatures(value.git.features);
}

/** Production reads exactly window.xrossRefyardV1; globalThis is that window in the WebView. */
export async function connectXrossView(
  loadHost: () => Promise<unknown> = async () => Reflect.get(globalThis, "xrossRefyardV1"),
): Promise<XrossViewConnection> {
  let candidate: unknown;
  try {
    candidate = await loadHost();
  } catch {
    throw new XrossViewProblem("HostUnavailable", "Xross Refyard host unavailable");
  }
  if (candidate === undefined || candidate === null) {
    throw new XrossViewProblem("HostUnavailable", "Xross Refyard host unavailable");
  }
  if (!isFacade(candidate)) {
    throw new XrossViewProblem("IncompatibleContract", "Xross Refyard facade has an incompatible method set");
  }
  let context: ViewContextV1 | null;
  let capabilities: unknown;
  try {
    context = parseViewContextV1(await candidate.context());
    capabilities = await candidate.capabilities();
  } catch (error) {
    if (isRecord(error) && error.code === "PermissionDenied") {
      throw new XrossViewProblem("PermissionDenied", "Xross refused this Refyard view");
    }
    throw new XrossViewProblem("HostUnavailable", "Xross Refyard handshake failed");
  }
  if (
    context === null || context.packId !== "refyard" || context.contractMajor !== 1 ||
    !context.featureBits.includes("refyard.read") ||
    !isCapabilities(capabilities) ||
    capabilities.apiMajor !== 1 ||
    !capabilities.contractVersion.startsWith("1.") ||
    parseRefyardId("srvc", capabilities.serviceInstanceId) === null
  ) {
    throw new XrossViewProblem("IncompatibleContract", "Xross Refyard view contract is incompatible");
  }
  let confirmedContext: ViewContextV1 | null;
  try {
    confirmedContext = parseViewContextV1(await candidate.context());
  } catch {
    throw new XrossViewProblem("HostUnavailable", "Xross Refyard context confirmation failed");
  }
  if (confirmedContext === null) {
    throw new XrossViewProblem("IncompatibleContract", "Xross Refyard context confirmation is malformed");
  }
  if (!isCurrentViewContext(context, confirmedContext)) {
    throw new XrossViewProblem("StaleGeneration", "Xross Refyard target changed during connection");
  }
  return { host: candidate, context, capabilities };
}
