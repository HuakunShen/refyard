<script lang="ts">
  /**
   * The workbench page.
   *
   * This is the only place that knows how to talk to a service: it owns the runtime
   * connection (address, session token, SSE stream) and the query cache, and it composes
   * `@refyard/git-ui` components that take plain props. Keeping that split means the
   * components can be reused by another host, and it means the app has no business logic
   * about Git in it — only reads, selection, and the states around them.
   *
   * Everything here is a read. There is no submit, no stage, no discard: M1's capability
   * list has no write operations, and the UI reflects that rather than offering a control
   * that would be refused.
   */
  import { browser } from "$app/environment";
  import {
    GitClientError,
    createEventStream,
    createGitClient,
    createMutationClient,
  } from "@refyard/git-client";
  import type {
    CommitDetail,
    CommitSummary,
    DiffResponse,
    ParsedMutationRequest,
    StatusEntry,
  } from "@refyard/git-contract";
  import { layoutPages, type GraphCommit } from "@refyard/git-graph";
  import {
    Badge,
    BranchPanel,
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CommitDetailPanel,
    CommitList,
    CommitPanel,
    ConnectionPanel,
    DiffPanel,
    DEFAULT_METRICS,
    ModeToggle,
    RefsPanel,
    RemotePanel,
    Separator,
    RepositoryList,
    StagingPanel,
    StashPanel,
    StateBanner,
    StatusList,
    SubmodulePanel,
    TagPanel,
    WorktreePanel,
    shortOid,
  } from "@refyard/git-ui";
  import {
    createInfiniteQuery,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { parseSessionConfig, stripTicket } from "$lib/connection.js";
  import {
    readStoredBaseUrl,
    readStoredToken,
    storeBaseUrl,
    storeToken,
  } from "$lib/storage.js";

  const HISTORY_PAGE_SIZE = 100;

  /* ------------------------------------------------------- runtime connection */

  const initial = browser
    ? parseSessionConfig({
        href: window.location.href,
        storedBaseUrl: readStoredBaseUrl(),
      })
    : { baseUrl: "http://127.0.0.1:47831", ticket: null, overridden: false };

  let baseUrl = $state(initial.baseUrl);
  let ticket = $state(initial.ticket ?? "");
  const hadTicketOnLoad = initial.ticket !== null;
  let token = $state<string | null>(browser ? readStoredToken() : null);
  let pairPhase = $state<"idle" | "connecting" | "failed">("idle");
  let pairMessage = $state<string | undefined>(undefined);
  let streamState = $state<"offline" | "connecting" | "live">("offline");

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

  async function pair(): Promise<void> {
    const value = ticket.trim();
    if (value.length === 0) {
      return;
    }
    pairPhase = "connecting";
    pairMessage = undefined;
    try {
      const session = await client.exchangeTicket(value);
      token = session.token;
      storeToken(session.token);
      storeBaseUrl(
        initial.overridden || baseUrl !== initial.baseUrl ? baseUrl : null,
      );
      pairPhase = "idle";
      ticket = "";
      if (browser) {
        // The ticket is spent; leaving it in the address bar would replay a dead value on
        // reload and leave a credential in the browser's history.
        window.history.replaceState({}, "", stripTicket(window.location.href));
      }
    } catch (error) {
      pairPhase = "failed";
      pairMessage = describeProblem(error);
    }
  }

  function disconnect(): void {
    token = null;
    storeToken(null);
    selectedOid = null;
    selectedPath = null;
    queryClient.clear();
  }

  // A pairing URL is meant to work by being opened. Doing the exchange on load is the
  // whole point of the fragment; asking the user to press a button would be theatre.
  $effect(() => {
    if (
      browser &&
      hadTicketOnLoad &&
      token === null &&
      ticket.length > 0 &&
      pairPhase === "idle"
    ) {
      void pair();
    }
  });

  /* ------------------------------------------------------------------- reads */

  const enabled = $derived(token !== null);
  const capabilities = createQuery(() => ({
    queryKey: ["capabilities", baseUrl, token],
    queryFn: () => client.capabilities(),
    enabled,
  }));
  const repositories = createQuery(() => ({
    queryKey: ["repositories", baseUrl, token],
    queryFn: () => client.repositories(),
    enabled,
  }));

  let selectedRepositoryId = $state<string | null>(null);
  let selectedOid = $state<string | null>(null);
  let selectedPath = $state<StatusEntry | null>(null);
  /**
   * The file selected inside the current change set.
   *
   * A diff is read in two steps on purpose: the change set first (paths and counts), then
   * one file's patch, which is how the host bounds the work. This is the second step's
   * argument.
   */
  let selectedDiffPathId = $state<string | null>(null);

  const repositoryList = $derived(repositories.data?.repositories ?? []);
  const repository = $derived(
    repositoryList.find(
      (entry) => entry.repositoryId === selectedRepositoryId,
    ) ?? null,
  );

  $effect(() => {
    if (repositoryList.length === 0) {
      return;
    }
    const stillThere = repositoryList.some(
      (entry) => entry.repositoryId === selectedRepositoryId,
    );
    if (!stillThere) {
      selectedRepositoryId = repositoryList[0]?.repositoryId ?? null;
      selectedOid = null;
      selectedPath = null;
    }
  });

  const status = createQuery(() => ({
    queryKey: ["status", baseUrl, token, selectedRepositoryId],
    queryFn: () =>
      client.status({
        repositoryId: selectedRepositoryId ?? "",
        worktreeId: repository?.primaryWorktreeId,
      }),
    enabled: enabled && selectedRepositoryId !== null,
  }));

  const refs = createQuery(() => ({
    queryKey: ["refs", baseUrl, token, selectedRepositoryId],
    queryFn: () => client.refs({ repositoryId: selectedRepositoryId ?? "" }),
    enabled: enabled && selectedRepositoryId !== null,
  }));

  const stashes = createQuery(() => ({
    queryKey: ["stashes", baseUrl, token, selectedRepositoryId],
    queryFn: () => client.stashes({ repositoryId: selectedRepositoryId ?? "" }),
    enabled: enabled && selectedRepositoryId !== null,
  }));

  const worktrees = createQuery(() => ({
    queryKey: ["worktrees", baseUrl, token, selectedRepositoryId],
    queryFn: () =>
      client.worktrees({ repositoryId: selectedRepositoryId ?? "" }),
    enabled: enabled && selectedRepositoryId !== null,
  }));

  /**
   * Submodule state of the primary worktree.
   *
   * The panel shows the worktree the write operations actually address, so the list
   * and the buttons cannot disagree about which checkout they mean.
   */
  const submodules = createQuery(() => {
    const worktreeId = repository?.primaryWorktreeId;
    return {
      queryKey: [
        "submodules",
        baseUrl,
        token,
        selectedRepositoryId,
        worktreeId,
      ],
      queryFn: () =>
        client.submodules({
          repositoryId: selectedRepositoryId ?? "",
          worktreeId: worktreeId ?? "",
        }),
      enabled:
        enabled && selectedRepositoryId !== null && worktreeId !== undefined,
    };
  });

  const history = createInfiniteQuery(() => ({
    queryKey: ["history", baseUrl, token, selectedRepositoryId],
    queryFn: ({ pageParam }) =>
      client.history({
        repositoryId: selectedRepositoryId ?? "",
        limit: HISTORY_PAGE_SIZE,
        ...(pageParam === null ? {} : { cursor: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: enabled && selectedRepositoryId !== null,
  }));

  const historyPages = $derived(history.data?.pages ?? []);
  const commits = $derived(historyPages.flatMap((page) => page.commits));
  // The fold is per page: page two starts from page one's lanes, so a merge that spans a
  // boundary is drawn as one line instead of two that do not meet.
  const graph = $derived(
    layoutPages(historyPages.map((page) => page.commits.map(toGraphCommit))),
  );
  const newestPage = $derived(historyPages[0] ?? null);
  // Page-level notices are combined over every loaded page: one truncated or shallow page
  // means the history on screen is incomplete, wherever in the list it happened.
  const historyNotices = $derived({
    truncated: historyPages.some((page) => page.truncated),
    tipsMoved: historyPages.some((page) => page.tipsMoved),
    shallow: historyPages.some((page) => page.shallow),
  });
  const selectedCommit = $derived(
    commits.find((commit) => commit.oid === selectedOid) ?? null,
  );

  const commitDetail = createQuery(() => ({
    queryKey: ["commit", baseUrl, token, selectedRepositoryId, selectedOid],
    queryFn: () =>
      client.history({
        repositoryId: selectedRepositoryId ?? "",
        detailOid: selectedOid ?? "",
        limit: 1,
      }),
    enabled: enabled && selectedRepositoryId !== null && selectedOid !== null,
  }));
  const detail: CommitDetail | null = $derived(
    commitDetail.data?.detail ?? null,
  );

  /**
   * What to diff for the current selection.
   *
   * A status path is diffed against the side that actually changed: the index when Git
   * says the index differs, the working tree otherwise, and the working tree as
   * synthesized text when the file is untracked. An ignored path is not diffed at all —
   * Git does not report content for it, so the pane explains that instead of showing an
   * empty patch that looks like an error.
   */
  const diffRequest = $derived.by(
    (): {
      kind: "commit" | "staged" | "unstaged" | "untracked";
      oid?: string;
      pathId?: string;
    } | null => {
      if (selectedPath !== null && selectedPath.kind !== "ignored") {
        if (selectedPath.kind === "untracked") {
          return { kind: "untracked", pathId: selectedPath.pathId };
        }
        return selectedPath.indexStatus === "."
          ? { kind: "unstaged", pathId: selectedPath.pathId }
          : { kind: "staged", pathId: selectedPath.pathId };
      }
      if (selectedOid !== null) {
        return { kind: "commit", oid: selectedOid };
      }
      return null;
    },
  );

  /** The change set: what changed, and by how much. No patch unless a path is named. */
  const diff = createQuery(() => {
    const request = diffRequest;
    return {
      queryKey: ["diff", baseUrl, token, selectedRepositoryId, request],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null) {
          throw new Error("no diff selected");
        }
        return client.diff({
          repositoryId: selectedRepositoryId ?? "",
          ...request,
        });
      },
      enabled: enabled && selectedRepositoryId !== null && request !== null,
    };
  });

  /**
   * The selected file's patch.
   *
   * A separate read because the host does not fetch a patch per file for a whole change
   * set: an untracked file already arrives with its patch (there is no Git object to diff
   * against), and everything else is asked for by path once the user picks a file.
   */
  const diffPatch = createQuery(() => {
    const request = diffRequest;
    const pathId = selectedDiffPathId;
    return {
      queryKey: [
        "diff-patch",
        baseUrl,
        token,
        selectedRepositoryId,
        request,
        pathId,
      ],
      queryFn: async (): Promise<DiffResponse> => {
        if (request === null || pathId === null) {
          throw new Error("no path selected");
        }
        return client.diff({
          repositoryId: selectedRepositoryId ?? "",
          ...request,
          pathId,
        });
      },
      enabled:
        enabled &&
        selectedRepositoryId !== null &&
        request !== null &&
        pathId !== null &&
        request.kind !== "untracked",
    };
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

  const OPERATION_TERMINAL = new Set([
    "succeeded",
    "failed",
    "needsAttention",
    "unknown",
    "cancelled",
  ]);

  let mutationBusy = $state(false);
  let stagingMessage = $state<string | null>(null);
  let commitResult = $state<string | null>(null);
  let branchMessage = $state<string | null>(null);
  let remoteMessage = $state<string | null>(null);
  let worktreeMessage = $state<string | null>(null);
  let submoduleMessage = $state<string | null>(null);

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
  const submoduleAvailable = $derived(implementedKinds.has("addSubmodule"));
  /** Branch names a new worktree may check out, from the refs read. */
  const branchNames = $derived(
    (refs.data?.branches ?? []).map((branch) => branch.name),
  );

  /**
   * Follow an accepted operation to its terminal state.
   *
   * The UI shows an outcome, so it polls the record rather than pretending the 202
   * is the result. A lost poll is surfaced as-is; nothing is resubmitted.
   */
  async function awaitOperation(operationId: string): Promise<string> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const record = await mutations.get(operationId);
      if (OPERATION_TERMINAL.has(record.status)) {
        if (record.status === "succeeded") {
          return record.result?.summary ?? "done";
        }
        return `${record.status}: ${record.problem?.message ?? "no detail"}`;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return "the operation did not finish in time; check the operation list before retrying";
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
      report(describeProblem(error));
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

  /* --------------------------------------------------------------- live hints */

  $effect(() => {
    if (!browser || token === null) {
      streamState = "offline";
      return;
    }
    const stream = createEventStream({
      baseUrl,
      fetch: (input, init) => fetch(input, init),
      token: () => token,
      onEvent: (envelope) => {
        const payload = envelope.payload;
        if (payload.kind === "repositoryChanged") {
          // A hint, not a source of truth: the queries re-read and stay correct even if
          // this call is the only one that ever arrives.
          void queryClient.invalidateQueries({
            queryKey: ["status", baseUrl, token, payload.repositoryId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["refs", baseUrl, token, payload.repositoryId],
          });
          void queryClient.invalidateQueries({
            queryKey: ["history", baseUrl, token, payload.repositoryId],
          });
        } else if (payload.kind === "eventGap") {
          void queryClient.invalidateQueries();
        }
      },
      onGap: () => {
        // Events were missed; nothing cached can be assumed current.
        void queryClient.invalidateQueries();
      },
      onError: () => {
        streamState = "offline";
      },
    });
    streamState = "connecting";
    void stream
      .start()
      .then(() => {
        streamState = "live";
      })
      .catch(() => {
        streamState = "offline";
      });
    return () => {
      stream.stop();
      streamState = "offline";
    };
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

  function toGraphCommit(commit: CommitSummary): GraphCommit {
    return {
      id: commit.oid,
      parentIds: commit.parents,
      refNames: commit.refNames,
    };
  }

  function describeProblem(error: unknown): string {
    if (error instanceof GitClientError) {
      const correlation =
        error.correlationId === null ? "" : ` (${error.correlationId})`;
      return `${error.code}: ${error.message}${correlation}`;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function problemCode(error: unknown): string | null {
    return error instanceof GitClientError ? error.code : null;
  }

  const authErrors = $derived(
    [
      repositories.error,
      capabilities.error,
      status.error,
      refs.error,
      history.error,
    ].filter((error) => problemCode(error) === "Unauthenticated"),
  );
  const sessionExpired = $derived(authErrors.length > 0);

  const primaryWorktreeId = $derived(repository?.primaryWorktreeId ?? null);
  /** True while the chosen address is still this page's own origin. */
  const baseUrlIsDefault = $derived(
    !initial.overridden && baseUrl === initial.baseUrl,
  );
</script>

<div class="flex h-dvh min-h-0 flex-col bg-canvas text-ink">
  <header
    class="flex flex-wrap items-center gap-3 border-b border-border bg-panel px-4 py-2"
  >
    <span class="text-sm font-semibold">refyard</span>

    {#if capabilities.data !== undefined}
      <span class="flex items-center gap-2 text-xs text-ink-muted">
        <span>git {capabilities.data.git.version}</span>
        <span class="text-ink-faint">·</span>
        <span class="font-mono" title="service instance"
          >{shortOid(capabilities.data.serviceInstanceId)}</span
        >
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
      </span>
    {/if}

    <span class="flex-1"></span>

    {#if token !== null}
      <Badge
        tone={streamState === "live"
          ? "branch"
          : streamState === "connecting"
            ? "muted"
            : "warn"}
      >
        {streamState === "live"
          ? "live updates"
          : streamState === "connecting"
            ? "connecting…"
            : "no live updates"}
      </Badge>
      <span class="font-mono text-xs text-ink-faint" title="service address"
        >{baseUrl}</span
      >
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
        {ticket}
        phase={pairPhase}
        message={pairMessage}
        {baseUrlIsDefault}
        onBaseUrl={(value) => {
          baseUrl = value;
        }}
        onTicket={(value) => {
          ticket = value;
        }}
        onConnect={() => void pair()}
      />
    </main>
  {:else}
    <main
      class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)_26rem]"
    >
      <aside
        class="flex min-h-0 flex-col gap-3 overflow-auto border-r border-border p-3"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle
              class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
            >
              Repositories
            </CardTitle>
          </CardHeader>
          <CardContent class="flex flex-col gap-2">
            {#if repositories.isPending}
              <StateBanner state="loading" title="Loading repositories…" />
            {:else if repositories.isError}
              <StateBanner
                state="error"
                title="Could not list repositories"
                detail={describeProblem(repositories.error)}
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
                  selectedRepositoryId = repositoryId;
                  selectedOid = null;
                  selectedPath = null;
                }}
              />
            {/if}
          </CardContent>
        </Card>

        <Separator />

        {#if repository !== null}
          <Card size="sm">
            <CardHeader>
              <CardTitle
                class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Changes
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-2">
              {#if status.isPending}
                <StateBanner state="loading" title="Reading status…" />
              {:else if status.isError}
                <StateBanner
                  state="error"
                  title="Could not read status"
                  detail={describeProblem(status.error)}
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
                    selectedPath = entry;
                    selectedOid = null;
                    selectedDiffPathId = null;
                  }}
                />
              {/if}
            </CardContent>
          </Card>

          {#if stagingAvailable}
            <Separator />

            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Stage &amp; commit
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-3">
                {#if status.isPending}
                  <StateBanner state="loading" title="Reading status…" />
                {:else if status.isError}
                  <StateBanner
                    state="error"
                    title="Could not read status"
                    detail={describeProblem(status.error)}
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
              </CardContent>
            </Card>
          {/if}

          <Separator />

          <Card size="sm">
            <CardHeader>
              <CardTitle
                class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
              >
                Refs
              </CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-2">
              {#if refs.isPending}
                <StateBanner state="loading" title="Reading refs…" />
              {:else if refs.isError}
                <StateBanner
                  state="error"
                  title="Could not read refs"
                  detail={describeProblem(refs.error)}
                />
              {:else}
                <RefsPanel refs={refs.data ?? null} />
              {/if}
            </CardContent>
          </Card>

          {#if branchAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Branches
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading branches…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeProblem(refs.error)}
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
                  />
                {/if}
              </CardContent>
            </Card>
          {/if}

          {#if networkAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Remotes &amp; sync
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading remotes…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeProblem(refs.error)}
                  />
                {:else}
                  <RemotePanel
                    refs={refs.data ?? null}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={remoteMessage}
                    onAdd={onRemoteAdd}
                    onRemove={onRemoteRemove}
                    {onFetch}
                    {onPush}
                    {onPull}
                  />
                {/if}
              </CardContent>
            </Card>
          {/if}

          {#if stashAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Stashes
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if stashes.isPending}
                  <StateBanner state="loading" title="Reading stashes…" />
                {:else if stashes.isError}
                  <StateBanner
                    state="error"
                    title="Could not read stashes"
                    detail={describeProblem(stashes.error)}
                  />
                {:else}
                  <StashPanel
                    stashes={stashes.data?.stashes ?? []}
                    disabled={mutationBusy}
                    busy={mutationBusy}
                    message={stashResult}
                    onCreate={onStashCreate}
                    onApply={onStashApply}
                    onPop={onStashPop}
                    onDrop={onStashDrop}
                  />
                {/if}
              </CardContent>
            </Card>
          {/if}

          {#if tagAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if refs.isPending}
                  <StateBanner state="loading" title="Reading tags…" />
                {:else if refs.isError}
                  <StateBanner
                    state="error"
                    title="Could not read refs"
                    detail={describeProblem(refs.error)}
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
              </CardContent>
            </Card>
          {/if}

          {#if worktreeAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Worktrees
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if worktrees.isPending}
                  <StateBanner state="loading" title="Reading worktrees…" />
                {:else if worktrees.isError}
                  <StateBanner
                    state="error"
                    title="Could not read worktrees"
                    detail={describeProblem(worktrees.error)}
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
              </CardContent>
            </Card>
          {/if}

          {#if submoduleAvailable}
            <Separator />
            <Card size="sm">
              <CardHeader>
                <CardTitle
                  class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
                >
                  Submodules
                </CardTitle>
              </CardHeader>
              <CardContent class="flex flex-col gap-2">
                {#if submodules.isPending}
                  <StateBanner state="loading" title="Reading submodules…" />
                {:else if submodules.isError}
                  <StateBanner
                    state="error"
                    title="Could not read submodules"
                    detail={describeProblem(submodules.error)}
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
              </CardContent>
            </Card>
          {/if}
        {/if}
      </aside>

      <section class="flex min-h-0 flex-col gap-2 p-3">
        <div class="flex items-center gap-2">
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
            disabled={history.isFetching}
            onclick={() => void history.refetch()}
          >
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
            detail={describeProblem(history.error)}
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
              selectedOid = commit.oid;
              selectedPath = null;
              selectedDiffPathId = null;
            }}
            onLoadMore={() => void history.fetchNextPage()}
            class="min-h-0 flex-1"
          />
        {/if}
      </section>

      <section class="flex min-h-0 flex-col border-l border-border">
        {#if selectedPath !== null && selectedPath.kind === "ignored"}
          <div class="p-3">
            <StateBanner
              state="info"
              title="Ignored path"
              detail="Git does not report content for an ignored path, so there is no diff to read."
            />
          </div>
        {:else if diffRequest === null}
          <div class="p-3">
            <StateBanner
              state="empty"
              title="Nothing selected"
              detail="Choose a commit or a changed path to read its diff."
            />
          </div>
        {:else}
          {#if selectedOid !== null}
            <CommitDetailPanel
              commit={selectedCommit}
              {detail}
              class="max-h-72 shrink-0 border-b border-border"
            />
          {/if}
          <div class="min-h-0 flex-1">
            {#if diff.isPending}
              <div class="p-3">
                <StateBanner state="loading" title="Reading diff…" />
              </div>
            {:else if diff.isError}
              <div class="p-3">
                <StateBanner
                  state="error"
                  title="Could not read the diff"
                  detail={describeProblem(diff.error)}
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
                  selectedDiffPathId = file.pathId;
                }}
                class="p-3"
              />
            {/if}
          </div>
        {/if}

        {#if primaryWorktreeId !== null}
          <footer
            class="border-t border-border px-3 py-2 text-xs text-ink-faint"
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
