/**
 * The HTTP host.
 *
 * One loopback listener, one authenticated API, one static bundle. The order of
 * checks in `handle` is the security model, so it is worth stating plainly:
 *
 * 1. **Host and Origin** are validated before anything else — a request from a page
 *    this service was not started for is refused even if it somehow holds a token.
 * 2. **The pairing exchange** is the only unauthenticated route, and it consumes
 *    its ticket whether it succeeds or not.
 * 3. **Every other route requires a bearer**, including `/api/v1/capabilities`.
 *    There is no read that is "safe enough" to leave open: a repository listing
 *    says what is on this machine.
 * 4. **The session's grant is checked against the repository** the request names,
 *    before the read touches Git.
 * 5. **The query is validated by the contract schema**, so a typo is a 400 rather
 *    than a silently ignored filter.
 *
 * A collision on a fixed port is a refusal, never a silent move to another port: a
 * bookmark, a PWA manifest and a pairing URL all name a port, and answering on a
 * different one would break them without saying so.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { getRequestListener } from "@hono/node-server";
import {
  eventsQuerySchema,
  healthResponseSchema,
  sessionExchangeRequestSchema,
  sessionExchangeResponseSchema,
  type Problem,
} from "@refyard/git-contract";
import type { ReadService } from "../coordinator/reads.js";
import { ReadProblem } from "../coordinator/reads.js";
import type { MutationCoordinator } from "../coordinator/submit.js";
import { createEventRing, createSseSession, type EventRing } from "./events.js";
import {
  UNIMPLEMENTED_PATHS,
  mutationRoutes,
  readRoutes,
  unsupportedProblem,
} from "./router.js";
import type { RepositoryApprovalManager } from "../registry/managed.js";
import {
  createAuthStore,
  type AuthStore,
  type SessionGrants,
  type Session,
} from "./auth.js";
import { createAssetServer, type AssetServer } from "./assets.js";
import {
  DEFAULT_HTTP_LIMITS,
  convertQuery,
  logLine,
  parseQuery,
  readJsonBody,
  validate,
  type ConvertedQuery,
  type HttpLimits,
} from "./json.js";
import {
  JSON_HEADERS,
  problemBody,
  problemFor,
  statusForProblem,
  newCorrelationId,
} from "./errors.js";
import {
  createOriginPolicy,
  loopbackAuthorities,
  originsFor,
  type OriginPolicy,
} from "./origins.js";
import { createHonoHttpApp } from "./hono-app.js";
/**
 * The port a taken listener holds, as its own error type.
 *
 * A caller that named a port explicitly must be told the port is busy; a caller that took
 * the default may reasonably be moved to a free one. Both need to tell this failure apart
 * from "the listener could not start at all", which no retry fixes.
 */
export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(
      `port ${port} is already in use; stop what is using it or pass a different --port`,
    );
    this.name = "PortInUseError";
    this.port = port;
  }
}

/**
 * The loopback port a service takes when nobody asks for one.
 *
 * It lives here because this is the layer that binds, and the CLI reads it rather than
 * keeping a second copy: two defaults is how a help text and a listener end up naming
 * different numbers.
 */
export const DEFAULT_SERVICE_PORT = 9595;

export interface HttpHostOptions {
  readonly read: ReadService;
  /** Present once a mutation engine exists; absent in a read-only host. */
  readonly mutations?: MutationCoordinator;
  /** Shared with the mutation coordinator so both publish to one ring. */
  readonly events?: EventRing;
  readonly serviceInstanceId?: string;
  readonly port?: number;
  /** `127.0.0.1` unless the caller explicitly asked for IPv6 loopback too. */
  readonly host?: string;
  readonly includeIpv6?: boolean;
  /** Exact non-loopback browser origins explicitly approved for hosted UI access. */
  readonly allowedOrigins?: readonly string[];
  /** Hosted pairing password; accepted only at startup and hashed by the auth store. */
  readonly hostedPassword?: string;
  readonly webRoot?: string | null;
  /** Document served when there is no web build; see `AssetServerOptions`. */
  readonly inlineDocument?: string;
  readonly limits?: Partial<HttpLimits>;
  /** Grants every session paired through this host receives. */
  readonly grants: SessionGrants;
  /**
   * The approved root a registered repository lives in, or null when this host does
   * not know it.
   *
   * Used by the scope check: a repository that did not exist when the session paired
   * (one this session just created, or another window's) is covered by the session's
   * grant on its **root**. Without this, creating a repository would produce one the
   * client cannot read back without a restart.
   */
  readonly repositoryRootOf?: (repositoryId: string) => string | null;
  /** Runtime repository approval/revocation, when form 2 is enabled. */
  readonly repositoryManagement?: RepositoryApprovalManager;
  readonly actor?: string;
  /**
   * Pairing-ticket lifetime in seconds. The 60-second default is the design; widening it
   * is a CLI-level choice for a URL that will be read later, never a smaller number.
   */
  readonly ticketTtlSeconds?: number;
  /** Injectable for tests; production uses the real clock. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
  /**
   * How long `close()` waits for in-flight requests before cutting their sockets.
   *
   * The default (5 s) is enough for a read and for a queued operation to be reported;
   * tests lower it so a shutdown case does not wait in real time.
   */
  readonly shutdownGraceMs?: number;
}

