/**
 * Browser/network connectivity state for the workbench.
 *
 * The Svelte page owns reactivity and query caching. This module owns the transitions for the
 * browser's online signal and the authenticated SSE stream. Events remain invalidation hints —
 * this module never stores Git data or treats the stream as a source of truth.
 */
import {
  createEventStream,
  type EventStream,
  type EventStreamOptions,
} from "@refyard/git-client";

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
