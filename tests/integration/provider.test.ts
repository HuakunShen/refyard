/**
 * The provider surface over real HTTP: connect, status, pull requests.
 *
 * The service runs exactly as the CLI runs it; the only substitute is the
 * upstream, which is a local stub standing in for api.github.com. Everything
 * else — the store, the scope, the route, the cache, the remote resolution —
 * is the production path. The security assertions at the end are the point of
 * the whole feature: the token is validated before storage, stored privately,
 * and never appears in any response.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";
import { startGitHubStub, type GitHubStub } from "../support/github-stub.js";

const TOKEN = "github_pat_11TESTTOKEN000000000000000";

const USER_OK = JSON.stringify({ login: "octocat", type: "User" });
const PULLS_EMPTY = "[]";

function pullsBody(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_unused, index) => ({
      number: index + 1,
      title: `PR ${index + 1}`,
      user: {
        login: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
      },
      head: { ref: "feature/provider" },
      base: { ref: "main" },
      draft: false,
      html_url: `https://github.com/octocat/Hello-World/pull/${index + 1}`,
      updated_at: "2026-09-22T10:00:00Z",
    })),
  );
}

describe("provider integration", () => {
  let repo: GitFixtureRepo;
  let service: TestService;
  let stub: GitHubStub;
  /** Paired once per test; the same bearer the page would hold. */
  const token = async (): Promise<string> => service.pair();

  beforeEach(async () => {
    stub = await startGitHubStub();
    repo = await createRepo({ initialCommit: true });
    await repo.git(["remote", "add", "origin", "https://github.com/octocat/Hello-World.git"]);
    service = await startTestService({
      repo,
      providerGithubBaseUrl: stub.baseUrl,
      providerGithubLoginBaseUrl: stub.baseUrl,
    });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
    await stub.close();
  });

  it("connects a valid token and reports the account", async () => {
    stub.set("GET /user", { status: 200, headers: { "x-oauth-scopes": "repo:read" }, body: USER_OK });
    const response = await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { connections: Array<{ accountLogin: string; scopes: string[] }> };
    expect(body.connections.map((entry) => entry.accountLogin)).toEqual(["octocat"]);
    expect(body.connections[0]?.scopes).toEqual(["repo:read"]);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("refuses a rejected token and stores nothing", async () => {
    stub.set("GET /user", { status: 401, body: JSON.stringify({ message: "Bad credentials" }) });
    const response = await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("ProviderUnauthorized");
    // Nothing was stored: a status read shows no connection at all.
    const status = await service.fetch("/api/v1/provider/connection", {
      token: await token(),
    });
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as { connections: unknown[] };
    expect(statusBody.connections).toEqual([]);
  });

  it("serves pull requests upstream first, then from the cache", async () => {
    stub.set("GET /user", { status: 200, body: USER_OK });
    stub.set(
      "GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1",
      { status: 200, body: pullsBody(3) },
    );
    await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });

    const first = await service.fetch(
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
      { token: await token() },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      source: string;
      cachedAt: string | null;
      repository: { owner: string; repo: string };
      pullRequests: Array<{ number: number; url: string }>;
    };
    expect(firstBody.source).toBe("upstream");
    expect(firstBody.cachedAt).toBeNull();
    expect(firstBody.repository).toEqual({ provider: "github", owner: "octocat", repo: "Hello-World" });
    expect(firstBody.pullRequests.map((entry) => entry.number)).toEqual([1, 2, 3]);

    // The stub goes dark: the second read is served from the cache and labeled as such.
    stub.clear();
    const second = await service.fetch(
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
      { token: await token() },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { source: string; cachedAt: string | null };
    expect(secondBody.source).toBe("cache");
    expect(secondBody.cachedAt).not.toBeNull();
  });

  it("answers ProviderNotConnected before any upstream call", async () => {
    stub.set(
      "GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1",
      { status: 200, body: pullsBody(1) },
    );
    const response = await service.fetch(
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
      { token: await token() },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("ProviderNotConnected");
    expect(stub.requests.some((request) => request.url.includes("/pulls"))).toBe(false);
  });

  it("answers NoProviderRemote for a repository without a GitHub remote", async () => {
    await repo.git(["remote", "remove", "origin"]);
    stub.set("GET /user", { status: 200, body: USER_OK });
    await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    const response = await service.fetch(
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
      { token: await token() },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("NoProviderRemote");
  });

  it("prefers origin when a second GitHub remote exists", async () => {
    await repo.git(["remote", "add", "fork", "https://github.com/forker/Hello-World.git"]);
    stub.set("GET /user", { status: 200, body: USER_OK });
    stub.set(
      "GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1",
      { status: 200, body: PULLS_EMPTY },
    );
    await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    const response = await service.fetch(
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
      { token: await token() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { repository: { owner: string } };
    expect(body.repository.owner).toBe("octocat");
  });

  it("refuses the connect route without the provider:manage scope", async () => {
    // A second, least-privilege service: the same repository, but the session
    // was never granted the provider scope.
    const limited = await startTestService({
      repo,
      providerGithubBaseUrl: stub.baseUrl,
      scopes: [
        "repository:read",
        "repository:write",
        "repository:network",
        "workspace:manage",
      ],
    });
    try {
      const response = await limited.fetch("/api/v1/provider/github/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        token: await limited.pair(),
        body: JSON.stringify({ provider: "github", token: TOKEN }),
      });
      expect(response.status).toBe(403);
      const body = (await response.json()) as { problem: { code: string } };
      expect(body.problem.code).toBe("Forbidden");
      // The status read needs the same scope, for the same reason.
      const status = await limited.fetch("/api/v1/provider/connection", {
        token: await limited.pair(),
      });
      expect(status.status).toBe(403);
    } finally {
      await limited.close();
    }
  });

  it("disconnects and then reports no connection again", async () => {
    stub.set("GET /user", { status: 200, body: USER_OK });
    await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    const response = await service.fetch("/api/v1/provider/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { connections: unknown[] };
    expect(body.connections).toEqual([]);
  });

  it("never writes the token into any response, including errors", async () => {
    stub.set("GET /user", { status: 200, body: USER_OK });
    stub.set(
      "GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1",
      { status: 401, body: JSON.stringify({ message: "Bad credentials" }) },
    );
    await service.fetch("/api/v1/provider/github/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github", token: TOKEN }),
    });
    const paths = [
      "/api/v1/capabilities",
      "/api/v1/provider/connection",
      `/api/v1/provider/pull-requests?repositoryId=${service.repositoryId}`,
    ];
    for (const path of paths) {
      const response = await service.fetch(path, { token: await token() });
      const text = await response.text();
      expect(text.includes(TOKEN), path).toBe(false);
    }
    // The upstream saw the token only in the Authorization header.
    const pullsCall = stub.requests.find((request) => request.url.includes("/pulls"));
    expect(pullsCall?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("reports the provider module in capabilities", async () => {
    const response = await service.fetch("/api/v1/capabilities", {
      token: await token(),
    });
    const body = (await response.json()) as { providers?: string[] };
    expect(body.providers).toEqual(["github"]);
  });
});

describe("provider device flow over HTTP", () => {
  let repo: GitFixtureRepo;
  let service: TestService;
  let stub: GitHubStub;

  beforeEach(async () => {
    stub = await startGitHubStub();
    repo = await createRepo({ initialCommit: true });
    await repo.git([
      "remote",
      "add",
      "origin",
      "https://github.com/octocat/Hello-World.git",
    ]);
    service = await startTestService({
      repo,
      providerGithubBaseUrl: stub.baseUrl,
      providerGithubLoginBaseUrl: stub.baseUrl,
    });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
    await stub.close();
  });

  const token = async (): Promise<string> => service.pair();

  it("hands the user code to the browser and completes on GitHub's answer", async () => {
    // The stub's interval of 0 makes the host's background poll fire at once,
    // which is how this test observes the whole exchange without waiting on
    // real timers in the common path.
    stub.set("POST /login/device/code", {
      status: 200,
      body: JSON.stringify({
        device_code: "device_code_123",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 0,
      }),
    });
    stub.set("POST /login/oauth/access_token", {
      status: 200,
      body: JSON.stringify({
        access_token: "ghu_live_access_token_000000000000001",
        refresh_token: "ghu_live_refresh_token_0000000000001",
        expires_in: 28800,
        token_type: "bearer",
      }),
    });
    // The /user identity validation rides on the REST stub.
    stub.set("GET /user", { status: 200, body: JSON.stringify({ login: "octocat", type: "User" }) });

    const started = await service.fetch("/api/v1/provider/github/device/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token: await token(),
      body: JSON.stringify({ provider: "github" }),
    });
    expect(started.status).toBe(200);
    const startBody = (await started.json()) as {
      userCode: string;
      verificationUri: string;
    };
    expect(startBody.userCode).toBe("ABCD-1234");
    expect(startBody.verificationUri).toBe("https://github.com/login/device");

    // The host's own poll completes the exchange; the connection read is the
    // observable result. The access token must never ride on any response.
    await expect
      .poll(
        async () => {
          const response = await service.fetch("/api/v1/provider/connection", {
            token: await token(),
          });
          const body = (await response.json()) as {
            connections: Array<{ authMethod: string }>;
          };
          return body.connections.map((connection) => connection.authMethod).join();
        },
        { timeout: 5_000 },
      )
      .toBe("oauth");
    const response = await service.fetch("/api/v1/provider/connection", {
      token: await token(),
    });
    const body = (await response.json()) as { connections: Array<{ tokenExpiresAt: string | null }> };
    expect(body.connections.map((connection) => connection.tokenExpiresAt !== null)).toEqual([true]);
    expect(JSON.stringify(body)).not.toContain("ghu_live_access_token_000000000000001");
    expect(JSON.stringify(body)).not.toContain("ghu_live_refresh_token_0000000000001");
  });

  it("keeps the device status gated behind provider:manage", async () => {
    const limited = await startTestService({
      repo,
      providerGithubBaseUrl: stub.baseUrl,
      scopes: ["repository:read", "repository:write", "repository:network", "workspace:manage"],
    });
    try {
      const response = await limited.fetch("/api/v1/provider/device/status?provider=github", {
        token: await limited.pair(),
      });
      expect(response.status).toBe(403);
    } finally {
      await limited.close();
    }
  });
});
