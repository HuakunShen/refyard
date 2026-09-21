/**
 * Tests for the browser-facing GitService client.
 *
 * The hosted password is a one-exchange input. Keeping this test at the client seam
 * prevents the UI from collecting a password while silently dropping it before HTTP.
 */
import { describe, expect, it } from "vitest";
import { createGitClient } from "@refyard/git-client/client";

describe("GitService session exchange", () => {
  it("sends a hosted password only in the session exchange body", async () => {
    // Prevents: the hosted form showing a password field that never reaches the
    // endpoint, which would leave the user unable to pair despite correct input.
    let request: RequestInit | undefined;
    const client = createGitClient({
      baseUrl: "https://api.example.test",
      fetch: async (_input, init) => {
        request = init;
        return new Response(
          JSON.stringify({
            token: "rfs_test_token",
            expiresAt: "2026-09-16T00:00:00.000Z",
            sessionId: "sess_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.exchangeTicket(
      "ticket-value-that-is-long-enough",
      "hosted-password",
    );

    expect(request?.body).toBe(
      JSON.stringify({
        ticket: "ticket-value-that-is-long-enough",
        password: "hosted-password",
      }),
    );
  });
});

describe("typed history query transport", () => {
  it("encodes literal filters and sends cursor-only continuation", async () => {
    const requests: URL[] = [];
    const client = createGitClient({
      baseUrl: "http://127.0.0.1:9595",
      fetch: async (input) => {
        requests.push(new URL(String(input)));
        return new Response(
          JSON.stringify({
            snapshotId: "snap_test",
            repositoryId: "repo_test",
            readAt: "2026-09-17T00:00:00Z",
            objectFormat: "sha1",
            shallow: false,
            commits: [],
            nextCursor: null,
            tipsMoved: false,
            truncated: false,
            detail: null,
            topology: "sparse",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    await client.history({
      repositoryId: "repo_test",
      message: "fix [auth].* + spaces",
      author: "Alice (Dev)",
      refFullName: "refs/heads/topic",
      committedAfter: "2026-01-01T00:00:00Z",
      committedBefore: "2026-02-01T00:00:00Z",
      pathId: "path_known",
    });
    expect(requests[0]?.searchParams.get("message")).toBe(
      "fix [auth].* + spaces",
    );
    expect(requests[0]?.searchParams.get("author")).toBe("Alice (Dev)");
    expect(requests[0]?.searchParams.get("refFullName")).toBe(
      "refs/heads/topic",
    );
    expect(requests[0]?.searchParams.get("committedAfter")).toBe(
      "2026-01-01T00:00:00Z",
    );
    expect(requests[0]?.searchParams.get("committedBefore")).toBe(
      "2026-02-01T00:00:00Z",
    );
    expect(requests[0]?.searchParams.get("pathId")).toBe("path_known");
    await client.history({
      repositoryId: "repo_test",
      cursor: "cur_known",
      detailOid: "a".repeat(40),
    });
    expect([...requests[1]!.searchParams.keys()]).toEqual([
      "repositoryId",
      "cursor",
      "detailOid",
    ]);
    await client.history({ repositoryId: "repo_test", oidPrefix: "abcd" });
    expect(requests[2]?.searchParams.get("oidPrefix")).toBe("abcd");
  });
});

it("refuses an older history response without explicit topology", async () => {
  // Prevents silently treating an unknown topology contract as a continuous graph.
  const client = createGitClient({
    baseUrl: "http://127.0.0.1:9595",
    fetch: async () =>
      new Response(
        JSON.stringify({
          snapshotId: "snap_test",
          repositoryId: "repo_test",
          readAt: "2026-09-17T00:00:00Z",
          objectFormat: "sha1",
          shallow: false,
          commits: [],
          nextCursor: null,
          tipsMoved: false,
          truncated: false,
          detail: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  await expect(
    client.history({ repositoryId: "repo_test" }),
  ).rejects.toMatchObject({ code: "InternalError" });
});

describe("provider surface transport", () => {
  /** A client over a stub that records what was sent and answers `routes`. */
  function clientFor(
    routes: Readonly<Record<string, unknown>>,
    requests: { path: URL; init?: RequestInit }[],
  ) {
    return createGitClient({
      baseUrl: "http://127.0.0.1:9595",
      fetch: async (input, init) => {
        const url = new URL(String(input));
        requests.push({ path: url, init });
        const route = routes[url.pathname];
        if (route === undefined) {
          return new Response(JSON.stringify({ problem: { code: "NotFound", message: "no route", retryable: false } }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify(route), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      token: () => "rfs_bearer",
    });
  }

  it("sends the token in the connect body, never in a URL", async () => {
    const requests: { path: URL; init?: RequestInit }[] = [];
    const client = clientFor(
      {
        "/api/v1/provider/github/connect": { connections: [] },
      },
      requests,
    );
    const result = await client.connectProvider("github", "github_pat_11TESTTOKEN000000000000000");
    expect(result).toEqual({ connections: [] });
    expect(requests[0]?.path.pathname).toBe("/api/v1/provider/github/connect");
    expect(requests[0]?.path.search).toBe("");
    expect(String(requests[0]?.init?.body)).toContain("github_pat_11TESTTOKEN000000000000000");
    expect(requests[0]?.init?.headers && new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer rfs_bearer",
    );
  });

  it("encodes the pull-request query and validates the response", async () => {
    const requests: { path: URL; init?: RequestInit }[] = [];
    const client = clientFor(
      {
        "/api/v1/provider/pull-requests": {
          repository: { provider: "github", owner: "octocat", repo: "Hello-World" },
          source: "upstream",
          cachedAt: null,
          pullRequests: [],
        },
      },
      requests,
    );
    const result = await client.providerPullRequests("repo_aaaaaaaaaaaaaaaa");
    expect(result.pullRequests).toEqual([]);
    expect(requests[0]?.path.search).toBe("?repositoryId=repo_aaaaaaaaaaaaaaaa");
  });
});
