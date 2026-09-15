/**
 * The client: one HTTP surface, two hosts.
 *
 * `@refyard/git-client` is what both the Svelte app and Node-side tests use to talk
 * to a running service. It is deliberately small, and it is deliberately strict:
 *
 * - **`fetch` is injected.** The package never reaches for a global, so the same
 *   code runs in a browser, in Node, and in a test with a stub — and it carries no
 *   Node types into a browser bundle.
 * - **The token comes from a provider, not from a field.** A caller that holds a
 *   session exposes it through a function, so this package never stores a bearer in
 *   a place that could be persisted by accident.
 * - **Every method returns a contract DTO.** The response is parsed by the same Zod
 *   schema the server used to build it, so a shape that drifted anywhere between the
 *   two fails at the boundary instead of three components later.
 * - **A failure is a problem, not an exception with a message.** Errors carry the
 *   closed problem code plus the HTTP status, so a caller can branch on
 *   `Unauthenticated` without reading English.
 */
import { z } from "zod";
import {
  healthResponseSchema,
  capabilitiesResponseSchema,
  diffResponseSchema,
  historyPageSchema,
  previewsResponseSchema,
  refsSnapshotSchema,
  repositoriesResponseSchema,
  stashesResponseSchema,
  statusSnapshotSchema,
  submodulesResponseSchema,
  worktreesResponseSchema,
  type CapabilitiesResponse,
  type DiffResponse,
  type HistoryPage,
  type PreviewsResponse,
  type Problem,
  type ProblemCode,
  type RefsSnapshot,
  type RepositoriesResponse,
  type StashesResponse,
  type StatusSnapshot,
  type SubmodulesResponse,
  type WorktreesResponse,
  type HealthResponse,
} from "@refyard/git-contract";

export interface GitClientOptions {
  /** Base URL of the service, e.g. `http://127.0.0.1:9595`. */
  readonly baseUrl: string;
  /**
   * The `fetch` implementation to use.
   *
   * Required rather than defaulted: a client that silently picked up a global
   * `fetch` would work in a browser and fail with a confusing error in a Node
   * version without it, and it would make the transport untestable.
   */
  readonly fetch: typeof fetch;
  /** Current bearer token, or null when the session has not been paired yet. */
  readonly token?: () => string | null;
  /** Injected for tests and for a host that measures requests. */
  readonly now?: () => number;
}

export class GitClientError extends Error {
  readonly code: ProblemCode;
  readonly status: number;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  readonly retryable: boolean;
  readonly correlationId: string | null;

  constructor(input: {
    code: ProblemCode;
    message: string;
    status: number;
    details?: Readonly<Record<string, string | number | boolean>>;
    retryable?: boolean;
    correlationId?: string | null;
  }) {
    super(input.message);
    this.name = "GitClientError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? {};
    this.retryable = input.retryable ?? false;
    this.correlationId = input.correlationId ?? null;
  }

  /** True when the session is gone and the user has to pair again. */
  isUnauthenticated(): boolean {
    return this.code === "Unauthenticated";
  }
}

export interface GitClient {
  exchangeTicket(ticket: string): Promise<{
    readonly token: string;
    readonly expiresAt: string;
    readonly sessionId: string;
  }>;
  health(): Promise<HealthResponse>;
  capabilities(): Promise<CapabilitiesResponse>;
  repositories(): Promise<RepositoriesResponse>;
  registerRepository(path: string): Promise<RepositoriesResponse>;
  revokeRepository(repositoryId: string): Promise<RepositoriesResponse>;
  status(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
    readonly includeIgnored?: boolean;
  }): Promise<StatusSnapshot>;
  history(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
    readonly cursor?: string;
    readonly limit?: number;
    readonly detailOid?: string;
    readonly firstParentOnly?: boolean;
  }): Promise<HistoryPage>;
  refs(query: { readonly repositoryId: string }): Promise<RefsSnapshot>;
  diff(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
    readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
    readonly oid?: string;
    readonly from?: string;
    readonly to?: string;
    readonly pathId?: string;
    readonly maxBytes?: number;
  }): Promise<DiffResponse>;
  worktrees(query: {
    readonly repositoryId: string;
  }): Promise<WorktreesResponse>;
  submodules(query: {
    readonly repositoryId: string;
    readonly worktreeId?: string;
  }): Promise<SubmodulesResponse>;
  stashes(query: { readonly repositoryId: string }): Promise<StashesResponse>;
  previews(query: {
    readonly repositoryId: string;
    readonly worktreeId: string;
    readonly pathIds: readonly string[];
  }): Promise<PreviewsResponse>;
}

/** Turn a query object into a query string, dropping undefined values. */
export function toQueryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }
    parameters.set(key, String(value));
  }
  const text = parameters.toString();
  return text.length === 0 ? "" : `?${text}`;
}

