/**
 * The route table.
 *
 * Every public path is listed here, with the contract schema that validates its
 * query. The types are threaded rather than cast: a route is declared with its
 * schema and its handler together, so the handler's parameter is the schema's
 * inferred type — a query that changes shape in the contract fails to compile here
 * instead of arriving as a string in the wrong place.
 *
 * Two rules are enforced by construction rather than by review:
 *
 * - **Authentication happens before a handler runs.** The server resolves a session
 *   and checks the session's grant against the repository the request names; a
 *   handler only ever sees an authorized session.
 * - **Unimplemented paths are absent, not stubbed.** `operations`, `events` and
 *   `previews` are known names that answer 501, so a client is told the truth
 *   instead of receiving a plausible-looking empty answer.
 */
import { z } from "zod";
import {
  MutationRequestSchema,
  cancelOperationRequestSchema,
  capabilitiesQuerySchema,
  diffQuerySchema,
  historyQuerySchema,
  operationAcceptedSchema,
  operationsListQuerySchema,
  previewsRequestSchema,
  repositoriesQuerySchema,
  repositoryQuerySchema,
  validateOperationSemantics,
  worktreeQuerySchema,
  type Problem,
} from "@refyard/git-contract";
import type { ReadService } from "../coordinator/reads.js";
import { ReadProblem } from "../coordinator/reads.js";
import type { Session } from "./auth.js";
import type { MutationCoordinator } from "../coordinator/submit.js";

/** What a route handler may use. The engine is absent in a read-only host. */
export interface RouteServices {
  readonly read: ReadService;
  readonly mutations?: MutationCoordinator | undefined;
}

export interface RouteDefinition {
  readonly method: "GET" | "POST";
  /** Exact path, no parameters: every input travels in the query or the body. */
  readonly path: string;
  /**
   * The contract schema for this route's *query*.
   *
   * Exposed so the server can convert raw parameter strings to the types the schema
   * declares before it checks the session's grant, and so the conversion stays
   * driven by the contract rather than by a list of key names kept in two places.
   * Absent on action routes, whose input is a validated JSON body.
   */
  readonly schema?: z.ZodObject<z.ZodRawShape>;
  /**
   * The HTTP status a successful response carries, from the response body.
   *
   * Almost every route answers 200; the submission route answers 202 for a fresh
   * acceptance, because "accepted for execution" is not "done" and a client must be
   * able to tell them apart. The status is derived here, at the route, so the server
   * never keeps a second table of which paths are special.
   */
  readonly successStatus?: (body: unknown) => number;
  handle(input: {
    readonly session: Session;
    readonly query: unknown;
    readonly body: unknown;
    readonly services: RouteServices;
  }): Promise<unknown>;
}

/**
 * Declare a read route.
 *
 * The schema is applied here rather than in the handler, so no handler can forget
 * it, and the generic ties the handler's parameter to the schema's output: this is
 * the one place where "the contract validated the request" is guaranteed instead of
 * remembered.
 */
function readRoute<Schema extends z.ZodObject<z.ZodRawShape>>(
  path: string,
  schema: Schema,
  run: (query: z.infer<Schema>, services: RouteServices) => Promise<unknown>,
): RouteDefinition {
  return {
    method: "GET",
    path,
    schema,
    async handle({ query, services }) {
      const parsed = schema.safeParse(query);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new ReadProblem({
          code: "InvalidRequest",
          message: `the query for ${path} is not valid: ${
            first === undefined
              ? "no detail"
              : `${first.path.join(".") || "(root)"} ${first.message}`
          }`,
          details: { issues: parsed.error.issues.length },
        });
      }
      return run(parsed.data, services);
    },
  };
}

export function readRoutes(): readonly RouteDefinition[] {
  return [
    readRoute(
      "/api/v1/capabilities",
      capabilitiesQuerySchema,
      async (_query, services) => services.read.capabilities(),
    ),
    readRoute(
      "/api/v1/repositories",
      repositoriesQuerySchema,
      async (_query, services) => services.read.repositories(),
    ),
    readRoute("/api/v1/status", worktreeQuerySchema, async (query, services) =>
      services.read.status(query),
    ),
    readRoute("/api/v1/history", historyQuerySchema, async (query, services) =>
      services.read.history(query),
    ),
    readRoute("/api/v1/refs", repositoryQuerySchema, async (query, services) =>
      services.read.refs(query),
    ),
    readRoute("/api/v1/diff", diffQuerySchema, async (query, services) =>
      services.read.diff(query),
    ),
    readRoute(
      "/api/v1/worktrees",
      repositoryQuerySchema,
      async (query, services) => services.read.worktrees(query),
    ),
    readRoute(
      "/api/v1/submodules",
      worktreeQuerySchema,
      async (query, services) => services.read.submodules(query),
    ),
    readRoute(
      "/api/v1/stashes",
      repositoryQuerySchema,
      async (query, services) => services.read.stashes(query),
    ),
    actionRoute(
      "/api/v1/previews",
      previewsRequestSchema,
      async (body, services) => services.read.previews(body),
    ),
    readRoute(
      "/api/v1/operations",
      operationsListQuerySchema,
      async (query, services) => {
        const jobs = services.mutations?.jobs;
        if (jobs === undefined) {
          throw new ReadProblem({
            code: "UnsupportedOperation",
            message: "this host has no operation engine",
          });
        }
        if (query.operationId !== undefined) {
          const record = jobs.get(query.operationId, SERVICES_ACTOR);
          if (record === null) {
            throw new ReadProblem({
              code: "NotFound",
              message: "no such operation for this session",
            });
          }
          return { operations: [record], truncated: false };
        }
        return jobs.list({ actor: SERVICES_ACTOR, limit: query.limit ?? 50 });
      },
    ),
  ];
}

