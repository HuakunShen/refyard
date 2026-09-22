/**
 * A ForgeAdapter stub for host-side provider tests.
 *
 * The adapter seam is exactly what makes these tests forge-agnostic: they
 * script authenticate/poll/refresh answers directly and never construct an
 * HTTP client. A future GitLab adapter is testable through the same stub.
 */
import type {
  ForgeAdapter,
  ForgeDevicePoll,
} from "@refyard/git-provider/adapter";

export interface StubAdapterBehavior {
  /** Whether authenticate() accepts the credential. */
  readonly authenticateOk: boolean;
  readonly login?: string;
  /** What each poll() answers, in order; the last one repeats. */
  readonly poll?: readonly ForgeDevicePoll[];
  /** Deadline for start(), in whatever clock units the test's `now` uses. */
  readonly expiresAtMs?: number;
  /** What refresh() answers, in order; empty means every refresh fails. */
  readonly refresh?: {
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number | null;
  }[];
}

export function stubForgeAdapter(behavior: StubAdapterBehavior): ForgeAdapter {
  let pollIndex = 0;
  let refreshIndex = 0;
  return {
    id: "github",
    authenticate: async () =>
      behavior.authenticateOk
        ? {
            ok: true,
            value: {
              login: behavior.login ?? "octocat",
              accountType: "User",
              scopes: [],
            },
          }
        : { ok: false, error: { kind: "unauthorized" } },
    listPullRequests: async () => ({ ok: true, value: [] }),
    listIssues: async () => ({ ok: true, value: [] }),
    deviceFlow: {
      start: async () => ({
        ok: true,
        value: {
          deviceCode: "device_code_123",
          userCode: "ABCD-1234",
          verificationUri: "https://github.com/login/device",
          expiresAtMs: behavior.expiresAtMs ?? Date.now() + 900_000,
          intervalMs: 1000,
        },
      }),
      poll: async () => {
        const value =
          behavior.poll?.[Math.min(pollIndex, behavior.poll.length - 1)] ?? {
            kind: "pending" as const,
          };
        pollIndex += 1;
        return { ok: true, value };
      },
      refresh: async (refreshToken) => {
        void refreshToken;
        const list = behavior.refresh ?? [];
        const value = list[Math.min(refreshIndex, list.length - 1)];
        if (value === undefined) {
          return {
            ok: false,
            error: { kind: "unauthorized" },
          };
        }
        refreshIndex += 1;
        return { ok: true, value };
      },
    },
  };
}

/** The manager tests care about the credential values, not the adapter. */
export const STUB_REFRESHED = {
  accessToken: "ghu_testaccesstoken00000000000000001",
  refreshToken: "ghu_testrefreshtoken00000000000000001",
  expiresInSeconds: 28800,
} as const;
