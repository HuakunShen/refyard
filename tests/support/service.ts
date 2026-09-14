/**
 * A running service for tests, wired exactly as the CLI wires it.
 *
 * The point of this helper is that a test exercises the same assembly production
 * uses — real registries, real Git host, real HTTP server on an ephemeral port — so
 * a passing test is evidence about the product rather than about a test-only path.
 *
 * It also shows the pairing dance the browser performs: `pair()` exchanges the
 * ticket from the pairing URL for a bearer, which is what every authenticated
 * request then carries.
 */
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createEventRing,
  createGitHost,
  createHandleRegistry,
  createJournalStore,
  createMutationCoordinator,
  createPathRegistry,
  createPreviewStore,
  createReadService,
  createRecovery,
  createRepositoryRegistry,
  createRootRegistry,
  createSnapshotStore,
  createTextCodec,
  createWorktreeRegistry,
  DEFAULT_RETENTION,
  startHttpHost,
  type EventRing,
  type HttpHost,
  type JournalStore,
  type MutationCoordinator,
  type MutationEffect,
} from "../../packages/host-node/src/index.js";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import { API_MAJOR, CONTRACT_VERSION } from "@refyard/git-contract";
import { fixtureGitPath, type GitFixtureRepo } from "./repo.js";

export interface TestService {
  readonly http: HttpHost;
  readonly baseUrl: string;
  readonly instanceId: string;
  readonly repositoryId: string;
  readonly allowedRootId: string;
  /** The mutation engine, wired exactly as the CLI wires it. */
  readonly mutations: MutationCoordinator;
  readonly journal: JournalStore;
  readonly events: EventRing;
  /** The private state root this service's journal lives in. */
  readonly stateRoot: string;
  /** The pairing URL a browser would be sent to, ticket included in the fragment. */
  readonly pairingUrl: string;
  /** Exchange the ticket for a bearer token; returns the token. */
  pair(): Promise<string>;
  /** Fetch with a bearer already attached. */
  fetch(
    path: string,
    init?: RequestInit & { readonly token?: string },
  ): Promise<Response>;
  readonly log: readonly string[];
  close(): Promise<void>;
}

export interface StartTestServiceOptions {
  readonly repo: GitFixtureRepo;
  /**
   * Reuse a state root, which is how a restart test sees the previous journal.
   */
  readonly stateRoot?: string;
  /** Effects this test host can run; empty means every mutation is unimplemented. */
  readonly effects?: readonly MutationEffect[];
  /** Extra web assets to serve, for the static-file cases. */
  readonly webRoot?: string | null;
  readonly inlineDocument?: string;
  readonly limits?: { readonly maxBodyBytes?: number };
  /** Grant this session access to a repository id it will otherwise not own. */
  readonly extraRepositoryIds?: readonly string[];
}

