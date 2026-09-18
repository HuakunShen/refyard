/**
 * The Tauri command surface, as a closed set.
 *
 * Each method of `GitReadService` becomes one member of a tagged union, and the
 * matching command returns exactly the DTO the contract publishes. Two properties
 * matter and both are enforced here rather than by convention:
 *
 * - **the union is closed.** An unknown `method` is rejected before a command is
 *   invoked, so a renderer cannot reach a command by inventing a name — there is no
 *   reflective "call whatever exists" path.
 * - **the response is validated.** `invoke<T>()` is a TypeScript assertion, not a
 *   runtime check; a mangled payload must fail here instead of reaching a component
 *   that would render it as empty state.
 */
import { z } from "zod";
import {
  capabilitiesResponseSchema,
  diffResponseSchema,
  executionTargetSummarySchema,
  hostCapabilitiesSchema,
  sshHostListSchema,
  type AcknowledgeUncertainOperationRequest,
  type CreateTargetRequest,
  filesystemEntriesResponseSchema,
  healthResponseSchema,
  historyPageSchema,
  operationRecordSchema,
  previewsResponseSchema,
  refsSnapshotSchema,
  repositoriesResponseSchema,
  stashesResponseSchema,
  statusSnapshotSchema,
  submodulesResponseSchema,
  worktreesResponseSchema,
} from "@refyard/git-contract";
import type { MutationService } from "@refyard/git-service";
import { BackendError, normalizeProblem } from "@refyard/git-service";

/** Reads the native session: one tagged member per `GitReadService` method. */
export type GitReadRequest =
  | { readonly method: "health" }
  | { readonly method: "capabilities"; readonly query?: NativeTargetSelector }
  | { readonly method: "repositories" }
  | {
      readonly method: "filesystemEntries";
      readonly query?: NativeFilesystemQuery;
    }
  | {
      readonly method: "registerRepository";
      readonly path: string;
      readonly targetId?: string;
    }
  | { readonly method: "revokeRepository"; readonly repositoryId: string }
  | { readonly method: "status"; readonly query: NativeStatusQuery }
  | { readonly method: "history"; readonly query: NativeHistoryQuery }
  | {
      readonly method: "refs";
      readonly query: { readonly repositoryId: string };
    }
  | { readonly method: "diff"; readonly query: NativeDiffQuery }
  | {
      readonly method: "worktrees";
      readonly query: { readonly repositoryId: string };
    }
  | { readonly method: "submodules"; readonly query: NativeSubmodulesQuery }
  | {
      readonly method: "stashes";
      readonly query: { readonly repositoryId: string };
    }
  | { readonly method: "previews"; readonly query: NativePreviewsQuery };

export interface NativeTargetSelector {
  readonly targetId?: string;
  readonly repositoryId?: string;
}

export interface NativeFilesystemQuery {
  readonly path?: string;
  readonly targetId?: string;
}

export interface NativeStatusQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly includeIgnored?: boolean;
}

export interface NativeHistoryQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface NativeDiffQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
  readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
  readonly oid?: string;
  readonly from?: string;
  readonly to?: string;
  readonly pathId?: string;
  readonly maxBytes?: number;
}

export interface NativeSubmodulesQuery {
  readonly repositoryId: string;
  readonly worktreeId?: string;
}

export interface NativePreviewsQuery {
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly pathIds: readonly string[];
}

/**
 * The commands this adapter may invoke — the contract's closed table, spelled once.
 *
 * A command in this list that the native host has not implemented yet still fails
 * honestly at the call: the host refuses an unknown command instead of answering it,
 * and capabilities gating keeps the UI from asking. A name that is *not* in this list
 * can never be invoked, so a caller cannot reach a command by inventing one.
 */
export const NATIVE_COMMANDS = [
  "refyard_connect",
  "refyard_disconnect",
  "refyard_git_read",
  "refyard_mutation_submit",
  "refyard_operation_get",
  "refyard_operation_list",
  "refyard_operation_cancel",
  "refyard_host_request",
  "refyard_events_subscribe",
  "refyard_events_unsubscribe",
] as const;

export type NativeCommand = (typeof NATIVE_COMMANDS)[number];

const READ_METHODS = new Set<GitReadRequest["method"]>([
  "health",
  "capabilities",
  "repositories",
  "filesystemEntries",
  "registerRepository",
  "revokeRepository",
  "status",
  "history",
  "refs",
  "diff",
  "worktrees",
  "submodules",
  "stashes",
  "previews",
]);

/** The webview's drag phases, translated to one shape. `paths` is what a browser can
 * never have: the full path of everything under the cursor while the OS drag is live. */
export type DragDropPathsEvent =
  | { readonly phase: "enter" | "over"; readonly paths: readonly string[] }
  | { readonly phase: "leave" }
  | { readonly phase: "drop"; readonly paths: readonly string[] };

/** The port the adapter needs. In production these are Tauri's own functions. */
export interface NativePorts {
  invoke<T>(command: NativeCommand, args?: Record<string, unknown>): Promise<T>;
  listen(
    event: string,
    handler: (event: { readonly payload: unknown }) => void,
  ): Promise<() => void>;
  /**
   * Present only when the webview reports OS drag-and-drop with real paths. Optional
   * so test ports and other hosts omit it and the adapter omits the surface with it.
   */
  onDragDropPaths?(
    handler: (event: DragDropPathsEvent) => void,
  ): Promise<() => void>;
}

