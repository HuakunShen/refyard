/**
 * Pairing: a one-time ticket becomes a bearer session.
 *
 * The problem this solves is that a local service has no user directory. It cannot
 * ask "who is this"; it can only ask "does this caller hold the secret the CLI
 * just created". So the CLI mints a 256-bit ticket and hands it to the browser in a
 * short-lived pairing URL. The current CLI uses `?pair=` because some browser flows
 * dropped fragments; the page still accepts the older fragment spelling. The host
 * never logs query strings, documents use `Referrer-Policy: no-referrer`, and the
 * page removes the ticket from the address bar immediately after exchange.
 *
 * Each rule below closes a specific hole:
 *
 * - **Single use.** A ticket that could be redeemed twice would be a password in a
 *   URL that anyone reading the browser's history could replay.
 * - **Short life (60 s).** A ticket exists for the seconds between the CLI printing
 *   the URL and the page exchanging it.
 * - **Bound to instance, origin and resources.** The exchange must come from the
 *   origin the ticket was minted for, and the session it produces carries exactly
 *   the grants the CLI decided — a session for one repository cannot read another.
 * - **In-memory only.** Neither tickets nor sessions are written to disk, so a
 *   restart invalidates them and nothing about a session survives in a file.
 * - **Comparison in constant time.** A ticket is a secret; comparing it with `===`
 *   leaks its prefix through timing to a caller that can retry.
 * - **Hosted second factor.** A non-loopback ticket can be marked as requiring a
 *   password. The password is scrypt-hashed at startup, compared to a fixed-size
 *   digest, and never retained or returned after the exchange.
 *
 * There is no refresh token and no "remember me": when a session expires the user
 * pairs again, which is exactly the moment a human is present. A password-rejected
 * hosted ticket stays in memory for a bounded retry window; the endpoint rate limiter
 * prevents it becoming an unlimited guessing oracle.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Problem } from "@refyard/git-contract";

export type AuthorizationScope =
  | "repository:read"
  | "repository:write"
  | "repository:network"
  | "workspace:manage"
  | "provider:manage";

export const AUTHORIZATION_SCOPES: readonly AuthorizationScope[] = [
  "repository:read",
  "repository:write",
  "repository:network",
  "workspace:manage",
  "provider:manage",
];

export interface SessionGrants {
  readonly allowedRootIds: readonly string[];
  readonly repositoryIds: readonly string[];
  readonly scopes: readonly string[];
}

export interface BootstrapTicket {
  readonly ticket: string;
  readonly serviceInstanceId: string;
  /** The single origin this ticket may be exchanged from. */
  readonly origin: string;
  readonly actor: string;
  readonly grants: SessionGrants;
  /** External-origin tickets require the separately configured hosted password. */
  readonly passwordRequired: boolean;
  readonly expiresAtMs: number;
}

export interface Session {
  readonly token: string;
  readonly sessionId: string;
  readonly actor: string;
  readonly grants: SessionGrants;
  readonly serviceInstanceId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

export interface AuthStoreOptions {
  readonly serviceInstanceId: string;
  readonly now?: () => number;
  /** Ticket lifetime; the design says 60 seconds. */
  readonly ticketTtlSeconds?: number;
  /** Session lifetime; the design caps it at 8 hours. */
  readonly sessionTtlSeconds?: number;
  readonly maxTickets?: number;
  readonly maxSessions?: number;
  /** Plaintext is accepted only at startup and immediately reduced to a memory-only hash. */
  readonly hostedPassword?: string;
}

export type ExchangeResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly problem: Problem };

export type AuthorizeResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly problem: Problem };

