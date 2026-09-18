/**
 * Browser/network connectivity state for the workbench.
 *
 * The Svelte page owns reactivity and query caching. This module owns the transitions for the
 * browser's online signal and the live invalidation stream. Events remain invalidation hints —
 * this module never stores Git data or treats the stream as a source of truth.
 *
 * `startSessionEventStream` is the transport-neutral path: it subscribes through the
 * session's `EventService`, so the page never builds an SSE URL or a bearer. The older
 * `startWorkbenchEventStream` is the HTTP-SSE-specific starter, kept for the callers that
 * still inject a `git-client` stream directly.
 */
import {
  createEventStream,
  type EventStream,
  type EventStreamOptions,
} from "@refyard/git-client";
import type { EventService } from "@refyard/git-service";
import { cacheKeyFor } from "./query-state.js";

export type WorkbenchStreamState = "offline" | "connecting" | "live";

export interface WorkbenchConnectivityState {
  browserOnline: boolean;
  streamState: WorkbenchStreamState;
}

export interface BrowserConnectivityPort {
  isOnline(): boolean;
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
}

export interface WorkbenchEventStreamPorts {
  readonly baseUrl: string;
  readonly token: () => string | null;
  readonly fetch: typeof fetch;
  /** `undefined` means every cached query; otherwise invalidate exactly this prefix. */
  readonly invalidate: (queryKey?: readonly unknown[]) => void;
  readonly createStream?: (options: EventStreamOptions) => EventStream;
}

export function createWorkbenchConnectivityState(
  browserOnline = true,
): WorkbenchConnectivityState {
  return { browserOnline, streamState: "offline" };
}

export function observeBrowserConnectivity(
  state: WorkbenchConnectivityState,
  browser: BrowserConnectivityPort,
): () => void {
  const update = (): void => {
    state.browserOnline = browser.isOnline();
  };
  update();
  browser.addEventListener("online", update);
  browser.addEventListener("offline", update);
  return () => {
    browser.removeEventListener("online", update);
    browser.removeEventListener("offline", update);
  };
}

export function startWorkbenchEventStream(
  state: WorkbenchConnectivityState,
  ports: WorkbenchEventStreamPorts,
): () => void {
  const bearer = ports.token();
  if (bearer === null) {
    state.streamState = "offline";
    return () => {
      state.streamState = "offline";
    };
  }

  const makeStream = ports.createStream ?? createEventStream;
  const stream = makeStream({
    baseUrl: ports.baseUrl,
    fetch: ports.fetch,
    token: ports.token,
    onEvent: (envelope) => {
      const payload = envelope.payload;
      if (payload.kind === "repositoryChanged") {
        for (const prefix of ["status", "refs", "history"] as const) {
          ports.invalidate([
            prefix,
            ports.baseUrl,
            bearer,
            payload.repositoryId,
          ]);
        }
        return;
      }
      if (payload.kind === "eventGap") {
        ports.invalidate();
      }
    },
    onGap: () => {
      ports.invalidate();
    },
    onError: () => {
      state.streamState = "offline";
    },
  });

  let active = true;
  state.streamState = "connecting";
  void stream
    .start()
    .then(() => {
      if (active) {
        state.streamState = "live";
      }
    })
    .catch(() => {
      if (active) {
        state.streamState = "offline";
      }
    });

  return () => {
    active = false;
    stream.stop();
    state.streamState = "offline";
  };
}

export interface SessionEventStreamPorts {
  /** The session's own event service: HTTP SSE or native scoped events, same interface. */
  readonly events: EventService;
  /** Part of every invalidation key; never a credential. */
  readonly cacheNamespace: string;
  /** `undefined` means every cached query; otherwise invalidate exactly this prefix. */
  readonly invalidate: (queryKey?: readonly unknown[]) => void;
}

/**
 * Live updates through the injected `EventService`.
 *
 * The transport-neutral twin of `startWorkbenchEventStream`: it never sees a URL, a
 * bearer, or a stream implementation, and its invalidation keys are scoped to the
 * session's cache namespace so an event from an earlier session cannot refresh a
 * later session's cached reads.
 */
export function startSessionEventStream(
  state: WorkbenchConnectivityState,
  ports: SessionEventStreamPorts,
): () => void {
  let disposed = false;
  let subscription: { dispose(): Promise<void> } | null = null;

  state.streamState = "connecting";
  const pending = ports.events
    .subscribe({
      onEvent: (envelope) => {
        const payload = envelope.payload;
        if (payload.kind === "repositoryChanged") {
          for (const prefix of ["status", "refs", "history"] as const) {
            ports.invalidate(
              cacheKeyFor(ports.cacheNamespace, prefix, payload.repositoryId),
            );
          }
          return;
        }
        if (payload.kind === "eventGap") {
          ports.invalidate();
        }
      },
      onGap: () => {
        ports.invalidate();
      },
      onState: (next) => {
        if (disposed) return;
        state.streamState =
          next === "live"
            ? "live"
            : next === "connecting" || next === "reconnecting"
              ? "connecting"
              : "offline";
      },
      onError: () => {
        if (!disposed) state.streamState = "offline";
      },
    })
    .then((created) => {
      if (disposed) {
        void created.dispose();
        return;
      }
      subscription = created;
    })
    .catch(() => {
      // A session that refuses to subscribe (released, or already failed) reports no
      // live updates rather than an unhandled rejection.
      if (!disposed) state.streamState = "offline";
    });

  return () => {
    disposed = true;
    state.streamState = "offline";
    const held = subscription;
    subscription = null;
    if (held !== null) void held.dispose();
    void pending;
  };
}
