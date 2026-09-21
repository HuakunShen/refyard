/**
 * The GitHub REST client — the one place this build talks to a forge API.
 *
 * Host-side only; the browser never imports this module. The discipline it
 * keeps:
 *
 * - **`fetch` is injected** and the base URL is overridable, so tests run a
 *   local stub and no test ever touches api.github.com.
 * - **The token travels in the Authorization header only**, never in a URL,
 *   never in an error message, never in a log line. Error results carry kinds
 *   and status numbers, not provider diagnostics, because a diagnostic is the
 *   one place a credential could echo back.
 * - **Every success body is schema-validated** before it leaves this module; a
 *   provider response this build does not recognize is `malformed`, not a crash
 *   or a silently half-filled DTO.
 * - **Pagination is bounded** by the caller's entry cap; the client stops at a
 *   short page or the cap and never pages on its own initiative.
 */
import { z } from "zod";

export interface GitHubRestClientOptions {
  /** The implementation to use — Node's global in the host, a stub in tests. */
  readonly fetch: typeof fetch;
  /** Default `https://api.github.com`; overridden against a local stub. */
  readonly baseUrl?: string;
  /** User-Agent prefix; GitHub refuses requests without one. */
  readonly userAgentPrefix?: string;
}

export interface GitHubUser {
  readonly login: string;
  readonly type: string;
  /**
   * Scopes GitHub reports for the token (`x-oauth-scopes`), which only rides on
   * responses made *with* that token — exactly what validation is. Empty for
   * fine-grained PATs, which GitHub does not list here; display-only either way.
   */
  readonly scopes: readonly string[];
}

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly authorLogin: string;
  readonly authorAvatarUrl: string | null;
  readonly headRef: string;
  readonly baseRef: string;
  readonly isDraft: boolean;
  readonly url: string;
  readonly updatedAt: string;
}

export type GitHubError =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rateLimited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "network"; readonly reason: string };

export type GitHubResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GitHubError };

const DEFAULT_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

/** GitHub wire shapes, validated on arrival. Unknown fields are stripped. */
const userSchema = z.object({
  login: z.string().min(1).max(100),
  type: z.string().min(1).max(40),
});

const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(600),
  user: z
    .object({ login: z.string().min(1).max(100), avatar_url: z.string().max(2048) })
    .nullable()
    .optional(),
  head: z.object({ ref: z.string().min(1).max(350) }),
  base: z.object({ ref: z.string().min(1).max(350) }),
  draft: z.boolean(),
  html_url: z.string().min(1).max(2048),
  updated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
});

export interface GitHubRestClient {
  readonly baseUrl: string;
  authenticatedUser(init: {
    readonly token: string;
    readonly signal?: AbortSignal;
  }): Promise<GitHubResult<GitHubUser>>;
  listOpenPullRequests(init: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly maxEntries: number;
    /** Page size override for tests; the real default is GitHub's maximum. */
    readonly perPage?: number;
    readonly signal?: AbortSignal;
  }): Promise<GitHubResult<GitHubPullRequest[]>>;
}

export function createGitHubRestClient(
  options: GitHubRestClientOptions,
): GitHubRestClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const userAgent = `${options.userAgentPrefix ?? "refyard"}/provider-github`;

  async function getJson(
    token: string,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<GitHubResult<{ value: unknown; response: Response }>> {
    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": API_VERSION,
          "user-agent": userAgent,
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "network",
          reason: error instanceof Error ? error.name : "unknown",
        },
      };
    }
    if (response.status === 401) {
      return { ok: false, error: { kind: "unauthorized" } };
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (remaining === "0") {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const reset = resetHeader === null ? null : Number(resetHeader);
        const retryAfterSeconds =
          reset === null || Number.isNaN(reset)
            ? null
            : Math.max(1, Math.ceil(reset - Date.now() / 1000));
        return { ok: false, error: { kind: "rateLimited", retryAfterSeconds } };
      }
      return { ok: false, error: { kind: "forbidden" } };
    }
    if (response.status !== 200) {
      return { ok: false, error: { kind: "refused", status: response.status } };
    }
    try {
      return {
        ok: true,
        value: { value: await response.json(), response },
      };
    } catch {
      return {
        ok: false,
        error: { kind: "malformed", reason: "response was not JSON" },
      };
    }
  }

  return {
    baseUrl,
    async authenticatedUser({ token, signal }) {
      const result = await getJson(token, "/user", signal);
      if (!result.ok) {
        return result;
      }
      const parsed = userSchema.safeParse(result.value.value);
      if (!parsed.success) {
        return {
          ok: false,
          error: { kind: "malformed", reason: "unexpected /user shape" },
        };
      }
      const headerScopes = result.value.response.headers.get("x-oauth-scopes");
      return {
        ok: true,
        value: {
          login: parsed.data.login,
          type: parsed.data.type,
          scopes: headerScopes === null ? [] : headerScopes.split(/\s+/).filter((scope) => scope.length > 0),
        },
      };
    },

    async listOpenPullRequests({ token, owner, repo, maxEntries, perPage, signal }) {
      const entries: z.infer<typeof pullSchema>[] = [];
      const size = perPage ?? 100;
      let pageNumber = 1;
      while (entries.length < maxEntries) {
        const path =
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls` +
          `?state=open&per_page=${size}&page=${pageNumber}`;
        const result = await getJson(token, path, signal);
        if (!result.ok) {
          return result;
        }
        const parsed = z.array(pullSchema).safeParse(result.value.value);
        if (!parsed.success) {
          return {
            ok: false,
            error: { kind: "malformed", reason: "unexpected pulls shape" },
          };
        }
        for (const pull of parsed.data) {
          if (entries.length === maxEntries) {
            break;
          }
          entries.push(pull);
        }
        if (parsed.data.length < size) {
          break;
        }
        pageNumber += 1;
      }
      return {
        ok: true,
        value: entries.map((pull) => ({
          number: pull.number,
          title: pull.title,
          authorLogin: pull.user?.login ?? "ghost",
          authorAvatarUrl: pull.user?.avatar_url ?? null,
          headRef: pull.head.ref,
          baseRef: pull.base.ref,
          isDraft: pull.draft,
          url: pull.html_url,
          updatedAt: pull.updated_at,
        })),
      };
    },
  };
}
