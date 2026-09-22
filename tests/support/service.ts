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
  createAccessJournal,
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
  createCherryPickEffects,
  createRebaseEffects,
  createTextCodec,
  createWorktreeEffects,
  createWorktreeRegistry,
  createProviderManager,
  createProviderService,
  createProviderStore,
  kindsBlockedByGitFeatures,
  unavailableForGitFeatures,
  unavailableMutations,
  DEFAULT_RETENTION,
  startHttpHost,
  type EventRing,
  type HttpHost,
  type JournalStore,
  type MutationCoordinator,
  type MutationEffect,
  type ReadService,
  type RecoveryBackupWriter,
} from "@refyard/host-node";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import { createGitHubAdapter } from "@refyard/git-provider/github/adapter";
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
  /**
   * The read service itself, wired exactly as the CLI wires it.
   *
   * Exposed so a differential case can drive the reads without HTTP: the wire schema is
   * still enforced (the read service validates every response against it), and a case
   * does not have to pair, address a port or re-implement the request encoding to ask a
   * question.
   */
  readonly read: ReadService;
  /**
   * The effects this service registered, in the order the CLI registers them.
   *
   * Exposed so a case can invoke one directly, with no HTTP and no queue in the way:
   * that is the only way to reach the effect's own precondition read, which the
   * submit-time checks run before it in every normal path.
   */
  readonly effects: readonly MutationEffect[];
  readonly journal: JournalStore;
  readonly events: EventRing;
  /** The private state root this service's journal lives in. */
  readonly stateRoot: string;
  /**
   * Roots this host approved but did **not** grant the session.
   *
   * Named so a case can address one and assert the refusal: the registry knows it,
   * the session does not.
   */
  readonly ungrantedRootIds: readonly string[];
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
   * Register a different directory as *the* subject, inside the fixture.
   *
   * A bare repository and a shallow clone are directories the fixture's Git created
   * beside the checkout — same environment, same HOME — and the service has to be
   * pointed at them rather than at `repo.root`. Defaults to the fixture's checkout.
   */
  readonly subjectPath?: string;
  /**
   * What `refyard doctor` probed on this machine's Git.
   *
   * Defaults to a Git that has every porcelain this build uses, which is what the
   * developer's machine and CI have. A case passes a narrower answer to exercise the
   * feature gating — the wiring that keeps an operation off the capability list when the
   * Git under it cannot report what moved.
   */
  readonly gitFeatures?: {
    readonly porcelainV2Status: boolean;
    readonly worktreeListZ: boolean;
    readonly catFileBatch: boolean;
    readonly pushPorcelain: boolean;
    readonly fetchPorcelain: boolean;
    readonly objectFormats: ("sha1" | "sha256")[];
  };
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
  /**
   * Approve additional roots **without** granting them to the session.
   *
   * The registry and the session are two different things: a root can exist (another
   * window approved it, the CLI was started with it) while this session was never
   * handed it. That is the case a scope check exists for.
   */
  readonly ungrantedRootPaths?: readonly string[];
  /** Session scopes; defaults to the complete local-workbench authority. */
  readonly scopes?: readonly string[];
  /**
   * Test seam: point the provider client at a local stub upstream. The store,
   * manager and service are always assembled — a harness without the module
   * could not prove that the capability honestly appears.
   */
  readonly providerGithubBaseUrl?: string;
  /** The device-flow login endpoints, likewise for stubs. */
  readonly providerGithubLoginBaseUrl?: string;
  /** Exact hosted UI origins allowed to call the test service. */
  readonly allowedOrigins?: readonly string[];
  /** Secret used when the test exercises the password-gated hosted form. */
  readonly hostedPassword?: string;
}

