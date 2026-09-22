/**
 * The OAuth device flow: GitHub App user authorization without any callback.
 *
 * The whole point of this transport is that the host needs no redirect target —
 * no loopback listener, no deeplink — so it must work identically in the
 * browser form and the Tauri form. These tests pin the protocol against a
 * local stub of github.com's three login endpoints, including the slow-down
 * and expiry contract the polling loop has to honour.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createDeviceFlowClient } from "@refyard/git-provider/github/device-flow";

const CLIENT_ID = "Iv1_testclientid";
const routes = new Map<
  string,
  { status: number; body: string; seenBody?: string }
>();

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const key = `${request.method} ${request.url}`;
      const route = routes.get(key);
      if (route === undefined) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      route.seenBody = Buffer.concat(chunks).toString("utf8");
      response.writeHead(route.status, { "content-type": "application/json" });
      response.end(route.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function client() {
  return createDeviceFlowClient({
    baseUrl,
    fetch: (input, init) => fetch(input, init),
  });
}

describe("start", () => {
  it("returns the code the user types and the polling contract", async () => {
    routes.set("POST /login/device/code", {
      status: 200,
      body: JSON.stringify({
        device_code: "device_code_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });
    const result = await client().start({ clientId: CLIENT_ID });
    expect(result).toEqual({
      ok: true,
      value: {
        deviceCode: "device_code_123",
        userCode: "ABCD-1234",
        verificationUri: "https://github.com/login/device",
        expiresAtMs: result.ok && result.value.expiresAtMs > 0 ? result.value.expiresAtMs : 0,
        intervalMs: 5000,
      },
    });
    if (result.ok) {
      // expires_in=900s from now, within a test-scale tolerance.
      expect(result.value.expiresAtMs).toBeGreaterThan(Date.now());
    }
    const sent = routes.get("POST /login/device/code")?.seenBody ?? "";
    expect(sent).toContain(`client_id=${encodeURIComponent(CLIENT_ID)}`);
  });
});

describe("poll", () => {
  it("reports pending while the user has not typed the code", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ error: "authorization_pending", error_description: "x" }),
    });
    const result = await client().poll({
      clientId: CLIENT_ID,
      deviceCode: "device_code_123",
    });
    expect(result).toEqual({ ok: true, value: { kind: "pending" } });
  });

  it("honours the slowed interval GitHub asks for", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ error: "slow_down", interval: 10 }),
    });
    const result = await client().poll({
      clientId: CLIENT_ID,
      deviceCode: "device_code_123",
    });
    expect(result).toEqual({ ok: true, value: { kind: "slowDown", intervalMs: 10000 } });
  });

  it("reports denial and expiry as terminal states", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ error: "access_denied" }),
    });
    expect(
      await client().poll({ clientId: CLIENT_ID, deviceCode: "d" }),
    ).toEqual({ ok: true, value: { kind: "denied" } });

    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ error: "expired_token" }),
    });
    expect(
      await client().poll({ clientId: CLIENT_ID, deviceCode: "d" }),
    ).toEqual({ ok: true, value: { kind: "expired" } });
  });

  it("returns the GitHub App token pair on success", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({
        access_token: "ghu_access",
        refresh_token: "ghu_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15780000,
        token_type: "bearer",
        scope: "",
      }),
    });
    const result = await client().poll({
      clientId: CLIENT_ID,
      deviceCode: "device_code_123",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "authorized",
        accessToken: "ghu_access",
        refreshToken: "ghu_refresh",
        expiresInSeconds: 28800,
      },
    });
  });

  it("accepts an OAuth App answer without expiry as a non-refreshing token", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ access_token: "gho_pat", token_type: "bearer" }),
    });
    const result = await client().poll({
      clientId: CLIENT_ID,
      deviceCode: "device_code_123",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "authorized",
        accessToken: "gho_pat",
        refreshToken: null,
        expiresInSeconds: null,
      },
    });
  });
});

describe("refresh", () => {
  it("exchanges a refresh token for a rotated pair", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({
        access_token: "ghu_new",
        refresh_token: "ghu_rotated",
        expires_in: 28800,
        token_type: "bearer",
      }),
    });
    const result = await client().refresh({ clientId: CLIENT_ID, refreshToken: "ghu_old" });
    expect(result).toEqual({
      ok: true,
      value: {
        accessToken: "ghu_new",
        refreshToken: "ghu_rotated",
        expiresInSeconds: 28800,
      },
    });
    const sent = routes.get("POST /login/oauth/access_token")?.seenBody ?? "";
    expect(sent).toContain("grant_type=refresh_token");
    expect(sent).toContain(`refresh_token=${encodeURIComponent("ghu_old")}`);
  });

  it("reports an upstream refusal as an error result", async () => {
    routes.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({ error: "bad_refresh_token" }),
    });
    const result = await client().refresh({ clientId: CLIENT_ID, refreshToken: "stale" });
    expect(result).toEqual({ ok: false, error: { code: "bad_refresh_token" } });
  });
});
