/**
 * `@refyard/backend-http` — the HTTP/SSE adapter.
 *
 * Wraps the existing `@refyard/git-client` rather than re-implementing its
 * protocol: the request/response shapes, the authenticated fetch-SSE stream and the
 * problem-code error mapping are already covered by that package's tests, and this
 * adapter's job is to present them through the transport-neutral interfaces plus the
 * host/execution-target extension.
 */
export {
  createHttpBackendAdapter,
  type HttpBackendAdapterOptions,
} from "./adapter.js";
export {
  createHttpBackendSession,
  toBackendError,
  type HttpSessionPorts,
} from "./session.js";
export { createHttpEventService, type HttpEventPorts } from "./events.js";
export {
  LEGACY_HOST_CAPABILITIES,
  probeHostExtension,
  requestJson,
  unsupportedHostOperation,
  type HostExtensionProbe,
  type HostProbePorts,
} from "./legacy-capabilities.js";
