/**
 * Kunkun custom-view seam.
 *
 * The view gets a kkrpc proxy to the backend API. It has no HTTP client, no
 * localhost URL, no pairing ticket and no bearer storage of its own; existing
 * Git UI components can receive `git` and `mutations` as injected services.
 */
import {
  dispose,
  wrap,
  type RPCMessage,
  type Transport,
} from "kkrpc/streaming";
import type { EventEnvelope } from "@refyard/git-contract";
import type {
  KunkunBackendApi,
  KunkunGitService,
} from "./backend.js";
import type { MutationClient } from "@refyard/git-client";

export interface KunkunViewChannel {
  readonly git: KunkunGitService;
  readonly mutations: MutationClient;
  watchEvents(): AsyncIterable<EventEnvelope>;
  close(): Promise<void>;
  dispose(): void;
}

/** Create the injected service surface a custom view mounts into its components. */
export function createKunkunView(
  transport: Transport<RPCMessage>,
): KunkunViewChannel {
  const remote = wrap<KunkunBackendApi>(transport);
  return {
    git: remote.git,
    mutations: remote.mutations,
    watchEvents: () => remote.watchEvents(),
    close: () => remote.close(),
    dispose: () => dispose(remote),
  };
}
