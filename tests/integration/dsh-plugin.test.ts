/** Exercise the embedded transport and pairing against an isolated repository/state root. */
import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apply } from "../../integrations/dsh/src/host.js";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

describe("Harness embedded workbench transport", () => {
  let repo: GitFixtureRepo;
  let origin: string;
  let handler:
    | ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>)
    | undefined;
  const cleanup: (() => void)[] = [];
  const server = createServer((req, res) => {
    if (handler === undefined) {
      res.writeHead(503);
      res.end();
      return;
    }
    void handler(req, res);
  });
  let previousState: string | undefined;

  beforeAll(async () => {
    repo = await createRepo();
    previousState = process.env["REFYARD_STATE_DIR"];
    process.env["REFYARD_STATE_DIR"] = join(repo.scratchRoot, "plugin-state");
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("no HTTP port");
    origin = `http://127.0.0.1:${address.port}`;
    apply({
      logger: { info() {}, warn() {}, error() {} },
      get: () => ({
        port: address.port,
        register(route) {
          handler = route.handler;
          return () => {
            handler = undefined;
          };
        },
      }),
      on() {},
      effect(install) {
        const dispose = install();
        if (dispose !== undefined) cleanup.push(dispose);
      },
    });
  });

  afterAll(async () => {
    cleanup.reverse().forEach((dispose) => dispose());
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousState === undefined) delete process.env["REFYARD_STATE_DIR"];
    else process.env["REFYARD_STATE_DIR"] = previousState;
    await repo.dispose();
  });

  async function pairing(): Promise<URL> {
    const response = await fetch(
      `${origin}/refyard/?repo=${encodeURIComponent(repo.root)}`,
      { headers: { accept: "text/html" }, redirect: "manual" },
    );
    expect(response.status).toBe(302);
    return new URL(response.headers.get("location") ?? "", origin);
  }

  it("redirects with a same-origin API path rather than the HTTP carrier authority", async () => {
    const url = await pairing();
    expect(url.searchParams.get("api")).toBe("/refyard");
    expect(url.searchParams.get("pair")).toBeTruthy();
  });

  it("redeems through an Origin-stripping carrier without losing ticket/bearer checks", async () => {
    // Electron validates dsh-app Origin then strips it; this request matches that carrier.
    const url = await pairing();
    const ticket = url.searchParams.get("pair");
    const exchange = () =>
      fetch(`${origin}/refyard/api/v1/session/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
    const response = await exchange();
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("token" in result) ||
      typeof result.token !== "string"
    )
      throw new Error("no bearer issued");
    expect(
      (
        await fetch(`${origin}/refyard/api/v1/repositories`, {
          headers: { authorization: `Bearer ${result.token}` },
        })
      ).status,
    ).toBe(200);
    expect((await exchange()).status).toBe(401);
    expect((await fetch(`${origin}/refyard/api/v1/repositories`)).status).toBe(
      401,
    );
  });

  it("refuses foreign/opaque origins, foreign Host, and originless cross-site before mapping", async () => {
    const url = await pairing();
    const body = JSON.stringify({ ticket: url.searchParams.get("pair") });
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { host: "evil.example" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      // A rejected attempt must not consume the ticket or be rewritten as local.
      // Use raw HTTP: Fetch normalises security-sensitive Host/Fetch metadata.
      const status = await new Promise<number>((resolve, reject) => {
        const outgoing = request(
          `${origin}/refyard/api/v1/session/exchange`,
          {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        outgoing.on("error", reject);
        outgoing.end(body);
      });
      expect(status, JSON.stringify(headers)).toBe(403);
    }
    expect(
      (
        await fetch(`${origin}/refyard/api/v1/session/exchange`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body,
        })
      ).status,
    ).toBe(200);
  });
});
