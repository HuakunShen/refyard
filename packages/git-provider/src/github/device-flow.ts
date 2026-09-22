/**
 * The OAuth device flow (RFC 8628) for GitHub — user authorization with no
 * callback target at all.
 *
 * This is the transport that lets the provider axis stay honest about its own
 * architecture: the Node service and the Tauri host look identical from here,
 * because neither needs a redirect listener, a public URL or a deeplink. The
 * user types a short code at github.com/login/device; the host polls.
 *
 * The polling contract is GitHub's, and the caller must honour it: poll no
 * faster than `intervalMs`, slow to the interval GitHub names on `slow_down`,
 * and treat `expired_token` as "start over". Success is a user access token;
 * a GitHub App answer carries a refresh token and an expiry (8 h tokens), an
 * OAuth App answer carries neither, so the caller stores what it gets and
 * adapts. The client id travels in the request body, never in a URL.
 */
import { z } from "zod";

export interface DeviceFlowClientOptions {
  readonly fetch: typeof fetch;
  /** Default `https://github.com` — the login endpoints, not api.github.com. */
  readonly baseUrl?: string;
}

export interface DeviceCodeStart {
  readonly deviceCode: string;
  /** The short code the user types at `verificationUri`. */
  readonly userCode: string;
  readonly verificationUri: string;
  /** Wall-clock instant after which the device code is dead. */
  readonly expiresAtMs: number;
  readonly intervalMs: number;
}

export type DeviceAuthorization =
  | {
      readonly kind: "authorized";
      readonly accessToken: string;
      /** Present only for GitHub Apps; rotated on every refresh. */
      readonly refreshToken: string | null;
      readonly expiresInSeconds: number | null;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "slowDown"; readonly intervalMs: number }
  | { readonly kind: "expired" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly code: string };

export type DeviceFlowError = { readonly code: string };

export interface DeviceFlowClient {
  start(init: {
    readonly clientId: string;
    readonly signal?: AbortSignal;
  }): Promise<
    | { readonly ok: true; readonly value: DeviceCodeStart }
    | { readonly ok: false; readonly error: DeviceFlowError }
  >;
  poll(init: {
    readonly clientId: string;
    readonly deviceCode: string;
    readonly signal?: AbortSignal;
  }): Promise<
    | { readonly ok: true; readonly value: DeviceAuthorization }
    | { readonly ok: false; readonly error: DeviceFlowError }
  >;
  refresh(init: {
    readonly clientId: string;
    readonly refreshToken: string;
    readonly signal?: AbortSignal;
  }): Promise<
    | {
        readonly ok: true;
        readonly value: {
          readonly accessToken: string;
          readonly refreshToken: string;
          readonly expiresInSeconds: number | null;
        };
      }
    | { readonly ok: false; readonly error: DeviceFlowError }
  >;
}

const DEFAULT_BASE_URL = "https://github.com";

/**
 * Refyard's public OAuth App client id. Public by design — GitHub's device
 * flow requires only the client id (no secret) for a public client, exactly
 * like the `gh` CLI ships its own. Overriding it is a test/deployment concern,
 * not a user setting.
 */
export const GITHUB_OAUTH_CLIENT_ID = "Ov23liKdOzoDRnsNFgBl";

const startSchema = z.object({
  device_code: z.string().min(1).max(256),
  user_code: z.string().min(1).max(32),
  verification_uri: z.string().min(1).max(2048),
  expires_in: z.number(),
  interval: z.number(),
});

const tokenAnswerSchema = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
  error: z.string().min(1).optional(),
});

async function postForm(
  options: DeviceFlowClientOptions,
  path: string,
  body: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<
  | { readonly ok: true; readonly value: z.infer<typeof tokenAnswerSchema> | Record<string, unknown> }
  | { readonly ok: false; readonly error: DeviceFlowError }
> {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  let response: Response;
  try {
    response = await options.fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "refyard",
      },
      body: new URLSearchParams(body).toString(),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return {
      ok: false,
      error: { code: error instanceof Error ? error.name : "network" },
    };
  }
  if (response.status !== 200) {
    return { ok: false, error: { code: `HTTP ${response.status}` } };
  }
  try {
    return { ok: true, value: (await response.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, error: { code: "malformed" } };
  }
}

export function createDeviceFlowClient(
  options: DeviceFlowClientOptions,
): DeviceFlowClient {
  return {
    async start({ clientId, signal }) {
      const result = await postForm(
        options,
        "/login/device/code",
        { client_id: clientId },
        signal,
      );
      if (!result.ok) {
        return result;
      }
      const parsed = startSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: { code: "malformed" } };
      }
      return {
        ok: true,
        value: {
          deviceCode: parsed.data.device_code,
          userCode: parsed.data.user_code,
          verificationUri: parsed.data.verification_uri,
          expiresAtMs: Date.now() + parsed.data.expires_in * 1000,
          intervalMs: parsed.data.interval * 1000,
        },
      };
    },

    async poll({ clientId, deviceCode, signal }) {
      const result = await postForm(
        options,
        "/login/oauth/access_token",
        {
          client_id: clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        signal,
      );
      if (!result.ok) {
        return result;
      }
      const parsed = tokenAnswerSchema.safeParse(result.value);
      if (!parsed.success) {
        return { ok: false, error: { code: "malformed" } };
      }
      const answer = parsed.data;
      if (answer.access_token !== undefined) {
        return {
          ok: true,
          value: {
            kind: "authorized",
            accessToken: answer.access_token,
            refreshToken: answer.refresh_token ?? null,
            expiresInSeconds: answer.expires_in ?? null,
          },
        };
      }
      switch (answer.error) {
        case "authorization_pending":
          return { ok: true, value: { kind: "pending" } };
        case "slow_down": {
          // GitHub names the interval it wants back; five more seconds is the
          // documented default when an interval field is absent.
          const seconds = Number(
            (result.value as { interval?: unknown }).interval ?? 0,
          );
          return {
            ok: true,
            value: {
              kind: "slowDown",
              intervalMs: (seconds > 0 ? seconds : 10) * 1000,
            },
          };
        }
        case "expired_token":
          return { ok: true, value: { kind: "expired" } };
        case "access_denied":
          return { ok: true, value: { kind: "denied" } };
        default:
          return {
            ok: true,
            value: { kind: "error", code: answer.error ?? "unknown" },
          };
      }
    },

    async refresh({ clientId, refreshToken, signal }) {
      const result = await postForm(
        options,
        "/login/oauth/access_token",
        {
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        },
        signal,
      );
      if (!result.ok) {
        return result;
      }
      const parsed = tokenAnswerSchema.safeParse(result.value);
      if (!parsed.success || parsed.data.access_token === undefined) {
        return {
          ok: false,
          error: {
            code:
              parsed.success && parsed.data.error !== undefined
                ? parsed.data.error
                : "malformed",
          },
        };
      }
      return {
        ok: true,
        value: {
          accessToken: parsed.data.access_token,
          // GitHub rotates the refresh token on every use; the answer always
          // carries the next one for a GitHub App.
          refreshToken: parsed.data.refresh_token ?? refreshToken,
          expiresInSeconds: parsed.data.expires_in ?? null,
        },
      };
    },
  };
}
