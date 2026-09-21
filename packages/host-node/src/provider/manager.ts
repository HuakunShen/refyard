/**
 * Provider connections: the private store and the connect/disconnect manager.
 *
 * A forge token is a grant, so it lives by the same rules as every other
 * private state here: a 0600 file inside the 0700 state root, an in-memory
 * cache, parse-and-validate on load, and an audit journal that records the act
 * without the credential. Two properties are structural:
 *
 * - **Nothing is stored before the provider accepted the token.** A connect
 *   that fails validation stores nothing, so a typo can never leave a
 *   half-trusted credential on disk.
 * - **The token never appears in a result.** `status()` returns the contract
 *   DTO, whose shape has no token field; the journal entries carry the act and
 *   the account, never the bytes.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
  ProviderConnection,
  ProviderConnectionsResponse,
  ProviderId,
} from "@refyard/git-contract";
import type { GitHubRestClient } from "@refyard/git-provider/github/rest";
import type { AccessJournal } from "../journal/access.js";

/* ----------------------------------------------------------------- the store */

const storedConnectionSchema = z.object({
  provider: z.enum(["github"]),
  token: z.string().min(20).max(255),
  accountLogin: z.string().min(1).max(100),
  accountType: z.string().min(1).max(40),
  scopes: z.array(z.string().min(1).max(64)).max(32),
  connectedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),
});

const storedFileSchema = z.array(storedConnectionSchema).max(8);

export interface StoredProviderConnection {
  readonly provider: ProviderId;
  /** The credential. It never leaves this store except to the provider client. */
  readonly token: string;
  readonly accountLogin: string;
  readonly accountType: string;
  readonly scopes: readonly string[];
  readonly connectedAt: string;
}

export interface ProviderStore {
  load(): Promise<void>;
  get(provider: ProviderId): StoredProviderConnection | null;
  set(connection: StoredProviderConnection): Promise<void>;
  remove(provider: ProviderId): Promise<void>;
  filePath(): string;
}

export function createProviderStore(options: {
  readonly stateRoot: string;
}): ProviderStore {
  const directory = join(options.stateRoot, "provider");
  const filePath = join(directory, "connections.json");
  const byProvider = new Map<ProviderId, StoredProviderConnection>();

  return {
    async load(): Promise<void> {
      let text: string;
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // A corrupt secret file must fail loudly: silently starting empty would
        // look like a working integration while nothing is connected.
        throw new Error(
          `the provider connections file at ${filePath} is not readable JSON; delete it and reconnect`,
        );
      }
      const file = storedFileSchema.safeParse(parsed);
      if (!file.success) {
        throw new Error(
          `the provider connections file at ${filePath} does not have the expected shape; delete it and reconnect`,
        );
      }
      for (const connection of file.data) {
        byProvider.set(connection.provider, connection);
      }
    },

    get(provider): StoredProviderConnection | null {
      return byProvider.get(provider) ?? null;
    },

    async set(connection): Promise<void> {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const next = new Map(byProvider);
      next.set(connection.provider, connection);
      const body = JSON.stringify([...next.values()], null, 2);
      await writeFile(filePath, `${body}\n`, { encoding: "utf8", mode: 0o600 });
      // Defence in depth: umask or a copied file could have softened the mode.
      if ((statSync(filePath).mode & 0o777) !== 0o600) {
        await rm(filePath);
        throw new Error(`the connections file at ${filePath} was not written privately`);
      }
      byProvider.set(connection.provider, connection);
    },

    async remove(provider): Promise<void> {
      if (!byProvider.has(provider)) {
        return;
      }
      byProvider.delete(provider);
      if (byProvider.size === 0) {
        await rm(filePath, { force: true });
        return;
      }
      const body = JSON.stringify([...byProvider.values()], null, 2);
      await writeFile(filePath, `${body}\n`, { encoding: "utf8", mode: 0o600 });
    },

    filePath(): string {
      return filePath;
    },
  };
}

