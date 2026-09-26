/**
 * Assembling one privileged service out of the pieces host-node owns.
 *
 * This is the only place that wires the handle registry, the Git host, the engine, the
 * registries, the read service, the mutation effects and the two journals into a working
 * whole. It lives here rather than in the CLI because the CLI is one of several hosts;
 * embedding hosts use the same wiring rather than drifting on which effects exist and
 * which reads are advertised.
 *
 * Two decisions are recorded here because they are the ones the user actually made:
 *
 * - the **approved root is the repository directory itself**, not its parent, so running
 *   the workbench in `~/projects/app` does not hand it `~/projects`;
 * - the **grant covers exactly that root and that repository**, so a session cannot read
 *   a second repository the service happens to know about.
 *
 * A linked worktree that lives elsewhere is listed but not readable; the caller reports
 * that, because silently widening the root to cover siblings would be convenient and wrong.
 */
import { join } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createHostEngine, type GitEngine } from "@refyard/git-core";
import { createGitHubAdapter } from "@refyard/git-provider/github/adapter";
import {
  API_MAJOR,
  CONTRACT_VERSION,
  targetKindsOf,
  type ReadKind,
  type UnavailableReason,
} from "@refyard/git-contract";
import { createGitHost } from "../process/git-host.js";
import { runDoctor } from "../process/doctor.js";
import { createHandleRegistry } from "../filesystem/handles.js";
import { createTextCodec } from "../filesystem/codec.js";
import { createRecoveryStore } from "../filesystem/metadata.js";
import { createPreviewStore } from "../filesystem/preview.js";
import {
  createRootRegistry,
  type RootRegistry,
} from "../registry/roots.js";
import {
  createRepositoryApprovalManager,
  type RepositoryApprovalManager,
} from "../registry/managed.js";
import {
  createRepositoryRegistry,
  type RepositoryRegistry,
} from "../registry/repositories.js";
import { createWorktreeRegistry } from "../registry/worktrees.js";
import { createPathRegistry } from "../registry/paths.js";
import { createSnapshotStore } from "../coordinator/snapshots.js";
import {
  createReadService,
  type ReadService,
} from "../coordinator/reads.js";
import {
  createJournalStore,
  type JournalStore,
} from "../journal/store.js";
import { DEFAULT_RETENTION } from "../journal/retention.js";
import { createRecovery } from "../journal/recovery.js";
import {
  createAccessJournal,
  type AccessJournal,
} from "../journal/access.js";
import { createStagingEffects } from "../coordinator/previews.js";
import { createRepositoryEffects } from "../coordinator/repository-effects.js";
import { createStashTagEffects } from "../coordinator/stash-tag-effects.js";
import { createWorktreeEffects } from "../coordinator/worktree-effects.js";
import { createMergeEffects } from "../coordinator/merge-effects.js";
import { createCherryPickEffects } from "../coordinator/cherry-pick-effects.js";
import { createRebaseEffects } from "../coordinator/rebase-effects.js";
import {
  kindsBlockedByGitFeatures,
  unavailableForGitFeatures,
  unavailableMutations,
} from "../coordinator/capabilities.js";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../coordinator/submit.js";
import { createEventRing, type EventRing } from "../http/events.js";
import {
  createProviderManager,
  createProviderStore,
} from "../provider/manager.js";
import { createProviderService } from "../provider/service.js";

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
  readonly provider: ReturnType<typeof createProviderService>;
  readonly repositoryPaths: readonly string[];
  readonly repositoryIds: readonly string[];
  readonly allowedRootIds: readonly string[];
  /** Compatibility aliases for callers that intentionally serve one repository. */
  readonly repositoryId: string | null;
  readonly allowedRootId: string | null;
  readonly gitPath: string;
  readonly gitVersion: string;
  readonly features: Awaited<ReturnType<typeof runDoctor>>["features"];
}

export interface AssembleOptions {
  /** One path for older embedders; `repositoryPaths` takes precedence when supplied. */
  readonly repositoryPath?: string;
  /** Every path is approved independently; no common parent is inferred. */
  readonly repositoryPaths?: readonly string[];
  /** Development launcher mode may begin before a repository is chosen. */
  readonly allowEmpty?: boolean;
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
  /** Test seam: point the provider client at a local stub upstream. */
  readonly providerGithubBaseUrl?: string;
  /** Test seam: the device-flow login endpoints, likewise for stubs. */
  readonly providerGithubLoginBaseUrl?: string;
  /** Injected in tests so no real Git process is probed twice. */
  readonly skipDoctor?: boolean;
}

export async function assembleService(
  options: AssembleOptions,
): Promise<ServiceAssembly> {
  const requestedPaths =
    options.repositoryPaths ??
    (options.repositoryPath === undefined ? [] : [options.repositoryPath]);
  if (requestedPaths.length === 0 && options.allowEmpty !== true) {
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
  // The provider axis: one connection store beside the journals, one manager,
  // one service. The base URL stays the real GitHub API in the product; tests
  // inject a local stub through AssembleOptions.
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
      journal: accessJournal,
      adapter: providerAdapter,
    }),
    engine,
    repositories,
    adapter: providerAdapter,
  });
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

  const firstRegistration = registrations[0] ?? null;
  const repositoryManagement = createRepositoryApprovalManager({
    roots,
    repositories,
    handles,
    journal: accessJournal,
  });

  const reads: readonly ReadKind[] = [
    "capabilities",
    "filesystem",
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
  const cherryPickEffects = createCherryPickEffects({ engine, repositories });
  const rebaseEffects = createRebaseEffects({ engine, repositories });
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
    ...cherryPickEffects,
    ...rebaseEffects,
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
    providers: ["github"],
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
    provider,
    repositoryPaths,
    repositoryIds: registrations.map(({ record }) => record.repositoryId),
    allowedRootIds: registrations.map(({ root }) => root.allowedRootId),
    repositoryId: firstRegistration?.record.repositoryId ?? null,
    allowedRootId: firstRegistration?.root.allowedRootId ?? null,
    gitPath: options.gitPath,
    gitVersion: doctor?.gitVersion ?? "unknown",
    features,
  };
}