export interface HttpHost {
  readonly baseUrl: string;
  readonly port: number;
  readonly serviceInstanceId: string;
  readonly auth: AuthStore;
  readonly assets: AssetServer;
  readonly events: EventRing;
  /** A pairing URL for a browser: origin plus the ticket in the fragment. */
  pairingUrl(origin: string): string;
  close(): Promise<void>;
}

export async function startHttpHost(
  options: HttpHostOptions,
): Promise<HttpHost> {
  const hostedOrigins = (options.allowedOrigins ?? []).filter(isHostedOrigin);
  if (hostedOrigins.length > 0 && options.hostedPassword === undefined) {
    throw new Error(
      "hosted origins require REFYARD_HOSTED_PASSWORD; the hosted form is never enabled with a ticket alone",
    );
  }
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...options.limits };
  const serviceInstanceId =
    options.serviceInstanceId ??
    `srvc_${randomBytes(12).toString("base64url")}`;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_SERVICE_PORT;
  const auth = createAuthStore({
    serviceInstanceId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.ticketTtlSeconds === undefined
      ? {}
      : { ticketTtlSeconds: options.ticketTtlSeconds }),
    ...(options.hostedPassword === undefined
      ? {}
      : { hostedPassword: options.hostedPassword }),
  });
  const assets = createAssetServer({
    webRoot: options.webRoot ?? null,
    ...(options.inlineDocument === undefined
      ? {}
      : { inlineDocument: options.inlineDocument }),
  });
  const log = options.log ?? ((): void => {});
  const now = options.now ?? Date.now;
  const routes = [...readRoutes(), ...mutationRoutes()];
  const events = options.events ?? createEventRing();
  let currentGrants = copyGrants(options.grants);
  const services = {
    read: options.read,
    ...(options.mutations === undefined
      ? {}
      : { mutations: options.mutations }),
    ...(options.repositoryManagement === undefined
      ? {}
      : {
          repositoryManagement: options.repositoryManagement,
          onRepositoryRegistered(input: {
            readonly sessionId: string;
            readonly approval: {
              readonly allowedRootId: string;
              readonly repositoryId: string;
            };
          }): void {
            currentGrants = addGrant(currentGrants, input.approval);
            auth.grant(input.sessionId, input.approval);
          },
          onRepositoryRevoked(input: {
            readonly sessionId: string;
            readonly result: {
              readonly repositoryId: string;
              readonly allowedRootId: string;
              readonly rootHasRepositories: boolean;
            };
          }): void {
            void input.sessionId;
            currentGrants = removeGrant(currentGrants, input.result);
            auth.revokeRepository(
              input.result.repositoryId,
              input.result.allowedRootId,
              input.result.rootHasRepositories,
            );
          },
        }),
  };
  let originPolicy: OriginPolicy | null = null;
  const honoHttp = createHonoHttpApp({
    read: options.read,
    services,
    auth,
    events,
    serviceInstanceId,
    originPolicy: () => originPolicy,
    ...(options.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: options.allowedOrigins }),
    ...(options.repositoryRootOf === undefined
      ? {}
      : { repositoryRootOf: options.repositoryRootOf }),
    limits,
    now,
    log,
  });
  const honoListener = getRequestListener((request) =>
    honoHttp.app.fetch(request),
  );

  /**
   * Requests that have started and not finished.
   *
   * Shutdown needs this count to keep its promise: "stop accepting new work, finish
   * what is running". A mutation that has been accepted is a write in progress, and
   * cutting its connection does not stop the write — it only hides the answer.
   */
  let inFlight = 0;

  const server: Server = createServer((request, response) => {
    inFlight += 1;
    response.on("close", () => {
      inFlight -= 1;
    });
    if (isHonoPath(request.url)) {
      void honoListener(request, response).catch((error: unknown) => {
        const correlationId = newCorrelationId();
        log(
          `internal failure ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
        );
        if (!response.headersSent) {
          sendProblem(
            response,
            problemFor(
              "InternalError",
              `the service failed; correlation ${correlationId}`,
            ),
            correlationId,
          );
        } else {
          response.end();
        }
      });
      return;
    }
    void handle(request, response).catch((error: unknown) => {
      const correlationId = newCorrelationId();
      log(
        `internal failure ${correlationId}: ${error instanceof Error ? error.message : "unknown"}`,
      );
      if (!response.headersSent) {
        sendProblem(
          response,
          problemFor(
            "InternalError",
            `the service failed; correlation ${correlationId}`,
          ),
          correlationId,
        );
      } else {
        response.end();
      }
    });
  });

  function sendJson(
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    for (const [name, value] of Object.entries(JSON_HEADERS)) {
      response.setHeader(name, value);
    }
    response.writeHead(status);
    response.end(JSON.stringify(body));
  }

  function sendProblem(
    response: ServerResponse,
    problem: Problem,
    correlationId?: string,
  ): void {
    for (const [name, value] of Object.entries(JSON_HEADERS)) {
      response.setHeader(name, value);
    }
    if (correlationId !== undefined) {
      response.setHeader("x-refyard-correlation", correlationId);
    }
    response.writeHead(statusForProblem(problem));
    response.end(problemBody(problem));
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const startedAt = now();
    const method = request.method ?? "GET";
    const rawUrl = request.url ?? "/";
    if (Buffer.byteLength(rawUrl, "utf8") > limits.maxUrlBytes) {
      sendProblem(
        response,
        problemFor(
          "LimitExceeded",
          `the request target may not exceed ${limits.maxUrlBytes} bytes`,
        ),
      );
      return;
    }
    const questionMark = rawUrl.indexOf("?");
    const path = questionMark === -1 ? rawUrl : rawUrl.slice(0, questionMark);
    const rawQuery = questionMark === -1 ? "" : rawUrl.slice(questionMark + 1);
    // A fragment is never sent by a browser; if one arrives it was hand-written, and
    // `parseQuery` would otherwise treat it as part of the last value.
    const hash = path.indexOf("#");
    const cleanPath = hash === -1 ? path : path.slice(0, hash);

    const policy = originPolicy;
    if (policy === null) {
      sendProblem(
        response,
        problemFor("Unavailable", "the service is still starting"),
      );
      return;
    }

    const originCheck = policy.check({
      origin: headerValue(request, "origin"),
      host: headerValue(request, "host"),
      secFetchSite: headerValue(request, "sec-fetch-site"),
    });
    if (!originCheck.ok) {
      log(
        logLine({
          method,
          path: cleanPath,
          status: statusForProblem(originCheck.problem),
          durationMs: now() - startedAt,
          problemCode: originCheck.problem.code,
          problemMessage: originCheck.problem.message,
        }),
      );
      sendProblem(response, originCheck.problem);
      return;
    }

    const requestOrigin = headerValue(request, "origin");
    const hostedOrigin = externalOrigin(requestOrigin, options.allowedOrigins);
    if (hostedOrigin !== null) {
      response.setHeader("access-control-allow-origin", hostedOrigin);
      response.setHeader(
        "access-control-allow-headers",
        "Authorization, Content-Type, Accept",
      );
      response.setHeader(
        "access-control-allow-methods",
        "GET, POST, OPTIONS",
      );
      response.setHeader(
        "access-control-expose-headers",
        "x-refyard-correlation",
      );
      response.setHeader("access-control-max-age", "300");
      response.setHeader("vary", "Origin");
    }

    if (method === "OPTIONS") {
      if (hostedOrigin !== null) {
        const requestedMethod = headerValue(
          request,
          "access-control-request-method",
        );
        if (
          requestedMethod !== undefined &&
          requestedMethod !== "GET" &&
          requestedMethod !== "POST"
        ) {
          sendProblem(
            response,
            problemFor(
              "Forbidden",
              "that hosted request method is not allowed",
            ),
          );
          return;
        }
        const requestedHeaders = headerValue(
          request,
          "access-control-request-headers",
        );
        if (requestedHeaders !== undefined) {
          const allowedHeaders = new Set([
            "authorization",
            "content-type",
            "accept",
          ]);
          const invalid = requestedHeaders
            .split(",")
            .map((header) => header.trim().toLowerCase())
            .find(
              (header) => header.length > 0 && !allowedHeaders.has(header),
            );
          if (invalid !== undefined) {
            sendProblem(
              response,
              problemFor(
                "Forbidden",
                `that hosted request header is not allowed: ${invalid}`,
              ),
            );
            return;
          }
        }
        response.writeHead(204);
        response.end();
        return;
      }
      // Same-origin requests do not need CORS preflight. Keep the old refusal so an
      // accidental OPTIONS call never advertises a broader API than this host has.
      response.setHeader("allow", "GET, POST");
      response.writeHead(405);
      response.end();
      return;
    }

    if (cleanPath === "/health") {
      const body = healthResponseSchema.parse({
        alive: true,
        apiMajor: 1,
        serviceInstanceId,
      });
      log(
        logLine({
          method,
          path: cleanPath,
          status: 200,
          durationMs: now() - startedAt,
        }),
      );
      sendJson(response, 200, body);
      return;
    }

    if (cleanPath === "/api/v1/events") {
      // Streaming route: authenticated like every other read, then the connection
      // belongs to the ring until the client goes away.
      const authorized = auth.authorize({
        authorization: headerValue(request, "authorization"),
        serviceInstanceId,
      });
      if (!authorized.ok) {
        log(
          logLine({
            method,
            path: cleanPath,
            status: 401,
            durationMs: now() - startedAt,
            problemCode: authorized.problem.code,
            problemMessage: authorized.problem.message,
          }),
        );
        sendProblem(response, authorized.problem);
        return;
      }
      const query = parseQuery(rawQuery, limits);
      if (!query.ok) {
        sendProblem(response, query.problem);
        return;
      }
      const converted = convertQuery(eventsQuerySchema, query.value);
      if (!converted.ok) {
        sendProblem(response, converted.problem);
        return;
      }
      const since = converted.value["since"];
      log(
        logLine({
          method,
          path: cleanPath,
          status: 200,
          durationMs: now() - startedAt,
          sessionId: authorized.session.sessionId,
        }),
      );
      const session = createSseSession(events);
      await session.start({
        response,
        since: typeof since === "number" ? since : undefined,
      });
      return;
    }

    if (cleanPath === "/api/v1/session/exchange") {
      if (method !== "POST") {
        sendProblem(
          response,
          problemFor("InvalidRequest", "the session exchange is a POST"),
        );
        return;
      }
      const body = await readJsonBody(request, limits);
      if (!body.ok) {
        sendProblem(response, body.problem);
        return;
      }
      const parsed = validate(
        sessionExchangeRequestSchema,
        body.value,
        "the exchange body",
      );
      if (!parsed.ok) {
        sendProblem(response, parsed.problem);
        return;
      }
      const origin = headerValue(request, "origin") ?? "";
      const exchanged = auth.exchange({
        ticket: parsed.value.ticket,
        origin,
        serviceInstanceId,
      });
      if (!exchanged.ok) {
        log(
          logLine({
            method,
            path: cleanPath,
            status: statusForProblem(exchanged.problem),
            durationMs: now() - startedAt,
            problemCode: exchanged.problem.code,
            problemMessage: exchanged.problem.message,
          }),
        );
        sendProblem(response, exchanged.problem);
        return;
      }
      const session = exchanged.session;
      const responseBody = sessionExchangeResponseSchema.parse({
        token: session.token,
        tokenType: "Bearer",
        expiresAt: new Date(session.expiresAtMs).toISOString(),
        serviceInstanceId,
        apiMajor: 1,
        sessionId: session.sessionId,
        grants: {
          allowedRootIds: [...session.grants.allowedRootIds],
          repositoryIds: [...session.grants.repositoryIds],
          scopes: [...session.grants.scopes],
        },
      });
      log(
        logLine({
          method,
          path: cleanPath,
          status: 200,
          durationMs: now() - startedAt,
          sessionId: session.sessionId,
        }),
      );
      sendJson(response, 200, responseBody);
      return;
    }

    if (cleanPath.startsWith("/api/")) {
      const authorized = auth.authorize({
        authorization: headerValue(request, "authorization"),
        serviceInstanceId,
      });
      const route = routes.find(
        (candidate) =>
          candidate.path === cleanPath && candidate.method === method,
      );
      if (route === undefined) {
        // An unimplemented path is 501 for a known name and 404 otherwise, and never
        // falls through to the SPA: a client must be able to tell an API answer from
        // an HTML shell. Either way the session is authenticated first, so an
        // anonymous caller learns nothing about which paths exist.
        if (!authorized.ok) {
          log(
            logLine({
              method,
              path: cleanPath,
              status: 401,
              durationMs: now() - startedAt,
              problemCode: authorized.problem.code,
              problemMessage: authorized.problem.message,
            }),
          );
          sendProblem(response, authorized.problem);
          return;
        }
        const problem = UNIMPLEMENTED_PATHS.includes(cleanPath)
          ? unsupportedProblem(cleanPath)
          : problemFor("NotFound", `no API route ${cleanPath}`);
        log(
          logLine({
            method,
            path: cleanPath,
            status: statusForProblem(problem),
            durationMs: now() - startedAt,
            sessionId: authorized.session.sessionId,
            problemCode: problem.code,
            problemMessage: problem.message,
          }),
        );
        sendProblem(response, problem);
        return;
      }
      if (!authorized.ok) {
        log(
          logLine({
            method,
            path: cleanPath,
            status: 401,
            durationMs: now() - startedAt,
            problemCode: authorized.problem.code,
            problemMessage: authorized.problem.message,
          }),
        );
        sendProblem(response, authorized.problem);
        return;
      }
      const session = authorized.session;

      const query = parseQuery(rawQuery, limits);
      if (!query.ok) {
        sendProblem(response, query.problem);
        return;
      }
      // A GET route's query is converted with its contract schema; a POST route's
      // input is its JSON body, read with a byte limit.
      let queryValue: ConvertedQuery = {};
      let actionBody: unknown = undefined;
      if (route.method === "GET") {
        const schema = route.schema;
        if (schema === undefined) {
          sendProblem(
            response,
            problemFor("InternalError", `${cleanPath} has no query schema`),
          );
          return;
        }
        const converted = convertQuery(schema, query.value);
        if (!converted.ok) {
          sendProblem(response, converted.problem);
          return;
        }
        queryValue = converted.value;
      } else {
        const readBody = await readJsonBody(request, limits);
        if (!readBody.ok) {
          sendProblem(response, readBody.problem);
          return;
        }
        actionBody = readBody.value;
      }
      // The grant is checked before the handler validates: a request naming a
      // repository this session does not cover is refused before anything reads Git,
      // and this check can only deny, never widen.
      const scoped = checkScope(
        session,
        route.method === "GET" ? queryValue : actionBody,
      );
      if (scoped !== null) {
        log(
          logLine({
            method,
            path: cleanPath,
            status: 403,
            durationMs: now() - startedAt,
            sessionId: session.sessionId,
            problemCode: scoped.code,
          }),
        );
        sendProblem(response, scoped);
        return;
      }

      try {
        const body = await route.handle({
          session,
          query: queryValue,
          body: actionBody,
          services,
        });
        // The route declares its success status; 200 is the default. A 202 here means
        // "accepted for execution", never "done".
        const successStatus = route.successStatus?.(body) ?? 200;
        log(
          logLine({
            method,
            path: cleanPath,
            status: successStatus,
            durationMs: now() - startedAt,
            sessionId: session.sessionId,
          }),
        );
        sendJson(response, successStatus, body);
      } catch (error) {
        const problem =
          error instanceof ReadProblem
            ? error.toProblem()
            : problemFor(
                "InternalError",
                `the read failed: ${error instanceof Error ? error.message : "unknown error"}`,
              );
        log(
          logLine({
            method,
            path: cleanPath,
            status: statusForProblem(problem),
            durationMs: now() - startedAt,
            sessionId: session.sessionId,
            problemCode: problem.code,
            problemMessage: problem.message,
          }),
        );
        sendProblem(response, problem);
      }
      return;
    }

    // Everything else is a static asset or a client-side route.
    const served = await assets.serve({
      path: cleanPath,
      response,
      headOnly: method === "HEAD",
    });
    if (served === "not-found") {
      log(
        logLine({
          method,
          path: cleanPath,
          status: 404,
          durationMs: now() - startedAt,
        }),
      );
      sendProblem(response, problemFor("NotFound", `no file at ${cleanPath}`));
      return;
    }
    log(
      logLine({
        method,
        path: cleanPath,
        status: served === "served" ? 200 : 403,
        durationMs: now() - startedAt,
      }),
    );
  }

  /**
   * Refuse a request that names a repository, or an approved root, the session does
   * not cover.
   *
   * A workspace target (init, clone) names a root and a destination instead of a
   * repository — there is no repository yet, which is the point of the operation — so
   * the grant checked for it is the root's. Skipping that check would let any paired
   * session create a repository anywhere in the service's approved roots, which is
   * exactly the reach a session's grants exist to bound.
   */
  function checkScope(session: Session, input: unknown): Problem | null {
    const repositoryId = repositoryIdForScope(input);
    if (repositoryId !== null) {
      if (auth.allowsRepository(session, repositoryId)) {
        return null;
      }
      // Not granted by id — but a root grant covers what lives in that root, which is
      // how a repository this session just created stays reachable.
      const root = options.repositoryRootOf?.(repositoryId) ?? null;
      if (root !== null && auth.allowsRoot(session, root)) {
        return null;
      }
      return problemFor(
        "Forbidden",
        "this session was not granted that repository",
        {
          repositoryId,
        },
      );
    }
    const allowedRootId = allowedRootIdForScope(input);
    if (allowedRootId !== null && !auth.allowsRoot(session, allowedRootId)) {
      return problemFor(
        "Forbidden",
        "this session was not granted that approved root",
        { allowedRootId },
      );
    }
    // Neither named (or not a single string): the route's own schema decides whether
    // that is acceptable, and it cannot grant anything the session lacks.
    return null;
  }

  const bound = await new Promise<
    { readonly port: number } | { readonly error: NodeJS.ErrnoException }
  >((resolve) => {
    server.once("error", (error: NodeJS.ErrnoException) => resolve({ error }));
    server.listen({ port, host }, () => {
      const address = server.address() as AddressInfo | null;
      resolve({ port: address?.port ?? port });
    });
  });

  if ("error" in bound) {
    const error = bound.error;
    await closeQuietly(server);
    if (error.code === "EADDRINUSE") {
      // Typed rather than a message the caller has to match on: the CLI decides whether a
      // busy port is a refusal (an explicitly requested port) or a reason to take another
      // free one (the default), and that decision belongs above this layer.
      throw new PortInUseError(port);
    }
    throw new Error(
      `the listener could not start: ${error.code ?? error.message}`,
    );
  }

  const actualPort = bound.port;
  const authorities = loopbackAuthorities({
    port: actualPort,
    ...(options.includeIpv6 === true ? { includeIpv6: true } : {}),
  });
  originPolicy = createOriginPolicy({
    authorities,
    allowedOrigins: [
      ...originsFor(authorities),
      ...(options.allowedOrigins ?? []),
    ],
  });

  return {
    baseUrl: `http://${host}:${actualPort}`,
    port: actualPort,
    serviceInstanceId,
    auth,
    events,
    assets,

    pairingUrl(origin: string): string {
      if (!originPolicy.allowedOrigins().includes(origin)) {
        throw new Error(`${origin} is not an origin this service answers on`);
      }
      const ticket = auth.mintTicket({
        origin,
        actor: options.actor ?? "cli",
        grants: currentGrants,
        passwordRequired:
          options.hostedPassword !== undefined && isHostedOrigin(origin),
      });
      // The ticket rides in the query string (the user's 2026-09-15 direction, after a
      // browser flow was observed dropping the fragment). That is safe here because this
      // server never logs a query string, documents go out with `Referrer-Policy:
      // no-referrer`, and the ticket is single-use and expires in sixty seconds; the page
      // also strips it from the address bar as soon as it is spent. The fragment spelling
      // (`/#pair=…`) keeps working for URLs already in circulation.
      return `${origin}/?pair=${ticket.ticket}`;
    },

    async close(): Promise<void> {
      await honoHttp.close();
      await closeQuietly(server, {
        inFlight: () => inFlight,
        ...(options.shutdownGraceMs === undefined
          ? {}
          : { graceMs: options.shutdownGraceMs }),
      });
    },
  };
}

function copyGrants(grants: SessionGrants): SessionGrants {
  return {
    allowedRootIds: [...grants.allowedRootIds],
    repositoryIds: [...grants.repositoryIds],
    scopes: [...grants.scopes],
  };
}

function addGrant(
  grants: SessionGrants,
  input: { readonly allowedRootId: string; readonly repositoryId: string },
): SessionGrants {
  return {
    allowedRootIds: grants.allowedRootIds.includes(input.allowedRootId)
      ? [...grants.allowedRootIds]
      : [...grants.allowedRootIds, input.allowedRootId],
    repositoryIds: grants.repositoryIds.includes(input.repositoryId)
      ? [...grants.repositoryIds]
      : [...grants.repositoryIds, input.repositoryId],
    scopes: [...grants.scopes],
  };
}

function removeGrant(
  grants: SessionGrants,
  input: {
    readonly allowedRootId: string;
    readonly repositoryId: string;
    readonly rootHasRepositories: boolean;
  },
): SessionGrants {
  return {
    allowedRootIds: input.rootHasRepositories
      ? [...grants.allowedRootIds]
      : grants.allowedRootIds.filter((id) => id !== input.allowedRootId),
    repositoryIds: grants.repositoryIds.filter(
      (id) => id !== input.repositoryId,
    ),
    scopes: [...grants.scopes],
  };
}

function externalOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[] | undefined,
): string | null {
  if (origin === undefined || allowedOrigins === undefined) {
    return null;
  }
  return allowedOrigins.includes(origin) ? origin : null;
}

/** A non-loopback origin is the hosted form and must have a second pairing factor. */
function isHostedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol !== "http:" ||
      !new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)
    );
  } catch {
    // The origin policy will refuse malformed request origins; configured malformed
    // origins still fail closed by requiring the hosted secret at startup.
    return true;
  }
}

