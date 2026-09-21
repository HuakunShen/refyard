/**
 * The GitHub REST client: protocol classification against a local stub.
 *
 * The client is the only place this build talks to a forge API, so its error
 * classes are the vocabulary the UI gets: unauthorized means "reconnect",
 * rateLimited means "later", malformed means "we misread the provider", network
 * means "no answer". A local node:http server stands in for api.github.com so
 * every class is exercised without egress.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createGitHubRestClient } from "@refyard/git-provider/github/rest";

const TOKEN = "github_pat_11TESTTOKEN000000000000000";

/** One stub route table shared by the suite; each test picks its path. */
const stubs = new Map<
  string,
  { status: number; headers?: Record<string, string>; body: string }
>();

let server: http.Server;
let baseUrl = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = `${request.method} ${request.url}`;
    const stub = stubs.get(url);
    if (stub === undefined) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Not Found" }));
      return;
    }
    response.writeHead(stub.status, {
      "content-type": "application/json",
      ...stub.headers,
    });
    response.end(stub.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function clientFor(
  observed: { urls: string[]; headers: Array<Record<string, string | undefined>> } = {
    urls: [],
    headers: [],
  },
) {
  return createGitHubRestClient({
    baseUrl,
    fetch: (input, init) => {
      observed.urls.push(String(input));
      observed.headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return fetch(input, init);
    },
  });
}

const USER_BODY = JSON.stringify({ login: "octocat", type: "User" });

describe("authenticatedUser", () => {
  it("returns the account and sends the required headers", async () => {
    stubs.set("GET /user", { status: 200, body: USER_BODY });
    const observed: { urls: string[]; headers: Array<Record<string, string | undefined>> } = {
      urls: [],
      headers: [],
    };
    const result = await clientFor(observed).authenticatedUser({ token: TOKEN });
    expect(result).toEqual({ ok: true, value: { login: "octocat", type: "User" } });
    expect(observed.urls).toEqual([`${baseUrl}/user`]);
    expect(observed.headers[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(observed.headers[0]?.accept).toContain("application/vnd.github");
    expect(observed.headers[0]?.["x-github-api-version"]).toBe("2022-11-28");
    expect(observed.headers[0]?.["user-agent"]).toMatch(/^refyard\//);
  });

  it("classifies a rejected token as unauthorized", async () => {
    stubs.set("GET /user", { status: 401, body: JSON.stringify({ message: "Bad credentials" }) });
    const result = await clientFor().authenticatedUser({ token: TOKEN });
    expect(result).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("classifies a plain 403 as forbidden", async () => {
    stubs.set("GET /user", {
      status: 403,
      headers: { "x-ratelimit-remaining": "4999" },
      body: JSON.stringify({ message: "Forbidden" }),
    });
    const result = await clientFor().authenticatedUser({ token: TOKEN });
    expect(result).toEqual({ ok: false, error: { kind: "forbidden" } });
  });

  it("classifies an exhausted rate limit with its reset time", async () => {
    stubs.set("GET /user", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" },
      body: JSON.stringify({ message: "API rate limit exceeded" }),
    });
    const result = await clientFor().authenticatedUser({ token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { kind: "rateLimited" } });
    if (result.ok === false && result.error.kind === "rateLimited") {
      expect(result.error.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("classifies another status as refused, with the status number only", async () => {
    stubs.set("GET /user", { status: 502, body: "server exploded" });
    const result = await clientFor().authenticatedUser({ token: TOKEN });
    expect(result).toEqual({ ok: false, error: { kind: "refused", status: 502 } });
  });

  it("classifies an unparseable success body as malformed, not a crash", async () => {
    stubs.set("GET /user", { status: 200, body: "<html>not json</html>" });
    const result = await clientFor().authenticatedUser({ token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { kind: "malformed" } });
  });

  it("classifies an unreachable host as network", async () => {
    const unreachable = createGitHubRestClient({
      baseUrl: "http://127.0.0.1:1",
      fetch: (input, init) => fetch(input, init),
    });
    const result = await unreachable.authenticatedUser({ token: TOKEN });
    expect(result).toMatchObject({ ok: false, error: { kind: "network" } });
  });
});

describe("listOpenPullRequests", () => {
  const pull = (number: number) => ({
    number,
    title: `PR ${number}`,
    user: { login: "octocat", avatar_url: `https://avatars.githubusercontent.com/u/1?v=${number}` },
    head: { ref: "feature/provider" },
    base: { ref: "main" },
    draft: false,
    html_url: `https://github.com/octocat/Hello-World/pull/${number}`,
    updated_at: "2026-09-22T10:00:00Z",
    extra_field_the_dto_strips: true,
  });

  it("maps one page of pull requests to the reduced shape", async () => {
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1", {
      status: 200,
      body: JSON.stringify([pull(1), pull(2)]),
    });
    const observed: { urls: string[]; headers: Array<Record<string, string | undefined>> } = {
      urls: [],
      headers: [],
    };
    const result = await clientFor(observed).listOpenPullRequests({
      token: TOKEN,
      owner: "octocat",
      repo: "Hello-World",
      maxEntries: 100,
    });
    if (result.ok === false) {
      throw new Error(`expected pulls, got ${JSON.stringify(result.error)}`);
    }
    expect(result.value.map((entry) => entry.number)).toEqual([1, 2]);
    expect(result.value.map((entry) => entry.headRef)).toEqual([
      "feature/provider",
      "feature/provider",
    ]);
    expect(result.value.map((entry) => entry.baseRef)).toEqual(["main", "main"]);
    expect(result.value.map((entry) => entry.authorLogin)).toEqual([
      "octocat",
      "octocat",
    ]);
    expect(result.value.map((entry) => entry.isDraft)).toEqual([false, false]);
    expect(JSON.stringify(result.value)).not.toContain("extra_field");
    // One page sufficed: the client must not ask for a second page it cannot fill.
    expect(observed.urls).toHaveLength(1);
    expect(observed.urls[0]).toContain("state=open");
    expect(observed.urls[0]).toContain("per_page=100");
  });

  it("follows pages until a short page or the entry cap", async () => {
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=2&page=1", {
      status: 200,
      body: JSON.stringify([pull(1), pull(2)]),
    });
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=2&page=2", {
      status: 200,
      body: JSON.stringify([pull(3)]),
    });
    const result = await clientFor().listOpenPullRequests({
      token: TOKEN,
      owner: "octocat",
      repo: "Hello-World",
      maxEntries: 100,
      perPage: 2,
    });
    if (result.ok === false) {
      throw new Error(`expected pulls, got ${JSON.stringify(result.error)}`);
    }
    expect(result.value.map((entry) => entry.number)).toEqual([1, 2, 3]);
  });

  it("stops at the entry cap even when pages continue", async () => {
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=2&page=1", {
      status: 200,
      body: JSON.stringify([pull(1), pull(2)]),
    });
    const result = await clientFor().listOpenPullRequests({
      token: TOKEN,
      owner: "octocat",
      repo: "Hello-World",
      maxEntries: 1,
      perPage: 2,
    });
    if (result.ok === false) {
      throw new Error(`expected pulls, got ${JSON.stringify(result.error)}`);
    }
    expect(result.value.map((entry) => entry.number)).toEqual([1]);
  });

  it("propagates the error classes of the underlying call", async () => {
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1", {
      status: 401,
      body: JSON.stringify({ message: "Bad credentials" }),
    });
    const result = await clientFor().listOpenPullRequests({
      token: TOKEN,
      owner: "octocat",
      repo: "Hello-World",
      maxEntries: 100,
    });
    expect(result).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("never puts the token in a URL, only in the Authorization header", async () => {
    stubs.set("GET /repos/octocat/Hello-World/pulls?state=open&per_page=100&page=1", {
      status: 200,
      body: JSON.stringify([]),
    });
    const observed: { urls: string[]; headers: Array<Record<string, string | undefined>> } = {
      urls: [],
      headers: [],
    };
    await clientFor(observed).listOpenPullRequests({
      token: TOKEN,
      owner: "octocat",
      repo: "Hello-World",
      maxEntries: 100,
    });
    for (const url of observed.urls) {
      expect(url).not.toContain(TOKEN);
    }
    expect(observed.headers.every((headers) => headers.authorization === `Bearer ${TOKEN}`)).toBe(
      true,
    );
  });
});
