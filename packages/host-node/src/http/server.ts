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
import {
  healthResponseSchema,
  sessionExchangeRequestSchema,
  sessionExchangeResponseSchema,
  type Problem,
} from "@refyard/git-contract";
import type { ReadService } from "../coordinator/reads.js";
import { ReadProblem } from "../coordinator/reads.js";
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
import {
  UNIMPLEMENTED_PATHS,
  readRoutes,
  unsupportedProblem,
} from "./router.js";

export interface HttpHostOptions {
  readonly read: ReadService;
  readonly serviceInstanceId?: string;
  readonly port?: number;
  /** `127.0.0.1` unless the caller explicitly asked for IPv6 loopback too. */
  readonly host?: string;
  readonly includeIpv6?: boolean;
  readonly webRoot?: string | null;
  /** Document served when there is no web build; see `AssetServerOptions`. */
  readonly inlineDocument?: string;
  readonly limits?: Partial<HttpLimits>;
  /** Grants every session paired through this host receives. */
  readonly grants: SessionGrants;
  readonly actor?: string;
  /** Injectable for tests; production uses the real clock. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface HttpHost {
  readonly baseUrl: string;
  readonly port: number;
  readonly serviceInstanceId: string;
  readonly auth: AuthStore;
  readonly assets: AssetServer;
  /** A pairing URL for a browser: origin plus the ticket in the fragment. */
  pairingUrl(origin: string): string;
  close(): Promise<void>;
}

export async function startHttpHost(
  options: HttpHostOptions,
): Promise<HttpHost> {
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...options.limits };
  const serviceInstanceId =
    options.serviceInstanceId ??
    `srvc_${randomBytes(12).toString("base64url")}`;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 47831;
  const auth = createAuthStore({
    serviceInstanceId,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const assets = createAssetServer({
    webRoot: options.webRoot ?? null,
    ...(options.inlineDocument === undefined
      ? {}
      : { inlineDocument: options.inlineDocument }),
  });
  const log = options.log ?? ((): void => {});
  const now = options.now ?? Date.now;
  const routes = readRoutes();
  let originPolicy: OriginPolicy | null = null;

  const server: Server = createServer((request, response) => {
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
        }),
      );
      sendProblem(response, originCheck.problem);
      return;
    }

    if (method === "OPTIONS") {
      // No CORS preflight is ever approved: the API is same-origin only, so an
      // allowed method list would only advertise something that does not exist.
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
      const converted = convertQuery(route.schema, query.value);
      if (!converted.ok) {
        sendProblem(response, converted.problem);
        return;
      }
      // The grant is checked before the handler validates: a request naming a
      // repository this session does not cover is refused before anything reads Git,
      // and this check can only deny, never widen.
      const scoped = checkScope(session, converted.value);
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
          query: converted.value,
          read: options.read,
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
        sendJson(response, 200, body);
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

  /** Refuse a request that names a repository the session does not cover. */
  function checkScope(
    session: Session,
    query: Record<string, string | string[] | number | boolean>,
  ): Problem | null {
    const repositoryId = query["repositoryId"];
    if (typeof repositoryId !== "string") {
      // No repository named (or not a single string): the route's own schema decides
      // whether that is acceptable, and it cannot grant anything the session lacks.
      return null;
    }
    if (!auth.allowsRepository(session, repositoryId)) {
      return problemFor(
        "Forbidden",
        "this session was not granted that repository",
        {
          repositoryId,
        },
      );
    }
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
    // A port that is taken is a refusal with a clear instruction, not a silent move
    // to another port that would invalidate every bookmark and pairing URL.
    const error = bound.error;
    const detail =
      error.code === "EADDRINUSE"
        ? `port ${port} is already in use; stop what is using it or pass a different --port`
        : `the listener could not start: ${error.code ?? error.message}`;
    await closeQuietly(server);
    throw new Error(detail);
  }

  const actualPort = bound.port;
  const authorities = loopbackAuthorities({
    port: actualPort,
    ...(options.includeIpv6 === true ? { includeIpv6: true } : {}),
  });
  originPolicy = createOriginPolicy({
    authorities,
    allowedOrigins: originsFor(authorities),
  });

  return {
    baseUrl: `http://${host}:${actualPort}`,
    port: actualPort,
    serviceInstanceId,
    auth,
    assets,

    pairingUrl(origin: string): string {
      if (!originPolicy.allowedOrigins().includes(origin)) {
        throw new Error(`${origin} is not an origin this service answers on`);
      }
      const ticket = auth.mintTicket({
        origin,
        actor: options.actor ?? "cli",
        grants: options.grants,
      });
      // The ticket lives in the fragment: the browser strips it before any request,
      // it never reaches a server log, and it is never sent in a Referer.
      return `${origin}/#pair=${ticket.ticket}`;
    },

    async close(): Promise<void> {
      await closeQuietly(server);
    },
  };
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

async function closeQuietly(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    // A listener that never started has no connections to drain; closing is then a
    // no-op and must not hang the caller.
    server.closeAllConnections?.();
  });
}
