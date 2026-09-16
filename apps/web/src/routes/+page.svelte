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
   * Reads, explicit approvals and submitted operations are composed here. The page does
   * not build Git commands: it sends closed contract intentions through the injected
   * clients, and capabilities decide which controls are visible.
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
    StashesResponse,
  } from "@refyard/git-contract";
  import { layoutPages, type GraphCommit } from "@refyard/git-graph";
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
  import {
    createInfiniteQuery,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import {
    extractTicketFromText,
    parseSessionConfig,
    stripTicket,
  } from "$lib/connection.js";
  import { followOperation } from "$lib/operation-follow.js";
  import {
    backgroundRead,
    createReadTimer,
    timedRead,
  } from "$lib/background-poll.js";
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
  /** A hosted password is entered for one exchange and is never persisted. */
  let hostedPassword = $state("");
  const hadTicketOnLoad = initial.ticket !== null;
  let token = $state<string | null>(browser ? readStoredToken() : null);
  /** The instance this tab paired with, as recorded when the token was stored. */
  let pairedInstance = $state<string | null>(
    browser ? readStoredInstance() : null,
  );
  let pairPhase = $state<"idle" | "connecting" | "failed">("idle");
  let pairMessage = $state<string | undefined>(undefined);
  let streamState = $state<"offline" | "connecting" | "live">("offline");
  let browserOnline = $state(true);

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

  async function pair(): Promise<void> {
    const rawValue = ticket.trim();
    if (rawValue.length === 0) {
      return;
    }
    const value = extractTicketFromText(rawValue);
    if (value.length === 0) {
      return;
    }
    pairPhase = "connecting";
    pairMessage = undefined;
    try {
      const session = await client.exchangeTicket(
        value,
        hostedPassword.length === 0 ? undefined : hostedPassword,
      );
      token = session.token;
      hostedPassword = "";
      storeToken(session.token);
      // Remembering the instance is what lets a later load notice that the address now
      // answers with a different service.
      const who = await client.health();
      pairedInstance = who.serviceInstanceId;
      storeInstance(who.serviceInstanceId);
      storeBaseUrl(
        initial.overridden || baseUrl !== initial.baseUrl ? baseUrl : null,
      );
      pairPhase = "idle";
    } catch (error) {
      pairPhase = "failed";
      pairMessage = describeProblem(error);
    } finally {
      // Keep a password-rejected ticket in memory so the user can correct the
      // password without asking the CLI for another one. The URL is still scrubbed
      // immediately, so the ticket never remains in browser history or a referrer.
      if (token !== null) {
        ticket = "";
      }
      if (browser) {
        // The ticket is spent or was attempted; leaving it in the address bar would replay a dead value on
        // reload and leave a credential in the browser's history.
        window.history.replaceState({}, "", stripTicket(window.location.href));
      }
    }
  }

  function disconnect(): void {
    token = null;
    pairedInstance = null;
    clearStoredSession();
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
    } else if (
      browser &&
      hadTicketOnLoad &&
      token !== null &&
      ticket.length > 0
    ) {
      // Already authenticated with a valid session: strip the pairing ticket from the URL
      // so it does not linger in the address bar or history.
      ticket = "";
      window.history.replaceState({}, "", stripTicket(window.location.href));
    }
  });

  /* ------------------------------------------------------------------- reads */

  const enabled = $derived(token !== null);
  /**
   * The last successful duration of each background read, which is what decides whether a
   * repository is paced at 2 s or at 30 s (see `$lib/background-poll.ts`).
   */
  const readTimer = createReadTimer();

  /**
   * Re-read the background queries the moment the tab becomes visible again.
   *
   * Hidden tabs poll every 15 s, so without this a user who comes back after an hour could
   * look at up to 15 seconds of stale repository. Only the background keys are refreshed —
   * a selected diff or path preview is read for the thing the user is looking at, and
   * re-reading all of them on every tab switch would be work nobody asked for.
   */
  $effect(() => {
    if (!browser) {
      return;
    }
    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") {
        return;
      }
      for (const prefix of [
        "repositories",
        "status",
        "refs",
        "stashes",
        "worktrees",
        "submodules",
        "history",
      ]) {
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  });
  /**
   * Whether the page is visible right now.
   *
   * The DOM read lives here, in the app that owns the browser, rather than in the polling
   * module: that module is the cadence arithmetic and is imported by a Node test, where
   * `document` does not exist. `ssr = false` means the guard is for that test, not for SSR.
   */
  function pageVisible(): boolean {
    return (
      typeof document === "undefined" || document.visibilityState !== "hidden"
    );
  }
  /** The cadence options a background read carries, for one query key. */
  const polled = (key: readonly unknown[]) =>
    backgroundRead({ key, timer: readTimer, visible: pageVisible });

  const capabilities = createQuery(() => ({
    queryKey: ["capabilities", baseUrl, token],
    queryFn: () => client.capabilities(),
    enabled,
  }));
  const repositories = createQuery(() => {
    const key = ["repositories", baseUrl, token];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => client.repositories(),
      }),
      enabled,
      ...polled(key),
    };
  });

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

  /**
   * The approved roots this session may create a repository in.
   *
   * A workspace target needs a root id, and the service reports one per repository it
   * knows — so the roots are read from there rather than invented or typed by hand. A
   * root the service never approved cannot be addressed, and a UI that offered one
   * would be offering a request that is refused every time.
   */
  const workspaceRoots = $derived([
    ...new Map(
      repositoryList.map((entry) => [
        entry.allowedRootId,
        { allowedRootId: entry.allowedRootId, displayPath: entry.displayPath },
      ]),
    ).values(),
  ]);
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

  const status = createQuery(() => {
    const key = ["status", baseUrl, token, selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          client.status({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: repository?.primaryWorktreeId,
          }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  const refs = createQuery(() => {
    const key = ["refs", baseUrl, token, selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => client.refs({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  const stashes = createQuery(() => {
    const key = ["stashes", baseUrl, token, selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () => client.stashes({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  /**
   * Keep the last known stash rows while a background read is pending or failed.
   * Query data is authoritative when it arrives, but the panel owns destructive
   * confirmation state and must not be remounted just because a retry is in flight.
   */
  let lastStashesRepositoryId = $state<string | null>(null);
  let lastStashes = $state<StashesResponse["stashes"]>([]);
  $effect(() => {
    const data = stashes.data;
    const repositoryId = selectedRepositoryId;
    if (data === undefined || repositoryId === null) {
      return;
    }
    lastStashesRepositoryId = repositoryId;
    lastStashes = data.stashes;
  });
  const displayedStashes = $derived(
    lastStashesRepositoryId === selectedRepositoryId
      ? lastStashes
      : (stashes.data?.stashes ?? []),
  );

  const worktrees = createQuery(() => {
    const key = ["worktrees", baseUrl, token, selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          client.worktrees({ repositoryId: selectedRepositoryId ?? "" }),
      }),
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

  /**
   * Submodule state of the primary worktree.
   *
   * The panel shows the worktree the write operations actually address, so the list
   * and the buttons cannot disagree about which checkout they mean.
   */
  const submodules = createQuery(() => {
    const worktreeId = repository?.primaryWorktreeId;
    const key = [
      "submodules",
      baseUrl,
      token,
      selectedRepositoryId,
      worktreeId,
    ];
    return {
      queryKey: key,
      queryFn: timedRead({
        key,
        timer: readTimer,
        run: () =>
          client.submodules({
            repositoryId: selectedRepositoryId ?? "",
            worktreeId: worktreeId ?? "",
          }),
      }),
      enabled:
        enabled && selectedRepositoryId !== null && worktreeId !== undefined,
      ...polled(key),
    };
  });

  const history = createInfiniteQuery(() => {
    const key = ["history", baseUrl, token, selectedRepositoryId];
    return {
      queryKey: key,
      queryFn: ({ pageParam }) =>
        timedRead({
          key: [...key, pageParam],
          timer: readTimer,
          run: () =>
            client.history({
              repositoryId: selectedRepositoryId ?? "",
              limit: HISTORY_PAGE_SIZE,
              ...(pageParam === null ? {} : { cursor: pageParam }),
            }),
        })(),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      enabled: enabled && selectedRepositoryId !== null,
      ...polled(key),
    };
  });

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
   * Ask the service who it is, without a token.
   *
   * `/health` is the one endpoint that answers without authentication, which is what
   * makes it the right probe here: a stale token must not be able to hide the fact that
   * the address now belongs to a different service — `capabilities` would answer 401,
   * and the page would blame the session instead of the instance.
   */
  const identity = createQuery(() => ({
    queryKey: ["identity", baseUrl],
    queryFn: () => client.health(),
    enabled,
  }));

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
      token = null;
      pairedInstance = null;
      clearStoredSession();
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
      report(describeProblem(error));
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
        selectedRepositoryId = created.repositoryId;
        selectedOid = null;
        selectedPath = null;
        await queryClient.invalidateQueries({ queryKey: ["status"] });
        await queryClient.invalidateQueries({ queryKey: ["refs"] });
      }
    } catch (error) {
      repositoryMessage = describeProblem(error);
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
        selectedRepositoryId = added.repositoryId;
        selectedOid = null;
        selectedPath = null;
      }
    } catch (error) {
      repositoryAccessMessage = describeProblem(error);
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
      if (selectedRepositoryId === repositoryId) {
        selectedRepositoryId = null;
        selectedOid = null;
        selectedPath = null;
      }
      await repositories.refetch();
    } catch (error) {
      repositoryAccessMessage = describeProblem(error);
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

  /**
   * The browser's own online signal.
   *
   * It is the only signal that means "the network is gone" rather than "this service is
   * not answering", and it is what the offline gate reads. A page that trusted a quiet
   * event stream instead would refuse writes on a service that is perfectly reachable.
   */
  $effect(() => {
    if (!browser) {
      return;
    }
    browserOnline = navigator.onLine;
    const update = (): void => {
      browserOnline = navigator.onLine;
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  });

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
        {ticket}
        hosted={!baseUrlIsDefault}
        password={hostedPassword}
        phase={pairPhase}
        message={pairMessage}
        {baseUrlIsDefault}
        onBaseUrl={(value) => {
          baseUrl = value;
        }}
        onTicket={(value) => {
          ticket = value;
        }}
        onPassword={(value) => {
          hostedPassword = value;
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
                    detail={describeProblem(stashes.error)}
                  />
                {/if}
                {#if stashes.data !== undefined || lastStashesRepositoryId === selectedRepositoryId}
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
                    detail={describeProblem(refs.error)}
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