/**
 * Declare an action route: one that takes a JSON body.
 *
 * The body schema is applied here for the same reason a read route applies its
 * query schema — no handler can forget it, and the parameter's type comes from the
 * schema rather than from a cast.
 */
function actionRoute<Schema extends z.ZodType<unknown>>(
  path: string,
  schema: Schema,
  run: (body: z.infer<Schema>, services: RouteServices) => Promise<unknown>,
): RouteDefinition {
  return {
    method: "POST",
    path,
    async handle({ body, services }) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new ReadProblem({
          code: "InvalidRequest",
          message: `the body for ${path} is not valid: ${
            first === undefined
              ? "no detail"
              : `${first.path.join(".") || "(root)"} ${first.message}`
          }`,
          details: { issues: parsed.error.issues.length },
        });
      }
      return run(parsed.data, services);
    },
  };
}

export function mutationRoutes(): readonly RouteDefinition[] {
  return [
    {
      ...actionRoute(
        "/api/v1/operations",
        MutationRequestSchema,
        async (body, services) => {
          const mutations = services.mutations;
          if (mutations === undefined) {
            throw new ReadProblem({
              code: "UnsupportedOperation",
              message:
                "this host has no mutation engine; no operation was accepted and none will run",
            });
          }
          // Semantic validation at the boundary: the schema pins the shape, and these
          // rules — a branch name that would read as an option, a remote URL that is a
          // transport helper in disguise, a rename to its own name — are refused here,
          // before an operation is accepted or Git is reached.
          const problems = validateOperationSemantics(body.operation, body.target);
          if (problems.length > 0) {
            throw new ReadProblem({
              code: "InvalidRequest",
              message: `the operation is not valid: ${problems
                .slice(0, 4)
                .map((entry) => `${entry.path ?? "operation"} ${entry.message}`)
                .join("; ")}`,
              details: { issues: problems.length },
              retryable: false,
            });
          }
          const result = await mutations.jobs.submit({
            request: body,
            actor: SERVICES_ACTOR,
          });
          if (!result.ok) {
            throw new ReadProblem({
              code: result.problem.code,
              message: result.problem.message,
              ...(result.problem.details === undefined
                ? {}
                : { details: result.problem.details }),
              retryable: result.problem.retryable,
            });
          }
          if (result.duplicate) {
            // A replay of an accepted request returns the recorded operation rather than
            // a second acceptance, which is what makes a retry after a lost response safe.
            return { operation: result.record, duplicate: true };
          }
          return operationAcceptedSchema.parse({
            operationId: result.record.operationId,
            status: "accepted",
            acceptedAt: result.record.acceptedAt,
          });
        },
      ),
      // A fresh acceptance is 202: the operation has not run yet, and a client that
      // treated it as a result would be showing an outcome nobody has observed. A
      // replay answers 200 with the recorded operation.
      successStatus: (body) =>
        typeof body === "object" &&
        body !== null &&
        "status" in body &&
        body.status === "accepted"
          ? 202
          : 200,
    },

    actionRoute(
      "/api/v1/operations/cancel",
      cancelOperationRequestSchema,
      async (body, services) => {
        const mutations = services.mutations;
        if (mutations === undefined) {
          throw new ReadProblem({
            code: "UnsupportedOperation",
            message: "this host has no mutation engine",
          });
        }
        const result = mutations.jobs.cancel({
          operationId: body.operationId,
          actor: SERVICES_ACTOR,
        });
        if (!result.ok) {
          throw new ReadProblem({
            code: result.problem.code,
            message: result.problem.message,
            retryable: result.problem.retryable,
          });
        }
        return { operation: result.record };
      },
    ),
  ];
}

/**
 * The actor every request through this host is attributed to.
 *
 * One OS user, one browser session: the session id identifies the connection, and
 * the actor identifies whose journal entries these are. A future multi-user host
 * would derive this from the session instead of a constant.
 */
export const SERVICES_ACTOR = "local-user";

/** Known paths this build does not implement, so a client learns that clearly. */
export const UNIMPLEMENTED_PATHS: readonly string[] = [
  "/api/v1/repositories/register",
];

export function unsupportedProblem(path: string): Problem {
  return {
    code: "UnsupportedOperation",
    message: `${path} is not implemented in this build; it is never stubbed with a fake success`,
    retryable: false,
  };
}
