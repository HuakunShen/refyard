/**
 * Hono composition for the Node GitService.
 *
 * This is the Web-standards HTTP boundary: Hono owns route matching and response
 * composition, while the existing contract, auth store, coordinator and Git core
 * remain the authorities for meaning and privilege. The Node listener adapts requests
 * into this app; it does not expose a generic command or filesystem capability.
 */
import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Scalar } from "@scalar/hono-api-reference";
import { describeRoute, openAPIRouteHandler, resolver } from "hono-openapi";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";
import {
  capabilitiesResponseSchema,
  cancelOperationRequestSchema,
  diffResponseSchema,
  filesystemEntriesResponseSchema,
  eventsQuerySchema,
  healthResponseSchema,
  historyPageSchema,
  MutationRequestSchema,
  objectIdSchema,
  operationAcceptedSchema,
  operationRecordSchema,
  operationsListResponseSchema,
  previewsRequestSchema,
  previewsResponseSchema,
  pathIdSchema,
  providerConnectionsResponseSchema,
  providerDeviceStartResponseSchema,
  providerDeviceStatusResponseSchema,
  providerPullRequestsResponseSchema,
  connectProviderRequestSchema,
  disconnectProviderRequestSchema,
  refsSnapshotSchema,
  registerRepositoryRequestSchema,
  repositoriesResponseSchema,
  revokeRepositoryRequestSchema,
  repositoryIdSchema,
  sessionExchangeRequestSchema,
  sessionExchangeResponseSchema,
  stashesResponseSchema,
  statusSnapshotSchema,
  submodulesResponseSchema,
  worktreeIdSchema,
  worktreesResponseSchema,
  type Problem,
} from "@refyard/git-contract";
import type { ReadService } from "../coordinator/reads.js";
import { ReadProblem } from "../coordinator/reads.js";
import {
  UNIMPLEMENTED_PATHS,
  mutationRoutes,
  readRoutes,
  unsupportedProblem,
  type RouteDefinition,
  type RouteServices,
} from "./router.js";
import type { AuthStore, AuthorizationScope, Session } from "./auth.js";
import {
  DEFAULT_HTTP_LIMITS,
  convertQuery,
  logLine,
  parseQuery,
  readJsonRequest,
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
import { sseFrame, type EventRing } from "./events.js";
import type { OriginPolicy } from "./origins.js";

export interface HonoHttpAppOptions {
  readonly read: ReadService;
  readonly services: RouteServices;
  readonly auth: AuthStore;
  readonly events: EventRing;
  readonly serviceInstanceId: string;
  readonly originPolicy: () => OriginPolicy | null;
  readonly allowedOrigins?: readonly string[];
  readonly repositoryRootOf?: (repositoryId: string) => string | null;
  readonly limits?: Partial<HttpLimits>;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface HonoHttpApp {
  readonly app: Hono;
  /** Close stateful MCP transports so a service shutdown does not retain streams. */
  close(): Promise<void>;
}

interface McpSession {
  readonly refyardSessionId: string;
  readonly server: McpServer;
  readonly transport: StreamableHTTPTransport;
}

const MCP_SESSION_LIMIT = 32;

const RESPONSE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "/health": healthResponseSchema,
  "/api/v1/capabilities": capabilitiesResponseSchema,
  "/api/v1/repositories": repositoriesResponseSchema,
  "/api/v1/filesystem/entries": filesystemEntriesResponseSchema,
  "/api/v1/status": statusSnapshotSchema,
  "/api/v1/history": historyPageSchema,
  "/api/v1/refs": refsSnapshotSchema,
  "/api/v1/diff": diffResponseSchema,
  "/api/v1/worktrees": worktreesResponseSchema,
  "/api/v1/submodules": submodulesResponseSchema,
  "/api/v1/stashes": stashesResponseSchema,
  "/api/v1/repositories/register": repositoriesResponseSchema,
  "/api/v1/repositories/revoke": repositoriesResponseSchema,
  "/api/v1/provider/connection": providerConnectionsResponseSchema,
  "/api/v1/provider/pull-requests": providerPullRequestsResponseSchema,
  "/api/v1/provider/github/connect": providerConnectionsResponseSchema,
  "/api/v1/provider/github/device/start": providerDeviceStartResponseSchema,
  "/api/v1/provider/device/status": providerDeviceStatusResponseSchema,
  "/api/v1/provider/disconnect": providerConnectionsResponseSchema,
  "/api/v1/previews": previewsResponseSchema,
  "/api/v1/operations": operationsListResponseSchema,
};

const BODY_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "/api/v1/session/exchange": sessionExchangeRequestSchema,
  "/api/v1/repositories/register": registerRepositoryRequestSchema,
  "/api/v1/repositories/revoke": revokeRepositoryRequestSchema,
  "/api/v1/provider/github/connect": connectProviderRequestSchema,
  "/api/v1/provider/disconnect": disconnectProviderRequestSchema,
  "/api/v1/previews": previewsRequestSchema,
  "/api/v1/operations": MutationRequestSchema,
  "/api/v1/operations/cancel": cancelOperationRequestSchema,
};

