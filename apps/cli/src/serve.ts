/**
 * `refyard serve` / `refyard open` — assemble the service and run it in the foreground.
 *
 * This is the only place that wires the privileged pieces together: the handle
 * registry, the Git host, the engine, the registries, the read service and the HTTP
 * host. It is also where the two decisions the user actually made are recorded —
 * which directory was approved, and how large the grant is:
 *
 * - the **approved root is the repository directory itself**, not its parent, so
 *   running the workbench in `~/projects/app` does not hand it `~/projects`;
 * - the **grant covers exactly that root and that repository**, so a session cannot
 *   read a second repository the service happens to know about.
 *
 * A linked worktree that lives elsewhere is listed but not readable, and the CLI
 * says so at startup with the command that would approve it. Silently widening the
 * root to cover siblings would be convenient and wrong.
 *
 * Foreground is the whole lifecycle model in this version: the process runs until
 * Ctrl+C, and Ctrl+C stops accepting new work before it exits. There is no daemon,
 * no service installer and no supervision — Xross is the future supervisor, and it
 * is not this release.
 */
import {
  createInterface,
  type Interface as ConsoleInterface,
} from "node:readline";
import { join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  createEventRing,
  createAccessJournal,
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
  createRepositoryApprovalManager,
  createRepositoryRegistry,
  createRootRegistry,
  createSnapshotStore,
  createStagingEffects,
  createStashTagEffects,
  createMergeEffects,
  createTextCodec,
  createWorktreeEffects,
  kindsBlockedByGitFeatures,
  unavailableForGitFeatures,
  unavailableMutations,
  createWorktreeRegistry,
  DEFAULT_RETENTION,
  runDoctor,
  PortInUseError,
  startHttpHost,
  type EventRing,
  type HttpHost,
  type HttpHostOptions,
  type JournalStore,
  type MutationCoordinator,
  type ReadService,
  type RepositoryRegistry,
  type RootRegistry,
  type RepositoryApprovalManager,
  type AccessJournal,
} from "@refyard/host-node";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import {
  API_MAJOR,
  CONTRACT_VERSION,
  targetKindsOf,
  type ReadKind,
  type UnavailableReason,
} from "@refyard/git-contract";
import { DEFAULT_PORT, DEFAULT_TICKET_TTL_SECONDS } from "./args.js";

import { isPairingCommand } from "./pairing-reprint.js";
import { reportedVersion } from "./version.js";
import { openInBrowser } from "./browser.js";

export interface ServiceAssembly {
  readonly read: ReadService;
  readonly journal: JournalStore;
  readonly mutations: MutationCoordinator;
  readonly events: EventRing;
  /**
   * The id of this running process.
   *
   * It is minted here and handed to both the read service (which publishes it in
   * `capabilities`) and the HTTP host (which binds sessions to it), so the value a
   * client sees in a capability response is the same one its session was issued for.
   */
  readonly serviceInstanceId: string;
  readonly repositories: RepositoryRegistry;
  readonly roots: RootRegistry;
  readonly repositoryManagement: RepositoryApprovalManager;
  readonly accessJournal: AccessJournal;
  readonly repositoryPaths: readonly string[];
  readonly repositoryIds: readonly string[];
  readonly allowedRootIds: readonly string[];
  /** Compatibility aliases for callers that intentionally serve one repository. */
  readonly repositoryId: string;
  readonly allowedRootId: string;
  readonly gitPath: string;
  readonly gitVersion: string;
  readonly features: Awaited<ReturnType<typeof runDoctor>>["features"];
}

export interface AssembleOptions {
  /** One path for older embedders; `repositoryPaths` takes precedence when supplied. */
  readonly repositoryPath?: string;
  /** Every path is approved independently; no common parent is inferred. */
  readonly repositoryPaths?: readonly string[];
  readonly gitPath: string;
  readonly write: (line: string) => void;
  /**
   * Where notes go when stdout belongs to a machine.
   *
   * `--json` mode needs one channel for data and another for everything else: without
   * this, the pairing URL would have to go to stdout and stop being machine-readable.
   */
  readonly writeError?: (line: string) => void;
  /** Private state override used by isolated integration fixtures. */
  readonly stateRootPath?: string;
  /** Injected in tests so no real Git process is probed twice. */
  readonly skipDoctor?: boolean;
}

