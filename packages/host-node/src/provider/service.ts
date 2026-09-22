/**
 * The provider service: forge connection management plus the one provider read.
 *
 * Pull requests are a *repository-scoped* read whose coordinates the host
 * derives itself: the request names a repository this host already approved,
 * the host reads that repository's remotes through its own Git engine, and the
 * forge owner/repo comes from parsing the raw remote URL. The browser never
 * names a provider repository — it cannot use a validated token to read a
 * project the workbench does not have.
 *
 * Responses are served through a short TTL cache because a provider call is
 * the only read here that leaves the machine; the age is part of the response,
 * so a UI can never mistake cached data for fresh. Every failure throws a
 * ReadProblem with a provider code the UI branches on.
 */
import { LIMITS, providerPullRequestsResponseSchema } from "@refyard/git-contract";
import type {
  ConnectProviderRequest,
  DisconnectProviderRequest,
  ProblemCode,
  ProviderConnection,
  ProviderConnectionsResponse,
  ProviderDeviceStatusResponse,
  ProviderId,
  ProviderPullRequestsResponse,
} from "@refyard/git-contract";
import { providerRepoFromRemote } from "@refyard/git-provider/remotes";
import type { ForgeAdapter, ForgeError } from "@refyard/git-provider/adapter";
import { readRefFacts, type GitEngine } from "@refyard/git-core";
import type { RepositoryRegistry } from "../registry/repositories.js";
import { ReadProblem } from "../coordinator/reads.js";
import type { ProviderManager } from "./manager.js";

const DEFAULT_CACHE_TTL_MS = 60_000;

export interface ProviderServiceOptions {
  readonly manager: ProviderManager;
  readonly engine: GitEngine;
  readonly repositories: RepositoryRegistry;
  readonly adapter: ForgeAdapter;
  readonly now?: () => number;
  readonly cacheTtlMs?: number;
}

export type ConnectResult =
  | { readonly ok: true; readonly connection: ProviderConnection }
  | {
      readonly ok: false;
      readonly code: ProblemCode;
      readonly message: string;
      readonly retryable: boolean;
    };

export type DeviceStartResult =
  | {
      readonly ok: true;
      readonly userCode: string;
      readonly verificationUri: string;
    }
  | { readonly ok: false; readonly message: string };

export interface ProviderService {
  status(): ProviderConnectionsResponse;
  connect(input: ConnectProviderRequest): Promise<ConnectResult>;
  disconnect(input: DisconnectProviderRequest): Promise<void>;
  /** Begin the device-flow exchange; the browser shows the returned code. */
  deviceStart(provider: string): Promise<DeviceStartResult>;
  /** One snapshot of the device exchange, for the panel's polling. */
  deviceStatus(provider: string): ProviderDeviceStatusResponse;
  pullRequests(input: {
    readonly repositoryId: string;
  }): Promise<ProviderPullRequestsResponse>;
}

export function createProviderService(
  options: ProviderServiceOptions,
): ProviderService {
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  interface CacheEntry {
    readonly atMs: number;
    readonly value: ProviderPullRequestsResponse;
  }
  const cache = new Map<string, CacheEntry>();

  return {
    status(): ProviderConnectionsResponse {
      return options.manager.status();
    },

    async connect(input) {
      const outcome = await options.manager.connect(input);
      if (!outcome.ok) {
        return outcome;
      }
      // A reconnect changes the account: cached data may now describe another
      // repository's view, and keeping it would be stale in the worst way.
      cache.clear();
      return { ok: true, connection: outcome.connection };
    },

    async disconnect(input): Promise<void> {
      await options.manager.disconnect(input);
      cache.clear();
    },

    async deviceStart(provider): Promise<DeviceStartResult> {
      const started = await options.manager.beginDeviceConnect({
        provider: provider as ProviderId,
      });
      if (!started.ok) {
        return { ok: false, message: started.message };
      }
      return {
        ok: true,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
      };
    },

    deviceStatus(provider): ProviderDeviceStatusResponse {
      void provider;
      const state = options.manager.deviceConnectState();
      switch (state.state) {
        case "awaiting-user":
          return {
            state: "awaiting-user",
            userCode: state.userCode,
            verificationUri: state.verificationUri,
          };
        case "connected":
          return { state: "connected" };
        case "denied":
          return { state: "denied" };
        case "expired":
          return { state: "expired" };
        case "failed":
          return { state: "failed", message: state.message };
        default:
          return { state: "idle" };
      }
    },

    async pullRequests({ repositoryId }) {
      const cached = cache.get(repositoryId);
      if (cached !== undefined && now() - cached.atMs < ttl) {
        return { ...cached.value, source: "cache", cachedAt: isoOf(cached.atMs) };
      }

      const connection = options.manager.status().connections.find(
        (entry) => entry.provider === "github",
      );
      if (connection === undefined) {
        throw new ReadProblem({
          code: "ProviderNotConnected",
          message:
            "this service is not connected to GitHub; connect an account to see pull requests",
        });
      }
      const token = await options.manager.validToken("github");
      if (token === null) {
        throw new ReadProblem({
          code: "ProviderNotConnected",
          message: "this service is not connected to GitHub; connect an account to see pull requests",
        });
      }

      const { githubRemote } = await resolveGithubRemote(
        options.engine,
        options.repositories,
        repositoryId,
      );
      if (githubRemote === null) {
        throw new ReadProblem({
          code: "NoProviderRemote",
          message:
            "no remote of this repository points at GitHub, so there is nothing to ask",
        });
      }

      const credential = await options.manager.validToken("github");
      if (credential === null) {
        throw new ReadProblem({
          code: "ProviderUnauthorized",
          message:
            "the stored credential stopped working; reconnect the account to keep seeing pull requests",
        });
      }
      const listed = await options.adapter.listPullRequests(
        credential,
        { owner: githubRemote.owner, repo: githubRemote.repo },
        LIMITS.providerPullRequestsMaxEntries,
      );
      if (!listed.ok) {
        throw problemForForgeError(listed.error);
      }

      let response: ProviderPullRequestsResponse;
      try {
        // The boundary check: the mapping above must produce exactly the DTO
        // the contract publishes, or the read fails rather than returning a
        // near-miss shape.
        response = providerPullRequestsResponseSchema.parse({
          repository: {
            provider: "github",
            owner: githubRemote.owner,
            repo: githubRemote.repo,
          },
          source: "upstream",
          cachedAt: null,
          pullRequests: listed.value,
        });
      } catch {
        throw new ReadProblem({
          code: "Unavailable",
          message: "GitHub's pull-request data was not understood; nothing is shown",
          retryable: true,
        });
      }
      cache.set(repositoryId, { atMs: now(), value: response });
      return response;
    },
  };

  function isoOf(atMs: number): string {
    return new Date(atMs).toISOString();
  }
}