const MUTATION_SUBMISSION_RESPONSE = z.union([
  operationAcceptedSchema,
  z.strictObject({
    operation: operationRecordSchema,
    duplicate: z.literal(true),
  }),
]);

const CANCEL_RESPONSE = z.strictObject({ operation: operationRecordSchema });

/** Compose the authenticated API, documentation routes and read-only MCP surface. */
export function createHonoHttpApp(options: HonoHttpAppOptions): HonoHttpApp {
  const limits: HttpLimits = { ...DEFAULT_HTTP_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const sessions = new Map<string, McpSession>();
  const app = new Hono();

  app.use(
    "/mcp",
    rateLimiter({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      keyGenerator: (context) =>
        context.req.header("x-forwarded-for") ??
        context.req.header("origin") ??
        "anonymous",
      message: {
        problem: {
          code: "ResourceBusy",
          message: "the MCP request rate limit was exceeded",
          retryable: true,
        },
      },
      statusCode: 429,
    }),
  );

  app.use("*", async (context, next) => {
    const target = requestTarget(context.req.raw);
    if (Buffer.byteLength(target.target, "utf8") > limits.maxUrlBytes) {
      return problemResponse(
        context,
        problemFor(
          "LimitExceeded",
          `the request target may not exceed ${limits.maxUrlBytes} bytes`,
        ),
        options,
      );
    }

    const policy = options.originPolicy();
    if (policy === null) {
      return problemResponse(
        context,
        problemFor("Unavailable", "the service is still starting"),
        options,
      );
    }
    const origin = context.req.header("origin");
    const originCheck = policy.check({
      origin,
      host: context.req.header("host"),
      secFetchSite: context.req.header("sec-fetch-site"),
    });
    if (!originCheck.ok) {
      logRequestProblem(context, now, log, originCheck.problem);
      return problemResponse(context, originCheck.problem, options);
    }

    const hostedOrigin = externalOrigin(origin, options.allowedOrigins);
    if (hostedOrigin !== null) {
      setCorsHeaders(context, hostedOrigin, target.path === "/mcp");
    }
    if (context.req.method === "OPTIONS") {
      return optionsResponse(
        context,
        hostedOrigin,
        target.path === "/mcp",
        options,
      );
    }
    await next();
  });

  app.use(
    "/api/v1/session/exchange",
    rateLimiter({
      windowMs: 60_000,
      limit: 10,
      standardHeaders: "draft-7",
      // The Node listener is loopback-only, so an untrusted forwarded address is
      // not a useful identity. The exact browser origin is the stable key for a
      // hosted page and cannot be widened by a request header.
      keyGenerator: (context) => context.req.header("origin") ?? "anonymous",
      message: {
        problem: {
          code: "ResourceBusy",
          message:
            "too many hosted pairing attempts; request a fresh ticket later",
          retryable: true,
        },
      },
      statusCode: 429,
    }),
  );

  app.onError((error, context) => {
    const correlationId = newCorrelationId();
    log(
      `internal failure ${correlationId} ${error instanceof Error ? error.message : "unknown"}`,
    );
    return problemResponse(
      context,
      problemFor(
        "InternalError",
        `the service failed; correlation ${correlationId}`,
      ),
      options,
      correlationId,
    );
  });

  app.get(
    "/health",
    describeRoute({
      operationId: "health",
      tags: ["service"],
      security: [],
      responses: {
        200: {
          description: "The service is alive.",
          content: {
            "application/json": { schema: resolver(healthResponseSchema) },
          },
        },
      },
    }),
    (context) =>
      jsonResponse(
        context,
        healthResponseSchema.parse({
          alive: true,
          apiMajor: 1,
          serviceInstanceId: options.serviceInstanceId,
        }),
        200,
        options,
      ),
  );

  app.post(
    "/api/v1/session/exchange",
    describeRoute({
      operationId: "exchangeSession",
      tags: ["session"],
      security: [],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(sessionExchangeRequestSchema),
          },
        },
      },
      responses: {
        200: {
          description:
            "The one-time ticket became an in-memory bearer session.",
          content: {
            "application/json": {
              schema: resolver(sessionExchangeResponseSchema),
            },
          },
        },
      },
    }),
    async (context) => {
      const body = await readJsonRequest(context.req.raw, limits);
      if (!body.ok) {
        logRequestProblem(context, now, log, body.problem);
        return problemResponse(context, body.problem, options);
      }
      const parsed = validate(
        sessionExchangeRequestSchema,
        body.value,
        "the exchange body",
      );
      if (!parsed.ok) {
        logRequestProblem(context, now, log, parsed.problem);
        return problemResponse(context, parsed.problem, options);
      }
      const exchanged = options.auth.exchange({
        ticket: parsed.value.ticket,
        origin: context.req.header("origin") ?? "",
        serviceInstanceId: options.serviceInstanceId,
        password: parsed.value.password,
      });
      if (!exchanged.ok) {
        logRequestProblem(context, now, log, exchanged.problem);
        return problemResponse(context, exchanged.problem, options);
      }
      const session = exchanged.session;
      return jsonResponse(
        context,
        sessionExchangeResponseSchema.parse({
          token: session.token,
          tokenType: "Bearer",
          expiresAt: new Date(session.expiresAtMs).toISOString(),
          serviceInstanceId: options.serviceInstanceId,
          apiMajor: 1,
          sessionId: session.sessionId,
          grants: {
            allowedRootIds: [...session.grants.allowedRootIds],
            repositoryIds: [...session.grants.repositoryIds],
            scopes: [...session.grants.scopes],
          },
        }),
        200,
        options,
      );
    },
  );

  const routes = [...readRoutes(), ...mutationRoutes()];
  for (const route of routes) {
    app.on(
      route.method,
      route.path,
      describeRoute(routeDocumentation(route)),
      async (context) => handleRoute(context, route, options, limits, now, log),
    );
  }

  app.get(
    "/api/v1/events",
    describeRoute({
      operationId: "subscribeEvents",
      tags: ["events"],
      parameters: queryParameters(eventsQuerySchema),
      responses: {
        200: {
          description:
            "An authenticated event stream of cache invalidation hints.",
          content: { "text/event-stream": { schema: { type: "string" } } },
        },
      },
    }),
    async (context) => {
      const authorized = authorize(context, options);
      if (!authorized.ok) {
        logRequestProblem(context, now, log, authorized.problem);
        return problemResponse(context, authorized.problem, options);
      }
      const authority = authorizationScopeProblem(
        authorized.session,
        "repository:read",
        options,
      );
      if (authority !== null) {
        logRequestProblem(context, now, log, authority, authorized.session);
        return problemResponse(context, authority, options);
      }

      const target = requestTarget(context.req.raw);
      const query = parseQuery(target.rawQuery, limits);
      if (!query.ok) {
        logRequestProblem(context, now, log, query.problem);
        return problemResponse(context, query.problem, options);
      }
      const converted = convertQuery(eventsQuerySchema, query.value);
      if (!converted.ok) {
        logRequestProblem(context, now, log, converted.problem);
        return problemResponse(context, converted.problem, options);
      }
      const since = converted.value["since"];
      return eventResponse(
        context,
        options.events,
        typeof since === "number" ? since : undefined,
        options,
      );
    },
  );

  app.all("/mcp", async (context) => {
    const authorized = authorize(context, options);
    if (!authorized.ok) {
      logRequestProblem(context, now, log, authorized.problem);
      return problemResponse(context, authorized.problem, options, undefined, {
        "www-authenticate": "Bearer",
      });
    }

    const authority = authorizationScopeProblem(
      authorized.session,
      "repository:read",
      options,
    );
    if (authority !== null) {
      logRequestProblem(context, now, log, authority, authorized.session);
      return problemResponse(context, authority, options);
    }

    const sessionId = context.req.header("mcp-session-id");
    let mcpSession =
      sessionId === undefined ? undefined : sessions.get(sessionId);
    if (sessionId !== undefined && mcpSession === undefined) {
      return mcpProtocolError(
        context,
        404,
        "that MCP session is not known to this service",
        options,
      );
    }
    if (
      mcpSession !== undefined &&
      mcpSession.refyardSessionId !== authorized.session.sessionId
    ) {
      return problemResponse(
        context,
        problemFor(
          "Forbidden",
          "that MCP session belongs to a different bearer session",
        ),
        options,
      );
    }
    if (mcpSession === undefined) {
      if (sessions.size >= MCP_SESSION_LIMIT) {
        return problemResponse(
          context,
          problemFor(
            "ResourceBusy",
            "the service has reached its MCP session limit",
            undefined,
            true,
          ),
          options,
        );
      }
      mcpSession = createMcpSession(authorized.session, options, sessions);
      await mcpSession.server.connect(mcpSession.transport);
    }

    let parsedBody: unknown = undefined;
    if (context.req.method === "POST") {
      const body = await readJsonRequest(context.req.raw, limits);
      if (!body.ok) {
        return mcpProtocolError(
          context,
          statusForProblem(body.problem),
          body.problem.message,
          options,
        );
      }
      parsedBody = body.value;
    }
    const response = await mcpSession.transport.handleRequest(
      context,
      parsedBody,
    );
    return (
      response ??
      new Response(null, {
        status: 202,
        headers: responseHeaders(context, options),
      })
    );
  });

  app.all("/api", (context) => unknownApiResponse(context, options, now, log));
  app.all("/api/*", (context) =>
    unknownApiResponse(context, options, now, log),
  );

  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Refyard GitService",
          version: "1",
          description:
            "Authenticated, closed-semantic Git reads and explicitly submitted operations. The MCP surface is read-only.",
        },
        security: [{ BearerAuth: [] }],
        components: {
          securitySchemes: {
            BearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      },
      exclude: ["/openapi.json", "/scalar", "/mcp"],
      excludeMethods: ["OPTIONS"],
    }),
  );

  app.use("/scalar", async (context, next) => {
    context.header("cache-control", "no-store");
    context.header("referrer-policy", "no-referrer");
    context.header("x-content-type-options", "nosniff");
    await next();
  });
  app.get(
    "/scalar",
    Scalar({
      url: "/openapi.json",
      pageTitle: "Refyard GitService API",
    }),
  );

  return {
    app,
    async close(): Promise<void> {
      const active = [...sessions.values()];
      sessions.clear();
      await Promise.all(active.map((session) => session.server.close()));
    },
  };
}

