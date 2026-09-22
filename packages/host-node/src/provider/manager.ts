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
import type { DeviceFlowClient } from "@refyard/git-provider/github/device-flow";
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
  // Records written before the OAuth path existed have neither field; a record
  // without an auth method is a PAT by definition.
  authMethod: z.enum(["pat", "oauth"]).optional(),
  refreshToken: z.string().min(10).max(512).nullable().optional(),
  expiresAtMs: z.number().int().positive().nullable().optional(),
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
  readonly authMethod: "pat" | "oauth";
  /** Present for OAuth connections; rotated on every refresh. */
  readonly refreshToken: string | null;
  /** Wall-clock instant after which the access token stops working. */
  readonly expiresAtMs: number | null;
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
        // Normalize pre-OAuth records: a stored connection without an auth
        // method is a PAT, which never expires and never refreshes.
        byProvider.set(connection.provider, {
          provider: connection.provider,
          token: connection.token,
          accountLogin: connection.accountLogin,
          accountType: connection.accountType,
          scopes: connection.scopes,
          connectedAt: connection.connectedAt,
          authMethod: connection.authMethod ?? "pat",
          refreshToken: connection.refreshToken ?? null,
          expiresAtMs: connection.expiresAtMs ?? null,
        });
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
  /**
   * The stored credential, for host-side code about to call the provider —
   * the same trust level as the manager itself. It must never reach a response,
   * a log line or a journal entry; `status()` exists for everything else.
   */
  tokenOf(provider: ProviderId): string | null;
  /**
   * The credential, refreshed if it is about to expire. Null means "there is
   * no working credential" — an OAuth refresh that GitHub rejected deletes the
   * connection rather than letting every later read fail mysteriously.
   */
  validToken(provider: ProviderId): Promise<string | null>;
  connect(input: {
    readonly provider: ProviderId;
    readonly token: string;
  }): Promise<ConnectOutcome>;
  /** Begin a device-flow exchange: returns the code the user must type. */
  beginDeviceConnect(input: {
    readonly provider: ProviderId;
  }): Promise<BeginDeviceOutcome>;
  /** Run one polling step; the background loop and tests share this. */
  stepDeviceConnect(): Promise<DeviceConnectState>;
  deviceConnectState(): DeviceConnectState;
  cancelDeviceConnect(): void;
  disconnect(input: { readonly provider: ProviderId }): Promise<void>;
}

export type DeviceConnectState =
  | { readonly state: "idle" }
  | {
      readonly state: "awaiting-user";
      readonly userCode: string;
      readonly verificationUri: string;
    }
  | { readonly state: "connected" }
  | { readonly state: "denied" }
  | { readonly state: "expired" }
  | { readonly state: "failed"; readonly message: string };

export type BeginDeviceOutcome =
  | {
      readonly ok: true;
      readonly userCode: string;
      readonly verificationUri: string;
    }
  | { readonly ok: false; readonly message: string };

/** Refresh this close to expiry so in-flight reads never race the deadline. */
const REFRESH_WINDOW_MS = 5 * 60_000;