export async function assembleService(
  options: AssembleOptions,
): Promise<ServiceAssembly> {
  const requestedPaths =
    options.repositoryPaths ??
    (options.repositoryPath === undefined ? [] : [options.repositoryPath]);
  if (requestedPaths.length === 0) {
    throw new Error("at least one repository path is required");
  }
  const repositoryPaths: string[] = [];
  for (const requestedPath of requestedPaths) {
    const repositoryPath = await realpath(requestedPath);
    const info = await stat(repositoryPath);
    if (!info.isDirectory()) {
      throw new Error(`${repositoryPath} is not a directory`);
    }
    repositoryPaths.push(repositoryPath);
  }

  const codec = createTextCodec();
  const handles = createHandleRegistry();
  const roots = createRootRegistry({
    handles,
    codec,
    ...(options.stateRootPath === undefined
      ? {}
      : { stateRootPath: options.stateRootPath }),
  });
  let counter = 0;
  let sequence = 0;
  const paths = createPathRegistry({
    codec,
    nextPathId: () => `path_${(counter += 1).toString(36)}`,
  });
  const worktrees = createWorktreeRegistry({
    codec,
    handles,
    nextWorktreeId: () => `wt_${(counter += 1).toString(36)}`,
  });
  const host = createGitHost({ gitPath: options.gitPath, registry: handles });
  const engine: GitEngine = createHostEngine(host, { runIdPrefix: "svc" });
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

  const serviceInstanceId = `srvc_${randomBytes(12).toString("base64url")}`;
  // The journal lives in the private state root, never inside a repository, and the
  // recovery pass runs before anything can write: an operation left in flight by a
  // previous process is reported as unknown and blocks that repository until a human
  // resolves it.
  const stateRoot = await roots.stateRoot();
  const journal = createJournalStore({
    stateRoot,
    retention: DEFAULT_RETENTION,
  });
  await journal.load();
  const accessJournal = createAccessJournal({ stateRoot });
  await accessJournal.load();
  const recovery = createRecovery({ journal });
  await recovery.run();
  const events = createEventRing();
  const doctor =
    options.skipDoctor === true
      ? null
      : await runDoctor({ gitPath: options.gitPath });
  if (doctor !== null && !doctor.executableFound) {
    throw new Error(
      `Git could not be run at ${options.gitPath}. Install Git, or point REFYARD_GIT at the executable.`,
    );
  }

  const registrations: {
    readonly path: string;
    readonly root: Awaited<ReturnType<RootRegistry["approve"]>>;
    readonly record: Awaited<ReturnType<RepositoryRegistry["register"]>>;
  }[] = [];
  for (const repositoryPath of repositoryPaths) {
    const root = await roots.approve({
      path: repositoryPath,
      executionTrusted: true,
    });
    const record = await repositories.register({
      allowedRootId: root.allowedRootId,
      relativePath: "",
      handles,
    });
    registrations.push({ path: repositoryPath, root, record });

    // Worktrees outside the approved root are read-only in this session, and saying so
    // up front is the difference between a limitation and a mystery.
    try {
      const worktreeList = await repositories.worktreesOf(record.repositoryId);
      for (const worktree of worktreeList) {
        if (worktree.handle === null) {
          options.write(
            `note: worktree ${worktree.displayPath.text} is outside the approved root (${repositoryPath}); run \`refyard open ${worktree.displayPath.text}\` in another session to work there`,
          );
        }
      }
    } catch {
      // A worktree list that cannot be read is reported by the first read that needs
      // it; failing the whole startup over it would hide the service itself.
    }
  }

  const firstRegistration = registrations[0];
  if (firstRegistration === undefined) {
    throw new Error("at least one repository registration is required");
  }
  const repositoryManagement = createRepositoryApprovalManager({
    roots,
    repositories,
    handles,
    journal: accessJournal,
  });

  const reads: readonly ReadKind[] = [
    "capabilities",
    "repositories",
    "status",
    "history",
    "refs",
    "diff",
    "worktrees",
    "submodules",
    "stashes",
  ];

  const stagingEffects = createStagingEffects({
    engine,
    repositories,
    paths,
    previews,
    backups: createRecoveryStore({ root: join(stateRoot, "backups") }),
  });
  const repositoryEffects = createRepositoryEffects({
    engine,
    repositories,
    roots,
    handles,
  });
  const stashTagEffects = createStashTagEffects({
    engine,
    repositories,
  });
  const mergeEffects = createMergeEffects({ engine, repositories });
  const worktreeEffects = createWorktreeEffects({
    engine,
    repositories,
    roots,
    paths,
  });

  // The doctor's probes decide which effects are registered, not just what the UI is
  // told: an operation built on a porcelain this machine's Git does not have is not
  // offered at all, so a click cannot reach a command Git will refuse.
  const features = doctor?.features ?? {
    porcelainV2Status: false,
    worktreeListZ: false,
    catFileBatch: false,
    pushPorcelain: false,
    fetchPorcelain: false,
    objectFormats: [],
  };
  const blocked = kindsBlockedByGitFeatures(features);
  const availableEffects = [
    ...stagingEffects,
    ...repositoryEffects,
    ...stashTagEffects,
    ...worktreeEffects,
    ...mergeEffects,
  ].filter((effect) => !blocked.has(effect.kind));

  const mutations = createMutationCoordinator({
    journal,
    repositories,
    worktrees,
    engine,
    recovery,
    snapshots,
    events,
    effects: availableEffects,
    nextOperationId: () => `op_${randomBytes(9).toString("base64url")}`,
    nextSequence: () => (sequence += 1),
  });

  // What the contract defines and this build does not implement — derived from the
  // coordinator's own registry by the shared rule, so the CLI and the test harness
  // cannot drift apart on what "unavailable" means.
  const unavailable: UnavailableReason[] = [
    ...unavailableMutations(mutations.implementedKinds(), {
      accountedFor: blocked,
    }),
    ...unavailableForGitFeatures(features),
  ];

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
    gitPath: options.gitPath,
    gitVersion: doctor?.gitVersion ?? "unknown",
    gitFeatures: features,
    unavailable,
    reads,
    // The registry is the single source: a kind is advertised exactly when an
    // effect for it was registered above.
    operations: mutations.implementedKinds().map((kind) => ({
      kind,
      targets: [...targetKindsOf(kind)],
    })),
  });

  return {
    read,
    journal,
    mutations,
    events,
    serviceInstanceId,
    repositories,
    roots,
    repositoryManagement,
    accessJournal,
    repositoryPaths,
    repositoryIds: registrations.map(({ record }) => record.repositoryId),
    allowedRootIds: registrations.map(({ root }) => root.allowedRootId),
    repositoryId: firstRegistration.record.repositoryId,
    allowedRootId: firstRegistration.root.allowedRootId,
    gitPath: options.gitPath,
    gitVersion: doctor?.gitVersion ?? "unknown",
    features,
  };
}