export interface AuthStore {
  /** Mint a ticket for one origin and one grant set. */
  mintTicket(input: {
    readonly origin: string;
    readonly actor: string;
    readonly grants: SessionGrants;
    readonly passwordRequired?: boolean;
  }): BootstrapTicket;
  /** Redeem a ticket; a hosted password failure keeps it retryable until expiry. */
  exchange(input: {
    readonly ticket: string;
    readonly origin: string;
    readonly serviceInstanceId: string;
    readonly password?: string;
  }): ExchangeResult;
  /** Resolve a bearer token. */
  authorize(input: {
    readonly authorization: string | undefined;
    readonly serviceInstanceId: string;
  }): AuthorizeResult;
  /** Does this session carry the requested operation authority? */
  allowsScope(session: Session, scope: AuthorizationScope): boolean;
  /** Does this session's resource grant cover the repository? */
  allowsRepository(session: Session, repositoryId: string): boolean;
  /**
   * Does this session's grant cover the approved root?
   *
   * Needed because a workspace target (init, clone) names a root and a destination
   * rather than a repository: the operation's whole purpose is to create the
   * repository, so there is no repository id to check, and a session that was never
   * granted a root must not be able to create anything inside it.
   */
  allowsRoot(session: Session, allowedRootId: string): boolean;
  /** Add a newly approved root/repository to one live session. */
  grant(
    sessionId: string,
    input: {
      readonly allowedRootId: string;
      readonly repositoryId: string;
    },
  ): boolean;
  /**
   * Add a newly approved root/repository to **every** live session.
   *
   * The mirror of `revokeRepository`, and it exists for the same reason: a grant is a fact
   * about the service rather than about one session. An embedding host approves a
   * repository on its own initiative, so a session that paired before that approval must
   * not be the one session that cannot read it.
   * @param input - the approval to record.
   * @returns how many live sessions gained it.
   */
  grantRepository(input: {
    readonly allowedRootId: string;
    readonly repositoryId: string;
  }): number;
  /** Remove a revoked repository from every live session. */
  revokeRepository(
    repositoryId: string,
    allowedRootId: string,
    rootHasRepositories: boolean,
  ): void;
  revoke(sessionId: string): boolean;
  sessionCount(): number;
  ticketCount(): number;
}

const DEFAULT_TICKET_TTL_SECONDS = 60;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const HOSTED_PASSWORD_MIN_LENGTH = 12;
const HOSTED_PASSWORD_MAX_LENGTH = 512;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;

interface PasswordHash {
  readonly salt: Buffer;
  readonly digest: Buffer;
}

function hashHostedPassword(password: string): PasswordHash {
  if (
    password.length < HOSTED_PASSWORD_MIN_LENGTH ||
    password.length > HOSTED_PASSWORD_MAX_LENGTH
  ) {
    throw new Error(
      `the hosted password must be between ${HOSTED_PASSWORD_MIN_LENGTH} and ${HOSTED_PASSWORD_MAX_LENGTH} characters`,
    );
  }
  const salt = randomBytes(16);
  return {
    salt,
    digest: scryptSync(
      password,
      salt,
      PASSWORD_KEY_BYTES,
      PASSWORD_SCRYPT_OPTIONS,
    ),
  };
}

function passwordMatches(given: string, expected: PasswordHash): boolean {
  const digest = scryptSync(
    given,
    expected.salt,
    expected.digest.byteLength,
    PASSWORD_SCRYPT_OPTIONS,
  );
  return timingSafeEqual(digest, expected.digest);
}

