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
  createRecoveryStore,
  createRepositoryEffects,
  createRepositoryRegistry,
  createRootRegistry,
  createSnapshotStore,
  createStagingEffects,
  createStashTagEffects,
  createMergeEffects,
  createTextCodec,
  createWorktreeEffects,
  createWorktreeRegistry,
  DEFAULT_RETENTION,
  startHttpHost,
  type EventRing,
  type HttpHost,
  type JournalStore,
  type MutationCoordinator,
  type MutationEffect,
  type RecoveryBackupWriter,
} from "@refyard/host-node";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import {
  API_MAJOR,
  CONTRACT_VERSION,
  targetKindsOf,
  type OperationRecord,
} from "@refyard/git-contract";
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
  /** Effects this test host can run; default is the real T08 staging effects. */
  readonly effects?: readonly MutationEffect[];
  /** Replace the discard backup store, e.g. with one that always refuses. */
  readonly backupStore?: RecoveryBackupWriter;
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

  const mutations = createMutationCoordinator({
    journal,
    repositories,
    worktrees,
    engine,
    recovery,
    snapshots,
    events,
    // The real product wiring: the T08 staging effects, exactly as the CLI
    // registers them, so a passing test is evidence about the product. A test
    // passes `effects` only to install a controlled stub.
    effects:
      options.effects ??
      [
        ...createStagingEffects({
          engine,
          repositories,
          paths,
          previews,
          backups:
            options.backupStore ??
            createRecoveryStore({ root: join(stateRoot, "backups") }),
        }),
        ...createRepositoryEffects({ engine, repositories }),
        ...createStashTagEffects({ engine, repositories }),
        ...createWorktreeEffects({ engine, repositories, roots, paths }),
        ...createMergeEffects({ engine, repositories }),
      ],
    nextOperationId: () => `op_${(counter += 1).toString(36)}`,
    nextSequence: () => (sequence += 1),
  });

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
    // Derived from the live registry, as the CLI does: an operation is
    // advertised exactly when an effect for it is registered.
    operations: mutations.implementedKinds().map((kind) => ({
      kind,
      targets: [...targetKindsOf(kind)],
    })),
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

/**
 * Submit one mutation over HTTP as a paired client and wait for its terminal state.
 *
 * An accepted operation is not an outcome: this polls the record until the state
 * machine settles, exactly as a UI must. It throws on a submission refused at the
 * boundary, because a 4xx there is a different fact from a failed operation.
 */
export async function submitAndWait(
  service: TestService,
  body: unknown,
  options: { readonly timeoutMs?: number } = {},
): Promise<OperationRecord> {
  const token = await service.pair();
  const submitted = await service.fetch("/api/v1/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    token,
    body: JSON.stringify(body),
  });
  const text = await submitted.text();
  if (submitted.status !== 200 && submitted.status !== 202) {
    throw new Error(
      `submit failed with HTTP ${submitted.status}: ${text.slice(0, 400)}`,
    );
  }
  // A fresh acceptance is the flat envelope; a replay wraps the record.
  const parsed = JSON.parse(text) as {
    operationId?: string;
    operation?: { operationId: string };
  };
  const operationId = parsed.operationId ?? parsed.operation?.operationId;
  if (operationId === undefined) {
    throw new Error(`submit response carried no operation id: ${text.slice(0, 200)}`);
  }
  const terminal = new Set([
    "succeeded",
    "failed",
    "needsAttention",
    "unknown",
    "cancelled",
  ]);
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const response = await service.fetch(
      `/api/v1/operations?operationId=${operationId}`,
      { token },
    );
    if (response.status === 200) {
      const listed = (await response.json()) as {
        operations: OperationRecord[];
      };
      const record = listed.operations[0];
      if (record !== undefined && terminal.has(record.status)) {
        return record;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("operation did not reach a terminal status in time");
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