export async function startTestService(
  options: StartTestServiceOptions,
): Promise<TestService> {
  const repositoryPath = await realpath(options.repo.root);
  const codec = createTextCodec();
  const handles = createHandleRegistry();
  const roots = createRootRegistry({ handles, codec });
  let counter = 0;
  const paths = createPathRegistry({
    codec,
    nextPathId: () => `path_${(counter += 1).toString(36)}`,
  });
  const worktrees = createWorktreeRegistry({
    codec,
    handles,
    nextWorktreeId: () => `wt_${(counter += 1).toString(36)}`,
  });
  const host = createGitHost({
    gitPath: fixtureGitPath(),
    registry: handles,
    env: Object.fromEntries(
      Object.entries(options.repo.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  const engine: GitEngine = createHostEngine(host, { runIdPrefix: "test" });
  const repositories = createRepositoryRegistry({
    roots,
    worktrees,
    codec,
    engine,
    nextRepositoryId: () => `repo_${(counter += 1).toString(36)}`,
  });
  const snapshots = createSnapshotStore({
    nextSnapshotId: () => `snap_${(counter += 1).toString(36)}`,
  });
  const previews = createPreviewStore();
  const root = await roots.approve({
    path: repositoryPath,
    executionTrusted: true,
  });
  const record = await repositories.register({
    allowedRootId: root.allowedRootId,
    relativePath: "",
    handles,
  });

  const serviceInstanceId = `srvc_${(counter += 1).toString(36)}`;
  const stateRoot =
    options.stateRoot ?? (await mkdtemp(join(tmpdir(), "refyard-state-")));
  const journal = createJournalStore({
    stateRoot,
    retention: DEFAULT_RETENTION,
  });
  await journal.load();
  const recovery = createRecovery({ journal });
  await recovery.run();
  const events = createEventRing();
  let sequence = 0;
  const read = createReadService({
    engine,
    roots,
    repositories,
    worktrees,
    paths,
    snapshots,
    previews,
    codec,
    serviceInstanceId,
    apiMajor: API_MAJOR,
    contractVersion: CONTRACT_VERSION,
    gitPath: fixtureGitPath(),
    gitVersion: "2.50.1",
    gitFeatures: {
      porcelainV2Status: true,
      worktreeListZ: true,
      catFileBatch: true,
      pushPorcelain: true,
      fetchPorcelain: true,
      objectFormats: ["sha1", "sha256"],
    },
    unavailable: [],
    reads: [
      "capabilities",
      "repositories",
      "status",
      "history",
      "refs",
      "diff",
      "worktrees",
      "submodules",
      "stashes",
    ],
    operations: [],
  });

  const mutations = createMutationCoordinator({
    journal,
    repositories,
    worktrees,
    engine,
    recovery,
    snapshots,
    events,
    effects: options.effects ?? [],
    nextOperationId: () => `op_${(counter += 1).toString(36)}`,
    nextSequence: () => (sequence += 1),
  });

  const log: string[] = [];
  let sessionToken: string | null = null;
  const http = await startHttpHost({
    read,
    mutations,
    events,
    serviceInstanceId,
    port: 0,
    webRoot: options.webRoot ?? null,
    ...(options.inlineDocument === undefined
      ? {}
      : { inlineDocument: options.inlineDocument }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    grants: {
      allowedRootIds: [root.allowedRootId],
      repositoryIds: [
        record.repositoryId,
        ...(options.extraRepositoryIds ?? []),
      ],
      scopes: ["repository:read"],
    },
    log: (line) => {
      log.push(line);
    },
  });

  const pairingUrl = http.pairingUrl(`http://127.0.0.1:${http.port}`);
  const baseUrl = `http://127.0.0.1:${http.port}`;
  const origin = `http://127.0.0.1:${http.port}`;

  return {
    http,
    baseUrl,
    instanceId: http.serviceInstanceId,
    repositoryId: record.repositoryId,
    allowedRootId: root.allowedRootId,
    mutations,
    journal,
    events,
    stateRoot,
    pairingUrl,
    log,
    async pair(): Promise<string> {
      // A ticket is single-use, so a second call reuses the session — which is what a
      // browser does: one pairing per page load, then one bearer for its lifetime.
      if (sessionToken !== null) {
        return sessionToken;
      }
      const ticket = ticketFrom(pairingUrl);
      const response = await fetch(`${baseUrl}/api/v1/session/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ ticket }),
      });
      if (!response.ok) {
        throw new Error(
          `pairing failed: ${response.status} ${await response.text()}`,
        );
      }
      const body = (await response.json()) as { token: string };
      sessionToken = body.token;
      return sessionToken;
    },
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      // A browser always sends Origin; these requests do too, because the service
      // refuses a request without one.
      headers.set("origin", origin);
      if (init.token !== undefined) {
        headers.set("authorization", `Bearer ${init.token}`);
      }
      return fetch(`${baseUrl}${path}`, { ...init, headers });
    },
    async close() {
      await http.close();
    },
  };
}

/** The ticket carried in a pairing URL, from its query string or its fragment. */
export function ticketFrom(pairingUrl: string): string {
  const url = new URL(pairingUrl);
  const fromQuery =
    url.searchParams.get("pair") ?? url.searchParams.get("ticket");
  if (fromQuery !== null && fromQuery.length > 0) {
    return fromQuery;
  }
  const fragment =
    url.hash.length > 1
      ? (new URLSearchParams(url.hash.slice(1)).get("pair") ??
        new URLSearchParams(url.hash.slice(1)).get("ticket"))
      : null;
  if (fragment !== null && fragment.length > 0) {
    return fragment;
  }
  throw new Error("no ticket in that pairing URL");
}
