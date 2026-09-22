/**
 * The device-flow connect orchestration, host-side.
 *
 * The protocol client is tested against a stub upstream elsewhere; what this
 * file pins is the orchestration around it: the store only ever receives a
 * validated OAuth identity, denial and expiry end in terminal states with
 * nothing stored, slow-down is honoured, and a token that is about to expire
 * is refreshed (and a refresh the forge refuses deletes the connection).
 *
 * The adapter here is a ForgeAdapter stub, which doubles as proof that the
 * orchestration is forge-agnostic: nothing in it mentions GitHub.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProviderManager,
  createProviderStore,
  type StoredProviderConnection,
} from "@refyard/host-node/provider/manager";
import { createAccessJournal } from "@refyard/host-node/journal/access";
import { stubForgeAdapter } from "../support/forge-adapter-stub.js";
import type { ForgeDevicePoll } from "@refyard/git-provider/adapter";

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

async function managerFor(
  stateRoot: string,
  poll: readonly ForgeDevicePoll[],
  options: {
    authenticateOk?: boolean;
    now?: () => number;
    seed?: StoredProviderConnection;
    expiresAtMs?: number;
    refresh?: {
      accessToken: string;
      refreshToken: string;
      expiresInSeconds: number | null;
    }[];
  } = {},
) {
  const store = createProviderStore({ stateRoot });
  await store.load();
  if (options.seed !== undefined) {
    await store.set(options.seed);
  }
  const journal = createAccessJournal({ stateRoot });
  const delays: number[] = [];
  const manager = createProviderManager({
    store,
    journal,
    adapter: stubForgeAdapter({
      authenticateOk: options.authenticateOk ?? true,
      expiresAtMs: options.expiresAtMs,
      poll: [...poll],
      refresh: options.refresh ?? [
        {
          accessToken: TOKEN,
          refreshToken: "ghu_rotatedtoken00000000000000001",
          expiresInSeconds: 28800,
        },
      ],
    }),
    now: options.now ?? (() => 1_000),
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
    const { manager, store, journal } = await managerFor(stateRoot, [
      { kind: "pending" },
    ]);
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

  it("stores the OAuth connection only after the forge accepts the token", async () => {
    const stateRoot = freshRoot();
    const { manager, store } = await managerFor(stateRoot, [
      { kind: "pending" },
      {
        kind: "authorized",
        accessToken: TOKEN,
        refreshToken: REFRESH,
        expiresInSeconds: 28800,
      },
    ]);
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
    const denied = await managerFor(deniedRoot, [{ kind: "denied" }]);
    await denied.manager.beginDeviceConnect({ provider: "github" });
    expect((await denied.manager.stepDeviceConnect()).state).toBe("denied");
    expect(denied.store.get("github")).toBeNull();

    const expiredRoot = freshRoot();
    const expired = await managerFor(expiredRoot, [{ kind: "expired" }]);
    await expired.manager.beginDeviceConnect({ provider: "github" });
    expect((await expired.manager.stepDeviceConnect()).state).toBe("expired");
    expect(expired.store.get("github")).toBeNull();
  });

  it("honours the slowed interval the forge asks for", async () => {
    const stateRoot = freshRoot();
    const { manager, delays } = await managerFor(stateRoot, [
      { kind: "slowDown", intervalMs: 8000 },
      { kind: "pending" },
    ]);
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
      [{ kind: "pending" }],
      { now: () => clock, expiresAtMs: 901_500 },
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
      [],
      {
        now: () => 30_000,
        seed: {
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
      },
    );
    const credential = await manager.validToken("github");
    expect(credential?.token).toBe(TOKEN);
    const stored = store.get("github");
    expect(stored?.token).toBe(TOKEN);
    expect(stored?.refreshToken).toBe("ghu_rotatedtoken00000000000000001");
  });

  it("deletes the connection when the forge refuses the refresh", async () => {
    const stateRoot = freshRoot();
    const { manager, store, journal } = await managerFor(
      stateRoot,
      [],
      {
        now: () => 30_000,
        refresh: [],
        seed: {
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
    const { manager } = await managerFor(stateRoot, [], { now: () => 30_000 });
    expect((await manager.validToken("github"))?.token).toBe(TOKEN);
  });
});

// The store's privacy contract is pinned here too: it is the property every
// future adapter inherits, so it belongs next to the orchestration tests.
describe("provider store privacy", () => {
  it("writes the connections file with mode 0600 in a 0700 directory", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.set({
      provider: "github",
      token: TOKEN,
      refreshToken: null,
      expiresAtMs: null,
      accountLogin: "octocat",
      accountType: "User",
      scopes: [],
      connectedAt: "2026-09-22T09:00:00.000Z",
      authMethod: "pat",
    });
    expect(statSync(store.filePath()).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateRoot, "provider")).mode & 0o777).toBe(0o700);
  });

  it("refuses to load a corrupted connections file", async () => {
    // A corrupt secret file must fail loudly: silently starting empty would
    // look like a working integration while nothing is connected.
    const stateRoot = freshRoot();
    mkdirSync(join(stateRoot, "provider"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stateRoot, "provider", "connections.json"), "{not json", {
      mode: 0o600,
    });
    const corrupt = createProviderStore({ stateRoot });
    await expect(corrupt.load()).rejects.toThrow();
  });
});
