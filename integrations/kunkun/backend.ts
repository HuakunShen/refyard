/**
 * Kunkun backend process boundary.
 *
 * The backend owns the Refyard GitClient, including its in-memory bearer token,
 * and exposes only the public GitService plus the separately typed mutation
 * client over a kkrpc streaming channel. The custom view never receives the
 * ticket, token or HTTP fetch function.
 */
import {
  expose,
  type ExposedController,
  type RPCMessage,
  type Transport,
} from "kkrpc/streaming";
import type { EventEnvelope } from "@refyard/git-contract";
import type { GitClient, MutationClient } from "@refyard/git-client";

/** The public GitService methods available to the custom view. */
export type KunkunGitService = Omit<GitClient, "exchangeTicket">;

export interface KunkunBackendApi {
  readonly git: KunkunGitService;
  readonly mutations: MutationClient;
  /** Replaces the browser's SSE connection with kkrpc pull-based streaming. */
  watchEvents(): AsyncIterable<EventEnvelope>;
  /** Ends the backend-owned Refyard session and any child service it owns. */
  close(): Promise<void>;
}

export interface KunkunBackendOptions {
  readonly mutations: MutationClient;
  readonly watchEvents?: () => AsyncIterable<EventEnvelope>;
  readonly closeSession?: () => Promise<void>;
}

/** Build the API that a Kunkun backend exposes over kkrpc. */
export function createKunkunBackend(
  client: GitClient,
  options: KunkunBackendOptions,
): KunkunBackendApi {
  const git: KunkunGitService = {
    health: () => client.health(),
    capabilities: () => client.capabilities(),
    repositories: () => client.repositories(),
    filesystemEntries: (query) => client.filesystemEntries(query),
    registerRepository: (path) => client.registerRepository(path),
    revokeRepository: (repositoryId) => client.revokeRepository(repositoryId),
    status: (query) => client.status(query),
    history: (query) => client.history(query),
    refs: (query) => client.refs(query),
    diff: (query) => client.diff(query),
    worktrees: (query) => client.worktrees(query),
    submodules: (query) => client.submodules(query),
    stashes: (query) => client.stashes(query),
    previews: (query) => client.previews(query),
    providerConnection: () => client.providerConnection(),
    connectProvider: (provider, token) => client.connectProvider(provider, token),
    disconnectProvider: (provider) => client.disconnectProvider(provider),
    providerPullRequests: (repositoryId) => client.providerPullRequests(repositoryId),
  };
  return {
    git,
    mutations: options.mutations,
    watchEvents: options.watchEvents ?? emptyEvents,
    async close(): Promise<void> {
      await options.closeSession?.();
    },
  };
}

/** Expose the backend API from the child process's injected kkrpc transport. */
export function exposeKunkunBackend(
  client: GitClient,
  transport: Transport<RPCMessage>,
  options: KunkunBackendOptions,
): ExposedController<KunkunBackendApi, object> {
  return expose(createKunkunBackend(client, options), transport);
}

async function* emptyEvents(): AsyncGenerator<EventEnvelope> {
  return;
}