/** The session metadata a native host reports back from `refyard_connect`. */
export const nativeSessionMetadataSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    serviceInstanceId: z.string().min(1),
    cacheNamespace: z.string().min(1),
    backendLabel: z.string().min(1),
  })
  .meta({ id: "NativeSessionMetadata" });

export const subscriptionAckSchema = z
  .strictObject({
    subscriptionId: z.string().min(1),
    serviceInstanceId: z.string().min(1),
    highWatermark: z.number().int().min(0),
    replay: z.array(z.unknown()),
  })
  .meta({ id: "NativeSubscriptionAck" });

/**
 * Rejects a request this adapter must never send. Kept as a runtime check because the
 * union above is erased at runtime and an untyped caller (a test, a plugin) can still
 * pass a string.
 */
export function assertReadRequest(request: GitReadRequest): void {
  if (!READ_METHODS.has(request.method)) {
    throw new BackendError({
      code: "InvalidRequest",
      message: `unknown native read method: ${String(request.method)}`,
      retryable: false,
    });
  }
}

/**
 * Turns a rejected command into the one error type callers know.
 *
 * A native command rejects with `{ problem: … }`; anything else is reported as an
 * `InternalError` rather than being interpreted. Guessing a code from a message is how
 * a permissions bug becomes an "it just fails" story.
 */
export function problemFromInvocation(error: unknown): BackendError {
  return new BackendError(
    normalizeProblem(error, {
      message:
        typeof error === "string" && error.length > 0
          ? error
          : "the native command failed without a problem body",
    }),
  );
}

/** The schemas a read response must satisfy, keyed by the method that produced it. */
export const READ_RESPONSE_SCHEMAS = {
  health: healthResponseSchema,
  capabilities: capabilitiesResponseSchema,
  repositories: repositoriesResponseSchema,
  filesystemEntries: filesystemEntriesResponseSchema,
  registerRepository: repositoriesResponseSchema,
  revokeRepository: repositoriesResponseSchema,
  status: statusSnapshotSchema,
  history: historyPageSchema,
  refs: refsSnapshotSchema,
  diff: diffResponseSchema,
  worktrees: worktreesResponseSchema,
  submodules: submodulesResponseSchema,
  stashes: stashesResponseSchema,
  previews: previewsResponseSchema,
} as const;

export type NativeReadMethod = keyof typeof READ_RESPONSE_SCHEMAS;

/** What the adapter validates with, before a payload reaches a component. */
export function validateReadResponse(
  method: NativeReadMethod,
  payload: unknown,
): unknown {
  const schema = READ_RESPONSE_SCHEMAS[method];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BackendError({
      code: "InternalError",
      message: `the native host answered ${method} with a shape this client cannot validate`,
      retryable: false,
    });
  }
  return parsed.data;
}

/** The operations command names, so a rename in Rust breaks the test table. */
export const OPERATION_COMMANDS = {
  get: "refyard_operation_get",
  list: "refyard_operation_list",
  cancel: "refyard_operation_cancel",
  submit: "refyard_mutation_submit",
} as const;

export const operationRecordSchemaForNative = operationRecordSchema;

export type NativeMutationService = MutationService;

/** Host requests, the second closed union. `targetId` is the only addressing it has. */
export type HostRequest =
  | { readonly method: "capabilities" }
  | { readonly method: "sshHosts" }
  | { readonly method: "targets" }
  | { readonly method: "createTarget"; readonly request: CreateTargetRequest }
  | { readonly method: "disconnectTarget"; readonly targetId: string }
  | { readonly method: "pickLocalDirectory" }
  | {
      readonly method: "acknowledgeUncertainOperation";
      readonly request: AcknowledgeUncertainOperationRequest;
    };

const HOST_METHODS = new Set<HostRequest["method"]>([
  "capabilities",
  "sshHosts",
  "targets",
  "createTarget",
  "disconnectTarget",
  "pickLocalDirectory",
  "acknowledgeUncertainOperation",
]);

export function assertHostRequest(request: HostRequest): void {
  if (!HOST_METHODS.has(request.method)) {
    throw new BackendError({
      code: "InvalidRequest",
      message: `unknown native host method: ${String(request.method)}`,
      retryable: false,
    });
  }
}

/** Response schemas for the host methods that answer with a DTO. */
export const HOST_RESPONSE_SCHEMAS = {
  capabilities: hostCapabilitiesSchema,
  sshHosts: sshHostListSchema,
  targets: z.array(executionTargetSummarySchema),
  createTarget: executionTargetSummarySchema,
  acknowledgeUncertainOperation: operationRecordSchema,
} as const;

export type NativeHostMethod = keyof typeof HOST_RESPONSE_SCHEMAS;

export function validateHostResponse(
  method: NativeHostMethod,
  payload: unknown,
): unknown {
  const schema = HOST_RESPONSE_SCHEMAS[method];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BackendError({
      code: "InternalError",
      message: `the native host answered ${method} with a shape this client cannot validate`,
      retryable: false,
    });
  }
  return parsed.data;
}