export function createGitClient(options: GitClientOptions): GitClient {
  const token = options.token ?? ((): string | null => null);

  async function send<Response>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<Response>,
    body?: unknown,
  ): Promise<Response> {
    const currentToken = token();
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (currentToken !== null) {
      headers["authorization"] = `Bearer ${currentToken}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    // The Origin header is set by the browser; a Node caller does not send one, and
    // this client never fabricates one, because a fabricated Origin would defeat the
    // check the server performs.
    const response = await options.fetch(`${options.baseUrl}${path}`, {
      method,
      headers,
      credentials: "omit",
      cache: "no-store",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw problemFrom(
        response.status,
        text,
        response.headers.get("x-refyard-correlation"),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GitClientError({
        code: "InternalError",
        status: response.status,
        message: "the service returned a body that is not JSON",
      });
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      const first = validated.error.issues[0];
      throw new GitClientError({
        code: "InternalError",
        status: response.status,
        message: `the service returned a body that does not match the contract: ${
          first === undefined
            ? "no detail"
            : `${first.path.join(".")} ${first.message}`
        }`,
      });
    }
    return validated.data;
  }

  return {
    async exchangeTicket(ticket) {
      const response = await send(
        "POST",
        "/api/v1/session/exchange",
        z.looseObject({
          token: z.string(),
          expiresAt: z.string(),
          sessionId: z.string(),
        }),
        { ticket },
      );
      return {
        token: response.token,
        expiresAt: response.expiresAt,
        sessionId: response.sessionId,
      };
    },

    /**
     * Who is answering at this address.
     *
     * The contract schema, not a loose object: the caller needs the instance id and the
     * API major to decide whether a remembered session still belongs here, and a
     * hand-rolled shape is exactly how a field goes missing when the host adds one.
     */
    health: () => send("GET", "/health", healthResponseSchema),

    capabilities: () =>
      send("GET", "/api/v1/capabilities", capabilitiesResponseSchema),
    repositories: () =>
      send("GET", "/api/v1/repositories", repositoriesResponseSchema),

    registerRepository: (path) =>
      send(
        "POST",
        "/api/v1/repositories/register",
        repositoriesResponseSchema,
        { path },
      ),

    revokeRepository: (repositoryId) =>
      send("POST", "/api/v1/repositories/revoke", repositoriesResponseSchema, {
        repositoryId,
      }),

    status: (query) =>
      send(
        "GET",
        `/api/v1/status${toQueryString({
          repositoryId: query.repositoryId,
          worktreeId: query.worktreeId,
          includeIgnored: query.includeIgnored,
        })}`,
        statusSnapshotSchema,
      ),

    history: (query) =>
      send(
        "GET",
        `/api/v1/history${toQueryString({
          repositoryId: query.repositoryId,
          worktreeId: query.worktreeId,
          cursor: query.cursor,
          limit: query.limit,
          detailOid: query.detailOid,
          firstParentOnly: query.firstParentOnly,
        })}`,
        historyPageSchema,
      ),

    refs: (query) =>
      send(
        "GET",
        `/api/v1/refs${toQueryString({ repositoryId: query.repositoryId })}`,
        refsSnapshotSchema,
      ),

    diff: (query) =>
      send(
        "GET",
        `/api/v1/diff${toQueryString({
          repositoryId: query.repositoryId,
          worktreeId: query.worktreeId,
          kind: query.kind,
          oid: query.oid,
          from: query.from,
          to: query.to,
          pathId: query.pathId,
          maxBytes: query.maxBytes,
        })}`,
        diffResponseSchema,
      ),

    worktrees: (query) =>
      send(
        "GET",
        `/api/v1/worktrees${toQueryString({ repositoryId: query.repositoryId })}`,
        worktreesResponseSchema,
      ),

    submodules: (query) =>
      send(
        "GET",
        `/api/v1/submodules${toQueryString({
          repositoryId: query.repositoryId,
          worktreeId: query.worktreeId,
        })}`,
        submodulesResponseSchema,
      ),

    stashes: (query) =>
      send(
        "GET",
        `/api/v1/stashes${toQueryString({ repositoryId: query.repositoryId })}`,
        stashesResponseSchema,
      ),

    previews: (query) =>
      send("POST", "/api/v1/previews", previewsResponseSchema, {
        repositoryId: query.repositoryId,
        worktreeId: query.worktreeId,
        pathIds: [...query.pathIds],
      }),
  };
}

function problemFrom(
  status: number,
  text: string,
  correlationId: string | null,
): GitClientError {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "problem" in parsed &&
      typeof parsed.problem === "object" &&
      parsed.problem !== null
    ) {
      const problem = parsed.problem as Problem;
      return new GitClientError({
        code: problem.code,
        message: problem.message,
        status,
        ...(problem.details === undefined ? {} : { details: problem.details }),
        retryable: problem.retryable,
        correlationId,
      });
    }
  } catch {
    // Fall through to the generic error below: an unparseable error body is still an
    // error, and the status code is the only fact that survived.
  }
  return new GitClientError({
    code: status === 401 ? "Unauthenticated" : "InternalError",
    status,
    message: `the service returned ${status} without a problem body`,
    correlationId,
  });
}
