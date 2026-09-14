/**
 * Pairing: a one-time ticket becomes a bearer session.
 *
 * The problem this solves is that a local service has no user directory. It cannot
 * ask "who is this"; it can only ask "does this caller hold the secret the CLI
 * just created". So the CLI mints a 256-bit ticket, hands it to the browser in the
 * URL **fragment** (never a query string: fragments are not sent to a server, do
 * not appear in `Referer`, and stay out of access logs), and the page exchanges it
 * once for a session token.
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
 *
 * There is no refresh token and no "remember me": when a session expires the user
 * pairs again, which is exactly the moment a human is present.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Problem } from "@refyard/git-contract";

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
  }): BootstrapTicket;
  /** Redeem a ticket. A ticket is consumed whether or not the exchange succeeds. */
  exchange(input: {
    readonly ticket: string;
    readonly origin: string;
    readonly serviceInstanceId: string;
  }): ExchangeResult;
  /** Resolve a bearer token. */
  authorize(input: {
    readonly authorization: string | undefined;
    readonly serviceInstanceId: string;
  }): AuthorizeResult;
  /** Does this session's grant cover the repository? */
  allowsRepository(session: Session, repositoryId: string): boolean;
  revoke(sessionId: string): boolean;
  sessionCount(): number;
  ticketCount(): number;
}

const DEFAULT_TICKET_TTL_SECONDS = 60;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function createAuthStore(options: AuthStoreOptions): AuthStore {
  const now = options.now ?? Date.now;
  const ticketTtlMs =
    (options.ticketTtlSeconds ?? DEFAULT_TICKET_TTL_SECONDS) * 1000;
  const sessionTtlMs =
    (options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) * 1000;
  const maxTickets = options.maxTickets ?? 64;
  const maxSessions = options.maxSessions ?? 16;
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
        // 256 bits, URL-safe: the fragment it travels in has no escaping rules to
        // get wrong and no character a shell would eat.
        ticket: randomBytes(32).toString("base64url"),
        serviceInstanceId: options.serviceInstanceId,
        origin: input.origin,
        actor: input.actor,
        grants: input.grants,
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
      // Consumed on first sight, whatever the outcome: a wrong-origin attempt must
      // not leave the ticket alive for a second try.
      tickets.delete(record.ticket);
      if (record.expiresAtMs <= now()) {
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
        return {
          ok: false,
          problem: {
            code: "Forbidden",
            message: "that pairing ticket was issued for a different origin",
            retryable: false,
          },
        };
      }
      const session: Session = {
        token: `rfs_${randomBytes(32).toString("base64url")}`,
        sessionId: `sess_${randomBytes(12).toString("base64url")}`,
        actor: record.actor,
        grants: record.grants,
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

    allowsRepository(session, repositoryId): boolean {
      if (session.grants.scopes.includes("repository:*")) {
        return true;
      }
      return session.grants.repositoryIds.includes(repositoryId);
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
}