export function createProviderManager(options: {
  readonly store: ProviderStore;
  readonly journal: AccessJournal;
  readonly client: GitHubRestClient;
  readonly deviceFlow: DeviceFlowClient;
  readonly clientId: string;
  readonly now?: () => number;
  /**
   * Injectable timer for the background polling loop. Defaults to setTimeout;
   * tests omit it and drive `stepDeviceConnect()` by hand, so no test ever
   * waits on real timers.
   */
  readonly schedule?: (fn: () => void, delayMs: number) => () => void;
}): ProviderManager {
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((fn: () => void, delayMs: number) => {
      const timer = setTimeout(fn, delayMs);
      return () => clearTimeout(timer);
    });

  let pending: {
    readonly deviceCode: string;
    readonly userCode: string;
    readonly verificationUri: string;
    intervalMs: number;
    expiresAtMs: number;
  } | null = null;
  let deviceState: DeviceConnectState = { state: "idle" };
  let cancelLoop: (() => void) | null = null;

  function clearPending(): void {
    pending = null;
    cancelLoop?.();
    cancelLoop = null;
  }

  function scheduleStep(delayMs: number): void {
    cancelLoop?.();
    cancelLoop = schedule(() => {
      void self.stepDeviceConnect();
    }, delayMs);
  }

  const self: ProviderManager = {
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
            authMethod: stored.authMethod,
            tokenExpiresAt:
              stored.expiresAtMs === null
                ? null
                : new Date(stored.expiresAtMs).toISOString(),
          });
        }
      }
      return { connections };
    },

    tokenOf(provider): string | null {
      return options.store.get(provider)?.token ?? null;
    },

    async validToken(provider): Promise<string | null> {
      const stored = options.store.get(provider);
      if (stored === null) {
        return null;
      }
      if (stored.authMethod === "pat" || stored.expiresAtMs === null) {
        return stored.token;
      }
      if (stored.expiresAtMs - now() > REFRESH_WINDOW_MS) {
        return stored.token;
      }
      const refreshed = await options.deviceFlow.refresh({
        clientId: options.clientId,
        refreshToken: stored.refreshToken ?? "",
      });
      if (!refreshed.ok) {
        // A refresh GitHub refuses is a dead connection: delete it so the next
        // status read says "not connected" instead of failing on every call.
        await options.store.remove(provider);
        await options.journal.append({
          action: "provider-disconnect",
          provider,
          accountLogin: stored.accountLogin,
          actor: "token-expiry",
          atMs: now(),
        });
        return null;
      }
      const updated: StoredProviderConnection = {
        ...stored,
        token: refreshed.value.accessToken,
        refreshToken: refreshed.value.refreshToken,
        expiresAtMs:
          refreshed.value.expiresInSeconds === null
            ? null
            : now() + refreshed.value.expiresInSeconds * 1000,
      };
      await options.store.set(updated);
      return updated.token;
    },

    async beginDeviceConnect({ provider }): Promise<BeginDeviceOutcome> {
      if (provider !== "github") {
        return { ok: false, message: `this build has no ${provider} integration` };
      }
      const started = await options.deviceFlow.start({
        clientId: options.clientId,
      });
      if (!started.ok) {
        return { ok: false, message: `GitHub could not start the device flow (${started.error.code})` };
      }
      pending = {
        deviceCode: started.value.deviceCode,
        userCode: started.value.userCode,
        verificationUri: started.value.verificationUri,
        intervalMs: started.value.intervalMs,
        expiresAtMs: started.value.expiresAtMs,
      };
      deviceState = {
        state: "awaiting-user",
        userCode: started.value.userCode,
        verificationUri: started.value.verificationUri,
      };
      scheduleStep(started.value.intervalMs);
      return {
        ok: true,
        userCode: started.value.userCode,
        verificationUri: started.value.verificationUri,
      };
    },

    async stepDeviceConnect(): Promise<DeviceConnectState> {
      if (pending === null) {
        deviceState = { state: "idle" };
        return deviceState;
      }
      if (now() >= pending.expiresAtMs) {
        clearPending();
        deviceState = { state: "expired" };
        return deviceState;
      }
      const polled = await options.deviceFlow.poll({
        clientId: options.clientId,
        deviceCode: pending.deviceCode,
      });
      if (!polled.ok) {
        clearPending();
        deviceState = { state: "failed", message: polled.error.code };
        return deviceState;
      }
      switch (polled.value.kind) {
        case "pending": {
          scheduleStep(pending.intervalMs);
          break;
        }
        case "slowDown": {
          pending.intervalMs = polled.value.intervalMs;
          scheduleStep(pending.intervalMs);
          break;
        }
        case "expired": {
          clearPending();
          deviceState = { state: "expired" };
          return deviceState;
        }
        case "denied": {
          clearPending();
          deviceState = { state: "denied" };
          return deviceState;
        }
        case "error": {
          clearPending();
          deviceState = { state: "failed", message: polled.value.code };
          return deviceState;
        }
        case "authorized": {
          const accessToken = polled.value.accessToken;
          // The same rule as the PAT path: validate the identity before any
          // credential touches the store.
          const verified = await options.client.authenticatedUser({
            token: accessToken,
          });
          clearPending();
          if (!verified.ok) {
            deviceState = {
              state: "failed",
              message: "GitHub accepted the device flow but rejected the token",
            };
            return deviceState;
          }
          const connection: StoredProviderConnection = {
            provider: "github",
            token: accessToken,
            refreshToken: polled.value.refreshToken,
            expiresAtMs:
              polled.value.expiresInSeconds === null
                ? null
                : now() + polled.value.expiresInSeconds * 1000,
            accountLogin: verified.value.login,
            accountType: verified.value.type,
            scopes: verified.value.scopes,
            connectedAt: new Date(now()).toISOString(),
            authMethod: "oauth",
          };
          await options.store.set(connection);
          await options.journal.append({
            action: "provider-connect",
            provider: "github",
            accountLogin: connection.accountLogin,
            actor: "device-flow",
            atMs: now(),
          });
          deviceState = { state: "connected" };
          return deviceState;
        }
      }
      return deviceState;
    },

    deviceConnectState(): DeviceConnectState {
      return deviceState;
    },

    cancelDeviceConnect(): void {
      clearPending();
      deviceState = { state: "idle" };
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
        refreshToken: null,
        expiresAtMs: null,
        accountLogin: verified.value.login,
        accountType: verified.value.type,
        scopes: verified.value.scopes,
        connectedAt: new Date(now()).toISOString(),
        authMethod: "pat",
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
          authMethod: "pat",
          tokenExpiresAt: null,
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

  return self;
}
