/**
 * Preview tokens — the host's proof that a destructive request was built against
 * the content it is about to change.
 *
 * The rule this enforces comes from the safety contract: a `git status` marker is
 * not evidence that a file still holds what the user was shown. `git status` says
 * "this path differs from the index", and that stays true across an edit, a
 * checkout of the same relative change, or a rewrite by an editor saving a file.
 * So before a discard, the host reads the path, fingerprints the *content*
 * (SHA-256 over the bytes, never the stat data), and hands the browser an opaque
 * token that names that exact fingerprint.
 *
 * A token is:
 *
 * - **bound** to one repository, one worktree, one path and one fingerprint;
 * - **single-use**, so a replayed request cannot discard a file the user has not
 *   been shown again;
 * - **expiring**, so a token minted before a long pause is refused rather than
 *   applied to a working tree that moved on;
 * - **never a capability on its own** — the operation must still pass scope,
 *   path-kind, and batch validation. The token only answers "is this the content
 *   the user saw?".
 *
 * Tokens are held in memory only: they die with the process, which is the correct
 * lifetime for something that authorises one write against one observed state.
 */
import { createHash, randomBytes } from "node:crypto";
import { LIMITS } from "@refyard/git-contract";

export interface PreviewClaim {
  readonly repositoryId: string;
  readonly worktreeId: string;
  readonly pathId: string;
  /** SHA-256 of the path's current content, as produced by `fingerprintFile`. */
  readonly fingerprintHex: string;
  readonly sizeBytes: number | null;
  readonly contentKind: "text" | "binary" | "unrepresentable";
}

export interface IssuedPreview {
  readonly previewToken: string;
  readonly expiresAtMs: number;
}

export interface PreviewRequest {
  readonly previewToken: string;
  readonly pathId: string;
  /** Recomputed at mutation time; if it differs the request is stale. */
  readonly fingerprintHex: string;
}

export type PreviewCheck =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "unknown-token"
        | "expired"
        | "already-used"
        | "wrong-path"
        | "stale-content";
      readonly message: string;
    };

export interface PreviewStoreOptions {
  readonly ttlSeconds?: number;
  readonly now?: () => number;
  /** Hard cap on live tokens; expired ones are pruned first. */
  readonly maxEntries?: number;
}

export interface PreviewStore {
  issue(claim: PreviewClaim): IssuedPreview;
  /** Non-consuming check, for a dry-run or a pre-flight report. */
  verify(requests: readonly PreviewRequest[]): PreviewCheck;
  /**
   * Verify every request, then mark the tokens used. All-or-nothing: one stale
   * entry leaves the whole batch untouched, because a partially consumed batch
   * would force the client to re-preview paths it never touched.
   */
  redeem(requests: readonly PreviewRequest[]): PreviewCheck;
  size(): number;
  clear(): void;
}

interface StoredPreview extends PreviewClaim {
  readonly expiresAtMs: number;
  used: boolean;
}

export function createPreviewStore(
  options: PreviewStoreOptions = {},
): PreviewStore {
  const ttlSeconds = options.ttlSeconds ?? LIMITS.previewTokenTtlSeconds;
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 10_000;
  const entries = new Map<string, StoredPreview>();

  function prune(): void {
    if (entries.size <= maxEntries) {
      return;
    }
    // Only under pressure, and dead entries first: an expired or used token that
    // is still remembered produces `expired`/`already-used`, which tells the client
    // what to do. Forgetting it early would downgrade every refusal to "unknown
    // token" and lose the reason.
    const current = now();
    for (const [token, entry] of entries) {
      if (entry.used || entry.expiresAtMs <= current) {
        entries.delete(token);
      }
    }
    if (entries.size <= maxEntries) {
      return;
    }
    // Still over the cap: drop the oldest live tokens, which are the least likely
    // to still be in a browser's pending request.
    const byAge = [...entries.entries()].sort(
      (a, b) => a[1].expiresAtMs - b[1].expiresAtMs,
    );
    for (const [token] of byAge.slice(0, entries.size - maxEntries)) {
      entries.delete(token);
    }
  }

  function check(request: PreviewRequest): PreviewCheck {
    const entry = entries.get(request.previewToken);
    if (entry === undefined) {
      return {
        ok: false,
        reason: "unknown-token",
        message:
          "this preview token was not issued by this host, or it has already been replaced",
      };
    }
    if (entry.used) {
      return {
        ok: false,
        reason: "already-used",
        message:
          "this preview token has already been used; re-preview the paths before changing them",
      };
    }
    if (entry.expiresAtMs <= now()) {
      return {
        ok: false,
        reason: "expired",
        message:
          "this preview token expired; re-preview the paths before changing them",
      };
    }
    if (entry.pathId !== request.pathId) {
      return {
        ok: false,
        reason: "wrong-path",
        message: "this preview token was issued for a different path",
      };
    }
    if (entry.fingerprintHex !== request.fingerprintHex) {
      return {
        ok: false,
        reason: "stale-content",
        message:
          "the file content changed since it was previewed; re-preview before changing it",
      };
    }
    return { ok: true };
  }

  return {
    issue(claim: PreviewClaim): IssuedPreview {
      prune();
      const token = `pt_${randomBytes(24).toString("base64url")}`;
      const expiresAtMs = now() + ttlSeconds * 1000;
      entries.set(token, { ...claim, expiresAtMs, used: false });
      return { previewToken: token, expiresAtMs };
    },

    verify(requests: readonly PreviewRequest[]): PreviewCheck {
      prune();
      for (const request of requests) {
        const result = check(request);
        if (!result.ok) {
          return result;
        }
      }
      return { ok: true };
    },

    redeem(requests: readonly PreviewRequest[]): PreviewCheck {
      prune();
      for (const request of requests) {
        const result = check(request);
        if (!result.ok) {
          return result;
        }
      }
      for (const request of requests) {
        const entry = entries.get(request.previewToken);
        if (entry !== undefined) {
          entry.used = true;
        }
      }
      return { ok: true };
    },

    size(): number {
      return entries.size;
    },

    clear(): void {
      entries.clear();
    },
  };
}

/** The `expiresAt` timestamp a token's TTL corresponds to, in contract form. */
export function expiresAtIso(expiresAtMs: number): string {
  return new Date(expiresAtMs).toISOString();
}

/** SHA-256 of an in-memory buffer, used by tests and by pathless previews. */
export function fingerprintBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
