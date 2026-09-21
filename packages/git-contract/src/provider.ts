/**
 * The provider axis: forge connections and their read-only DTOs.
 *
 * A provider connection is configuration plus a bounded read, not a Git
 * operation, so it is modeled like the management API — dedicated schemas under
 * a dedicated scope, outside the mutation registry. Two properties are structural
 * here, not conventions: the connection DTO has no token field at all (a token
 * is accepted once on connect and never echoed), and every pull-request URL is
 * a forge URL, because each one is built by our own client from coordinates
 * parsed off the repository's own remote.
 */
import { z } from "zod";
import { LIMITS } from "./limits.js";
import { repositoryIdSchema, timestampSchema } from "./ids.js";
import { branchNameSchema } from "./names.js";

export const providerIdSchema = z.enum(["github"]).meta({
  id: "ProviderId",
  description:
    "A forge integration this build carries. The enum grows only when an integration ships; hosts without one omit it from capabilities.providers.",
});

/** The connection status read is global, not per repository: no query at all. */
export const providerConnectionQuerySchema = z
  .strictObject({})
  .meta({ id: "ProviderConnectionQuery" });

export const providerPullRequestsQuerySchema = z
  .strictObject({ repositoryId: repositoryIdSchema })
  .meta({
    id: "ProviderPullRequestsQuery",
    description:
      "The repository whose own forge remote is queried. The host resolves the coordinates; the browser never names a provider repository.",
  });

export const providerConnectionSchema = z
  .strictObject({
    provider: providerIdSchema,
    accountLogin: z.string().min(1).max(100),
    accountType: z.string().min(1).max(40),
    /** Scopes the provider reports for the token — display only. */
    scopes: z.array(z.string().min(1).max(64)).max(32),
    connectedAt: timestampSchema,
  })
  .meta({
    id: "ProviderConnection",
    description:
      "One live forge connection, as the host stores it. Never contains the token.",
  });

export const providerConnectionsResponseSchema = z
  .strictObject({ connections: z.array(providerConnectionSchema).max(8) })
  .meta({
    id: "ProviderConnectionsResponse",
    description: "The forge accounts this host is connected to.",
  });

export const connectProviderRequestSchema = z
  .strictObject({
    provider: providerIdSchema,
    token: z.string().min(20).max(255),
  })
  .meta({
    id: "ConnectProviderRequest",
    description:
      "The token is validated against the provider before anything is stored, lives only in the host's private state, and is never returned by any read.",
  });

export const disconnectProviderRequestSchema = z
  .strictObject({ provider: providerIdSchema })
  .meta({
    id: "DisconnectProviderRequest",
    description: "Deletes the stored connection. Revoking the token upstream is the user's act on the forge.",
  });

/**
 * A forge URL this product itself may construct; anything else is a mapping bug.
 * The host part is anchored on both sides, so `github.com.evil.example` cannot
 * ride in on a suffix match. The contract compiles without DOM globals, so the
 * check is textual, not `new URL`.
 */
const GITHUB_URL = /^https:\/\/(?:github\.com|[\w.-]+\.githubusercontent\.com|[\w.-]+\.github\.com)(?:\/|$)/i;

const providerUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(GITHUB_URL, "must be an https GitHub URL");

export const providerPullRequestSchema = z
  .strictObject({
    number: z.int().positive(),
    title: z.string().min(1).max(600),
    authorLogin: z.string().min(1).max(100),
    authorAvatarUrl: providerUrlSchema.nullable(),
    headRef: branchNameSchema,
    baseRef: branchNameSchema,
    isDraft: z.boolean(),
    url: providerUrlSchema,
    updatedAt: timestampSchema,
  })
  .meta({
    id: "ProviderPullRequest",
    description:
      "One open pull request, reduced to what the workbench shows. Draft and merge state that moved on are refreshed, not cached forever.",
  });

export const providerPullRequestsResponseSchema = z
  .strictObject({
    repository: z.strictObject({
      provider: providerIdSchema,
      owner: z.string().min(1).max(100),
      repo: z.string().min(1).max(100),
    }),
    /** `cache` comes with `cachedAt`; `upstream` means this response left the host to fetch. */
    source: z.enum(["upstream", "cache"]),
    cachedAt: timestampSchema.nullable(),
    pullRequests: z.array(providerPullRequestSchema).max(LIMITS.providerPullRequestsMaxEntries),
  })
  .meta({
    id: "ProviderPullRequestsResponse",
    description:
      "Open pull requests for one repository's forge remote. Served from a short host-side cache; the age is always visible.",
  });

export type ProviderId = z.infer<typeof providerIdSchema>;
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type ProviderConnectionsResponse = z.infer<
  typeof providerConnectionsResponseSchema
>;
export type ConnectProviderRequest = z.infer<typeof connectProviderRequestSchema>;
export type DisconnectProviderRequest = z.infer<
  typeof disconnectProviderRequestSchema
>;
export type ProviderPullRequest = z.infer<typeof providerPullRequestSchema>;
export type ProviderPullRequestsResponse = z.infer<
  typeof providerPullRequestsResponseSchema
>;
