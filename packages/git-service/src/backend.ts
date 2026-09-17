/**
 * The session an adapter produces, and the adapter that produces it.
 *
 * The one rule this file exists to state: nothing above this line may know which
 * adapter is in use. `ready` means the *service session* is usable — not that every
 * execution target is online — and the bearer an HTTP adapter holds stays inside
 * that adapter's closure rather than in `SessionMetadata`.
 */
import type { Problem } from "@refyard/git-contract";
import type { EventService } from "./events.js";
import type { HostService } from "./host.js";
import type { GitReadService, MutationService } from "./service.js";

export type ConnectionPhase =
  "connecting" | "ready" | "reconnecting" | "disconnected" | "failed";

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  readonly problem: Problem | null;
}

export interface SessionMetadata {
  /**
   * The service-issued session id when the transport has one and the adapter
   * learned it. A bearer restored from storage identifies a session the client
   * cannot name, so this is null there rather than an invented identifier; the
   * native adapter always has a real one.
   */
  readonly sessionId: string | null;
  readonly serviceInstanceId: string;
  /**
   * Changes with the session and with the authorization round, so cached reads can
   * be scoped to it. It is not a secret and never a substitute for a credential.
   */
  readonly cacheNamespace: string;
  readonly backendLabel: string;
}

export interface BackendSession {
  readonly metadata: SessionMetadata;
  readonly git: GitReadService;
  readonly mutations: MutationService;
  readonly host: HostService;
  readonly events: EventService;
  state(): ConnectionState;
  onState(listener: (state: ConnectionState) => void): () => void;
  /** Idempotent: releases this session's listeners, timers and owned targets. */
  dispose(): Promise<void>;
}

export interface BackendConnectOptions {
  /** HTTP only: the single-use bootstrap ticket. A native adapter has none. */
  readonly ticket?: string;
  /** HTTP only: the hosted-UI password. */
  readonly password?: string;
}

export interface BackendAdapter {
  readonly kind: "http" | "tauri" | "kunkun" | "xross";
  connect(options: BackendConnectOptions): Promise<BackendSession>;
}
