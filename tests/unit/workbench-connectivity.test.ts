/** Workbench browser/network state without a Svelte component. */
import { describe, expect, it, vi } from "vitest";
import type { EventStream, EventStreamOptions } from "@refyard/git-client";
import {
  createWorkbenchConnectivityState,
  observeBrowserConnectivity,
  startWorkbenchEventStream,
  type BrowserConnectivityPort,
} from "../../apps/web/src/lib/workbench/connectivity.js";

class FakeBrowserConnectivity implements BrowserConnectivityPort {
  online = true;
  readonly listeners = new Map<"online" | "offline", Set<() => void>>();

  isOnline(): boolean {
    return this.online;
  }

  addEventListener(type: "online" | "offline", listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: "online" | "offline", listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: "online" | "offline"): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function fakeFetch(): typeof fetch {
  return (async () => new Response(null, { status: 204 })) as typeof fetch;
}

describe("workbench connectivity", () => {
  it("tracks the browser online signal independently of the event stream", () => {
    const state = createWorkbenchConnectivityState(false);
    const browser = new FakeBrowserConnectivity();
    browser.online = true;

    const stop = observeBrowserConnectivity(state, browser);
    expect(state.browserOnline).toBe(true);

    browser.online = false;
    browser.emit("offline");
    expect(state.browserOnline).toBe(false);
    expect(state.streamState).toBe("offline");

    stop();
    browser.online = true;
    browser.emit("online");
    expect(state.browserOnline).toBe(false);
  });

  it("does not create an event stream without a bearer", () => {
    const state = createWorkbenchConnectivityState(true);
    state.streamState = "live";
    const createStream = vi.fn();

    const stop = startWorkbenchEventStream(state, {
      baseUrl: "http://127.0.0.1:9595",
      token: () => null,
      fetch: fakeFetch(),
      invalidate: vi.fn(),
      createStream,
    });

    expect(createStream).not.toHaveBeenCalled();
    expect(state.streamState).toBe("offline");
    stop();
  });

  it("routes repository events narrowly, gaps broadly, and owns stream readiness", async () => {
    const state = createWorkbenchConnectivityState(true);
    const invalidations: Array<readonly unknown[] | undefined> = [];
    const captured: EventStreamOptions[] = [];
    const stopStream = vi.fn();
    const stream: EventStream = {
      start: vi.fn(async () => undefined),
      stop: stopStream,
      lastSequence: () => 0,
      connected: () => true,
    };
    const createStream = vi.fn((value: EventStreamOptions) => {
      captured.push(value);
      return stream;
    });

    const cleanup = startWorkbenchEventStream(state, {
      baseUrl: "http://127.0.0.1:9595",
      token: () => "tok_abc",
      fetch: fakeFetch(),
      invalidate: (queryKey) => invalidations.push(queryKey),
      createStream,
    });

    expect(state.streamState).toBe("connecting");
    await Promise.resolve();
    expect(state.streamState).toBe("live");
    const callbacks = captured[0];
    if (callbacks === undefined) {
      throw new Error("the controller did not create an event stream");
    }

    callbacks.onEvent({
      sequence: 1,
      emittedAt: new Date(0).toISOString(),
      payload: {
        kind: "repositoryChanged",
        repositoryId: "repo_1",
        worktreeIds: [],
        snapshotInvalidated: true,
      },
    });
    expect(invalidations).toEqual([
      ["status", "http://127.0.0.1:9595", "tok_abc", "repo_1"],
      ["refs", "http://127.0.0.1:9595", "tok_abc", "repo_1"],
      ["history", "http://127.0.0.1:9595", "tok_abc", "repo_1"],
    ]);

    callbacks.onEvent({
      sequence: 2,
      emittedAt: new Date(0).toISOString(),
      payload: { kind: "eventGap", fromSequence: 1, toSequence: 2 },
    });
    expect(invalidations.at(-1)).toBeUndefined();

    callbacks.onGap({ fromSequence: 2, toSequence: 3 });
    expect(invalidations.at(-1)).toBeUndefined();

    callbacks.onError?.({ code: "Unavailable", message: "gone" });
    expect(state.streamState).toBe("offline");

    cleanup();
    expect(stopStream).toHaveBeenCalledOnce();
    expect(state.streamState).toBe("offline");
  });
});