export interface RunServiceOptions extends AssembleOptions {
  readonly port: number;
  /**
   * Whether `port` was asked for by name.
   *
   * An explicit port is a request for *that* port — a bookmark, a tunnel, a script that
   * expects it — so a busy one is refused. The default port is a courtesy, and a busy one
   * means "take another free port and say which". Required rather than defaulted: a call
   * site that has not thought about which case it is in should not silently get one.
   */
  readonly portExplicit: boolean;
  readonly openBrowser: boolean;
  /** Pairing-ticket lifetime in seconds; 60 unless --ticket-ttl says otherwise. */
  readonly ticketTtlSeconds: number;
  /** Optional static root for an embedding host; the CLI itself leaves this absent. */
  readonly webRoot?: string | null;
  /** Exact browser origins allowed to call this API in hosted mode. */
  readonly allowedOrigins?: readonly string[];
  /** Origin of the separately deployed UI that receives the pairing URL. */
  readonly uiOrigin?: string;
  /** Browser-visible API origin, such as the HTTPS endpoint exposed by a tunnel. */
  readonly apiOrigin?: string;
  readonly allowRoot: boolean;
  /**
   * Machine output: one JSON object on stdout, pairing material on stderr only.
   *
   * A terminal is a private channel; a pipe may be read by anything, so the ticket
   * never appears on stdout in this mode.
   */
  readonly json?: boolean;
  /** Injected by tests so a run does not need a signal to stop. */
  readonly installSignalHandlers?: boolean;
  /** How long a stop waits for in-flight requests; the host's default is 5 s. */
  readonly shutdownGraceMs?: number;
}

