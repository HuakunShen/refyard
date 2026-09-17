/**
 * `@refyard/git-client` — the typed HTTP client for `GitService`.
 *
 * It is shared by the Svelte app and by Node-side tooling, and it holds no
 * transport state of its own: `fetch` and the token provider are injected, so a
 * browser passes its own `fetch` and an in-memory token, while a test passes a stub
 * and a fixed token. Nothing here reads `localStorage`, a cookie, an environment
 * variable or a global — a bearer that this module could persist by accident is a
 * bearer that would outlive the session that earned it.
 */
export {
  createGitClient,
  toQueryString,
  GitClientError,
  type GitClient,
  type GitClientOptions,
} from "./client.js";
export {
  createEventStream,
  type EventStream,
  type EventStreamOptions,
} from "./events.js";
export {
  createMutationClient,
  type MutationClient,
  type MutationClientOptions,
} from "./mutations.js";

/**
 * Re-exported so a consumer that already depends on this package does not need a
 * second import for the shared interfaces. The dependency runs one way only:
 * `git-client` knows about `git-service`, never the reverse — the service layer
 * must stay free of any HTTP implementation.
 */
export type {
  BackendAdapter,
  BackendConnectOptions,
  BackendSession,
  ConnectionPhase,
  ConnectionState,
  DiffQuery,
  EventObserver,
  EventService,
  EventSubscription,
  FilesystemEntriesQuery,
  GitReadService,
  HostService,
  MutationService,
  PreviewsQuery,
  RegisterRepositoryOptions,
  SessionMetadata,
  StashesQuery,
  StatusQuery,
  SubmodulesQuery,
  SubmitResult,
  SubscriptionAck,
  ScopedEventFrame,
  TargetSelector,
  WorktreesQuery,
} from "@refyard/git-service";
export { BackendError, isBackendError, normalizeProblem } from "@refyard/git-service";