export async function startTestService(
  options: StartTestServiceOptions,
): Promise<TestService> {
  const repositoryPath = await realpath(
    options.subjectPath ?? options.repo.root,
  );
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

  const features = options.gitFeatures ?? {
    porcelainV2Status: true,
    worktreeListZ: true,
    catFileBatch: true,
    pushPorcelain: true,
    fetchPorcelain: true,
    objectFormats: ["sha1", "sha256"],
  };

  // The real product wiring: the T08 staging effects, exactly as the CLI registers
  // them, so a passing test is evidence about the product. A test passes `effects`
  // only to install a controlled stub.
  const registered: readonly MutationEffect[] = options.effects ?? [
    ...createStagingEffects({
      engine,
      repositories,
      paths,
      previews,
      backups:
        options.backupStore ??
        createRecoveryStore({ root: join(stateRoot, "backups") }),
    }),
    ...createRepositoryEffects({ engine, repositories, roots, handles }),
    ...createStashTagEffects({ engine, repositories }),
    ...createWorktreeEffects({ engine, repositories, roots, paths }),
    ...createMergeEffects({ engine, repositories }),
    ...createCherryPickEffects({ engine, repositories }),
    ...createRebaseEffects({ engine, repositories }),
  ];

  // The same feature gate the CLI applies: an operation whose porcelain this machine's
  // Git lacks is not registered at all, so a click cannot reach a command Git refuses.
  const blocked = kindsBlockedByGitFeatures(features);
  const effects = registered.filter((effect) => !blocked.has(effect.kind));

  const mutations = createMutationCoordinator({
    journal,
    repositories,
    worktrees,
    engine,
    recovery,
    snapshots,
    events,
    effects,
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
    gitFeatures: features,
    // Derived from this host's own registry, exactly as the CLI derives it: a
    // harness that hardcoded an empty list could not exercise the 501 path at all.
    unavailable: [
      ...unavailableMutations(mutations.implementedKinds(), {
        accountedFor: blocked,
      }),
      ...unavailableForGitFeatures(features),
    ],
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
    providers: ["github"],
    // Derived from the live registry, as the CLI does: an operation is
    // advertised exactly when an effect for it is registered.
    operations: mutations.implementedKinds().map((kind) => ({
      kind,
      targets: [...targetKindsOf(kind)],
    })),
  });

  const log: string[] = [];
  let sessionToken: string | null = null;
  const ungranted = [];
  for (const path of options.ungrantedRootPaths ?? []) {
    ungranted.push(
      (await roots.approve({ path, executionTrusted: true })).allowedRootId,
    );
  }

  const providerStore = createProviderStore({ stateRoot });
  await providerStore.load();
  const providerAdapter = createGitHubAdapter({
    fetch: (input, init) => fetch(input, init),
    ...(options.providerGithubBaseUrl === undefined
      ? {}
      : { apiBaseUrl: options.providerGithubBaseUrl }),
    ...(options.providerGithubLoginBaseUrl === undefined
      ? {}
      : { loginBaseUrl: options.providerGithubLoginBaseUrl }),
    userAgentPrefix: "refyard",
  });
  const provider = createProviderService({
    manager: createProviderManager({
      store: providerStore,
      journal: createAccessJournal({ stateRoot }),
      adapter: providerAdapter,
    }),
    engine,
    repositories,
    adapter: providerAdapter,
  });

  const http = await startHttpHost({
    read,
    mutations,
    provider,
    events,
    serviceInstanceId,
    port: 0,
    webRoot: options.webRoot ?? null,
    ...(options.inlineDocument === undefined
      ? {}
      : { inlineDocument: options.inlineDocument }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    repositoryRootOf: (repositoryId) =>
      repositories.get(repositoryId)?.allowedRootId ?? null,
    grants: {
      allowedRootIds: [root.allowedRootId],
      repositoryIds: [
        record.repositoryId,
        ...(options.extraRepositoryIds ?? []),
      ],
      scopes: options.scopes ?? [
        "repository:read",
        "repository:write",
        "repository:network",
        "workspace:manage",
        "provider:manage",
      ],
    },
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
    ...(options.hostedPassword === undefined
      ? {}
      : { hostedPassword: options.hostedPassword }),
    log: (line) => {
      log.push(line);
    },
  });

  const pairingUrl = http.pairingUrl(`http://127.0.0.1:${http.port}`);
  const baseUrl = `http://127.0.0.1:${http.port}`;
  const origin = `http://127.0.0.1:${http.port}`;

  return {
    http,
    read,
    baseUrl,
    instanceId: http.serviceInstanceId,
    repositoryId: record.repositoryId,
    allowedRootId: root.allowedRootId,
    ungrantedRootIds: [...ungranted],
    mutations,
    effects,
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
    throw new Error(
      `submit response carried no operation id: ${text.slice(0, 200)}`,
    );
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
