/**
 * Contract tests: the provider axis (forge connections, read-only).
 *
 * The provider surface is configuration plus a bounded read, not a Git
 * operation, so it is modeled like the management API: dedicated schemas, a
 * dedicated scope, and DTOs that never carry a credential. These tests pin the
 * shapes a browser may see and the failure codes a UI branches on.
 */
import { describe, expect, it } from "vitest";
import {
  CONTRACT_SCHEMAS,
  PROBLEM_CODES,
  RUNTIME_LIMITS,
  capabilitiesResponseSchema,
  connectProviderRequestSchema,
  disconnectProviderRequestSchema,
  providerConnectionsResponseSchema,
  providerIdSchema,
  providerPullRequestSchema,
  providerPullRequestsResponseSchema,
} from "@refyard/git-contract";

const VALID_PR = {
  number: 42,
  title: "Add provider panel",
  authorLogin: "octocat",
  authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  headRef: "feature/provider",
  baseRef: "main",
  isDraft: false,
  url: "https://github.com/drizzle-team/drizzle-orm/pull/42",
  updatedAt: "2026-09-22T10:00:00.000Z",
};

describe("provider identity", () => {
  it("accepts github in P1", () => {
    expect(providerIdSchema.parse("github")).toBe("github");
  });

  it("refuses providers this build does not integrate", () => {
    // A typo'd or future provider name must not silently match a connection
    // that does not exist; the enum grows with real integrations only.
    expect(providerIdSchema.safeParse("gitlab").success).toBe(false);
    expect(providerIdSchema.safeParse("").success).toBe(false);
  });
});

describe("connectProviderRequestSchema", () => {
  it("accepts a github token", () => {
    const parsed = connectProviderRequestSchema.parse({
      provider: "github",
      token: "github_pat_11AAAAAAA0aaaaaaaaaaaaaaaaaaaa",
    });
    expect(parsed.provider).toBe("github");
  });

  it("refuses a token too short to be real", () => {
    // A truncated paste would fail upstream anyway; refusing here keeps the
    // failure local and stops a one-character token ever reaching storage.
    expect(
      connectProviderRequestSchema.safeParse({
        provider: "github",
        token: "short",
      }).success,
    ).toBe(false);
  });

  it("refuses unknown keys so a token cannot hide in an extra field", () => {
    expect(
      connectProviderRequestSchema.safeParse({
        provider: "github",
        token: "ghp_" + "a".repeat(36),
        scopes: ["repo"],
      }).success,
    ).toBe(false);
  });
});

describe("disconnectProviderRequestSchema", () => {
  it("accepts a provider name", () => {
    expect(
      disconnectProviderRequestSchema.parse({ provider: "github" }).provider,
    ).toBe("github");
  });

  it("refuses an unknown provider", () => {
    expect(
      disconnectProviderRequestSchema.safeParse({ provider: "azure" }).success,
    ).toBe(false);
  });
});

describe("providerConnectionsResponseSchema", () => {
  it("round-trips a connection without ever carrying the token", () => {
    const response = providerConnectionsResponseSchema.parse({
      connections: [
        {
          provider: "github",
          accountLogin: "octocat",
          accountType: "User",
          scopes: ["repo:read"],
          connectedAt: "2026-09-22T09:00:00.000Z",
        },
      ],
    });
    expect(response.connections).toHaveLength(1);
    // The DTO shape has no token field at all; this is structural, not a filter.
    expect(
      response.connections.map((connection) => Object.keys(connection).sort()),
    ).toEqual([["accountLogin", "accountType", "connectedAt", "provider", "scopes"]]);
  });

  it("rejects a connection entry with an unknown key", () => {
    expect(
      providerConnectionsResponseSchema.safeParse({
        connections: [
          {
            provider: "github",
            accountLogin: "octocat",
            accountType: "User",
            scopes: [],
            connectedAt: "2026-09-22T09:00:00.000Z",
            token: "leaked",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("providerPullRequestsResponseSchema", () => {
  it("round-trips a page of pull requests", () => {
    const response = providerPullRequestsResponseSchema.parse({
      repository: { provider: "github", owner: "drizzle-team", repo: "drizzle-orm" },
      source: "upstream",
      cachedAt: null,
      pullRequests: [VALID_PR],
    });
    expect(
      response.pullRequests.map((pullRequest) => pullRequest.number),
    ).toEqual([42]);
    expect(response.source).toBe("upstream");
  });

  it("accepts a cached page and pins its age field", () => {
    const response = providerPullRequestsResponseSchema.parse({
      repository: { provider: "github", owner: "o", repo: "r" },
      source: "cache",
      cachedAt: "2026-09-22T09:30:00.000Z",
      pullRequests: [],
    });
    expect(response.cachedAt).toBe("2026-09-22T09:30:00.000Z");
  });

  it("refuses a pull request with a non-github url", () => {
    // Every url in this DTO is built by our own client from a github remote;
    // anything else in the field means the parser or the API mapping broke.
    expect(
      providerPullRequestSchema.safeParse({
        ...VALID_PR,
        url: "https://evil.example/octocat/repo/pull/42",
      }).success,
    ).toBe(false);
  });

  it("refuses a pull request with an unknown key", () => {
    expect(
      providerPullRequestSchema.safeParse({ ...VALID_PR, body: "x" }).success,
    ).toBe(false);
  });
});

describe("capabilitiesResponseSchema", () => {
  const base = {
    apiMajor: 1,
    contractVersion: "1.2.0",
    serviceInstanceId: "srvc_aaaaaaaaaaaaaaaa",
    host: { kind: "node", version: "26.8.2" },
    git: {
      executableDisplay: "/usr/bin/git",
      version: "2.50.0",
      features: {
        porcelainV2Status: true,
        worktreeListZ: true,
        catFileBatch: true,
        pushPorcelain: true,
        fetchPorcelain: true,
        objectFormats: ["sha1"],
      },
    },
    reads: ["capabilities"],
    operations: [],
    limits: RUNTIME_LIMITS,
    unavailable: [],
  };

  it("tolerates the absence of providers (older or native hosts)", () => {
    expect(capabilitiesResponseSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an explicit provider list", () => {
    const parsed = capabilitiesResponseSchema.parse({
      ...base,
      providers: ["github"],
    });
    expect(parsed.providers).toEqual(["github"]);
  });
});

describe("problem codes", () => {
  it("names the four provider failures a UI branches on", () => {
    // Connect prompt, panel degradation, reconnect prompt, backoff — each is a
    // distinct state, so each has a distinct code rather than message parsing.
    for (const code of [
      "ProviderNotConnected",
      "NoProviderRemote",
      "ProviderUnauthorized",
      "ProviderRateLimited",
    ]) {
      expect(PROBLEM_CODES).toContain(code);
    }
  });
});

describe("registry", () => {
  it("registers the provider schemas by name", () => {
    for (const name of [
      "ProviderId",
      "ProviderConnection",
      "ProviderConnectionsResponse",
      "ConnectProviderRequest",
      "DisconnectProviderRequest",
      "ProviderPullRequest",
      "ProviderPullRequestsResponse",
    ]) {
      expect(CONTRACT_SCHEMAS[name], name).toBeDefined();
    }
  });
});
