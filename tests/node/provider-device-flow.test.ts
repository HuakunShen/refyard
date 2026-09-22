/**
 * The device-flow connect orchestration, host-side.
 *
 * The protocol client is tested against a stub upstream elsewhere; what this
 * file pins is the orchestration around it: the store only ever receives a
 * validated OAuth identity, denial and expiry end in terminal states with
 * nothing stored, slow-down is honoured, and a token that is about to expire
 * is refreshed (and a refresh GitHub refuses deletes the connection).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProviderManager,
  createProviderStore,
} from "@refyard/host-node/provider/manager";
import { createAccessJournal } from "@refyard/host-node/journal/access";
import type {
  DeviceAuthorization,
  DeviceFlowClient,
} from "@refyard/git-provider/github/device-flow";
import type { GitHubRestClient } from "@refyard/git-provider/github/rest";

const TOKEN = "ghu_testaccesstoken00000000000000001";
const REFRESH = "ghu_testrefreshtoken00000000000000001";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() ?? "", { recursive: true, force: true });
  }
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "refyard-provider-device-"));
  roots.push(root);
  return root;
}

function stubRest(behavior: { ok: boolean }): GitHubRestClient {
  return {
    baseUrl: "http://127.0.0.1:1",
    authenticatedUser: async () =>
      behavior.ok
        ? {
            ok: true,
            value: {
              login: "octocat",
              type: "User",
              scopes: [],
            },
          }
        : { ok: false, error: { kind: "unauthorized" } },
    listOpenPullRequests: async () => ({ ok: true, value: [] }),
    listOpenIssues: async () => ({ ok: true, value: [] }),
    listWorkflowRuns: async () => ({ ok: true, value: [] }),
  };
}

function stubDeviceFlow(options: {
  poll: DeviceAuthorization[];
  refresh?: Array<{
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number | null;
  }>;
  /** Deadline in the test's own clock units, so expiry cases stay deterministic. */
  expiresAtMs?: number;
}): DeviceFlowClient {
  let pollIndex = 0;
  let refreshIndex = 0;
  return {
    start: async () => ({
      ok: true,
      value: {
        deviceCode: "device_code_123",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresAtMs: options.expiresAtMs ?? Date.now() + 900_000,
        intervalMs: 1000,
      },
    }),
    poll: async () => {
      const value =
        options.poll[Math.min(pollIndex, options.poll.length - 1)] ?? {
          kind: "pending" as const,
        };
      pollIndex += 1;
      return { ok: true, value };
    },
    refresh: async () => {
      const list = options.refresh ?? [];
      const value = list[Math.min(refreshIndex, list.length - 1)];
      if (value === undefined) {
        return { ok: false, error: { code: "bad_refresh_token" } };
      }
      refreshIndex += 1;
      return { ok: true, value };
    },
  };
}

async function managerFor(
  stateRoot: string,
  deviceFlow: DeviceFlowClient,
  restBehavior: { ok: boolean } = { ok: true },
  now: () => number = () => 1_000,
  seed?: import("@refyard/host-node/provider/manager").StoredProviderConnection,
) {
  const store = createProviderStore({ stateRoot });
  await store.load();
  if (seed !== undefined) {
    await store.set(seed);
  }
  const journal = createAccessJournal({ stateRoot });
  const delays: number[] = [];
  const manager = createProviderManager({
    store,
    journal,
    client: stubRest(restBehavior),
    deviceFlow,
    clientId: "Iv1_test",
    now,
    schedule: (fn, delayMs) => {
      delays.push(delayMs);
      void fn;
      return () => {};
    },
  });
  return { manager, store, journal, delays };
}

