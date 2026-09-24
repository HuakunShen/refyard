/**
 * Host half of the Refyard plugin for the DeepSeek Harness.
 *
 * It adds one thing to the Harness host process: a Git workbench for the repository the
 * current session is working in, rendered by Refyard's own SPA inside the Harness Web UI.
 *
 * The shape is deliberate:
 *
 * - **No second browser origin.** The Harness already owns a loopback web server, so the
 *   workbench is mounted on it at `/refyard` rather than given a port of its own. One page
 *   origin means no CORS, no second thing to trust, and nothing new reachable from a page.
 * - **The workbench is Refyard, not a reimplementation.** A real Refyard service is
 *   assembled in this process out of `@refyard/host-node` — the same wiring the CLI uses —
 *   and its HTTP application answers behind this route. Everything the product can do to a
 *   repository (history, diffs, stage, commit, branches, stashes, worktrees) is therefore
 *   available here without a second implementation drifting behind the first.
 * - **The ticket still exists.** The service keeps its own authentication: a browser that
 *   reaches `/refyard` is redirected to a single-use pairing URL minted here in trusted
 *   code, exactly as the CLI mints one for a human at a terminal. The embedded frame is
 *   authenticated the same way every other Refyard client is; nothing was relaxed to make
 *   embedding convenient.
 * - **The frame is policed by the product's own rule.** `createOriginPolicy` — the check
 *   that exists because a loopback service is reachable by every page in the browser —
 *   guards this route too, so a cross-site page cannot use it to reach the workbench.
 * - **Repositories are approved on demand.** The panel names the directory it wants (the
 *   session's `cwd`), which becomes an approved root exactly as `refyard open` would
 *   approve it, and is recorded in the access journal. Nothing is pre-approved and no
 *   parent directory is ever widened.
 */
import {
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleService,
  createOriginPolicy,
  defaultStateRoot,
  resolveGitPath,
  startHttpHost,
  type HttpHost,
  type ServiceAssembly,
} from "@refyard/host-node";

/** Where the workbench is mounted on the Harness web server. The client half reads it too. */
const PREFIX = "/refyard";
/** The route the panel asks for its frame URL. */
const CONTEXT_ROUTE = `${PREFIX}/dsh/context`;

/** Wait for the web server before applying, so the route registers whenever it activates. */
export const inject = ["webServer"];

/**
 * The part of a Session this plugin reads: its identity, the directory it works in, and
 * whether it is a Session a person is looking at rather than a delegated child.
 *
 * A subagent works in the same directory as its parent, so reading a child's `cwd` is not
 * wrong — but a child that runs for an hour while the user reads a different Session would
 * win a "most recently active" comparison and point the panel at the wrong place. The flag
 * below is what keeps the answer to "which repository is this session about" honest.
 */
interface SessionAnnouncement {
  readonly id?: unknown;
  readonly header?: {
    readonly cwd?: unknown;
    readonly parentSession?: unknown;
    readonly origin?: unknown;
  };
}

/** The part of the Harness web server this plugin needs. */
interface WebServerLike {
  /** The listening port, set by the web server's own activation. */
  readonly port?: number;
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

/**
 * The slice of the Harness host context this plugin uses.
 *
 * The Harness host is not a dependency of this repository — the plugin is loaded *by* the
 * Harness and built against nothing — so the contract it relies on is declared here rather
 * than imported. Writing the shape down is what lets the plugin be type-checked at all; it
 * is a statement of what the host provides, not a promise this repository can enforce, so
 * every member stays optional-in-practice and is checked at the point of use.
 */
interface HostContext {
  readonly logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  get(name: "webServer"): WebServerLike | undefined;
  on(
    name: "session/created",
    listener: (session: SessionAnnouncement) => void,
  ): unknown;
  on(
    name: "session/event",
    listener: (session: SessionAnnouncement, event: unknown) => void,
  ): unknown;
  effect(install: () => void | (() => void), label?: string): unknown;
}

/** What approving one directory settled on: the repository, or why it did not. */
type ApprovalOutcome =
  | { readonly ok: true; readonly repositoryId: string }
  | { readonly ok: false; readonly message: string };

/** The running workbench: Refyard's assembled service plus its loopback listener. */
interface Workbench {
  readonly http: HttpHost;
  readonly assembly: ServiceAssembly;
}

/** One directory the panel may show, and whether a person or a delegated child works there. */
interface RepositoryCandidate {
  readonly path: string;
  readonly root: boolean;
}

export function apply(ctx: HostContext): void {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) {
    ctx.logger.warn(
      "refyard: no webServer service in this composition; the Git panel has nothing to mount on",
    );
    return;
  }

