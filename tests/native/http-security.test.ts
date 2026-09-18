/**
 * The native HTTP gate, driven over the real socket of the real release binary.
 *
 * Each case is one rule the design states: every read authenticated, the Host and Origin
 * compared exactly, a ticket spent once, an unknown API path a JSON 404 and never the
 * SPA, and a session reaching only what it was granted. Requests that need to name their
 * own `Host` header use `node:http`, because `fetch` refuses to set it — the same reason
 * a browser cannot be told what to send, which is why the check exists.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { request } from "node:http";

import { startNativeService, type RunningNativeService } from "./native-server.ts";

let service: RunningNativeService;

beforeAll(async () => {
  service = await startNativeService();
});

afterAll(async () => {
  await service.stop();
});

/** One plain HTTP/1.1 request with full control over Host and Origin. */
function rawRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
  port: number = service.port,
): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (response: IncomingMessage) => {
        let text = "";
        response.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            contentType: String(response.headers["content-type"] ?? ""),
            body: text,
          });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const authority = (): string => `127.0.0.1:${service.port}`;

describe("the native HTTP gate", () => {
  it("answers /health without a session, because it names no repository", async () => {
    const answer = await rawRequest("GET", "/health", { host: authority() });
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.body) as { alive: boolean; serviceInstanceId: string };
    expect(body.alive).toBe(true);
    expect(body.serviceInstanceId).toBe(service.serviceInstanceId);
  });

  // Prevents: a page without a ticket reading anything, including the capability list
  // that describes what else exists.
  it("refuses an unauthenticated read as Unauthenticated", async () => {
    const answer = await rawRequest("GET", "/api/v1/capabilities", { host: authority() });
    expect(answer.status).toBe(401);
    expect(answer.contentType).toContain("application/json");
    const body = JSON.parse(answer.body) as { problem: { code: string } };
    expect(body.problem.code).toBe("Unauthenticated");
  });

  // Prevents: a DNS-rebinding request, whose Host names an attacker's domain and whose
  // page therefore sees the response as same-origin.
  it("refuses a Host that is not this instance's authority", async () => {
    const answer = await rawRequest("GET", "/api/v1/repositories", { host: "attacker.example" });
    expect(answer.status).toBe(403);
    const body = JSON.parse(answer.body) as { problem: { code: string } };
    expect(body.problem.code).toBe("Forbidden");
  });

  // Prevents: a cross-origin page reading the API. Every cross-origin fetch carries an
  // Origin, and an exact comparison is the only rule that cannot be widened by accident.
  it("refuses an Origin that is not this service's own", async () => {
    const answer = await rawRequest("GET", "/api/v1/repositories", {
      host: authority(),
      origin: "https://evil.example",
    });
    expect(answer.status).toBe(403);
    const body = JSON.parse(answer.body) as { problem: { code: string } };
    expect(body.problem.code).toBe("Forbidden");
  });

  it("refuses an opaque (null) origin, as a sandboxed frame reports one", async () => {
    const answer = await rawRequest("GET", "/api/v1/repositories", {
      host: authority(),
      origin: "null",
    });
    expect(answer.status).toBe(403);
  });

  // Prevents: a pairing URL in a browser history minting session after session. This
  // case runs against its own service so no other test's pairing spends its ticket.
  it("pairs a ticket exactly once, and says so when it is spent again", async () => {
    const isolated = await startNativeService();
    try {
      const token = await isolated.pair();
      expect(token.length).toBeGreaterThan(16);

      const spent = await rawRequest("POST", "/api/v1/session/exchange", {
        host: `127.0.0.1:${isolated.port}`,
        origin: isolated.origin,
        "content-type": "application/json",
      }, JSON.stringify({ ticket: isolated.ticket }), isolated.port);
      expect(spent.status).toBe(401);
      const body = JSON.parse(spent.body) as { problem: { code: string } };
      expect(body.problem.code).toBe("Unauthenticated");

      // The session the first exchange produced actually reads.
      const answer = await rawRequest("GET", "/api/v1/repositories", {
        host: `127.0.0.1:${isolated.port}`,
        authorization: `Bearer ${token}`,
      }, undefined, isolated.port);
      expect(answer.status).toBe(200);
    } finally {
      await isolated.stop();
    }
  });

  // Prevents: a broken client request looking alive, or an unauthenticated caller
  // mapping which routes exist by watching status codes differ.
  it("answers an unknown API path with a JSON 404 after authentication, never the SPA", async () => {
    const bearer = await service.pair();
    const answer = await rawRequest("GET", "/api/v1/no-such-read", {
      host: authority(),
      authorization: `Bearer ${bearer}`,
    });
    expect(answer.status).toBe(404);
    expect(answer.contentType).toContain("application/json");
    expect(answer.body).not.toContain("<html");
    const body = JSON.parse(answer.body) as { problem: { code: string; message: string } };
    expect(body.problem.code).toBe("NotFound");
  });

  it("answers OPTIONS with the methods the service has", async () => {
    const answer = await rawRequest("OPTIONS", "/api/v1/repositories", { host: authority() });
    expect(answer.status).toBe(405);
  });

  // Prevents: a session reaching a repository its grants do not cover. The binary was
  // started with the fixture repository approved, so any other id is unreachable.
  it("refuses a repository the session was not granted", async () => {
    const token = await service.pair();
    const answer = await rawRequest("GET", "/api/v1/status?repositoryId=repo_other", {
      host: authority(),
      authorization: `Bearer ${token}`,
    });
    expect(answer.status).toBe(403);
    const body = JSON.parse(answer.body) as { problem: { code: string } };
    expect(body.problem.code).toBe("Forbidden");
  });

  it("refuses a query naming an unknown parameter instead of ignoring it", async () => {
    const token = await service.pair();
    const answer = await rawRequest("GET", "/api/v1/status?repositoryId=repo_1&includeIgnored=true", {
      host: authority(),
      authorization: `Bearer ${token}`,
    });
    // The deployed status schema carries repositoryId and worktreeId only; the
    // reference host rejects `includeIgnored` the same way, and the asymmetry with the
    // browser client is the contract's, not this build's to fix quietly.
    expect(answer.status).toBe(400);
  });
});