describe("device flow orchestration", () => {
  it("starts an exchange and reports the code without storing anything", async () => {
    const stateRoot = freshRoot();
    const { manager, store, journal } = await managerFor(stateRoot, stubDeviceFlow({ poll: [{ kind: "pending" }] }));
    const started = await manager.beginDeviceConnect({ provider: "github" });
    expect(started).toMatchObject({
      ok: true,
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
    expect(store.get("github")).toBeNull();
    expect(manager.deviceConnectState().state).toBe("awaiting-user");
    expect(journal.list()).toEqual([]);
  });

  it("stores the OAuth connection only after GitHub accepts the token", async () => {
    const stateRoot = freshRoot();
    const { manager, store } = await managerFor(
      stateRoot,
      stubDeviceFlow({
        poll: [
          { kind: "pending" },
          {
            kind: "authorized",
            accessToken: TOKEN,
            refreshToken: REFRESH,
            expiresInSeconds: 28800,
          },
        ],
      }),
    );
    await manager.beginDeviceConnect({ provider: "github" });
    const first = await manager.stepDeviceConnect();
    expect(first.state).toBe("awaiting-user");
    const second = await manager.stepDeviceConnect();
    expect(second.state).toBe("connected");
    const stored = store.get("github");
    expect(stored?.authMethod).toBe("oauth");
    expect(stored?.refreshToken).toBe(REFRESH);
    expect(stored?.expiresAtMs).toBe(1_000 + 28800 * 1000);
    // The status DTO reflects the auth method and the expiry, never the token.
    const status = manager.status();
    expect(
      status.connections.map((connection) => connection.authMethod),
    ).toEqual(["oauth"]);
    expect(
      status.connections.map((connection) => connection.tokenExpiresAt !== null),
    ).toEqual([true]);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("ends in terminal states with nothing stored on denial or expiry", async () => {
    const deniedRoot = freshRoot();
    const denied = await managerFor(
      deniedRoot,
      stubDeviceFlow({ poll: [{ kind: "denied" }] }),
    );
    await denied.manager.beginDeviceConnect({ provider: "github" });
    expect((await denied.manager.stepDeviceConnect()).state).toBe("denied");
    expect(denied.store.get("github")).toBeNull();

    const expiredRoot = freshRoot();
    const expired = await managerFor(
      expiredRoot,
      stubDeviceFlow({ poll: [{ kind: "expired" }] }),
    );
    await expired.manager.beginDeviceConnect({ provider: "github" });
    expect((await expired.manager.stepDeviceConnect()).state).toBe("expired");
    expect(expired.store.get("github")).toBeNull();
  });

  it("honours the slowed interval GitHub asks for", async () => {
    const stateRoot = freshRoot();
    const { manager, delays } = await managerFor(
      stateRoot,
      stubDeviceFlow({
        poll: [
          { kind: "slowDown", intervalMs: 8000 },
          { kind: "pending" },
        ],
      }),
    );
    await manager.beginDeviceConnect({ provider: "github" });
    expect(delays).toEqual([1000]);
    await manager.stepDeviceConnect();
    expect(delays.slice(1)).toEqual([8000]);
    expect(manager.deviceConnectState().state).toBe("awaiting-user");
  });

  it("expires an unanswered exchange when the device code deadline passes", async () => {
    const stateRoot = freshRoot();
    let clock = 1_000;
    const { manager } = await managerFor(
      stateRoot,
      stubDeviceFlow({ poll: [{ kind: "pending" }], expiresAtMs: 901_500 }),
      { ok: true },
      () => clock,
    );
    clock += 1_000;
    await manager.beginDeviceConnect({ provider: "github" });
    clock += 900_000;
    expect((await manager.stepDeviceConnect()).state).toBe("expired");
    expect(manager.deviceConnectState().state).toBe("expired");
  });

  it("refreshes an OAuth token before it expires and persists the rotation", async () => {
    const stateRoot = freshRoot();
    const { manager, store } = await managerFor(
      stateRoot,
      stubDeviceFlow({
        poll: [],
        refresh: [
          {
            accessToken: TOKEN,
            refreshToken: "ghu_rotatedtoken000000000000000001",
            expiresInSeconds: 28800,
          },
        ],
      }),
      { ok: true },
      () => 30_000,
      {
        provider: "github",
        token: "ghu_oldtoken0000000000000000000001",
        refreshToken: REFRESH,
        expiresAtMs: 60_000,
        accountLogin: "octocat",
        accountType: "User",
        scopes: [],
        connectedAt: "2026-09-22T09:00:00.000Z",
        authMethod: "oauth",
      },
    );
    const token = await manager.validToken("github");
    expect(token).toBe(TOKEN);
    const stored = store.get("github");
    expect(stored?.token).toBe(TOKEN);
    expect(stored?.refreshToken).toBe("ghu_rotatedtoken000000000000000001");
  });

  it("deletes the connection when GitHub refuses the refresh", async () => {
    const stateRoot = freshRoot();
    const { manager, store, journal } = await managerFor(
      stateRoot,
      stubDeviceFlow({ poll: [], refresh: [] }),
      { ok: true },
      () => 30_000,
      {
        provider: "github",
        token: "ghu_oldtoken0000000000000000000001",
        refreshToken: "ghu_stalerefresh0000000000000000001",
        expiresAtMs: 60_000,
        accountLogin: "octocat",
        accountType: "User",
        scopes: [],
        connectedAt: "2026-09-22T09:00:00.000Z",
        authMethod: "oauth",
      },
    );
    expect(await manager.validToken("github")).toBeNull();
    expect(store.get("github")).toBeNull();
    // The disconnect is an audited act with its own actor, and no token bytes
    // appear anywhere in the journal.
    expect(
      journal.list().some((entry) => entry.action === "provider-disconnect"),
    ).toBe(true);
    expect(JSON.stringify(journal.list())).not.toContain("ghu_");
  });

  it("returns a PAT without touching the refresh path", async () => {
    const stateRoot = freshRoot();
    mkdirSync(join(stateRoot, "provider"), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(stateRoot, "provider", "connections.json"),
      JSON.stringify([
        {
          provider: "github",
          token: TOKEN,
          accountLogin: "octocat",
          accountType: "User",
          scopes: [],
          connectedAt: "2026-09-22T09:00:00.000Z",
        },
      ]),
      { mode: 0o600 },
    );
    const { manager } = await managerFor(
      stateRoot,
      stubDeviceFlow({ poll: [], refresh: [{ accessToken: "x", refreshToken: "y", expiresInSeconds: 1 }] }),
      { ok: true },
      () => 30_000,
    );
    expect(await manager.validToken("github")).toBe(TOKEN);
  });
});