  // `dist/index.js` sits beside the SPA copy the build staged for the embedder.
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "web");
  const stateRoot = join(defaultStateRoot(), "dsh");

  /** Every Session this process has seen, by id, newest observation last. */
  const candidates = new Map<string, RepositoryCandidate>();

  function observe(session: SessionAnnouncement | undefined): void {
    const id = typeof session?.id === "string" ? session.id : null;
    const cwd = session?.header?.cwd;
    if (id === null || typeof cwd !== "string" || cwd === "") {
      return;
    }
    // Re-inserting keeps Map iteration order equal to recency, which is what makes "the
    // Session the user is most likely looking at" answerable without asking the browser.
    candidates.delete(id);
    candidates.set(id, {
      path: cwd,
      root:
        session?.header?.parentSession === undefined &&
        session?.header?.origin !== "subagent",
    });
  }

  ctx.on("session/created", (session) => observe(session));
  // Creation alone is not enough: a Session that already existed when this plugin was
  // activated never announces itself again, and the panel would open with no repository.
  // Any durable event re-teaches the host where that Session works.
  ctx.on("session/event", (session) => observe(session));

  let workbench: Workbench | null = null;
  let starting: Promise<Workbench> | null = null;

  ctx.effect(
    () => () => {
      const running = workbench;
      workbench = null;
      starting = null;
      if (running !== null) {
        void running.http.close();
      }
    },
    "refyard: workbench lifecycle",
  );

  /** The origins this plugin serves and mints pairing tickets for: loopback, this port. */
  function originsFor(port: number): readonly string[] {
    return [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`,
    ];
  }

  function portOf(): number | null {
    const port = webServer?.port;
    return typeof port === "number" && Number.isInteger(port) && port > 0
      ? port
      : null;
  }

  async function ensureWorkbench(port: number): Promise<Workbench> {
    if (workbench !== null) {
      return workbench;
    }
    if (starting === null) {
      starting = start(port);
    }
    try {
      return await starting;
    } catch (error) {
      // A failed start must be retryable: the usual cause is a machine where Git is not
      // installed yet, and caching that failure would keep the panel dead for the life of
      // the process.
      starting = null;
      throw error;
    }
  }

  async function start(port: number): Promise<Workbench> {
    const assembly = await assembleService({
      // No repository is approved up front. Approving one is a durable, journalled act, so
      // it happens when a panel actually asks for a directory — never because the plugin
      // started.
      repositoryPaths: [],
      allowEmpty: true,
      gitPath: resolveGitPath(),
      // A private state root beside Refyard's own: the plugin's journal must not be the
      // file a terminal `refyard open` is concurrently appending to.
      stateRootPath: stateRoot,
      write: (line) => ctx.logger.info(`refyard: ${line}`),
    });
    const origins = originsFor(port);
    const http = await startHttpHost({
      read: assembly.read,
      mutations: assembly.mutations,
      events: assembly.events,
      serviceInstanceId: assembly.serviceInstanceId,
      // Port 0: this listener is an implementation detail behind the Harness route, so it
      // must not compete for a port a user might expect to find something on.
      port: 0,
      webRoot,
      // The frame is same-origin with the Harness page, and the service is told exactly
      // which origin may frame it and call it.
      frameAncestors: ["'self'"],
      allowedOrigins: origins,
      repositoryManagement: assembly.repositoryManagement,
      repositoryRootOf: (repositoryId) =>
        assembly.repositories.get(repositoryId)?.allowedRootId ?? null,
      provider: assembly.provider,
      grants: {
        allowedRootIds: [...assembly.allowedRootIds],
        repositoryIds: [...assembly.repositoryIds],
        scopes: [
          "repository:read",
          "repository:write",
          "repository:network",
          "workspace:manage",
          "provider:manage",
        ],
      },
      log: (line) => ctx.logger.info(`refyard: ${line}`),
    });
    workbench = { http, assembly };
    ctx.logger.info(
      `refyard: Git panel listening on http://127.0.0.1:${http.port} behind ${PREFIX}`,
    );
    return workbench;
  }

  /**
   * The origin this request came from, when it is one this plugin serves.
   *
   * A document request carries no `Origin` header at all, so the authority is read from
   * `Host` — which is also the value a forged request cannot fake into a second origin,
   * because it has to name this server.
   */
  function requestOrigin(req: IncomingMessage): string | null {
    const host = req.headers.host;
    if (typeof host !== "string" || host === "") {
      return null;
    }
    const port = portOf();
    if (port === null) {
      return null;
    }
    const origin = `http://${host}`;
    return originsFor(port).includes(origin) ? origin : null;
  }

  /**
   * The most recent root Session's directory: the Session a person is working in, as
   * opposed to a delegated child that happens to have logged more recently.
   */
  function bestKnownRepository(): string | null {
    let newestRoot: string | null = null;
    let newestAny: string | null = null;
    for (const candidate of candidates.values()) {
      if (candidate.root) {
        newestRoot = candidate.path;
      }
      newestAny = candidate.path;
    }
    return newestRoot ?? newestAny;
  }

  /**
   * The repository this request is about.
   *
   * An explicit `repo` wins because it is the caller naming what it wants; an explicit
   * `session` next, because the panel knows which Session the user has selected and the
   * host only knows which Sessions have been active.
   */
  function requestedRepository(url: URL): string | null {
    const named = url.searchParams.get("repo");
    if (named !== null && named.trim() !== "") {
      return named.trim();
    }
    const sessionId = url.searchParams.get("session");
    if (sessionId !== null) {
      const exact = candidates.get(sessionId);
      if (exact !== undefined) {
        return exact.path;
      }
    }
    return bestKnownRepository();
  }

  /**
   * Approve one directory, so the service will answer reads for it.
   *
   * Two steps that must not be collapsed: registering is what makes the repository exist,
   * and granting is what lets a session read it. Refyard's own HTTP route does both, but a
   * route needs a session and this host approves *before* the frame has one — it mints the
   * frame's ticket itself. So the grant is stated explicitly, which is also what makes the
   * already-registered case work: a second panel load finds the repository present and
   * still has to say that this session may read it.
   */
  async function approveRepository(
    running: Workbench,
    path: string,
  ): Promise<ApprovalOutcome> {
    const result = await running.assembly.repositoryManagement.register({
      path,
      actor: "dsh-plugin",
    });
    if (result.ok) {
      running.http.grantRepository(result.approval);
      return { ok: true, repositoryId: result.approval.repositoryId };
    }
    if (result.code !== "Conflict") {
      return { ok: false, message: result.message };
    }
    // Already registered — by an earlier panel load in this same process. Find the record
    // rather than parsing the conflict message, because the path a caller hands us is not
    // the canonical one the registry stores.
    const resolved = await realpath(path).catch(() => null);
    if (resolved === null) {
      return { ok: false, message: result.message };
    }
    const existing = running.assembly.repositories
      .list()
      .find((record) => record.displayPath.text === resolved);
    if (existing === undefined) {
      return { ok: false, message: result.message };
    }
    running.http.grantRepository({
      repositoryId: existing.repositoryId,
      allowedRootId: existing.allowedRootId,
    });
    return { ok: true, repositoryId: existing.repositoryId };
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  }

  function sendProblem(
    res: ServerResponse,
    status: number,
    message: string,
  ): void {
    sendJson(res, status, { problem: { status, message } });
  }

  /**
   * The panel's frame URL, and the directory it will show.
   *
   * `session` is what makes the panel follow the project: the caller names the Session it
   * is drawing, and the answer is that Session's directory rather than whichever one
   * happened to be active most recently.
   */
  async function contextPayload(url: URL, port: number): Promise<{
    readonly repositoryPath: string | null;
    readonly repositoryId: string | null;
    readonly panelUrl: string;
  }> {
    const repositoryPath = requestedRepository(url);
    // Approve here, not only on the document request: the panel URL has to name the
    // repository, and the id only exists once the service has registered it.
    let repositoryId: string | null = null;
    if (repositoryPath !== null) {
      const outcome = await approveRepository(
        await ensureWorkbench(port),
        repositoryPath,
      );
      if (outcome.ok) {
        repositoryId = outcome.repositoryId;
      } else {
        ctx.logger.warn(
          `refyard: could not approve ${repositoryPath}: ${outcome.message}`,
        );
      }
    }
    const query = new URLSearchParams();
    if (repositoryPath !== null) {
      query.set("repo", repositoryPath);
    }
    if (url.searchParams.get("mode") === "single") {
      // An embedding host owns repository selection: one repository, no tab strip. Naming
      // it by id rather than by path is what keeps two Sessions' panels apart when they
      // share a mount, and what makes the choice exact rather than a path comparison.
      query.set("single", "1");
      if (repositoryId !== null) {
        query.set("repositoryId", repositoryId);
      }
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    return { repositoryPath, repositoryId, panelUrl: `${PREFIX}/${suffix}` };
  }

  /**
   * Answer a document request with a pairing redirect.
   *
   * This is the whole of the pairing story: the frame is a real Refyard client, and like
   * every other one it arrives with a single-use ticket. The ticket is minted here, in
   * trusted host code, and spent by the frame's own exchange.
   */
  async function serveDocument(
    res: ServerResponse,
    url: URL,
    origin: string,
    port: number,
  ): Promise<void> {
    const running = await ensureWorkbench(port);
    const repository = requestedRepository(url);
    if (repository !== null) {
      const outcome = await approveRepository(running, repository);
      if (!outcome.ok) {
        // The workbench still opens; it opens without that repository, and says why.
        ctx.logger.warn(
          `refyard: could not approve ${repository}: ${outcome.message}`,
        );
      }
    }
    const ticket = new URL(running.http.pairingUrl(origin)).searchParams.get(
      "pair",
    );
    if (ticket === null) {
      sendProblem(res, 500, "the service did not issue a pairing ticket");
      return;
    }
    // `api` is what tells the SPA its service lives under this prefix rather than at the
    // page origin — the Harness owns `/api` for its own bridge.
    url.searchParams.set("api", `${origin}${PREFIX}`);
    url.searchParams.set("pair", ticket);
    res.writeHead(302, {
      location: `${url.pathname}${url.search}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  }

  /** Forward one request to the loopback Refyard service and stream the answer back. */
  function proxy(
    req: IncomingMessage,
    res: ServerResponse,
    upstreamPort: number,
    path: string,
  ): void {
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: upstreamPort,
      path,
      method: req.method,
      headers: {
        ...req.headers,
        // The service answers only on its own authority, and this is that authority.
        host: `127.0.0.1:${upstreamPort}`,
      },
    });
    upstream.on("response", (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", (error: Error) => {
      ctx.logger.error(`refyard: upstream request failed: ${error.message}`);
      if (!res.headersSent) {
        sendProblem(res, 502, "the Git workbench did not answer");
      } else {
        res.end();
      }
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const port = portOf();
    if (port === null) {
      sendProblem(res, 503, "the Harness web server has no listening port yet");
      return;
    }
    const origins = originsFor(port);
    const policy = createOriginPolicy({
      authorities: origins.map((value) => value.slice("http://".length)),
      allowedOrigins: origins,
    });
    const verdict = policy.check({
      origin: req.headers.origin,
      host: req.headers.host,
      secFetchSite: req.headers["sec-fetch-site"],
    });
    if (!verdict.ok) {
      sendProblem(res, 403, verdict.problem.message);
      return;
    }
    const origin = requestOrigin(req);
    if (origin === null) {
      sendProblem(res, 403, "this panel is served on a loopback origin only");
      return;
    }

    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "127.0.0.1"}`,
    );
    // The mount point itself is a directory: without the slash, the frame's own relative
    // resolution would step out of the mount on the next navigation.
    if (url.pathname === PREFIX) {
      res.writeHead(308, {
        location: `${PREFIX}/${url.search}`,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
    if (url.pathname === CONTEXT_ROUTE) {
      sendJson(res, 200, await contextPayload(url, port));
      return;
    }

    const isDocument =
      (req.method === "GET" || req.method === "HEAD") &&
      (req.headers.accept ?? "").includes("text/html");
    if (isDocument && !url.searchParams.has("pair")) {
      await serveDocument(res, url, origin, port);
      return;
    }

    const running = await ensureWorkbench(port);
    const upstreamPath = `${url.pathname.slice(PREFIX.length)}${url.search}`;
    proxy(req, res, running.http.port, upstreamPath === "" ? "/" : upstreamPath);
  }

  ctx.effect(
    () =>
      webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler(req, res) {
          void handle(req, res).catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : String(error);
            ctx.logger.error(`refyard: panel request failed: ${message}`);
            if (!res.headersSent) {
              sendProblem(res, 500, `the Git panel failed: ${message}`);
            } else {
              res.end();
            }
          });
        },
      }),
    "refyard: web route",
  );
}
