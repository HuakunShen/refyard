<script lang="ts">
  /**
   * The workbench page.
   *
   * This is the composition root for the runtime session/connectivity controllers and the
   * query cache, and it composes
   * `@refyard/git-ui` components that take plain props. Keeping that split means the
   * components can be reused by another host, and it means the app has no business logic
   * about Git in it — only reads, selection, and the states around them.
   *
   * Reads, explicit approvals and submitted operations are composed here. The page does
   * not build Git commands: it sends closed contract intentions through the injected
   * clients, and capabilities decide which controls are visible.
   */
  import { browser } from "$app/environment";
  import { createGitClient, createMutationClient } from "@refyard/git-client";
  import type { ParsedMutationRequest } from "@refyard/git-contract";
  import {
    AppearanceSettings,
    Badge,
    BranchPanel,
    Button,
    CommitDetailPanel,
    CommitList,
    CommitPanel,
    ConflictPanel,
    ConnectionPanel,
    DiffPanel,
    ModeToggle,
    RefsPanel,
    RefyardLogo,
    RepositoryAccessPanel,
    RemotePanel,
    RepositoryList,
    RepositoryPanel,
    SectionCard,
    Separator,
    StagingPanel,
    StashPanel,
    StateBanner,
    StatusList,
    SubmodulePanel,
    TagPanel,
    WorktreePanel,
    cn,
    shortOid,
    type RepositoryCloneRequest,
    type RepositoryInitRequest,
  } from "@refyard/git-ui";
  import {
    Archive,
    Boxes,
    FileDiff,
    FolderGit2,
    GitBranch,
    GitCommit,
    Globe,
    Layers,
    RefreshCw,
    Tag,
  } from "@lucide/svelte";
  import { useQueryClient } from "@tanstack/svelte-query";
  import {
    clearWorkbenchCredentials,
    consumeInitialPairingUrl,
    createWorkbenchSessionState,
    describeClientProblem,
    isDefaultSessionBaseUrl,
    pairWorkbenchSession,
    type WorkbenchSessionPorts,
  } from "$lib/workbench/session.js";
  import {
    createWorkbenchConnectivityState,
    observeBrowserConnectivity,
    startWorkbenchEventStream,
  } from "$lib/workbench/connectivity.js";
  import {
    clearInspectableSelection,
    clearRepositoryIfSelected,
    createWorkbenchSelectionState,
    selectCommit,
    selectDiffPath,
    selectRepository,
    selectStatusPath,
  } from "$lib/workbench/selection.js";
  import { followOperation } from "$lib/operation-follow.js";
  import {
    createWorkbenchQueries,
    invalidateWorkbenchBackgroundQueries,
  } from "$lib/workbench/queries.svelte.js";
  import {
    clearStoredSession,
    readStoredAccent,
    readStoredBackground,
    readStoredBaseUrl,
    readStoredGlass,
    readStoredInstance,
    readStoredToken,
    storeAccent,
    storeBackground,
    storeBaseUrl,
    storeGlass,
    storeInstance,
    storeToken,
  } from "$lib/storage.js";
  import {
    blocksWrites,
    negotiateSession,
    type Negotiation,
  } from "$lib/session-negotiation.js";

  /* ------------------------------------------------------- runtime connection */

  const session = $state(
    createWorkbenchSessionState({
      href: browser ? window.location.href : "http://127.0.0.1:47831/",
      storedBaseUrl: browser ? readStoredBaseUrl() : null,
      storedToken: browser ? readStoredToken() : null,
      storedInstance: browser ? readStoredInstance() : null,
    }),
  );
  const baseUrl = $derived(session.baseUrl);
  const token = $derived(session.token);
  const pairedInstance = $derived(session.pairedInstance);
  const connectivity = $state(createWorkbenchConnectivityState(true));
  const streamState = $derived(connectivity.streamState);
  const browserOnline = $derived(connectivity.browserOnline);

  let accent = $state(browser ? readStoredAccent() : "default");
  let background = $state(browser ? readStoredBackground() : "none");
  let glass = $state(browser ? readStoredGlass() : false);

  $effect(() => {
    if (!browser) {
      return;
    }
    document.documentElement.setAttribute("data-accent", accent);
    document.documentElement.setAttribute(
      "data-glass",
      glass ? "true" : "false",
    );
    storeAccent(accent);
    storeBackground(background);
    storeGlass(glass);
  });

  const queryClient = useQueryClient();

  // Rebuilt when the address changes: the client holds the base URL, and a stale one would
  // send every later request to the previous service.
  const client = $derived(
    createGitClient({
      baseUrl,
      fetch: (input, init) => fetch(input, init),
      token: () => token,
    }),
  );

  const sessionPorts: WorkbenchSessionPorts = {
    exchangeTicket: (value, password) => client.exchangeTicket(value, password),
    health: () => client.health(),
    storeToken,
    storeInstance,
    storeBaseUrl,
    clearStoredSession,
    currentHref: () =>
      browser ? window.location.href : `${session.initialBaseUrl}/`,
    replaceHref: (href) => {
      if (browser) {
        window.history.replaceState({}, "", href);
      }
    },
  };

  async function pair(): Promise<void> {
    await pairWorkbenchSession(session, sessionPorts);
  }

  function disconnect(): void {
    clearWorkbenchCredentials(session, sessionPorts);
    clearInspectableSelection(selection);
    queryClient.clear();
  }

  // A pairing URL is meant to work by being opened. The controller handles both the
  // current query spelling and legacy fragments, including immediate URL scrubbing.
  $effect(() => {
    if (browser) {
      void consumeInitialPairingUrl(session, sessionPorts);
    }
  });

  /* ------------------------------------------------------------------- reads */

  const selection = $state(createWorkbenchSelectionState());
  const selectedRepositoryId = $derived(selection.repositoryId);
  const selectedOid = $derived(selection.commitOid);
  const selectedPath = $derived(selection.statusPath);
  const selectedDiffPathId = $derived(selection.diffPathId);

  function pageVisible(): boolean {
    return (
      typeof document === "undefined" || document.visibilityState !== "hidden"
    );
  }

  const queries = createWorkbenchQueries({
    client: () => client,
    baseUrl: () => baseUrl,
    token: () => token,
    selection,
    visible: pageVisible,
  });
  const capabilities = queries.capabilities;
  const repositories = queries.repositories;
  const status = queries.status;
  const refs = queries.refs;
  const stashes = queries.stashes;
  const worktrees = queries.worktrees;
  const submodules = queries.submodules;
  const history = queries.history;
  const diff = queries.diff;
  const diffPatch = queries.diffPatch;
  const identity = queries.identity;

  const repositoryList = $derived(queries.repositoryList);
  const workspaceRoots = $derived(queries.workspaceRoots);
  const repository = $derived(queries.repository);
  const displayedStashes = $derived(queries.displayedStashes);
  const stashPanelAvailable = $derived(queries.stashPanelAvailable);
  const commits = $derived(queries.commits);
  const graph = $derived(queries.graph);
  const historyNotices = $derived(queries.historyNotices);
  const selectedCommit = $derived(queries.selectedCommit);
  const detail = $derived(queries.detail);
  const diffRequest = $derived(queries.diffRequest);
  const sessionExpired = $derived(queries.sessionExpired);
  const primaryWorktreeId = $derived(queries.primaryWorktreeId);

  // The DOM listener stays at the composition root; query ownership only exposes the
  // invalidation intent and never reaches for `document` itself.
  $effect(() => {
    if (!browser) {
      return;
    }
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        invalidateWorkbenchBackgroundQueries(queryClient);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  });

  /* --------------------------------------------------------------- mutations */

  // Writes live behind the same authenticated client as reads. The page owns the
  // client and the confirmation flow; `git-ui` panels only render and emit intent.
  const mutations = $derived(
    createMutationClient({
      baseUrl,
      fetch: (input, init) => fetch(input, init),
      token: () => token,
    }),
  );

  let mutationBusy = $state(false);
  /** What the last create/clone reported, in the host's words; null when nothing is wrong. */
  let repositoryMessage: string | null = $state(null);
  let repositoryAccessMessage: string | null = $state(null);
  let stagingMessage = $state<string | null>(null);
  let commitResult = $state<string | null>(null);
  let branchMessage = $state<string | null>(null);
  let remoteMessage = $state<string | null>(null);
  let worktreeMessage = $state<string | null>(null);
  let submoduleMessage = $state<string | null>(null);
  let mergeMessage = $state<string | null>(null);

  /**
   * What this page is allowed to do with the service it found.
   *
   * The instance and the API major decide whether the remembered session and the write
   * controls are usable at all. A mismatch clears storage and the cache rather than
   * retrying: the token belongs to a service that is not answering, and the UI's idea of
   * an operation may not match the service's.
   */
  const negotiation: Negotiation = $derived(
    identity.data === undefined
      ? { kind: "ok" }
      : negotiateSession(
          { instanceId: pairedInstance, hasToken: token !== null },
          {
            serviceInstanceId: identity.data.serviceInstanceId,
            apiMajor: identity.data.apiMajor,
            contractVersion: capabilities.data?.contractVersion ?? "unknown",
          },
        ),
  );
  /**
   * Writes are refused when the page is offline, unpaired, or talking to a stranger.
   *
   * "Offline" here is the browser's own signal, not a quiet event stream: a dropped SSE
   * connection means no live hints, not an unreachable service, and the write itself
   * reports a real failure when the service is gone. What must never happen is a write
   * being *queued* for later, and nothing in this app queues one.
   */
  const writesAllowed = $derived(
    token !== null && !blocksWrites(negotiation) && browserOnline,
  );

  $effect(() => {
    const verdict = negotiation;
    if (verdict.kind === "ok") {
      return;
    }
    // Once per change: forgetting the session is what makes the notice disappear and
    // the pairing panel appear, so the state itself is the guard.
    if (verdict.kind === "differentInstance" && token !== null) {
      clearWorkbenchCredentials(session, sessionPorts);
      queryClient.clear();
      return;
    }
    if (verdict.kind === "incompatible") {
      queryClient.clear();
    }
  });

  const implementedKinds = $derived(
    new Set((capabilities.data?.operations ?? []).map((entry) => entry.kind)),
  );
  const stagingAvailable = $derived(implementedKinds.has("stagePaths"));
  const commitAvailable = $derived(implementedKinds.has("commit"));
  const branchAvailable = $derived(implementedKinds.has("createBranch"));
  const networkAvailable = $derived(implementedKinds.has("fetch"));
  const stashAvailable = $derived(implementedKinds.has("createStash"));
  const tagAvailable = $derived(implementedKinds.has("createTag"));
  const worktreeAvailable = $derived(implementedKinds.has("createWorktree"));
  /**
   * What the *service* says it can create, per operation.
   *
   * Capabilities that never arrived are `"unknown"`, not `false`. Those two answers look
   * alike in a boolean and are not alike at all: a service that answered and listed no
   * `initRepository` is a build fact, while a service that is not answering — stopped,
   * still starting — says nothing about this build. The panel words them separately,
   * because a page that has lost its service should name the connection, not the code.
   */
  const repositoryCreationAvailable = $derived(
    capabilities.data === undefined
      ? ("unknown" as const)
      : {
          init: implementedKinds.has("initRepository"),
          clone: implementedKinds.has("cloneRepository"),
        },
  );
  const submoduleAvailable = $derived(implementedKinds.has("addSubmodule"));
  const mergeAvailable = $derived(implementedKinds.has("merge"));
  /** The operation Git reports as unfinished, straight from the status read. */
  const operationInProgress = $derived(
    status.data?.operationInProgress ?? null,
  );
  /** Conflicted paths and their index stages, from the same read. */
  const conflictedPaths = $derived(
    (status.data?.entries ?? []).filter((entry) => entry.kind === "unmerged"),
  );
  /** Branch names a new worktree may check out, from the refs read. */
  const branchNames = $derived(
    (refs.data?.branches ?? []).map((branch) => branch.name),
  );

  /**
   * Follow an accepted operation to its terminal state.
   *
   * The UI shows an outcome, so it polls the record rather than pretending the 202 is
   * the result. The polling rules — a lost connection re-reads, never resubmits — live
   * in `$lib/operation-follow.ts`, where they are tested without a browser.
   */
  async function awaitOperation(operationId: string): Promise<string> {
    return followOperation(mutations, operationId);
  }

  /**
   * Refresh status, then hand the writer the snapshot it must target.
   *
   * Mutations carry the snapshot they were planned against; re-reading first means a
   * request is not refused as stale because the user took a moment to decide.
   */
  async function performWrite(
    label: string,
    buildOperation: (context: {
      worktreeId: string;
    }) =>
      | ParsedMutationRequest["operation"]
      | Promise<ParsedMutationRequest["operation"]>,
    report: (message: string | null) => void = (message) => {
      stagingMessage = message;
    },
    targetKind: "worktree" | "repository" = "worktree",
  ): Promise<void> {
    mutationBusy = true;
    report(null);
    try {
      if (!writesAllowed) {
        // Nothing is queued for later: an offline page cannot know whether the request
        // it would send is still the right one, and a write replayed after reconnecting
        // is exactly what this refuses to do.
        throw new Error(
          !browserOnline
            ? "this browser is offline; nothing was sent and nothing will be retried"
            : negotiation.kind === "ok"
              ? "not paired with the service; pair before writing"
              : negotiation.message,
        );
      }
      if (selectedRepositoryId === null || primaryWorktreeId === null) {
        throw new Error("no repository selected");
      }
      const operation = await buildOperation({ worktreeId: primaryWorktreeId });
      const target =
        targetKind === "worktree"
          ? await (async () => {
              const snapshot = await client.status({
                repositoryId: selectedRepositoryId,
                worktreeId: primaryWorktreeId,
              });
              return {
                kind: "worktree" as const,
                repositoryId: snapshot.repositoryId,
                worktreeId: snapshot.worktreeId,
                expectedSnapshotId: snapshot.snapshotId,
              };
            })()
          : await (async () => {
              const snapshot = await client.refs({
                repositoryId: selectedRepositoryId,
              });
              return {
                kind: "repository" as const,
                repositoryId: snapshot.repositoryId,
                expectedSnapshotId: snapshot.snapshotId,
              };
            })();
      const submitted = await mutations.submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target,
        operation,
      });
      const operationId =
        submitted.kind === "accepted"
          ? submitted.accepted.operationId
          : submitted.record.operationId;
      report(await awaitOperation(operationId));
      // The SSE hint will also invalidate; doing it here as well keeps the pane
      // correct when the stream is down.
      await queryClient.invalidateQueries({
        queryKey: ["status", baseUrl, token, selectedRepositoryId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["refs", baseUrl, token, selectedRepositoryId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["stashes", baseUrl, token, selectedRepositoryId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["history", baseUrl, token, selectedRepositoryId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["worktrees", baseUrl, token, selectedRepositoryId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["submodules", baseUrl, token, selectedRepositoryId],
      });
    } catch (error) {
      report(describeClientProblem(error));
    } finally {
      mutationBusy = false;
    }
  }

  /**
   * Create a repository: the one write whose target is a workspace.
   *
   * There is no repository to plan against yet and no snapshot to be stale — the
   * operation is what brings the repository into being — so this does not go through
   * `performWrite`. What it shares with it is the part that matters: an offline or
   * unpaired page sends nothing and queues nothing, the 202 is followed to its
   * terminal state instead of being read as success, and a failure is reported in the
   * host's own words (Git's diagnostic for a refusal).
   *
   * On success the list is refetched and the new repository selected, because "create
   * a repository" means "and then work in it", not "and then find it in a list".
   */
  async function createRepository(
    label: string,
    operation: ParsedMutationRequest["operation"],
    allowedRootId: string,
    relativeDestination: string,
  ): Promise<void> {
    mutationBusy = true;
    repositoryMessage = null;
    try {
      if (!writesAllowed) {
        throw new Error(
          !browserOnline
            ? "this browser is offline; nothing was sent and nothing will be retried"
            : negotiation.kind === "ok"
              ? "not paired with the service; pair before writing"
              : negotiation.message,
        );
      }
      const submitted = await mutations.submit({
        clientRequestId: `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        target: { kind: "workspace", allowedRootId, relativeDestination },
        operation,
      });
      const operationId =
        submitted.kind === "accepted"
          ? submitted.accepted.operationId
          : submitted.record.operationId;
      repositoryMessage = await awaitOperation(operationId);

      const refreshed = await repositories.refetch();
      const created = (refreshed.data?.repositories ?? []).find((entry) =>
        entry.displayPath.endsWith(relativeDestination),
      );
      if (created !== undefined) {
        selectRepository(selection, created.repositoryId);
        await queryClient.invalidateQueries({ queryKey: ["status"] });
        await queryClient.invalidateQueries({ queryKey: ["refs"] });
      }
    } catch (error) {
      repositoryMessage = describeClientProblem(error);
    } finally {
      mutationBusy = false;
    }
  }

  function onRepositoryInit(request: RepositoryInitRequest): void {
    void createRepository(
      "init-repository",
      { kind: "initRepository", initialBranch: request.initialBranch },
      request.allowedRootId,
      request.relativeDestination,
    );
  }

  function onRepositoryClone(request: RepositoryCloneRequest): void {
    void createRepository(
      "clone-repository",
      {
        kind: "cloneRepository",
        remoteUrl: request.remoteUrl,
        relativeDestination: request.relativeDestination,
        initializeSubmodules: request.initializeSubmodules,
      },
      request.allowedRootId,
      request.relativeDestination,
    );
  }

  async function registerRepository(path: string): Promise<void> {
    mutationBusy = true;
    repositoryAccessMessage = null;
    try {
      if (!writesAllowed) {
        throw new Error(
          !browserOnline
            ? "this browser is offline; nothing was sent and nothing will be retried"
            : negotiation.kind === "ok"
              ? "not paired with the service; pair before changing repository access"
              : negotiation.message,
        );
      }
      const result = await client.registerRepository(path);
      repositoryAccessMessage = `approved ${path}`;
      await repositories.refetch();
      const added = result.repositories.find(
        (entry) => entry.displayPath === path,
      );
      if (added !== undefined) {
        selectRepository(selection, added.repositoryId);
      }
    } catch (error) {
      repositoryAccessMessage = describeClientProblem(error);
    } finally {
      mutationBusy = false;
    }
  }

  async function revokeRepository(repositoryId: string): Promise<void> {
    mutationBusy = true;
    repositoryAccessMessage = null;
    try {
      if (!writesAllowed) {
        throw new Error(
          !browserOnline
            ? "this browser is offline; nothing was sent and nothing will be retried"
            : negotiation.kind === "ok"
              ? "not paired with the service; pair before changing repository access"
              : negotiation.message,
        );
      }
      await client.revokeRepository(repositoryId);
      repositoryAccessMessage = `revoked ${repositoryId}`;
      clearRepositoryIfSelected(selection, repositoryId);
      await repositories.refetch();
    } catch (error) {
      repositoryAccessMessage = describeClientProblem(error);
    } finally {
      mutationBusy = false;
    }
  }

  /** Preview tokens for a selection, positionally aligned with the path ids. */
  async function previewTokensFor(
    worktreeId: string,
    pathIds: readonly string[],
  ): Promise<readonly string[]> {
    const previews = await client.previews({
      repositoryId: selectedRepositoryId ?? "",
      worktreeId,
      pathIds: [...pathIds],
    });
    const byPath = new Map(
      previews.tokens.map((token) => [token.pathId, token.previewToken]),
    );
    return pathIds.map((pathId) => {
      const token = byPath.get(pathId);
      if (token === undefined) {
        throw new Error("the host issued no preview token for a selected path");
      }
      return token;
    });
  }

  function onStage(pathIds: readonly string[]): void {
    void performWrite("stage", async ({ worktreeId }) => ({
      kind: "stagePaths",
      pathIds: [...pathIds],
      previewTokens: [...(await previewTokensFor(worktreeId, pathIds))],
    }));
  }

  function onUnstage(pathIds: readonly string[]): void {
    void performWrite("unstage", () => ({
      kind: "unstagePaths",
      pathIds: [...pathIds],
    }));
  }

  function onDiscard(pathIds: readonly string[]): void {
    void performWrite("discard", async ({ worktreeId }) => ({
      kind: "discardTrackedPaths",
      pathIds: [...pathIds],
      previewTokens: [...(await previewTokensFor(worktreeId, pathIds))],
      confirmed: true,
    }));
  }

  function onCommit(message: string): void {
    void performWrite(
      "commit",
      () => ({ kind: "commit", message }),
      (result) => {
        commitResult = result;
      },
    );
  }

  function onAmend(message: string | null): void {
    void performWrite(
      "amend",
      () => ({ kind: "amendCommit", message, confirmed: true }),
      (result) => {
        commitResult = result;
      },
    );
  }

  /* ----------------------------------------------------- branches and remotes */

  function onBranchCreate(branchName: string): void {
    void performWrite(
      "create-branch",
      () => ({
        kind: "createBranch",
        branchName,
        startOid: null,
        switchToIt: false,
      }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchSwitch(branchName: string): void {
    void performWrite(
      "switch-branch",
      () => ({ kind: "switchBranch", branchName }),
      (result) => {
        branchMessage = result;
      },
      "worktree",
    );
  }

  function onBranchRename(branchName: string, newName: string): void {
    void performWrite(
      "rename-branch",
      () => ({ kind: "renameBranch", branchName, newName }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchDelete(branchName: string): void {
    void performWrite(
      "delete-branch",
      () => ({ kind: "deleteBranch", branchName, confirmed: true }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  function onBranchSetUpstream(
    branchName: string,
    upstream: {
      readonly remoteName: string;
      readonly branchName: string;
    } | null,
  ): void {
    void performWrite(
      "set-branch-upstream",
      () => ({ kind: "setBranchUpstream", branchName, upstream }),
      (result) => {
        branchMessage = result;
      },
      "repository",
    );
  }

  /* ------------------------------------------------------------------ merging */

  /**
   * Merge a branch into the current one.
   *
   * The request carries the commit the branch points at *now*, read from the refs on
   * screen, so a branch that moves before the request lands is a stale snapshot the
   * host refuses rather than a different merge than the one the user chose.
   */
  function onBranchMerge(branchName: string, noFf: boolean): void {
    const branch = (refs.data?.branches ?? []).find(
      (entry) => entry.name === branchName,
    );
    if (branch === undefined) {
      mergeMessage = `no branch named ${branchName} is on screen; refresh and retry`;
      return;
    }
    void performWrite(
      "merge",
      () => ({
        kind: "merge",
        sourceOid: branch.oid,
        mode: noFf ? ("no-ff" as const) : ("default" as const),
        message: null,
      }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onMergeContinue(): void {
    void performWrite(
      "continue-merge",
      () => ({ kind: "continueMerge", message: null }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onMergeAbort(): void {
    void performWrite(
      "abort-merge",
      () => ({ kind: "abortMerge", confirmed: true }),
      (result) => {
        mergeMessage = result;
      },
      "worktree",
    );
  }

  function onRemoteAdd(remoteName: string, fetchUrl: string): void {
    void performWrite(
      "add-remote",
      () => ({ kind: "addRemote", remoteName, fetchUrl, pushUrl: null }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onRemoteUpdate(
    remoteName: string,
    changes: {
      readonly newName: string | null;
      readonly fetchUrl: string | null;
      readonly pushUrl: string | null;
    },
  ): void {
    void performWrite(
      "update-remote",
      () => ({ kind: "updateRemote", remoteName, ...changes }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onRemoteRemove(remoteName: string): void {
    void performWrite(
      "remove-remote",
      () => ({ kind: "removeRemote", remoteName, confirmed: true }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onFetch(remoteName: string): void {
    void performWrite(
      "fetch",
      () => ({ kind: "fetch", remoteName, prune: false, tags: "none" }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onPush(remoteName: string, branchName: string): void {
    void performWrite(
      "push",
      () => ({
        kind: "push",
        remoteName,
        sourceRef: `refs/heads/${branchName}`,
        destinationRef: `refs/heads/${branchName}`,
        setUpstream: false,
      }),
      (result) => {
        remoteMessage = result;
      },
      "repository",
    );
  }

  function onPull(remoteName: string): void {
    void performWrite(
      "pull",
      () => ({ kind: "pull", remoteName, mode: "ff-only" }),
      (result) => {
        remoteMessage = result;
      },
      "worktree",
    );
  }

  /* ---------------------------------------------------------------- stashes */

  let stashResult = $state<string | null>(null);
  let tagResult = $state<string | null>(null);

  function onStashCreate(
    stashMessage: string,
    includeUntracked: boolean,
  ): void {
    void performWrite(
      "stash-create",
      () => ({
        kind: "createStash",
        message: stashMessage.trim().length === 0 ? null : stashMessage,
        includeUntracked,
        keepIndex: false,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashApply(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-apply",
      () => ({
        kind: "applyStash",
        stash: { oid: stash.oid, locator: stash.locator },
        restoreIndex: false,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashPop(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-pop",
      () => ({
        kind: "popStash",
        stash: { oid: stash.oid, locator: stash.locator },
        restoreIndex: false,
        confirmed: true,
      }),
      (result) => {
        stashResult = result;
      },
      "worktree",
    );
  }

  function onStashDrop(stash: { oid: string; locator: string }): void {
    void performWrite(
      "stash-drop",
      () => ({
        kind: "dropStash",
        stash: { oid: stash.oid, locator: stash.locator },
        confirmed: true,
      }),
      (result) => {
        stashResult = result;
      },
      "repository",
    );
  }

  /* ------------------------------------------------------------------- tags */

  function onTagCreate(tagName: string, annotation: string | null): void {
    void performWrite(
      "tag-create",
      () => ({
        kind: "createTag",
        tagName,
        targetOid: null,
        annotation: annotation === null ? null : { message: annotation },
      }),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  function onTagDelete(tagName: string): void {
    void performWrite(
      "tag-delete",
      () => ({ kind: "deleteTag", tagName, confirmed: true }),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  function onTagPush(tagName: string): void {
    const remote = refs.data?.remotes[0]?.name ?? null;
    if (remote === null) {
      tagResult = "no remote to push to";
      return;
    }
    void performWrite(
      "tag-push",
      () => ({ kind: "pushTag", remoteName: remote, tagName }),
      (result) => {
        tagResult = result;
      },
      "repository",
    );
  }

  /* ------------------------------------------------ worktrees and submodules */

  /**
   * A new worktree's branch reference, resolved against the current refs.
   *
   * `newBranch` starts from the commit HEAD is at, read at request time rather than
   * from the refs the screen was drawn with: the snapshot check would refuse a start
   * point that moved while the user was typing, and a refusal is the honest answer
   * only when the user actually asked for the old commit.
   */
  async function worktreeReference(reference: {
    readonly kind: "newBranch" | "existingBranch" | "detached";
    readonly branchName?: string;
    readonly oid?: string;
  }): Promise<
    | {
        readonly kind: "newBranch";
        readonly branchName: string;
        readonly startOid: string;
      }
    | { readonly kind: "existingBranch"; readonly branchName: string }
    | { readonly kind: "detached"; readonly oid: string }
  > {
    if (reference.kind === "detached") {
      return { kind: "detached", oid: reference.oid ?? "" };
    }
    if (reference.kind === "existingBranch") {
      return { kind: "existingBranch", branchName: reference.branchName ?? "" };
    }
    if (selectedRepositoryId === null || primaryWorktreeId === null) {
      throw new Error("no worktree selected");
    }
    const snapshot = await client.status({
      repositoryId: selectedRepositoryId,
      worktreeId: primaryWorktreeId,
    });
    const head = snapshot.head;
    if (head.kind !== "born" || head.oid === null) {
      throw new Error(
        "this repository has no commit yet, so a new worktree has nothing to start from",
      );
    }
    return {
      kind: "newBranch",
      branchName: reference.branchName ?? "",
      startOid: head.oid,
    };
  }

  function onWorktreeCreate(
    relativeDestination: string,
    reference: {
      readonly kind: "newBranch" | "existingBranch" | "detached";
      readonly branchName?: string;
      readonly oid?: string;
    },
  ): void {
    void performWrite(
      "create-worktree",
      async () => ({
        kind: "createWorktree",
        relativeDestination,
        reference: await worktreeReference(reference),
      }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeRemove(worktreeId: string): void {
    void performWrite(
      "remove-worktree",
      () => ({ kind: "removeWorktree", worktreeId, confirmed: true }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeLock(worktreeId: string, reason: string | null): void {
    void performWrite(
      "lock-worktree",
      () => ({ kind: "lockWorktree", worktreeId, reason }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onWorktreeUnlock(worktreeId: string): void {
    void performWrite(
      "unlock-worktree",
      () => ({ kind: "unlockWorktree", worktreeId }),
      (result) => {
        worktreeMessage = result;
      },
      "repository",
    );
  }

  function onSubmoduleAdd(input: {
    remoteUrl: string;
    relativePath: string;
    branchName: string | null;
  }): void {
    void performWrite(
      "add-submodule",
      () => ({
        kind: "addSubmodule",
        remoteUrl: input.remoteUrl,
        relativePath: input.relativePath,
        branchName: input.branchName,
        initialize: true,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  function onSubmoduleUpdate(
    pathIds: readonly string[],
    recursive: boolean,
  ): void {
    void performWrite(
      "update-submodule",
      () => ({
        kind: "updateSubmodule",
        pathIds: [...pathIds],
        initialize: true,
        recursive,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  function onSubmoduleSync(
    pathIds: readonly string[],
    recursive: boolean,
  ): void {
    void performWrite(
      "sync-submodule",
      () => ({
        kind: "syncSubmodule",
        pathIds: [...pathIds],
        recursive,
      }),
      (result) => {
        submoduleMessage = result;
      },
      "worktree",
    );
  }

  /* ------------------------------------------------------- connection and hints */

  // Browser reachability and SSE are separate signals: navigator.onLine gates writes,
  // while the event stream only reports whether live invalidation hints are arriving.
  $effect(() => {
    if (!browser) {
      return;
    }
    return observeBrowserConnectivity(connectivity, {
      isOnline: () => navigator.onLine,
      addEventListener: (type, listener) =>
        window.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        window.removeEventListener(type, listener),
    });
  });

  $effect(() => {
    if (!browser) {
      connectivity.streamState = "offline";
      return;
    }
    return startWorkbenchEventStream(connectivity, {
      baseUrl,
      token: () => token,
      fetch: (input, init) => fetch(input, init),
      invalidate: (queryKey) => {
        if (queryKey === undefined) {
          void queryClient.invalidateQueries();
        } else {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
    });
  });

  /* ------------------------------------------------------------------ clock */

  let now = $state(Date.now());
  $effect(() => {
    const handle = setInterval(() => {
      now = Date.now();
    }, 30_000);
    return () => {
      clearInterval(handle);
    };
  });

  /* --------------------------------------------------------------- helpers */

  /** True while the chosen address is still this page's own origin. */
  const baseUrlIsDefault = $derived(isDefaultSessionBaseUrl(session));
</script>

<div class="relative flex h-dvh min-h-0 flex-col bg-canvas text-ink">
  {#if background !== "none"}
    <div
      class="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-500"
      style="background-image: url('{background === 'mountain-mist'
        ? '/backgrounds/mountain-mist.svg'
        : background === 'aurora'
          ? '/backgrounds/aurora.svg'
          : background}'); opacity: 0.85;"
    ></div>
  {/if}

  <header
    class="relative z-10 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-panel/90 px-4 backdrop-blur-md"
  >
    <div class="flex items-center gap-2">
      <RefyardLogo variant="mark" size={22} />
      <span class="text-sm font-semibold tracking-tight">refyard</span>

      {#if capabilities.data !== undefined}
        <span
          class="hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:flex"
        >
          <span class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px]"
            >git {capabilities.data.git.version}</span
          >
          <span class="text-ink-faint">·</span>
          <span
            class="font-mono text-[11px] text-ink-faint"
            title="service instance"
            >{shortOid(capabilities.data.serviceInstanceId)}</span
          >
        </span>
      {/if}
    </div>

    {#if repository !== null}
      <div
        class="hidden items-center gap-1.5 rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs shadow-2xs backdrop-blur-xs md:flex"
      >
        <FolderGit2 class="size-3.5 text-primary" />
        <span
          class="max-w-44 truncate font-semibold tracking-tight text-ink lg:max-w-64"
          title={repository.displayPath}
        >
          {repository.displayName}
        </span>
        {#if status.data?.head?.branchName}
          <span class="text-ink-faint">·</span>
          <div
            class="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <GitBranch class="size-3 text-primary/70" />
            <span class="font-medium text-foreground"
              >{status.data.head.branchName}</span
            >
          </div>
        {/if}
      </div>
    {/if}

    {#if capabilities.data !== undefined}
      <div class="flex items-center">
        {#if capabilities.data.operations.length === 0}
          <Badge
            tone="muted"
            data-testid="build-badge"
            title="No write operations: no route, no capability, no button."
          >
            read-only build
          </Badge>
        {:else}
          <Badge
            tone="branch"
            data-testid="build-badge"
            title={`Implemented write operations: ${capabilities.data.operations
              .map((operation) => operation.kind)
              .join(", ")}`}
          >
            {capabilities.data.operations.length} write operations
          </Badge>
        {/if}
      </div>
    {/if}

    <span class="flex-1"></span>

    {#if token !== null}
      <Badge
        tone={!browserOnline || negotiation.kind !== "ok"
          ? "warn"
          : streamState === "live"
            ? "branch"
            : "muted"}
        data-testid="connection-state"
        class="gap-1.5 py-0.5"
      >
        <span class="relative flex size-2">
          <span
            class={cn(
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              streamState === "live"
                ? "animate-ping bg-emerald-400"
                : "bg-muted-foreground",
            )}
          ></span>
          <span
            class={cn(
              "relative inline-flex size-2 rounded-full",
              streamState === "live" ? "bg-emerald-500" : "bg-muted-foreground",
            )}
          ></span>
        </span>
        {!browserOnline
          ? "not connected (offline)"
          : negotiation.kind === "incompatible"
            ? "not connected (incompatible service)"
            : negotiation.kind === "readOnlyCompatibility"
              ? "read-only (contract update available)"
              : streamState === "live"
                ? "live updates"
                : streamState === "connecting"
                  ? "connecting…"
                  : "no live updates"}
      </Badge>
      <span
        class="hidden font-mono text-xs text-ink-faint 2xl:inline"
        title="service address">{baseUrl}</span
      >
      <AppearanceSettings
        {accent}
        {background}
        {glass}
        onAccentChange={(val) => (accent = val)}
        onBackgroundChange={(val) => (background = val)}
        onGlassChange={(val) => (glass = val)}
      />
      <ModeToggle />
      <Button size="sm" variant="ghost" onclick={disconnect}>Disconnect</Button>
    {/if}
  </header>

  {#if sessionExpired}
    <div class="border-b border-border bg-panel px-4 py-2">
      <StateBanner
        state="disconnected"
        title="The session is no longer valid"
        detail="The service was restarted or the session expired. Pair again with a fresh ticket."
      >
        {#snippet action()}
          <Button size="sm" variant="outline" onclick={disconnect}
            >Pair again</Button
          >
        {/snippet}
      </StateBanner>
    </div>
  {/if}

  {#if token === null}
    <main class="flex-1 overflow-auto p-6">
      <ConnectionPanel
        {baseUrl}
        ticket={session.ticket}
        hosted={!baseUrlIsDefault}
        password={session.hostedPassword}
        phase={session.pairPhase}
        message={session.pairMessage}
        {baseUrlIsDefault}
        onBaseUrl={(value) => {
          session.baseUrl = value;
        }}
        onTicket={(value) => {
          session.ticket = value;
        }}
        onPassword={(value) => {
          session.hostedPassword = value;
        }}
        onConnect={() => void pair()}
      />
    </main>
  {:else}
    <main
      class="relative z-1 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18.5rem_minmax(0,1fr)_21rem] xl:grid-cols-[21rem_minmax(0,1fr)_25rem] 2xl:grid-cols-[23rem_minmax(0,1fr)_28rem]"
    >
      <aside
        class="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r border-border/80 bg-canvas/40 p-2.5 custom-scrollbar"
      >
        <SectionCard
          title="Repositories"
          count={repositoryList.length}
          open={true}
        >
          {#snippet icon()}
            <FolderGit2 class="size-3.5 text-muted-foreground" />
          {/snippet}
          <div class="flex flex-col gap-2">
            {#if repositories.isPending}
              <StateBanner state="loading" title="Loading repositories…" />
            {:else if repositories.isError}
              <StateBanner
                state="error"
                title="Could not list repositories"
                detail={describeClientProblem(repositories.error)}
              >
                {#snippet action()}
                  <Button
                    size="sm"
                    variant="outline"
                    onclick={() => void repositories.refetch()}
                  >
                    Retry
                  </Button>
                {/snippet}
              </StateBanner>
            {:else if repositoryList.length === 0}
              <StateBanner
                state="empty"
                title="No repositories"
                detail="Start the service in a repository (refyard open <path>) to read it here."
              />
            {:else}
              <RepositoryList
                repositories={repositoryList}
                selectedId={selectedRepositoryId}
                onSelect={(repositoryId) => {
                  selectRepository(selection, repositoryId);
                }}
              />
            {/if}
            {#if token !== null}
              <Separator />
              <RepositoryPanel
                roots={workspaceRoots}
                available={repositoryCreationAvailable}
                disabled={!writesAllowed}
                busy={mutationBusy}
                message={repositoryMessage}
                onInit={onRepositoryInit}
                onClone={onRepositoryClone}
              />
              <Separator />
              <RepositoryAccessPanel
                repositories={repositoryList}
                disabled={!writesAllowed}
                busy={mutationBusy}
                message={repositoryAccessMessage}
                onRegister={(path) => void registerRepository(path)}
                onRevoke={(repositoryId) => void revokeRepository(repositoryId)}
              />
            {/if}
          </div>
        </SectionCard>

        {#if repository !== null}
          <SectionCard
            title="Changes"
            count={status.data ? status.data.entries.length : undefined}
            open={true}
          >
            {#snippet icon()}
              <FileDiff class="size-3.5 text-muted-foreground" />
            {/snippet}
            <div class="flex flex-col gap-2">
              {#if status.isPending}
                <StateBanner state="loading" title="Reading status…" />
              {:else if status.isError}
                <StateBanner
                  state="error"
                  title="Could not read status"
                  detail={describeClientProblem(status.error)}
                >
                  {#snippet action()}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() => void status.refetch()}
                    >
                      Retry
                    </Button>
                  {/snippet}
                </StateBanner>
              {:else if status.data !== undefined}
                <StatusList
                  snapshot={status.data}
                  selectedPathId={selectedPath?.pathId ?? null}
                  onSelect={(entry) => {
                    selectStatusPath(selection, entry);
                  }}
                />
              {/if}
            </div>
          </SectionCard>

          {#if mergeAvailable && (operationInProgress !== null || mergeMessage !== null)}
            <ConflictPanel
              {operationInProgress}
              conflicted={conflictedPaths}
              disabled={mutationBusy}
              busy={mutationBusy}
              message={mergeMessage}
              onContinue={onMergeContinue}
              onAbort={onMergeAbort}
            />
          {/if}

          {#if stagingAvailable}
            <SectionCard
              title="Stage & commit"
              count={status.data
                ? status.data.entries.filter(
                    (entry) => entry.indexStatus !== ".",
                  ).length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitCommit class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-3">
                {#if status.isPending}
                  <StateBanner state="loading" title="Reading status…" />
                {:else if status.isError}
                  <StateBanner
                    state="error"
                    title="Could not read status"
                    detail={describeClientProblem(status.error)}
                  />
                {:else if status.data !== undefined}
                  <StagingPanel
                    entries={status.data.entries}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={stagingMessage}
                    {onStage}
                    {onUnstage}
                    {onDiscard}
                  />
                  {#if commitAvailable}
                    <Separator />
                    <CommitPanel
                      stagedCount={status.data.entries.filter(
                        (entry) => entry.indexStatus !== ".",
                      ).length}
                      disabled={mutationBusy}
                      busy={mutationBusy}
                      canAmend={status.data.head.kind === "born"}
                      message={commitResult}
                      {onCommit}
                      {onAmend}
                    />
                  {/if}
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if branchAvailable}
            <SectionCard
              title="Branches"
              count={refs.data ? refs.data.branches.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitBranch class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading branches…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <BranchPanel
                    refs={refs.data ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={branchMessage}
                    onCreate={onBranchCreate}
                    onSwitch={onBranchSwitch}
                    onRename={onBranchRename}
                    onDelete={onBranchDelete}
                    onSetUpstream={onBranchSetUpstream}
                    onMerge={onBranchMerge}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if networkAvailable}
            <SectionCard
              title="Remotes & sync"
              count={refs.data ? refs.data.remotes.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Globe class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading remotes…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <RemotePanel
                    refs={refs.data ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={remoteMessage}
                    onAdd={onRemoteAdd}
                    onUpdate={onRemoteUpdate}
                    onRemove={onRemoteRemove}
                    {onFetch}
                    {onPush}
                    {onPull}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if stashAvailable}
            <SectionCard
              title="Stashes"
              count={stashes.data ? stashes.data.stashes.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Archive class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if stashes.isPending && stashes.data === undefined}
                  <StateBanner state="loading" title="Reading stashes…" />
                {/if}
                {#if stashes.isError}
                  <StateBanner
                    state="error"
                    title="Could not read stashes"
                    detail={describeClientProblem(stashes.error)}
                  />
                {/if}
                {#if stashPanelAvailable}
                  <StashPanel
                    stashes={displayedStashes}
                    disabled={mutationBusy ||
                      stashes.isError ||
                      stashes.data === undefined}
                    busy={mutationBusy}
                    message={stashResult}
                    onCreate={onStashCreate}
                    onApply={onStashApply}
                    onPop={onStashPop}
                    onDrop={onStashDrop}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if tagAvailable}
            <SectionCard
              title="Tags"
              count={refs.data ? refs.data.tags.length : undefined}
              open={true}
            >
              {#snippet icon()}
                <Tag class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading tags…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <TagPanel
                    tags={refs.data?.tags ?? []}
                    remoteName={refs.data?.remotes[0]?.name ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={tagResult}
                    onCreate={onTagCreate}
                    onDelete={onTagDelete}
                    onPush={onTagPush}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if worktreeAvailable}
            <SectionCard
              title="Worktrees"
              count={worktrees.data
                ? worktrees.data.worktrees.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <Layers class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if worktrees.isPending}
                  <StateBanner state="loading" title="Reading worktrees…" />
                {:else if worktrees.isError}
                  <StateBanner
                    state="error"
                    title="Could not read worktrees"
                    detail={describeClientProblem(worktrees.error)}
                  />
                {:else}
                  <WorktreePanel
                    worktrees={worktrees.data?.worktrees ?? []}
                    branches={branchNames}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={worktreeMessage}
                    onCreate={onWorktreeCreate}
                    onRemove={onWorktreeRemove}
                    onLock={onWorktreeLock}
                    onUnlock={onWorktreeUnlock}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if submoduleAvailable}
            <SectionCard
              title="Submodules"
              count={submodules.data
                ? submodules.data.submodules.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <Boxes class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if submodules.isPending}
                  <StateBanner state="loading" title="Reading submodules…" />
                {:else if submodules.isError}
                  <StateBanner
                    state="error"
                    title="Could not read submodules"
                    detail={describeClientProblem(submodules.error)}
                  />
                {:else}
                  <SubmodulePanel
                    submodules={submodules.data?.submodules ?? []}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={submoduleMessage}
                    onAdd={onSubmoduleAdd}
                    onUpdate={onSubmoduleUpdate}
                    onSync={onSubmoduleSync}
                  />
                {/if}
              </div>
            </SectionCard>
          {/if}

          {#if !branchAvailable}
            <SectionCard
              title="Refs"
              count={refs.data
                ? refs.data.branches.length +
                  refs.data.remoteBranches.length +
                  refs.data.tags.length
                : undefined}
              open={true}
            >
              {#snippet icon()}
                <GitBranch class="size-3.5 text-muted-foreground" />
              {/snippet}
              <div class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading refs…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeClientProblem(refs.error)}
                  />
                {:else}
                  <RefsPanel refs={refs.data ?? null} />
                {/if}
              </div>
            </SectionCard>
          {/if}
        {/if}
      </aside>

      <section class="flex min-h-0 flex-col gap-2 p-3">
        <div class="shrink-0 flex items-center gap-2">
          <h2 class="text-sm font-semibold">History</h2>
          {#if repository !== null}
            <span
              class="truncate font-mono text-xs text-ink-faint"
              title={repository.displayPath}
            >
              {repository.displayName}
            </span>
          {/if}
          <span class="flex-1"></span>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            disabled={history.isFetching}
            onclick={() => void history.refetch()}
          >
            <RefreshCw
              class={cn("size-3.5", history.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        {#if selectedRepositoryId === null}
          <StateBanner state="empty" title="No repository selected" />
        {:else if history.isPending}
          <StateBanner state="loading" title="Reading history…" />
        {:else if history.isError}
          <StateBanner
            state="error"
            title="Could not read history"
            detail={describeClientProblem(history.error)}
          >
            {#snippet action()}
              <Button
                size="sm"
                variant="outline"
                onclick={() => void history.refetch()}
              >
                Retry
              </Button>
            {/snippet}
          </StateBanner>
        {:else}
          <CommitList
            rows={graph.rows}
            {commits}
            {selectedOid}
            {now}
            hasMore={history.hasNextPage}
            loadingMore={history.isFetchingNextPage}
            truncated={historyNotices.truncated}
            tipsMoved={historyNotices.tipsMoved}
            shallow={historyNotices.shallow}
            laneCount={graph.laneCount}
            onSelect={(commit) => {
              selectCommit(selection, commit.oid);
            }}
            onLoadMore={() => void history.fetchNextPage()}
            class="min-h-0 flex-1"
          />
        {/if}
      </section>

      <section
        class="flex min-h-0 flex-col border-l border-border bg-canvas/30"
      >
        {#if selectedPath !== null && selectedPath.kind === "ignored"}
          <div class="p-3">
            <StateBanner
              state="info"
              title="Ignored path"
              detail="Git does not report content for an ignored path, so there is no diff to read."
            />
          </div>
        {:else if diffRequest === null}
          <div
            class="flex flex-1 flex-col items-center justify-center p-6 text-center"
          >
            <div
              class="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground shadow-2xs border border-border/50"
            >
              <FileDiff class="size-6 text-primary/70" />
            </div>
            <h3 class="text-sm font-medium text-foreground">
              No diff selected
            </h3>
            <p class="mt-1 max-w-xs text-xs text-muted-foreground">
              Select a commit in History or a modified file in Changes to
              inspect the diff.
            </p>
            <div class="mt-4 w-full max-w-xs">
              <StateBanner
                state="empty"
                title="Nothing selected"
                detail="Choose a commit or a changed path to read its diff."
              />
            </div>
          </div>
        {:else}
          {#if selectedOid !== null}
            <CommitDetailPanel
              commit={selectedCommit}
              {detail}
              class="max-h-72 shrink-0 border-b border-border"
            />
          {/if}
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {#if diff.isPending}
              <div class="p-3">
                <StateBanner state="loading" title="Reading diff…" />
              </div>
            {:else if diff.isError}
              <div class="p-3">
                <StateBanner
                  state="error"
                  title="Could not read the diff"
                  detail={describeClientProblem(diff.error)}
                >
                  {#snippet action()}
                    <Button
                      size="sm"
                      variant="outline"
                      onclick={() => void diff.refetch()}
                    >
                      Retry
                    </Button>
                  {/snippet}
                </StateBanner>
              </div>
            {:else}
              <DiffPanel
                diff={diff.data ?? null}
                patch={diffPatch.data ?? null}
                selectedPathId={selectedDiffPathId}
                onSelectPath={(file) => {
                  selectDiffPath(selection, file.pathId);
                }}
                class="p-3"
              />
            {/if}
          </div>
        {/if}

        {#if primaryWorktreeId !== null}
          <footer
            class="shrink-0 border-t border-border px-3 py-2 text-xs text-ink-faint"
          >
            worktree <span class="font-mono">{shortOid(primaryWorktreeId)}</span
            >
            {#if repository !== null}· {repository.objectFormat}{/if}
            {#if status.data !== undefined && status.data.truncated}
              · status truncated
            {/if}
            {#if refs.data !== undefined && refs.data.truncated}
              · refs truncated
            {/if}
          </footer>
        {/if}
      </section>
    </main>
  {/if}
</div>
