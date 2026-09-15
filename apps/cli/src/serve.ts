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
import { dirname, join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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
  unavailableMutations,
  createWorktreeRegistry,
  DEFAULT_RETENTION,
  runDoctor,
  startHttpHost,
  type EventRing,
  type HttpHost,
  type JournalStore,
  type MutationCoordinator,
  type ReadService,
  type RepositoryRegistry,
  type RootRegistry,
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
import { MINIMAL_PAGE } from "./minimal-page.js";

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
  readonly repositoryId: string;
  readonly allowedRootId: string;
  readonly gitPath: string;
  readonly gitVersion: string;
  readonly features: Awaited<ReturnType<typeof runDoctor>>["features"];
}

export interface AssembleOptions {
  readonly repositoryPath: string;
  readonly gitPath: string;
  readonly write: (line: string) => void;
  /**
   * Where notes go when stdout belongs to a machine.
   *
   * `--json` mode needs one channel for data and another for everything else: without
   * this, the pairing URL would have to go to stdout and stop being machine-readable.
   */
  readonly writeError?: (line: string) => void;
  /** Injected in tests so no real Git process is probed twice. */
  readonly skipDoctor?: boolean;
}

export async function assembleService(
  options: AssembleOptions,
): Promise<ServiceAssembly> {
  const repositoryPath = await realpath(options.repositoryPath);
  const info = await stat(repositoryPath);
  if (!info.isDirectory()) {
    throw new Error(`${repositoryPath} is not a directory`);
  }

  const codec = createTextCodec();
  const handles = createHandleRegistry();
  const roots = createRootRegistry({ handles, codec });
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

  const root = await roots.approve({
    path: repositoryPath,
    executionTrusted: true,
  });
  const record = await repositories.register({
    allowedRootId: root.allowedRootId,
    relativePath: "",
    handles,
  });

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

  const mutations = createMutationCoordinator({
    journal,
    repositories,
    worktrees,
    engine,
    recovery,
    snapshots,
    events,
    effects: [
      ...stagingEffects,
      ...repositoryEffects,
      ...stashTagEffects,
      ...worktreeEffects,
      ...mergeEffects,
    ],
    nextOperationId: () => `op_${randomBytes(9).toString("base64url")}`,
    nextSequence: () => (sequence += 1),
  });

  // What the contract defines and this build does not implement — derived from the
  // coordinator's own registry by the shared rule, so the CLI and the test harness
  // cannot drift apart on what "unavailable" means.
  const unavailable: UnavailableReason[] = unavailableMutations(
    mutations.implementedKinds(),
  );

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
    gitFeatures: doctor?.features ?? {
      porcelainV2Status: false,
      worktreeListZ: false,
      catFileBatch: false,
      pushPorcelain: false,
      fetchPorcelain: false,
      objectFormats: [],
    },
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
    repositoryId: record.repositoryId,
    allowedRootId: root.allowedRootId,
    gitPath: options.gitPath,
    gitVersion: doctor?.gitVersion ?? "unknown",
    features: doctor?.features ?? {
      porcelainV2Status: false,
      worktreeListZ: false,
      catFileBatch: false,
      pushPorcelain: false,
      fetchPorcelain: false,
      objectFormats: [],
    },
  };
}

export interface RunServiceOptions extends AssembleOptions {
  readonly port: number;
  readonly openBrowser: boolean;
  /** Pairing-ticket lifetime in seconds; 60 unless --ticket-ttl says otherwise. */
  readonly ticketTtlSeconds: number;
  /** Directory of the built web app; when absent, a placeholder page is served. */
  readonly webRoot: string | null;
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
  const http = await startHttpHost({
    read: assembly.read,
    mutations: assembly.mutations,
    events: assembly.events,
    serviceInstanceId: assembly.serviceInstanceId,
    port: options.port,
    ticketTtlSeconds: options.ticketTtlSeconds,
    webRoot: options.webRoot,
    inlineDocument: MINIMAL_PAGE,
    ...(options.shutdownGraceMs === undefined
      ? {}
      : { shutdownGraceMs: options.shutdownGraceMs }),
    grants: {
      allowedRootIds: [assembly.allowedRootId],
      repositoryIds: [assembly.repositoryId],
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
  });

  const origin = `http://127.0.0.1:${http.port}`;
  const pairingUrl = http.pairingUrl(origin);
  // Without a separate error channel (a host that only passes `write`), notes fall
  // back to it rather than being dropped silently.
  const note = options.writeError ?? options.write;

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
        ui: options.webRoot,
      }),
    );
    note(`pairing URL (single use): ${pairingUrl}`);
    if (options.openBrowser) {
      const opened = await openInBrowser(`${origin}/`);
      if (!opened.ok) {
        note(`could not open a browser: ${opened.reason}`);
      }
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
  options.write(`  repository: ${options.repositoryPath}`);
  options.write(`  git:        ${assembly.gitVersion}`);
  options.write(
    `  port:       ${http.port}${options.port === 0 ? " (chosen by the OS)" : ""}`,
  );
  options.write(
    `  ticket ttl: ${options.ticketTtlSeconds}s${options.ticketTtlSeconds === DEFAULT_TICKET_TTL_SECONDS ? "" : " (--ticket-ttl)"}`,
  );
  options.write(
    `  ui:         ${options.webRoot === null ? "placeholder page (the Svelte app is built in a later task)" : options.webRoot}`,
  );
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

  if (options.openBrowser) {
    const opened = await openInBrowser(`${origin}/`);
    if (!opened.ok) {
      // The URL is already printed, so a missing browser is a note, not a failure.
      options.write(
        `  note: could not open a browser (${opened.reason}); use the URL above`,
      );
    }
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
        options.write(`    ${http.pairingUrl(origin)}`);
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

/** The web build, if this installation has one next to the CLI. */
export async function findWebRoot(
  cliDirectory: string,
): Promise<string | null> {
  for (const candidate of [
    join(dirname(cliDirectory), "web"),
    join(cliDirectory, "web"),
  ]) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export { DEFAULT_PORT };
