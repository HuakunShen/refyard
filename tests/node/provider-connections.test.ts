/**
 * The provider connection store and manager, host-side.
 *
 * These tests pin the two properties the whole provider axis rests on: the
 * stored file is private (0600) and never leaves the state root, and a token
 * that the provider has not validated is never stored at all. The manager's
 * journal entries are checked to contain the act, never the credential.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProviderManager,
  createProviderStore,
} from "@refyard/host-node/provider/manager";
import { createAccessJournal } from "@refyard/host-node/journal/access";
import { stubForgeAdapter } from "../support/forge-adapter-stub.js";

const TOKEN = "github_pat_11TESTTOKEN000000000000000";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() ?? "", { recursive: true, force: true });
  }
});

/** Every test gets its own state root: no case depends on another's leftovers. */
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "refyard-provider-"));
  roots.push(root);
  return root;
}

const CONNECTION = {
  provider: "github",
  token: TOKEN,
  refreshToken: null,
  expiresAtMs: null,
  accountLogin: "octocat",
  accountType: "User",
  scopes: ["repo:read"],
  connectedAt: "2026-09-22T09:00:00.000Z",
  authMethod: "pat",
} as const;

describe("provider store", () => {
  it("writes the connections file with mode 0600 in a 0700 directory", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.set(CONNECTION);
    expect(statSync(store.filePath()).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateRoot, "provider")).mode & 0o777).toBe(0o700);
  });

  it("round-trips a connection through the file", async () => {
    const stateRoot = freshRoot();
    await createProviderStore({ stateRoot }).set(CONNECTION);
    const reloaded = createProviderStore({ stateRoot });
    await reloaded.load();
    const connection = reloaded.get("github");
    expect(connection?.token).toBe(TOKEN);
    expect(connection?.accountLogin).toBe("octocat");
  });

  it("remove deletes the record so a fresh store sees nothing", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.load();
    await store.set(CONNECTION);
    await store.remove("github");
    const reloaded = createProviderStore({ stateRoot });
    await reloaded.load();
    expect(reloaded.get("github")).toBeNull();
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
    writeFileSync(
      join(stateRoot, "provider", "connections.json"),
      JSON.stringify([{ ...CONNECTION, connectedAt: "not-a-timestamp" }]),
      { mode: 0o600 },
    );
    const mistyped = createProviderStore({ stateRoot });
    await expect(mistyped.load()).rejects.toThrow();
  });
});

describe("provider manager", () => {
  it("stores a connection only after the provider accepted the token", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.load();
    const journal = createAccessJournal({ stateRoot });
    await journal.load();
    const rejecting = createProviderManager({
      store,
      journal,
      adapter: stubForgeAdapter({ authenticateOk: false }),
      now: () => 1_000,
    });
    const refused = await rejecting.connect({ provider: "github", token: TOKEN });
    expect(refused.ok).toBe(false);
    expect(store.get("github")).toBeNull();

    const accepting = createProviderManager({
      store,
      journal,
      adapter: stubForgeAdapter({ authenticateOk: true }),
      now: () => 1_000,
    });
    const accepted = await accepting.connect({ provider: "github", token: TOKEN });
    expect(accepted.ok).toBe(true);
    expect(store.get("github")?.token).toBe(TOKEN);
  });

  it("reports status without ever carrying the token", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.load();
    await store.set(CONNECTION);
    const manager = createProviderManager({
      store,
      journal: createAccessJournal({ stateRoot }),
      adapter: stubForgeAdapter({ authenticateOk: true }),
      now: () => 1_000,
    });
    const status = manager.status();
    expect(status.connections.map((connection) => connection.provider)).toEqual([
      "github",
    ]);
    expect(
      status.connections.map((connection) => connection.accountLogin),
    ).toEqual(["octocat"]);
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it("records the connect and disconnect acts without the token bytes", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.load();
    const journal = createAccessJournal({ stateRoot });
    await journal.load();
    const manager = createProviderManager({
      store,
      journal,
      adapter: stubForgeAdapter({ authenticateOk: true }),
      now: () => 1_000,
    });
    await manager.connect({ provider: "github", token: TOKEN });
    await manager.disconnect({ provider: "github" });
    expect(store.get("github")).toBeNull();
    const acts = journal
      .list()
      .filter((entry) => entry.action.startsWith("provider-"))
      .map((entry) => entry.action);
    expect(acts).toEqual(["provider-connect", "provider-disconnect"]);
    expect(JSON.stringify(journal.list())).not.toContain(TOKEN);
  });

  it("disconnects idempotently when nothing is connected", async () => {
    const stateRoot = freshRoot();
    const store = createProviderStore({ stateRoot });
    await store.load();
    const journal = createAccessJournal({ stateRoot });
    await journal.load();
    const manager = createProviderManager({
      store,
      journal,
      adapter: stubForgeAdapter({ authenticateOk: true }),
      now: () => 1_000,
    });
    await manager.disconnect({ provider: "github" });
    expect(journal.list()).toEqual([]);
  });
});
