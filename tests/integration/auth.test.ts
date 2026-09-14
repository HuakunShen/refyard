/**
 * Authentication and origin policy over real HTTP.
 *
 * These are the cases where a wrong implementation is not a bug but a
 * vulnerability, so each test states the attack it prevents:
 *
 * - a page this service was not started for reading a repository listing from
 *   another origin;
 * - a missing `Origin` (curl, an old browser, a malicious page that somehow
 *   suppressed it) being treated as same-origin;
 * - a `null` origin (a sandboxed iframe, a `file://` document) being trusted;
 * - a DNS-rebinding name resolving to loopback and passing the `Host` check;
 * - a pairing ticket being replayed after use, or redeemed from another origin;
 * - an unauthenticated read of any endpoint, including `/api/v1/capabilities`;
 * - a session for one repository reading another.
 */
import { request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  ticketFrom,
  type TestService,
} from "../support/service.js";

describe("authentication", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startTestService({ repo });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
  });

  it("refuses every API read without a bearer token", async () => {
    for (const path of [
      "/api/v1/capabilities",
      "/api/v1/repositories",
      `/api/v1/status?repositoryId=${service.repositoryId}`,
    ]) {
      const response = await service.fetch(path);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { problem: { code: string } };
      expect(body.problem.code).toBe("Unauthenticated");
    }
  });

  it("serves a read once the browser has paired", async () => {
    const token = await service.pair();
    const response = await service.fetch("/api/v1/repositories", { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { repositories: unknown[] };
    expect(body.repositories).toHaveLength(1);
  });

  it("refuses a request from a different origin", async () => {
    // Prevents: any page the user visits reading their repositories from the local
    // service, which is the whole reason a loopback listener still needs auth.
    const token = await service.pair();
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`, {
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://evil.example",
      },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("Forbidden");
  });

  it("still requires a bearer when no Origin header is present", async () => {
    // A document request and a non-browser client both arrive without an Origin.
    // That is not treated as proof of same-origin: the request is answered only if
    // it carries a bearer, so an unauthenticated probe gets nothing.
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`);
    expect(response.status).toBe(401);
  });

  it("answers a same-origin API read that carries a bearer but no Origin", async () => {
    // Prevents the opposite mistake: refusing this would break the SPA itself, whose
    // same-origin GETs carry no Origin header.
    const token = await service.pair();
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
  });

  it("refuses a request the browser marks as cross-site, even without an Origin", async () => {
    // Prevents: a client that suppresses Origin from being trusted on that basis.
    const token = await service.pair();
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`, {
      headers: {
        authorization: `Bearer ${token}`,
        "sec-fetch-site": "cross-site",
      },
    });
    expect(response.status).toBe(403);
  });

  it("serves the app shell to a plain document request", async () => {
    // Prevents: the loopback check being so strict that opening the workbench in a
    // browser is impossible.
    const response = await service.fetch("/");
    expect([200, 404]).toContain(response.status);
    expect(response.status).not.toBe(403);
  });

  it("refuses a null origin", async () => {
    const token = await service.pair();
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`, {
      headers: { authorization: `Bearer ${token}`, origin: "null" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a Host header that is not this service's authority", async () => {
    // Prevents: DNS rebinding, where `attacker.example` resolves to 127.0.0.1 and
    // the page's own fetch is then same-origin from the browser's point of view.
    // `fetch` refuses to send a custom Host header, so this uses a raw request: that
    // is exactly what a rebinding attack looks like on the wire.
    const token = await service.pair();
    const response = await rawRequest({
      port: service.http.port,
      path: "/api/v1/repositories",
      headers: {
        host: "attacker.example",
        origin: `http://127.0.0.1:${service.http.port}`,
        authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a Host header that names a localhost port this service does not own", async () => {
    const token = await service.pair();
    const response = await rawRequest({
      port: service.http.port,
      path: "/api/v1/repositories",
      headers: {
        host: `127.0.0.1:${service.http.port + 1}`,
        origin: `http://127.0.0.1:${service.http.port}`,
        authorization: `Bearer ${token}`,
      },
    });
    expect(response.status).toBe(403);
  });

  it("refuses a pairing ticket a second time", async () => {
    // Prevents: the ticket in the URL being replayed from the browser history.
    const ticket = ticketFrom(service.pairingUrl);
    const origin = `http://127.0.0.1:${service.http.port}`;
    const first = await fetch(`${service.baseUrl}/api/v1/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ ticket }),
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${service.baseUrl}/api/v1/session/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ ticket }),
    });
    expect(second.status).toBe(401);
  });

  it("refuses a ticket presented from a different origin", async () => {
    // Prevents: a leaked URL being redeemed by a page on another origin.
    const ticket = ticketFrom(service.pairingUrl);
    const response = await fetch(`${service.baseUrl}/api/v1/session/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ ticket }),
    });
    expect(response.status).toBe(403);
  });

  it("refuses a ticket that this service never issued", async () => {
    const response = await fetch(`${service.baseUrl}/api/v1/session/exchange`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${service.http.port}`,
      },
      body: JSON.stringify({ ticket: "a".repeat(43) }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a forged bearer token", async () => {
    const response = await service.fetch("/api/v1/repositories", {
      token: "rfs_forged_token_value_that_was_never_issued",
    });
    expect(response.status).toBe(401);
  });

  it("refuses a session that is not a bearer", async () => {
    const token = await service.pair();
    const response = await fetch(`${service.baseUrl}/api/v1/repositories`, {
      headers: {
        authorization: token,
        origin: `http://127.0.0.1:${service.http.port}`,
      },
    });
    expect(response.status).toBe(401);
  });

  it("does not offer CORS to any origin", async () => {
    // Prevents: a wildcard or reflected CORS header turning a browser into a proxy
    // for the local service.
    const token = await service.pair();
    const response = await service.fetch("/api/v1/repositories", { token });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps a ticket and a token out of the log lines", async () => {
    // Prevents: pairing material ending up in a log file that is later shared.
    const token = await service.pair();
    await service.fetch("/api/v1/repositories", { token });
    const ticket = ticketFrom(service.pairingUrl);
    const joined = service.log.join("\n");
    expect(joined).not.toContain(ticket);
    expect(joined).not.toContain(token);
    // The path is logged without its query string, so a credential placed there by
    // a caller still does not reach the log.
    expect(joined).toContain("GET /api/v1/repositories");
  });

  it("reports health without authentication but with no repository information", async () => {
    const response = await service.fetch("/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["alive"]).toBe(true);
    expect(JSON.stringify(body)).not.toContain(service.repositoryId);
  });
});