function problemForForgeError(error: ForgeError): ReadProblem {
  switch (error.kind) {
    case "unauthorized":
      return new ReadProblem({
        code: "ProviderUnauthorized",
        message:
          "GitHub rejected the stored token; reconnect the account to keep seeing pull requests",
      });
    case "rateLimited":
      return new ReadProblem({
        code: "ProviderRateLimited",
        message:
          error.retryAfterSeconds === null || error.retryAfterSeconds === undefined
            ? "GitHub rate-limited this request; try again later"
            : `GitHub rate-limited this request; retry after about ${error.retryAfterSeconds}s`,
        retryable: true,
      });
    case "network":
      return new ReadProblem({
        code: "Unavailable",
        message: `the forge could not be reached (${error.reason})`,
        retryable: true,
      });
    case "malformed":
      return new ReadProblem({
        code: "Unavailable",
        message: "GitHub's answer was not understood",
        retryable: true,
      });
    case "forbidden":
      return new ReadProblem({
        code: "Unavailable",
        message: "GitHub refused the request",
        retryable: false,
      });
    case "refused":
      return new ReadProblem({
        code: "Unavailable",
        message: `GitHub refused the request (HTTP ${error.status})`,
        retryable: false,
      });
  }
}

/**
 * Resolve a repository id to its primary worktree and the GitHub coordinates
 * of one of its remotes, `origin` first. Raw URLs stay here: only the parsed
 * owner/repo pair is used, and nothing about a remote's credentials is logged.
 */
async function resolveGithubRemote(
  engine: GitEngine,
  repositories: RepositoryRegistry,
  repositoryId: string,
): Promise<{
  readonly githubRemote: { readonly owner: string; readonly repo: string } | null;
}> {
  try {
    // The authority check: an unknown repository id is a NotFound before any
    // worktree lookup, so the two failure messages stay distinct.
    await repositories.require(repositoryId);
  } catch {
    throw new ReadProblem({
      code: "NotFound",
      message: "that request names a repository this service does not know",
    });
  }
  let worktree;
  try {
    worktree = await repositories.worktree(repositoryId, null);
  } catch {
    throw new ReadProblem({
      code: "NotFound",
      message: "that repository has no readable worktree; reload and retry",
    });
  }
  if (worktree.handle === null) {
    throw new ReadProblem({
      code: "Forbidden",
      message: `${worktree.displayPath.text} is outside every approved root`,
    });
  }
  let facts;
  try {
    facts = await readRefFacts(engine, { cwdHandle: worktree.handle });
  } catch {
    throw new ReadProblem({
      code: "Unavailable",
      message: "this repository's remotes could not be read",
      retryable: true,
    });
  }
  const ordered = [
    ...facts.remotes.filter((remote) => remote.name === "origin"),
    ...facts.remotes.filter((remote) => remote.name !== "origin"),
  ];
  for (const remote of ordered) {
    const found = providerRepoFromRemote(remote.fetchUrl);
    if (found !== null && found.provider === "github") {
      return { githubRemote: { owner: found.owner, repo: found.repo } };
    }
  }
  return { githubRemote: null };
}
