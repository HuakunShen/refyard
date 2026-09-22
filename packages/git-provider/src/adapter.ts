/**
 * The forge adapter interface — the seam that keeps "which forge is this" out
 * of the host.
 *
 * Everything above this line (the Node service, the Tauri host, the UI) knows
 * `ProviderId` and these shapes; everything below it is one module per forge
 * (`github/`, later `gitlab/`, `bitbucket/`). A new provider means a new
 * adapter implementation plus one entry in the provider enum — no host code
 * changes, no new host-side conditionals.
 *
 * The design is shaped by two commitments rather than by GitHub's API:
 *
 * - **Capabilities are optional fields, not booleans.** `deviceFlow` is absent
 *   on GitLab (no RFC 8628 support there) and `listWorkflowRuns` is absent on
 *   forges without CI; the host asks for what exists and reports the rest as
   * absent, which is the same capability honesty the contract enforces.
 * - **Errors are classified here, in forge-neutral kinds.** The host maps
 *   `unauthorized` to "reconnect" and `rateLimited` to "later" without ever
 *   knowing which forge said so.
 */
import type { ProviderId } from "@refyard/git-contract";

/** Coordinates of one repository on one forge, parsed from a remote URL. */
export interface ForgeCoordinates {
  readonly owner: string;
  readonly repo: string;
}

/** A credential bundle as the host stores it — opaque to everything above. */
export interface ForgeCredential {
  readonly token: string;
  readonly refreshToken: string | null;
  readonly expiresAtMs: number | null;
}

export interface ForgeAccount {
  readonly login: string;
  readonly accountType: string;
  /** Display-only; empty when the forge does not report scopes for a token. */
  readonly scopes: readonly string[];
}

export interface ForgePullRequest {
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

export interface ForgeIssue {
  readonly number: number;
  readonly title: string;
  readonly authorLogin: string;
  readonly authorAvatarUrl: string | null;
  readonly url: string;
  readonly updatedAt: string;
}

export interface ForgeWorkflowRun {
  readonly id: number;
  readonly name: string | null;
  readonly headBranch: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly url: string;
  readonly runNumber: number;
  readonly event: string;
  readonly createdAt: string;
}

/** Forge-neutral failure kinds. The host never parses a forge's own message. */
export type ForgeError =
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "rateLimited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "network"; readonly reason: string };

export type ForgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ForgeError };

/** The RFC 8628 exchange, for forges that support it. */
export interface ForgeDeviceStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAtMs: number;
  readonly intervalMs: number;
}

export type ForgeDevicePoll =
  | {
      readonly kind: "authorized";
      readonly accessToken: string;
      readonly refreshToken: string | null;
      readonly expiresInSeconds: number | null;
    }
  | { readonly kind: "pending" }
  | { readonly kind: "slowDown"; readonly intervalMs: number }
  | { readonly kind: "expired" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly code: string };

export interface ForgeAdapter {
  readonly id: ProviderId;
  /** Validate a credential and identify the account it belongs to. */
  authenticate(
    credential: ForgeCredential,
  ): Promise<ForgeResult<ForgeAccount>>;
  listPullRequests(
    credential: ForgeCredential,
    coordinates: ForgeCoordinates,
    maxEntries: number,
  ): Promise<ForgeResult<ForgePullRequest[]>>;
  listIssues(
    credential: ForgeCredential,
    coordinates: ForgeCoordinates,
    maxEntries: number,
  ): Promise<ForgeResult<ForgeIssue[]>>;
  listWorkflowRuns?(
    credential: ForgeCredential,
    coordinates: ForgeCoordinates,
    maxEntries: number,
  ): Promise<ForgeResult<ForgeWorkflowRun[]>>;
  /**
   * Exchange a device code for a credential. Absent on forges without RFC
   * 8628; the host reports such a provider as connectable by token only.
   */
  deviceFlow?: {
    start(): Promise<ForgeResult<ForgeDeviceStart>>;
    poll(deviceCode: string): Promise<ForgeResult<ForgeDevicePoll>>;
    /**
     * Rotate a refresh token into a new credential pair. Refusing here is how
     * the host learns a connection has died.
     */
    refresh(
      refreshToken: string,
    ): Promise<
      ForgeResult<{
        accessToken: string;
        refreshToken: string;
        expiresInSeconds: number | null;
      }>
    >;
  };
}