export function createAuthStore(options: AuthStoreOptions): AuthStore {
  const now = options.now ?? Date.now;
  const ticketTtlMs =
    (options.ticketTtlSeconds ?? DEFAULT_TICKET_TTL_SECONDS) * 1000;
  const sessionTtlMs =
    (options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
  const maxTickets = options.maxTickets ?? 64;
  const maxSessions = options.maxSessions ?? 16;
  const hostedPasswordHash =
    options.hostedPassword === undefined
      ? null
      : hashHostedPassword(options.hostedPassword);
  const tickets = new Map<string, BootstrapTicket>();
  const sessions = new Map<string, Session>();

  function prune(): void {
    const current = now();
    for (const [ticket, record] of tickets) {
      if (record.expiresAtMs <= current) {
        tickets.delete(ticket);
      }
    }
    for (const [token, session] of sessions) {
      if (session.expiresAtMs <= current) {
        sessions.delete(token);
      }
    }
    // Oldest first when over the cap: a housekeeping bound, not an eviction policy
    // a user is expected to notice.
    while (tickets.size > maxTickets) {
      const oldest = [...tickets.entries()].sort(
        (a, b) => a[1].expiresAtMs - b[1].expiresAtMs,
      )[0];
      if (oldest === undefined) {
        break;
      }
      tickets.delete(oldest[0]);
    }
    while (sessions.size > maxSessions) {
      const oldest = [...sessions.entries()].sort(
        (a, b) => a[1].issuedAtMs - b[1].issuedAtMs,
      )[0];
      if (oldest === undefined) {
        break;
      }
      sessions.delete(oldest[0]);
    }
  }

  function secretMatches(given: string, expected: string): boolean {
    const givenBytes = Buffer.from(given, "utf8");
    const expectedBytes = Buffer.from(expected, "utf8");
    if (givenBytes.byteLength !== expectedBytes.byteLength) {
      return false;
    }
    return timingSafeEqual(givenBytes, expectedBytes);
  }

  return {
    mintTicket(input): BootstrapTicket {
      prune();
      const record: BootstrapTicket = {
        // 256 bits and base64url-safe for the pairing URL. The ticket may appear in
        // either the current query spelling or the legacy fragment spelling.
        ticket: randomBytes(32).toString("base64url"),
        serviceInstanceId: options.serviceInstanceId,
        origin: input.origin,
        actor: input.actor,
        grants: copyGrants(input.grants),
        passwordRequired: input.passwordRequired === true,
        expiresAtMs: now() + ticketTtlMs,
      };
      tickets.set(record.ticket, record);
      return record;
    },

    exchange(input): ExchangeResult {
      prune();
      const record = findTicket(input.ticket);
      if (record === undefined) {
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message:
              "that pairing ticket is not valid: it was already used, it expired, or this service did not issue it",
            retryable: false,
          },
        };
      }
      if (record.expiresAtMs <= now()) {
        tickets.delete(record.ticket);
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message: "that pairing ticket expired; start the workbench again",
            retryable: false,
          },
        };
      }
      if (record.serviceInstanceId !== input.serviceInstanceId) {
        tickets.delete(record.ticket);
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message:
              "that pairing ticket belongs to a different service process",
            retryable: false,
          },
        };
      }
      if (record.origin !== input.origin) {
        tickets.delete(record.ticket);
        return {
          ok: false,
          problem: {
            code: "Forbidden",
            message: "that pairing ticket was issued for a different origin",
            retryable: false,
          },
        };
      }
      if (record.passwordRequired) {
        // A hosted password failure is retryable with the same ticket, but the
        // request-rate limiter around the endpoint bounds guessing. Invalid origin,
        // instance and expiry failures above still consume the ticket on first sight.
        if (
          hostedPasswordHash === null ||
          !passwordMatches(input.password ?? "", hostedPasswordHash)
        ) {
          return {
            ok: false,
            problem: {
              code: "Unauthenticated",
              message: "hosted pairing requires the correct password",
              retryable: true,
            },
          };
        }
      }
      tickets.delete(record.ticket);
      const session: Session = {
        token: `rfs_${randomBytes(32).toString("base64url")}`,
        sessionId: `sess_${randomBytes(12).toString("base64url")}`,
        actor: record.actor,
        grants: copyGrants(record.grants),
        serviceInstanceId: options.serviceInstanceId,
        issuedAtMs: now(),
        expiresAtMs: now() + sessionTtlMs,
      };
      sessions.set(session.token, session);
      return { ok: true, session };
    },

    authorize(input): AuthorizeResult {
      prune();
      const header = input.authorization;
      if (header === undefined || header.length === 0) {
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message:
              "this service requires a bearer token; pair again from the CLI",
            retryable: false,
          },
        };
      }
      const match = /^Bearer (.+)$/.exec(header);
      if (match === null || match[1] === undefined) {
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message: "the Authorization header must be `Bearer <token>`",
            retryable: false,
          },
        };
      }
      const token = match[1];
      const session = findSession(token);
      if (session === undefined) {
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message:
              "that session is not valid: it expired, or this service restarted",
            retryable: false,
          },
        };
      }
      if (session.serviceInstanceId !== input.serviceInstanceId) {
        return {
          ok: false,
          problem: {
            code: "Unauthenticated",
            message: "that session belongs to a different service process",
            retryable: false,
          },
        };
      }
      return { ok: true, session };
    },

    allowsScope(session, scope): boolean {
      if (session.grants.scopes.includes(scope)) {
        return true;
      }
      return (
        scope.startsWith("repository:") &&
        session.grants.scopes.includes("repository:*")
      );
    },

    allowsRepository(session, repositoryId): boolean {
      return session.grants.repositoryIds.includes(repositoryId);
    },

    allowsRoot(session, allowedRootId): boolean {
      return session.grants.allowedRootIds.includes(allowedRootId);
    },

    grant(sessionId, input): boolean {
      for (const [token, session] of sessions) {
        if (session.sessionId !== sessionId) {
          continue;
        }
        sessions.set(token, {
          ...session,
          grants: {
            allowedRootIds: session.grants.allowedRootIds.includes(
              input.allowedRootId,
            )
              ? [...session.grants.allowedRootIds]
              : [...session.grants.allowedRootIds, input.allowedRootId],
            repositoryIds: session.grants.repositoryIds.includes(
              input.repositoryId,
            )
              ? [...session.grants.repositoryIds]
              : [...session.grants.repositoryIds, input.repositoryId],
            scopes: [...session.grants.scopes],
          },
        });
        return true;
      }
      return false;
    },

    grantRepository(input): number {
      let granted = 0;
      for (const [token, session] of sessions) {
        if (
          session.grants.repositoryIds.includes(input.repositoryId) &&
          session.grants.allowedRootIds.includes(input.allowedRootId)
        ) {
          continue;
        }
        sessions.set(token, {
          ...session,
          grants: {
            allowedRootIds: session.grants.allowedRootIds.includes(
              input.allowedRootId,
            )
              ? [...session.grants.allowedRootIds]
              : [...session.grants.allowedRootIds, input.allowedRootId],
            repositoryIds: session.grants.repositoryIds.includes(
              input.repositoryId,
            )
              ? [...session.grants.repositoryIds]
              : [...session.grants.repositoryIds, input.repositoryId],
            scopes: [...session.grants.scopes],
          },
        });
        granted += 1;
      }
      return granted;
    },

    revokeRepository(repositoryId, allowedRootId, rootHasRepositories): void {
      for (const [token, session] of sessions) {
        sessions.set(token, {
          ...session,
          grants: {
            allowedRootIds: rootHasRepositories
              ? [...session.grants.allowedRootIds]
              : session.grants.allowedRootIds.filter(
                  (id) => id !== allowedRootId,
                ),
            repositoryIds: session.grants.repositoryIds.filter(
              (id) => id !== repositoryId,
            ),
            scopes: [...session.grants.scopes],
          },
        });
      }
    },

    revoke(sessionId): boolean {
      for (const [token, session] of sessions) {
        if (session.sessionId === sessionId) {
          sessions.delete(token);
          return true;
        }
      }
      return false;
    },

    sessionCount(): number {
      return sessions.size;
    },

    ticketCount(): number {
      return tickets.size;
    },
  };

  function findTicket(ticket: string): BootstrapTicket | undefined {
    // Timing-safe comparison, so a caller cannot learn a ticket's prefix by
    // measuring how long a failed lookup took.
    for (const [candidate, record] of tickets) {
      if (secretMatches(ticket, candidate)) {
        return record;
      }
    }
    return undefined;
  }

  function findSession(token: string): Session | undefined {
    for (const [candidate, session] of sessions) {
      if (secretMatches(token, candidate)) {
        return session;
      }
    }
    return undefined;
  }

  function copyGrants(grants: SessionGrants): SessionGrants {
    return {
      allowedRootIds: [...grants.allowedRootIds],
      repositoryIds: [...grants.repositoryIds],
      scopes: [...grants.scopes],
    };
  }
}
