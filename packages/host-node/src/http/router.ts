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
  capabilitiesQuerySchema,
  diffQuerySchema,
  historyQuerySchema,
  repositoriesQuerySchema,
  repositoryQuerySchema,
  worktreeQuerySchema,
  type Problem,
} from "@refyard/git-contract";
import type { ReadService } from "../coordinator/reads.js";
import { ReadProblem } from "../coordinator/reads.js";
import type { Session } from "./auth.js";

export interface RouteDefinition {
  readonly method: "GET" | "POST";
  /** Exact path, no parameters: every input travels in the query or the body. */
  readonly path: string;
  /**
   * The contract schema for this route's query.
   *
   * Exposed so the server can convert raw parameter strings to the types the schema
   * declares before it checks the session's grant, and so the conversion stays
   * driven by the contract rather than by a list of key names kept in two places.
   */
  readonly schema: z.ZodObject<z.ZodRawShape>;
  handle(input: {
    readonly session: Session;
    readonly query: unknown;
    readonly read: ReadService;
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
  run: (query: z.infer<Schema>, read: ReadService) => Promise<unknown>,
): RouteDefinition {
  return {
    method: "GET",
    path,
    schema,
    async handle({ query, read }) {
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
      return run(parsed.data, read);
    },
  };
}

export function readRoutes(): readonly RouteDefinition[] {
  return [
    readRoute(
      "/api/v1/capabilities",
      capabilitiesQuerySchema,
      async (_query, read) => read.capabilities(),
    ),
    readRoute(
      "/api/v1/repositories",
      repositoriesQuerySchema,
      async (_query, read) => read.repositories(),
    ),
    readRoute("/api/v1/status", worktreeQuerySchema, async (query, read) =>
      read.status(query),
    ),
    readRoute("/api/v1/history", historyQuerySchema, async (query, read) =>
      read.history(query),
    ),
    readRoute("/api/v1/refs", repositoryQuerySchema, async (query, read) =>
      read.refs(query),
    ),
    readRoute("/api/v1/diff", diffQuerySchema, async (query, read) =>
      read.diff(query),
    ),
    readRoute("/api/v1/worktrees", repositoryQuerySchema, async (query, read) =>
      read.worktrees(query),
    ),
    readRoute("/api/v1/submodules", worktreeQuerySchema, async (query, read) =>
      read.submodules(query),
    ),
    readRoute("/api/v1/stashes", repositoryQuerySchema, async (query, read) =>
      read.stashes(query),
    ),
  ];
}

/** Known paths this build does not implement, so a client learns that clearly. */
export const UNIMPLEMENTED_PATHS: readonly string[] = [
  "/api/v1/operations",
  "/api/v1/events",
  "/api/v1/previews",
];

export function unsupportedProblem(path: string): Problem {
  return {
    code: "UnsupportedOperation",
    message: `${path} is not implemented in this build; it is never stubbed with a fake success`,
    retryable: false,
  };
}