/** One raw HTTP request, with headers `fetch` refuses to set. */
async function rawRequest(input: {
  readonly port: number;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
}): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: input.port,
        path: input.path,
        method: "GET",
        headers: { ...input.headers },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("authorization and request shape", () => {
  let repo: GitFixtureRepo;
  let service: TestService;
  let token: string;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startTestService({ repo });
    token = await service.pair();
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
  });

  it("refuses a repository this session was not granted", async () => {
    const response = await service.fetch(
      "/api/v1/status?repositoryId=repo_someone_else",
      {
        token,
      },
    );
    expect(response.status).toBe(403);
  });

  it("rejects an unknown query parameter instead of ignoring it", async () => {
    const response = await service.fetch(
      `/api/v1/status?repositoryId=${service.repositoryId}&depth=999`,
      { token },
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("InvalidRequest");
  });

  it("rejects a query value of the wrong type", async () => {
    const response = await service.fetch(
      `/api/v1/history?repositoryId=${service.repositoryId}&limit=lots`,
      { token },
    );
    expect(response.status).toBe(400);
  });

  it("rejects a page size above the contract maximum", async () => {
    const response = await service.fetch(
      `/api/v1/history?repositoryId=${service.repositoryId}&limit=100000`,
      { token },
    );
    expect(response.status).toBe(400);
  });

  it("answers a JSON 404 for an unknown API path, never the SPA", async () => {
    const response = await service.fetch("/api/v1/does-not-exist", { token });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("NotFound");
  });

  it("answers 501 for a path this build does not implement", async () => {
    // Prevents: an unimplemented path being answered with a plausible empty success,
    // which a UI would then render as "nothing to see". (Previews became a real
    // route when mutations arrived; repository registration never did.)
    const response = await service.fetch("/api/v1/repositories/register", { token });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("UnsupportedOperation");
  });

  it("answers 501 for a mutation no effect implements, never a fake 202", async () => {
    // Prevents: the UI believing a repository was created when this build has no
    // code that could run it. (Staging, branches/remotes/network, stash/tags and
    // worktree/submodule operations have effects now; creating a repository and
    // the merge operations still do not.)
    const response = await service.fetch("/api/v1/operations", {
      method: "POST",
      token,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: "req-1",
        target: {
          kind: "workspace",
          allowedRootId: service.allowedRootId,
          relativeDestination: "not-implemented-yet",
        },
        operation: { kind: "initRepository", initialBranch: null },
      }),
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("UnsupportedOperation");
  });

  it("lists operations for this session, which is empty until one runs", async () => {
    // The path is implemented and answers honestly rather than with a 501: an empty
    // list is the truth for a session that has submitted nothing.
    const response = await service.fetch("/api/v1/operations", { token });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { operations: unknown[] };
    expect(body.operations).toEqual([]);
  });

  it("serves the same data over HTTP as the read service produces", async () => {
    await repo.write("a.txt", "changed\n");
    const response = await service.fetch(
      `/api/v1/status?repositoryId=${service.repositoryId}`,
      { token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { displayPath: string; pathId: string }[];
      head: { branchName: string };
    };
    expect(body.head.branchName).toBe("main");
    expect(body.entries[0]?.displayPath).toBe("a.txt");
    expect(body.entries[0]?.pathId.startsWith("path_")).toBe(true);
  });
});