async function handleRoute(
  context: Context,
  route: RouteDefinition,
  options: HonoHttpAppOptions,
  limits: HttpLimits,
  now: () => number,
  log: (line: string) => void,
): Promise<Response> {
  const authorized = authorize(context, options);
  if (!authorized.ok) {
    logRequestProblem(context, now, log, authorized.problem);
    return problemResponse(context, authorized.problem, options);
  }

  const target = requestTarget(context.req.raw);
  const query = parseQuery(target.rawQuery, limits);
  if (!query.ok) {
    logRequestProblem(context, now, log, query.problem, authorized.session);
    return problemResponse(context, query.problem, options);
  }

  let queryValue: ConvertedQuery = {};
  let bodyValue: unknown = undefined;
  if (route.method === "GET") {
    if (route.schema === undefined) {
      const problem = problemFor(
        "InternalError",
        `${route.path} has no query schema`,
      );
      logRequestProblem(context, now, log, problem, authorized.session);
      return problemResponse(context, problem, options);
    }
    const converted = convertQuery(route.schema, query.value);
    if (!converted.ok) {
      logRequestProblem(
        context,
        now,
        log,
        converted.problem,
        authorized.session,
      );
      return problemResponse(context, converted.problem, options);
    }
    queryValue = converted.value;
  } else {
    const body = await readJsonRequest(context.req.raw, limits);
    if (!body.ok) {
      logRequestProblem(context, now, log, body.problem, authorized.session);
      return problemResponse(context, body.problem, options);
    }
    bodyValue = body.value;
  }

  const requiredScope = route.requiredScope({
    query: queryValue,
    body: bodyValue,
    services: options.services,
  });
  const authority =
    requiredScope === null
      ? null
      : authorizationScopeProblem(authorized.session, requiredScope, options);
  if (authority !== null) {
    logRequestProblem(context, now, log, authority, authorized.session);
    return problemResponse(context, authority, options);
  }

  const scoped = scopeProblem(
    authorized.session,
    route.method === "GET" ? queryValue : bodyValue,
    options,
  );
  if (scoped !== null) {
    logRequestProblem(context, now, log, scoped, authorized.session);
    return problemResponse(context, scoped, options);
  }

  try {
    const body = await route.handle({
      session: authorized.session,
      query: queryValue,
      body: bodyValue,
      services: options.services,
    });
    const status = route.successStatus?.(body) ?? 200;
    logRequest(context, now, log, status, authorized.session);
    return jsonResponse(context, body, status, options);
  } catch (error) {
    const problem =
      error instanceof ReadProblem
        ? error.toProblem()
        : problemFor(
            "InternalError",
            `the read failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
    logRequestProblem(context, now, log, problem, authorized.session);
    return problemResponse(context, problem, options);
  }
}

function unknownApiResponse(
  context: Context,
  options: HonoHttpAppOptions,
  now: () => number,
  log: (line: string) => void,
): Response {
  const authorized = authorize(context, options);
  if (!authorized.ok) {
    logRequestProblem(context, now, log, authorized.problem);
    return problemResponse(context, authorized.problem, options);
  }
  const path = requestTarget(context.req.raw).path;
  const problem = UNIMPLEMENTED_PATHS.includes(path)
    ? unsupportedProblem(path)
    : problemFor("NotFound", `no API route ${path}`);
  logRequestProblem(context, now, log, problem, authorized.session);
  return problemResponse(context, problem, options);
}

function authorize(context: Context, options: HonoHttpAppOptions) {
  return options.auth.authorize({
    authorization: context.req.header("authorization"),
    serviceInstanceId: options.serviceInstanceId,
  });
}

function authorizationScopeProblem(
  session: Session,
  requiredScope: AuthorizationScope,
  options: HonoHttpAppOptions,
): Problem | null {
  if (options.auth.allowsScope(session, requiredScope)) {
    return null;
  }
  return problemFor(
    "Forbidden",
    `this session was not granted the ${requiredScope} scope`,
    { requiredScope },
  );
}

function scopeProblem(
  session: Session,
  input: unknown,
  options: HonoHttpAppOptions,
): Problem | null {
  const repositoryId = repositoryIdForScope(input);
  if (repositoryId !== null) {
    if (options.auth.allowsRepository(session, repositoryId)) {
      return null;
    }
    const root = options.repositoryRootOf?.(repositoryId) ?? null;
    if (root !== null && options.auth.allowsRoot(session, root)) {
      return null;
    }
    return problemFor(
      "Forbidden",
      "this session was not granted that repository",
      { repositoryId },
    );
  }
  const allowedRootId = allowedRootIdForScope(input);
  if (
    allowedRootId !== null &&
    !options.auth.allowsRoot(session, allowedRootId)
  ) {
    return problemFor(
      "Forbidden",
      "this session was not granted that approved root",
      { allowedRootId },
    );
  }
  return null;
}

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
    input.target !== null &&
    "repositoryId" in input.target &&
    typeof input.target.repositoryId === "string"
  ) {
    return input.target.repositoryId;
  }
  return null;
}

function allowedRootIdForScope(input: unknown): string | null {
  if (
    typeof input !== "object" ||
    input === null ||
    !("target" in input) ||
    typeof input.target !== "object" ||
    input.target === null ||
    !("kind" in input.target) ||
    input.target.kind !== "workspace" ||
    !("allowedRootId" in input.target) ||
    typeof input.target.allowedRootId !== "string"
  ) {
    return null;
  }
  return input.target.allowedRootId;
}

function requestTarget(request: Request): {
  readonly path: string;
  readonly rawQuery: string;
  readonly target: string;
} {
  const url = new URL(request.url);
  return {
    path: url.pathname,
    rawQuery: url.search.length === 0 ? "" : url.search.slice(1),
    target: `${url.pathname}${url.search}`,
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

function setCorsHeaders(context: Context, origin: string, mcp: boolean): void {
  context.header("access-control-allow-origin", origin);
  context.header(
    "access-control-allow-headers",
    mcp
      ? "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
      : "Authorization, Content-Type, Accept",
  );
  context.header(
    "access-control-allow-methods",
    mcp ? "GET, POST, DELETE, OPTIONS" : "GET, POST, OPTIONS",
  );
  context.header(
    "access-control-expose-headers",
    mcp
      ? "x-refyard-correlation, Mcp-Session-Id, WWW-Authenticate"
      : "x-refyard-correlation",
  );
  context.header("access-control-max-age", "300");
  context.header("vary", "Origin");
}

function optionsResponse(
  context: Context,
  hostedOrigin: string | null,
  mcp: boolean,
  options: HonoHttpAppOptions,
): Response {
  if (hostedOrigin === null) {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, POST" },
    });
  }
  const requestedMethod = context.req.header("access-control-request-method");
  const allowedMethods = mcp ? ["GET", "POST", "DELETE"] : ["GET", "POST"];
  if (
    requestedMethod !== undefined &&
    !allowedMethods.includes(requestedMethod)
  ) {
    return problemResponse(
      context,
      problemFor("Forbidden", "that hosted request method is not allowed"),
      options,
    );
  }
  const requestedHeaders = context.req.header("access-control-request-headers");
  if (requestedHeaders !== undefined) {
    const allowedHeaders = new Set(
      mcp
        ? [
            "authorization",
            "content-type",
            "accept",
            "mcp-session-id",
            "mcp-protocol-version",
            "last-event-id",
          ]
        : ["authorization", "content-type", "accept"],
    );
    const invalid = requestedHeaders
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .find((header) => header.length > 0 && !allowedHeaders.has(header));
    if (invalid !== undefined) {
      return new Response(
        JSON.stringify({
          problem: problemFor(
            "Forbidden",
            `that hosted request header is not allowed: ${invalid}`,
          ),
        }),
        {
          status: 403,
          headers: responseHeaders(context, options),
        },
      );
    }
  }
  return new Response(null, {
    status: 204,
    headers: responseHeaders(context, options),
  });
}

function responseHeaders(
  context: Context,
  options: HonoHttpAppOptions,
  extra: Readonly<Record<string, string>> = {},
): Headers {
  const headers = new Headers({ ...JSON_HEADERS, ...extra });
  const origin = externalOrigin(
    context.req.header("origin"),
    options.allowedOrigins,
  );
  if (origin !== null) {
    setRawCorsHeaders(
      headers,
      origin,
      requestTarget(context.req.raw).path === "/mcp",
    );
  }
  return headers;
}

function setRawCorsHeaders(
  headers: Headers,
  origin: string,
  mcp: boolean,
): void {
  headers.set("access-control-allow-origin", origin);
  headers.set(
    "access-control-allow-headers",
    mcp
      ? "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
      : "Authorization, Content-Type, Accept",
  );
  headers.set(
    "access-control-allow-methods",
    mcp ? "GET, POST, DELETE, OPTIONS" : "GET, POST, OPTIONS",
  );
  headers.set(
    "access-control-expose-headers",
    mcp
      ? "x-refyard-correlation, Mcp-Session-Id, WWW-Authenticate"
      : "x-refyard-correlation",
  );
  headers.set("access-control-max-age", "300");
  headers.set("vary", "Origin");
}

function jsonResponse(
  context: Context,
  body: unknown,
  status: number,
  options: HonoHttpAppOptions,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(context, options),
  });
}

function problemResponse(
  context: Context,
  problem: Problem,
  options: HonoHttpAppOptions,
  correlationId?: string,
  extra: Readonly<Record<string, string>> = {},
): Response {
  const headers = responseHeaders(context, options, extra);
  if (correlationId !== undefined) {
    headers.set("x-refyard-correlation", correlationId);
  }
  return new Response(problemBody(problem), {
    status: statusForProblem(problem),
    headers,
  });
}

function mcpProtocolError(
  context: Context,
  status: number,
  message: string,
  options: HonoHttpAppOptions,
): Response {
  const headers = responseHeaders(context, options);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_000, message },
      id: null,
    }),
    { status, headers },
  );
}

function logRequestProblem(
  context: Context,
  now: () => number,
  log: (line: string) => void,
  problem: Problem,
  session?: Session,
): void {
  logRequest(context, now, log, statusForProblem(problem), session, problem);
}

function logRequest(
  context: Context,
  now: () => number,
  log: (line: string) => void,
  status: number,
  session?: Session,
  problem?: Problem,
): void {
  const target = requestTarget(context.req.raw);
  log(
    logLine({
      method: context.req.method,
      path: target.path,
      status,
      durationMs: Math.max(0, now() - now()),
      ...(session === undefined ? {} : { sessionId: session.sessionId }),
      ...(problem === undefined
        ? {}
        : { problemCode: problem.code, problemMessage: problem.message }),
    }),
  );
}

function eventResponse(
  context: Context,
  ring: EventRing,
  since: number | undefined,
  options: HonoHttpAppOptions,
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string): void => {
        if (!cleaned) {
          controller.enqueue(encoder.encode(value));
        }
      };
      for (const envelope of ring.replay(since)) {
        write(sseFrame(envelope));
      }
      write("retry: 3000\n\n");
      unsubscribe = ring.subscribe((envelope) => write(sseFrame(envelope)));
      heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);
      if (typeof heartbeat === "object" && "unref" in heartbeat) {
        heartbeat.unref();
      }
      context.req.raw.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel: cleanup,
  });
  const headers = responseHeaders(context, options, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  return new Response(stream, { status: 200, headers });
}

function createMcpSession(
  session: Session,
  options: HonoHttpAppOptions,
  sessions: Map<string, McpSession>,
): McpSession {
  let result: McpSession | null = null;
  const transport = new StreamableHTTPTransport({
    enableJsonResponse: true,
    sessionIdGenerator: () => `mcp_${randomBytes(18).toString("base64url")}`,
    onsessioninitialized: (sessionId) => {
      if (result === null) {
        throw new Error(
          "MCP session initialized before its server was assembled",
        );
      }
      sessions.set(sessionId, result);
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });
  const server = new McpServer({ name: "refyard", version: "0.1.1" });
  registerMcpTools(server, session, options);
  result = { refyardSessionId: session.sessionId, server, transport };
  return result;
}

function registerMcpTools(
  server: McpServer,
  session: Session,
  options: HonoHttpAppOptions,
): void {
  server.registerTool(
    "repo_status",
    {
      description:
        "Read the bounded status snapshot for one approved repository.",
      inputSchema: {
        repositoryId: repositoryIdSchema,
        worktreeId: worktreeIdSchema.optional(),
      },
    },
    async (input) =>
      runMcpRead(session, input.repositoryId, options, () =>
        options.read.status(input),
      ),
  );
  server.registerTool(
    "list_branches",
    {
      description:
        "List local branches, remote refs and tags for one repository.",
      inputSchema: { repositoryId: repositoryIdSchema },
    },
    async (input) =>
      runMcpRead(session, input.repositoryId, options, async () => {
        const refs = await options.read.refs(input);
        return { repositoryId: input.repositoryId, branches: refs.branches };
      }),
  );
  server.registerTool(
    "list_worktrees",
    {
      description: "List the worktrees registered for one approved repository.",
      inputSchema: { repositoryId: repositoryIdSchema },
    },
    async (input) =>
      runMcpRead(session, input.repositoryId, options, () =>
        options.read.worktrees(input),
      ),
  );
  server.registerTool(
    "get_diff",
    {
      description:
        "Read one bounded diff selection; it never writes Git state.",
      inputSchema: {
        repositoryId: repositoryIdSchema,
        worktreeId: worktreeIdSchema.optional(),
        kind: z.enum(["unstaged", "staged", "untracked", "commit", "range"]),
        oid: objectIdSchema.optional(),
        from: objectIdSchema.optional(),
        to: objectIdSchema.optional(),
        pathId: pathIdSchema.optional(),
        maxBytes: z.int().positive().optional(),
      },
    },
    async (input) =>
      runMcpRead(session, input.repositoryId, options, () =>
        options.read.diff(input),
      ),
  );
  server.registerTool(
    "get_commit",
    {
      description: "Read one commit summary and its full message by object id.",
      inputSchema: {
        repositoryId: repositoryIdSchema,
        oid: objectIdSchema,
      },
    },
    async (input) =>
      runMcpRead(session, input.repositoryId, options, async () => {
        const history = await options.read.history({
          repositoryId: input.repositoryId,
          detailOid: input.oid,
          limit: 1,
        });
        return {
          repositoryId: input.repositoryId,
          oid: input.oid,
          commit:
            history.commits.find((commit) => commit.oid === input.oid) ?? null,
          detail: history.detail,
        };
      }),
  );
}

async function runMcpRead<T>(
  session: Session,
  repositoryId: string,
  options: HonoHttpAppOptions,
  read: () => Promise<T>,
): Promise<CallToolResult> {
  const scope = scopeProblem(session, { repositoryId }, options);
  if (scope !== null) {
    return mcpToolError(scope.message);
  }
  try {
    return mcpToolResult(await read());
  } catch (error) {
    return mcpToolError(
      error instanceof ReadProblem ? error.message : "the read failed",
    );
  }
}

function mcpToolResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) ?? "null" }],
    structuredContent: { data: value },
  };
}

function mcpToolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function routeDocumentation(route: RouteDefinition) {
  const responseSchema = responseSchemaFor(route);
  const bodySchema = BODY_SCHEMAS[route.path];
  const base = {
    operationId: operationIdFor(route),
    tags: [route.path.startsWith("/api/") ? "GitService" : "service"],
    security: [{ BearerAuth: [] }],
    ...(route.schema === undefined
      ? {}
      : { parameters: queryParameters(route.schema) }),
    ...(bodySchema === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: resolver(bodySchema) },
            },
          },
        }),
  };
  const response = responseDocumentation(responseSchema);
  if (route.path === "/api/v1/operations" && route.method === "POST") {
    return {
      ...base,
      responses: {
        200: responseDocumentation(operationAcceptedSchema)[200],
        202: responseDocumentation(MUTATION_SUBMISSION_RESPONSE)[200],
      },
    };
  }
  if (route.path === "/api/v1/operations/cancel") {
    return {
      ...base,
      responses: responseDocumentation(CANCEL_RESPONSE),
    };
  }
  return { ...base, responses: response };
}

function responseSchemaFor(route: RouteDefinition): z.ZodType | undefined {
  if (route.path === "/api/v1/operations" && route.method === "POST") {
    return MUTATION_SUBMISSION_RESPONSE;
  }
  if (route.path === "/api/v1/operations/cancel") {
    return CANCEL_RESPONSE;
  }
  return RESPONSE_SCHEMAS[route.path];
}

function responseDocumentation(schema: z.ZodType | undefined) {
  return schema === undefined
    ? { 200: { description: "The operation completed." } }
    : {
        200: {
          description: "The request completed.",
          content: {
            "application/json": { schema: resolver(schema) },
          },
        },
      };
}

function operationIdFor(route: RouteDefinition): string {
  const ids: Readonly<Record<string, string>> = {
    "/api/v1/capabilities": "getCapabilities",
    "/api/v1/repositories":
      route.method === "GET"
        ? "listRepositories"
        : "registerOrRevokeRepository",
    "/api/v1/status": "getStatus",
    "/api/v1/history": "getHistory",
    "/api/v1/refs": "getRefs",
    "/api/v1/diff": "getDiff",
    "/api/v1/worktrees": "listWorktrees",
    "/api/v1/submodules": "listSubmodules",
    "/api/v1/stashes": "listStashes",
    "/api/v1/previews": "previewPaths",
    "/api/v1/operations":
      route.method === "GET" ? "listOperations" : "submitOperation",
    "/api/v1/operations/cancel": "cancelOperation",
  };
  return (
    ids[route.path] ??
    `${route.method.toLowerCase()}${route.path
      .split("/")
      .filter((part) => part.length > 0)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join("")}`
  );
}

function queryParameters(schema: z.ZodObject<z.ZodRawShape>): Array<{
  readonly name: string;
  readonly in: "query";
  readonly required: boolean;
  readonly schema: {
    readonly type: "string" | "integer" | "boolean";
    readonly format?: "int32";
  };
}> {
  return Object.keys(schema.shape).map((name) => ({
    name,
    in: "query",
    required: !isOptionalSchema(schema.shape[name]),
    schema: parameterSchema(name),
  }));
}

function parameterSchema(name: string): {
  readonly type: "string" | "integer" | "boolean";
  readonly format?: "int32";
} {
  if (["limit", "since", "maxBytes"].includes(name)) {
    return { type: "integer", format: "int32" };
  }
  if (["firstParentOnly", "includeIgnored"].includes(name)) {
    return { type: "boolean" };
  }
  return { type: "string" };
}

function isOptionalSchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null || !("def" in schema)) {
    return false;
  }
  const definition = Reflect.get(schema, "def");
  return (
    typeof definition === "object" &&
    definition !== null &&
    Reflect.get(definition, "type") === "optional"
  );
}
