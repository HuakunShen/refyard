/**
 * The GitHub forge adapter: one object that satisfies `ForgeAdapter` by
 * composing the REST client and the device-flow client.
 *
 * This is the only module the host needs to know about; GitHub-specific
 * details (api.github.com, the login endpoints, the public client id, header
 * conventions, pagination) stay behind it. The base URLs remain injectable
 * so tests can stub both endpoints, and a self-hosted or proxied deployment
 * can redirect them.
 */
import type {
  ForgeAdapter,
  ForgeCredential,
  ForgeDevicePoll,
  ForgeDeviceStart,
  ForgeError,
  ForgeIssue,
  ForgePullRequest,
  ForgeResult,
  ForgeWorkflowRun,
} from "../adapter.js";
import { GITHUB_OAUTH_CLIENT_ID } from "./device-flow.js";
import { createGitHubRestClient, type GitHubRestClient } from "./rest.js";
import { createDeviceFlowClient, type DeviceFlowClient } from "./device-flow.js";

export interface GitHubAdapterOptions {
  readonly fetch: typeof fetch;
  /** Default `https://api.github.com`. */
  readonly apiBaseUrl?: string;
  /** Default `https://github.com` (the login endpoints, not the REST API). */
  readonly loginBaseUrl?: string;
  readonly clientId?: string;
  readonly userAgentPrefix?: string;
}

function toForgeError(error: ForgeError): ForgeError {
  return error;
}

/** The device client's own error vocabulary, lifted into the forge kinds. */
function deviceErrorToForgeError(error: { code: string }): ForgeError {
  return { kind: "network", reason: error.code };
}

export function createGitHubAdapter(
  options: GitHubAdapterOptions,
): ForgeAdapter {
  const rest: GitHubRestClient = createGitHubRestClient({
    fetch: options.fetch,
    ...(options.apiBaseUrl === undefined ? {} : { baseUrl: options.apiBaseUrl }),
    ...(options.userAgentPrefix === undefined
      ? {}
      : { userAgentPrefix: options.userAgentPrefix }),
  });
  const deviceFlow: DeviceFlowClient = createDeviceFlowClient({
    fetch: options.fetch,
    ...(options.loginBaseUrl === undefined
      ? {}
      : { baseUrl: options.loginBaseUrl }),
  });
  const clientId = options.clientId ?? GITHUB_OAUTH_CLIENT_ID;

  return {
    id: "github",

    async authenticate(credential: ForgeCredential): Promise<ForgeResult<{
      login: string;
      accountType: string;
      scopes: readonly string[];
    }>> {
      const result = await rest.authenticatedUser({ token: credential.token });
      if (!result.ok) {
        return { ok: false, error: toForgeError(result.error) };
      }
      return {
        ok: true,
        value: {
          login: result.value.login,
          accountType: result.value.type,
          scopes: result.value.scopes,
        },
      };
    },

    async listPullRequests(credential, coordinates, maxEntries) {
      const result = await rest.listOpenPullRequests({
        token: credential.token,
        owner: coordinates.owner,
        repo: coordinates.repo,
        maxEntries,
      });
      if (!result.ok) {
        return { ok: false, error: toForgeError(result.error) };
      }
      const pulls: ForgePullRequest[] = result.value;
      return { ok: true, value: pulls };
    },

    async listIssues(credential, coordinates, maxEntries) {
      const result = await rest.listOpenIssues({
        token: credential.token,
        owner: coordinates.owner,
        repo: coordinates.repo,
        maxEntries,
      });
      if (!result.ok) {
        return { ok: false, error: toForgeError(result.error) };
      }
      const issues: ForgeIssue[] = result.value;
      return { ok: true, value: issues };
    },

    async listWorkflowRuns(credential, coordinates, maxEntries) {
      const result = await rest.listWorkflowRuns({
        token: credential.token,
        owner: coordinates.owner,
        repo: coordinates.repo,
        maxEntries,
      });
      if (!result.ok) {
        return { ok: false, error: toForgeError(result.error) };
      }
      const runs: ForgeWorkflowRun[] = result.value;
      return { ok: true, value: runs };
    },

    deviceFlow: {
      async start(): Promise<ForgeResult<ForgeDeviceStart>> {
        const result = await deviceFlow.start({ clientId });
        if (!result.ok) {
          return { ok: false, error: deviceErrorToForgeError(result.error) };
        }
        const start: ForgeDeviceStart = {
          deviceCode: result.value.deviceCode,
          userCode: result.value.userCode,
          verificationUri: result.value.verificationUri,
          expiresAtMs: result.value.expiresAtMs,
          intervalMs: result.value.intervalMs,
        };
        return { ok: true, value: start };
      },

      async poll(deviceCode: string): Promise<ForgeResult<ForgeDevicePoll>> {
        const result = await deviceFlow.poll({ clientId, deviceCode });
        if (!result.ok) {
          return { ok: false, error: deviceErrorToForgeError(result.error) };
        }
        const poll: ForgeDevicePoll = result.value;
        return { ok: true, value: poll };
      },

      async refresh(refreshToken: string): Promise<ForgeResult<{
        accessToken: string;
        refreshToken: string;
        expiresInSeconds: number | null;
      }>> {
        const result = await deviceFlow.refresh({ clientId, refreshToken });
        if (!result.ok) {
          return { ok: false, error: deviceErrorToForgeError(result.error) };
        }
        return { ok: true, value: result.value };
      },
    },
  };
}