export interface RunningService {
  readonly http: HttpHost;
  readonly assembly: ServiceAssembly;
  readonly url: string;
  /** The pairing URL, which carries the one-time ticket in its fragment. */
  readonly pairingUrl: string;
  close(): Promise<void>;
}

export async function runService(
  options: RunServiceOptions,
): Promise<RunningService> {
  if (
    process.getuid !== undefined &&
    process.getuid() === 0 &&
    !options.allowRoot
  ) {
    throw new Error(
      "refyard refuses to run as root: Git hooks and filters would run with root privileges. Pass --allow-root only if you understand that.",
    );
  }

  const assembly = await assembleService(options);
  const note = options.writeError ?? options.write;
  // Annotated so a mistyped field is a compile error: an unannotated object spread into
  // the call would silently drop whatever the host does not recognise.
  const hostOptions: Omit<HttpHostOptions, "port"> = {
    read: assembly.read,
    mutations: assembly.mutations,
    events: assembly.events,
    serviceInstanceId: assembly.serviceInstanceId,
    ticketTtlSeconds: options.ticketTtlSeconds,
    webRoot: options.webRoot ?? null,
    allowedOrigins: [
      ...(options.allowedOrigins ?? []),
      ...(options.uiOrigin === undefined ? [] : [options.uiOrigin]),
    ],
    repositoryManagement: assembly.repositoryManagement,
    ...(options.shutdownGraceMs === undefined
      ? {}
      : { shutdownGraceMs: options.shutdownGraceMs }),
    repositoryRootOf: (repositoryId: string) =>
      assembly.repositories.get(repositoryId)?.allowedRootId ?? null,
    grants: {
      allowedRootIds: [...assembly.allowedRootIds],
      repositoryIds: [...assembly.repositoryIds],
      scopes: ["repository:read"],
    },
    log: (line) => {
      // Service logs are diagnostics, not data: a machine reading stdout must not
      // find them interleaved with the JSON object.
      if (options.json === true) {
        note(`  ${line}`);
      } else {
        options.write(`  ${line}`);
      }
    },
  };

  let http: HttpHost;
  try {
    http = await startHttpHost({ ...hostOptions, port: options.port });
  } catch (error) {
    if (error instanceof PortInUseError && !options.portExplicit) {
      // The default port is a courtesy, not a promise: a second refyard, a dev server or a
      // tunnel may hold it. Taking a free port instead keeps the default usable, and the
      // note names both ports so nothing moves silently. An explicitly requested port is
      // not retried — see `RunServiceOptions.portExplicit`.
      http = await startHttpHost({ ...hostOptions, port: 0 });
      note(
        `note: port ${error.port} is in use; listening on port ${http.port} instead (pass --port to pin one)`,
      );
    } else {
      throw error;
    }
  }

  const origin = `http://127.0.0.1:${http.port}`;
  const pairingUrlFor = (): string => {
    const pairingOrigin = options.uiOrigin ?? origin;
    const issued = http.pairingUrl(pairingOrigin);
    if (options.uiOrigin === undefined) {
      return issued;
    }
    const url = new URL(issued);
    url.searchParams.set("api", options.apiOrigin ?? origin);
    return url.toString();
  };
  const pairingUrl = pairingUrlFor();

  /**
   * Two output modes, and the difference is who is reading.
   *
   * A terminal gets the banner, including the pairing URL — the user's own screen is
   * the private channel that a web page cannot read. A machine (`--json`) gets one
   * JSON object on stdout with no pairing material in it at all, and the pairing URL
   * goes to stderr: a supervisor can capture it, a log can strip it, and a program
   * parsing stdout can never mistake a ticket for data.
   */
  if (options.json === true) {
    options.write(
      JSON.stringify({
        serviceInstanceId: http.serviceInstanceId,
        port: http.port,
        url: origin,
        apiMajor: API_MAJOR,
        contractVersion: CONTRACT_VERSION,
        repositoryId: assembly.repositoryId,
        repositoryIds: [...assembly.repositoryIds],
        allowedRootIds: [...assembly.allowedRootIds],
        ui: null,
        apiOnly: true,
      }),
    );
    note(`pairing URL (single use): ${pairingUrl}`);
    if (options.openBrowser && options.uiOrigin !== undefined) {
      const opened = await openInBrowser(pairingUrl);
      if (!opened.ok) {
        note(`could not open a browser: ${opened.reason}`);
      }
    } else if (options.openBrowser) {
      note(
        "not opening a browser: this CLI serves the API only; configure the deployed UI origin with --ui-origin",
      );
    }
    let jsonClosed = false;
    const closeJson = async (): Promise<void> => {
      if (jsonClosed) {
        return;
      }
      jsonClosed = true;
      await http.close();
    };
    if (options.installSignalHandlers !== false) {
      const onJsonSignal = (): void => {
        note("stopping: no new requests will be accepted");
        void closeJson().then(() => {
          process.exitCode = 0;
        });
      };
      process.on("SIGINT", onJsonSignal);
      process.on("SIGTERM", onJsonSignal);
    }
    return { http, assembly, url: origin, pairingUrl, close: closeJson };
  }

  options.write(`refyard ${await reportedVersion()} (api ${API_MAJOR})`);
  options.write(`  repositories: ${assembly.repositoryPaths.join(", ")}`);
  options.write(`  git:        ${assembly.gitVersion}`);
  options.write(
    `  port:       ${http.port}${options.port === 0 ? " (chosen by the OS)" : ""}`,
  );
  options.write(
    `  ticket ttl: ${options.ticketTtlSeconds}s${options.ticketTtlSeconds === DEFAULT_TICKET_TTL_SECONDS ? "" : " (--ticket-ttl)"}`,
  );
  options.write("  ui:         API-only (deploy apps/web separately)");
  options.write("");
  options.write(`  open this URL in your browser to pair this session:`);
  options.write(`    ${pairingUrl}`);
  options.write("");
  options.write(
    `  ready ${JSON.stringify({ serviceInstanceId: http.serviceInstanceId, port: http.port, url: origin })}`,
  );
  options.write(
    `  press p + Enter to print another pairing URL (each is single use)`,
  );
  options.write(`  press Ctrl+C to stop`);

  if (options.openBrowser && options.uiOrigin !== undefined) {
    const opened = await openInBrowser(pairingUrl);
    if (!opened.ok) {
      // The URL is already printed, so a missing browser is a note, not a failure.
      options.write(
        `  note: could not open a browser (${opened.reason}); use the URL above`,
      );
    }
  } else if (options.openBrowser) {
    options.write(
      "  note: not opening a browser: this CLI serves the API only; configure --ui-origin for the deployed UI",
    );
  }

  let closed = false;
  // Created once the listener is up; `close` shuts it down so the terminal
  // interface never holds the process open after a stop.
  let consoleInterface: ConsoleInterface | null = null;
  const close = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    // Stop accepting new requests first, then drop sessions: an in-flight read gets
    // to finish, and nothing new is paired after the user asked to stop.
    await http.close();
    consoleInterface?.close();
  };

  if (options.installSignalHandlers !== false) {
    const onSignal = (): void => {
      options.write("");
      options.write("stopping: no new requests will be accepted");
      void close().then(() => {
        process.exitCode = 0;
      });
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);

    // A second browser needs a second ticket, and minting must stay out of the
    // authenticated API: the user's terminal is the channel that cannot be spoofed by a
    // web page. The interface is closed with the service so it never holds the process
    // open after a stop.
    const readline = createInterface({ input: process.stdin });
    consoleInterface = readline;
    readline.on("line", (line) => {
      if (isPairingCommand(line)) {
        options.write("");
        options.write("  a fresh pairing URL (single use):");
        options.write(`    ${pairingUrlFor()}`);
      }
    });
  }

  return {
    http,
    assembly,
    url: origin,
    pairingUrl,
    close,
  };
}

export { DEFAULT_PORT };
