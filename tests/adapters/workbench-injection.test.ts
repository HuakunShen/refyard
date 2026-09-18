/**
 * The workbench controllers must be able to run against either adapter.
 *
 * The two properties this pins are the ones a token-gated UI silently loses:
 *
 * - **A ready session is what enables a read, not a credential.** A native session has
 *   no bearer at all, so an `enabled` that tests for one leaves the native workbench
 *   empty forever; and a read the service does not implement must neither run nor be
 *   polled, or a panel the host cannot answer turns into a background request storm.
 * - **Cache identity is the session namespace, never a credential.** Two sessions (or
 *   two authorization rounds of one service) must not read each other's cached
 *   repository data, and a bearer copied into a query key would outlive the adapter's
 *   closure in the cache, devtools and serialized state.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTauriBackendAdapter } from "@refyard/backend-tauri";
import { BackendError, type BackendSession } from "@refyard/git-service";
import {
  cacheKeyFor,
  queryState,
} from "../../apps/web/src/lib/workbench/query-state.js";
import {
  createBackendRegistry,
  isNativeWebview,
} from "../../apps/web/src/lib/runtime/backend-registry.js";
import {
  createAdapterHarness,
  type AdapterHarness,
} from "../support/adapter-harness.js";
import {
  createRecordingNativePorts,
  nativeSessionPayload,
} from "../support/native-ports.js";

describe("query gating", () => {
  it("enables a read only for a ready session, an implemented read, and a selection", () => {
    // Prevents: gating on a bearer, which no native session has, so a local App would
    // show empty panels while the host is perfectly able to answer.
    expect(
      queryState({ phase: "ready", supportsRead: true, hasSelection: true }),
    ).toEqual({ enabled: true, poll: true });

    // Prevents: a read the service reports as unimplemented being issued anyway.
    expect(
      queryState({ phase: "ready", supportsRead: false, hasSelection: true })
        .enabled,
    ).toBe(false);

    // Prevents: a read starting while the session is still connecting, reconnecting,
    // disconnected or failed — every one of them would 401 or race the handshake.
    for (const phase of [
      "connecting",
      "reconnecting",
      "disconnected",
      "failed",
    ] as const) {
      expect(
        queryState({ phase, supportsRead: true, hasSelection: true }),
      ).toEqual({ enabled: false, poll: false });
    }

    // Prevents: reading a repository or worktree the user has not selected yet.
    expect(
      queryState({ phase: "ready", supportsRead: true, hasSelection: false })
        .enabled,
    ).toBe(false);
  });

  it("never polls a read that may not run", () => {
    // Prevents: a disabled panel still refetching on the background cadence, which is
    // the read storm the capability honesty rule exists to avoid.
    for (const missing of [
      { phase: "ready" as const, supportsRead: true, hasSelection: false },
      { phase: "ready" as const, supportsRead: false, hasSelection: true },
      { phase: "failed" as const, supportsRead: true, hasSelection: true },
    ]) {
      expect(queryState(missing).poll).toBe(false);
    }
  });
});

describe("runtime adapter selection", () => {
  it("detects a native WebView without throwing outside a browser", () => {
    // Prevents: a detection helper that reads `window` and turns the static page into a
    // crash in any non-browser context (tests, prerender, a plain tab).
    expect(isNativeWebview({})).toBe(false);
    expect(isNativeWebview(undefined)).toBe(false);
    expect(isNativeWebview({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isNativeWebview({ isTauri: true })).toBe(true);
  });

  it("chooses the native adapter inside a WebView and HTTP everywhere else", () => {
    // Prevents: the desktop App quietly talking to a localhost service, and a browser
    // page activating native IPC through a URL parameter.
    const http = {
      baseUrl: "http://127.0.0.1:9595",
      fetch: async (): Promise<Response> => new Response(null, { status: 204 }),
    };
    expect(createBackendRegistry({ http, runtime: {} }).kind).toBe("http");
    expect(
      createBackendRegistry({
        http,
        runtime: { __TAURI_INTERNALS__: {} },
      }).kind,
    ).toBe("tauri");
  });

  it("keeps a remembered browser session usable while the service is unreachable", async () => {
    // Prevents: a stopped service turning a paired tab into the pairing panel and losing
    // the read errors that say which panels could not be answered.
    const registry = createBackendRegistry({
      http: {
        baseUrl: "http://127.0.0.1:9",
        fetch: async (): Promise<Response> => {
          throw new TypeError("fetch failed");
        },
        initialToken: "rfs_remembered",
      },
      rememberedInstanceId: "srvc_remembered",
      runtime: {},
    });

    const session = await registry.connect();
    expect(session.metadata.serviceInstanceId).toBe("srvc_remembered");
    expect(session.metadata.sessionId).toBeNull();
    await expect(session.git.repositories()).rejects.toBeInstanceOf(
      BackendError,
    );
  });

  it("still refuses an unpaired browser session", async () => {
    // Prevents: handing a tab with no remembered session a workbench whose every read
    // will fail, instead of the pairing panel that can fix it.
    const registry = createBackendRegistry({
      http: {
        baseUrl: "http://127.0.0.1:9",
        fetch: async (): Promise<Response> => {
          throw new TypeError("fetch failed");
        },
        initialToken: null,
      },
      runtime: {},
    });

    await expect(registry.connect()).rejects.toMatchObject({
      code: "Unauthenticated",
    });
  });
});

describe("cache identity", () => {
  let harness: AdapterHarness | null = null;
  const sessions: BackendSession[] = [];

  afterEach(async () => {
    for (const session of sessions) await session.dispose();
    sessions.length = 0;
    await harness?.dispose();
    harness = null;
  });

  it("keys an HTTP session's cache by its namespace and never by its bearer", async () => {
    harness = await createAdapterHarness();
    const session = await harness.connectHttp();
    sessions.push(session);
    const key = cacheKeyFor(
      session.metadata.cacheNamespace,
      "status",
      harness.repositoryId,
      "wt_main",
    );

    expect(key).toContain(session.metadata.cacheNamespace);
    expect(key).toContain(harness.repositoryId);
    // The bearer is a real secret minted by the service; a key that carried it would
    // keep it alive in every cache entry long after the adapter released it.
    expect(JSON.stringify(key)).not.toContain(harness.secretToken);
  });

  it("keys a token-free native session by the namespace the host minted", async () => {
    const ports = createRecordingNativePorts();
    ports.respond("refyard_connect", () => nativeSessionPayload());
    ports.respond("refyard_disconnect", () => null);
    const adapter = createTauriBackendAdapter({ ports });
    const session = await adapter.connect({});
    sessions.push(session);

    const key = cacheKeyFor(
      session.metadata.cacheNamespace,
      "status",
      "repo_1",
      "wt_main",
    );
    expect(key).toContain("native/srvc_1/sess_1");
    expect(
      queryState({
        phase: session.state().phase,
        supportsRead: true,
        hasSelection: true,
      }).enabled,
    ).toBe(true);
  });
});