/* ---------------------------------------------------------------- the manager */

export type ConnectOutcome =
  | { readonly ok: true; readonly connection: ProviderConnection }
  | {
      readonly ok: false;
      readonly code:
        | "ProviderUnauthorized"
        | "ProviderRateLimited"
        | "Unavailable";
      readonly message: string;
      readonly retryable: boolean;
    };

export interface ProviderManager {
  status(): ProviderConnectionsResponse;
  connect(input: {
    readonly provider: ProviderId;
    readonly token: string;
  }): Promise<ConnectOutcome>;
  disconnect(input: { readonly provider: ProviderId }): Promise<void>;
}

export function createProviderManager(options: {
  readonly store: ProviderStore;
  readonly journal: AccessJournal;
  readonly client: GitHubRestClient;
  readonly now?: () => number;
}): ProviderManager {
  const now = options.now ?? Date.now;

  return {
    status(): ProviderConnectionsResponse {
      const connections: ProviderConnection[] = [];
      for (const provider of ["github"] as const) {
        const stored = options.store.get(provider);
        if (stored !== null) {
          connections.push({
            provider: stored.provider,
            accountLogin: stored.accountLogin,
            accountType: stored.accountType,
            scopes: [...stored.scopes],
            connectedAt: stored.connectedAt,
          });
        }
      }
      return { connections };
    },

    async connect({ provider, token }): Promise<ConnectOutcome> {
      if (provider !== "github") {
        return {
          ok: false,
          code: "Unavailable",
          message: `this build has no ${provider} integration`,
          retryable: false,
        };
      }
      // Validation comes first and success is required: only a token the
      // provider has just accepted is ever written to disk.
      const verified = await options.client.authenticatedUser({ token });
      if (!verified.ok) {
        switch (verified.error.kind) {
          case "unauthorized":
            return {
              ok: false,
              code: "ProviderUnauthorized",
              message: "GitHub rejected that token; create a new one and try again",
              retryable: false,
            };
          case "rateLimited":
            return {
              ok: false,
              code: "ProviderRateLimited",
              message:
                verified.error.retryAfterSeconds === null
                  ? "GitHub rate-limited the connection attempt; try again later"
                  : `GitHub rate-limited the connection attempt; retry after about ${verified.error.retryAfterSeconds}s`,
              retryable: true,
            };
          case "network":
            return {
              ok: false,
              code: "Unavailable",
              message: `GitHub could not be reached (${verified.error.reason}); check the network and try again`,
              retryable: true,
            };
          case "malformed":
            return {
              ok: false,
              code: "Unavailable",
              message: "GitHub's answer was not understood; nothing was stored",
              retryable: false,
            };
          case "forbidden":
          case "refused":
            return {
              ok: false,
              code: "Unavailable",
              message: `GitHub refused the connection attempt (${verified.error.kind})`,
              retryable: false,
            };
        }
      }
      const connection: StoredProviderConnection = {
        provider,
        token,
        accountLogin: verified.value.login,
        accountType: verified.value.type,
        scopes: verified.value.scopes,
        connectedAt: new Date(now()).toISOString(),
      };
      await options.store.set(connection);
      await options.journal.append({
        action: "provider-connect",
        provider,
        accountLogin: connection.accountLogin,
        actor: "local",
        atMs: now(),
      });
      return {
        ok: true,
        connection: {
          provider,
          accountLogin: connection.accountLogin,
          accountType: connection.accountType,
          scopes: [...connection.scopes],
          connectedAt: connection.connectedAt,
        },
      };
    },

    async disconnect({ provider }): Promise<void> {
      const stored = options.store.get(provider);
      await options.store.remove(provider);
      if (stored !== null) {
        await options.journal.append({
          action: "provider-disconnect",
          provider,
          accountLogin: stored.accountLogin,
          actor: "local",
          atMs: now(),
        });
      }
    },
  };
}
