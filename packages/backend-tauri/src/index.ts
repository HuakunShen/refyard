/**
 * `@refyard/backend-tauri` — the native adapter.
 *
 * The only package allowed to know the command names and the event name. It depends on
 * `@refyard/git-service` for the interfaces it implements and on `@refyard/git-contract`
 * for the schemas it validates with; nothing here imports `@tauri-apps/api`, because the
 * ports are injected at the composition root. That is what makes the whole adapter
 * testable without a WebView.
 */
export {
  createTauriBackendAdapter,
  type TauriBackendAdapterOptions,
} from "./adapter.js";
export {
  assertHostRequest,
  assertReadRequest,
  HOST_RESPONSE_SCHEMAS,
  NATIVE_COMMANDS,
  nativeSessionMetadataSchema,
  OPERATION_COMMANDS,
  problemFromInvocation,
  READ_RESPONSE_SCHEMAS,
  subscriptionAckSchema,
  validateHostResponse,
  validateReadResponse,
  type GitReadRequest,
  type HostRequest,
  type NativeCommand,
  type NativeDiffQuery,
  type NativeFilesystemQuery,
  type NativeHistoryQuery,
  type NativeHostMethod,
  type NativePorts,
  type NativePreviewsQuery,
  type NativeReadMethod,
  type NativeStatusQuery,
  type NativeSubmodulesQuery,
  type NativeTargetSelector,
} from "./commands.js";
export {
  NATIVE_EVENT_NAME,
  MAX_BUFFERED_EVENTS,
  createNativeEventService,
} from "./events.js";