/** API and discovery requests are adapted into the Web-standard Hono app. */
function isHonoPath(rawUrl: string | undefined): boolean {
  const rawPath = (rawUrl ?? "/").split("?", 1)[0]?.split("#", 1)[0] ?? "/";
  return (
    rawPath === "/health" ||
    rawPath === "/openapi.json" ||
    rawPath === "/scalar" ||
    rawPath === "/mcp" ||
    rawPath === "/api" ||
    rawPath.startsWith("/api/")
  );
}

/**
 * The repository a request names, wherever it names it.
 *
 * A read carries `repositoryId` as a query parameter; a mutation carries it inside
 * its target. Both are checked against the session's grant before anything runs, and
 * this answers null for anything else — which can only mean "no grant check applies
 * here", never "allowed".
 */
function repositoryIdForScope(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  if ("repositoryId" in input && typeof input.repositoryId === "string") {
    return input.repositoryId;
  }
  if (
    "target" in input &&
    typeof input.target === "object" &&
    input.target !== null
  ) {
    const target = input.target;
    if ("repositoryId" in target && typeof target.repositoryId === "string") {
      return target.repositoryId;
    }
  }
  return null;
}

function allowedRootIdForScope(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  if (
    "target" in input &&
    typeof input.target === "object" &&
    input.target !== null
  ) {
    const target = input.target;
    if (
      "kind" in target &&
      target.kind === "workspace" &&
      "allowedRootId" in target &&
      typeof target.allowedRootId === "string"
    ) {
      return target.allowedRootId;
    }
  }
  return null;
}

function headerValue(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Stop accepting connections, let what is running finish, then close.
 *
 * `server.close()` alone stops the listener but also waits for every open socket —
 * including idle keep-alive connections a browser is holding, which would keep the
 * process alive for minutes. `closeAllConnections()` alone cuts in-flight work in
 * half. So the order is: stop accepting, drain what is running (bounded by
 * `graceMs`), drop idle sockets, and only then cut whatever is left.
 */
async function closeQuietly(
  server: Server,
  options: { readonly inFlight: () => number; readonly graceMs?: number } = {
    inFlight: () => 0,
  },
): Promise<void> {
  const graceMs = options.graceMs ?? 5_000;
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  const deadline = Date.now() + graceMs;
  while (options.inFlight() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await closed;
}
