/**
 * The pairing ticket's lifetime, as actually enforced.
 *
 * The 60-second default is the design; `--ticket-ttl` widens it for a URL that will be
 * read later. These cases pin the two sides of that knob: a ticket minted with the
 * default is dead the moment its minute is up (a spent credential must not keep working),
 * and a ticket minted with a widened TTL is still alive within it (the flag must actually
 * do something). Time is injected, so no test waits on a clock.
 */
import { describe, expect, it } from "vitest";
import { createAuthStore } from "@refyard/host-node";

const SERVICE = "srvc_test";
const ORIGIN = "http://127.0.0.1:47831";
const GRANTS = {
  allowedRootIds: ["root_1"],
  repositoryIds: ["repo_1"],
  scopes: ["repository:read"],
};

function exchange(
  store: ReturnType<typeof createAuthStore>,
  ticket: string,
): { readonly ok: boolean } {
  const result = store.exchange({
    ticket,
    origin: ORIGIN,
    serviceInstanceId: SERVICE,
  });
  return { ok: result.ok };
}

describe("ticket TTL", () => {
  it("lets the default 60-second ticket die on time", () => {
    let current = 1_000_000;
    const store = createAuthStore({
      serviceInstanceId: SERVICE,
      now: () => current,
    });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: GRANTS,
    });

    current += 59_000;
    expect(exchange(store, ticket.ticket).ok).toBe(true);
  });

  it("refuses the default ticket one second past its life", () => {
    let current = 1_000_000;
    const store = createAuthStore({
      serviceInstanceId: SERVICE,
      now: () => current,
    });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: GRANTS,
    });

    current += 61_000;
    expect(exchange(store, ticket.ticket).ok).toBe(false);
  });

  it("honours a widened TTL from --ticket-ttl", () => {
    let current = 1_000_000;
    const store = createAuthStore({
      serviceInstanceId: SERVICE,
      now: () => current,
      ticketTtlSeconds: 3600,
    });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: GRANTS,
    });

    current += 59 * 60_000;
    expect(exchange(store, ticket.ticket).ok).toBe(true);
  });

  it("consumes a ticket whether or not the exchange succeeds", () => {
    // An expired exchange must not leave the ticket somehow reusable: the guarantee the
    // whole pairing flow rests on is "one ticket, one exchange, ever".
    let current = 1_000_000;
    const store = createAuthStore({
      serviceInstanceId: SERVICE,
      now: () => current,
    });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: GRANTS,
    });

    current += 61_000;
    expect(exchange(store, ticket.ticket).ok).toBe(false);
    current -= 61_000;
    expect(exchange(store, ticket.ticket).ok).toBe(false);
  });
});

describe("repository grants and broad scopes", () => {
  it("lets repository:* satisfy repository operation scopes but not workspace management", () => {
    const store = createAuthStore({ serviceInstanceId: SERVICE });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: {
        allowedRootIds: ["root_1"],
        repositoryIds: ["repo_1"],
        scopes: ["repository:*"],
      },
    });
    const exchanged = store.exchange({
      ticket: ticket.ticket,
      origin: ORIGIN,
      serviceInstanceId: SERVICE,
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) {
      return;
    }
    expect(store.allowsScope(exchanged.session, "repository:read")).toBe(true);
    expect(store.allowsScope(exchanged.session, "repository:write")).toBe(true);
    expect(store.allowsScope(exchanged.session, "repository:network")).toBe(
      true,
    );
    expect(store.allowsScope(exchanged.session, "workspace:manage")).toBe(
      false,
    );
  });

  it("does not let repository:* grant a repository id the session was never given", () => {
    // Prevents: a broad operation scope silently turning into access to every repository
    // registered in the process. Resource grants and operation scopes are independent axes.
    const store = createAuthStore({ serviceInstanceId: SERVICE });
    const ticket = store.mintTicket({
      origin: ORIGIN,
      actor: "cli",
      grants: {
        allowedRootIds: [],
        repositoryIds: [],
        scopes: ["repository:*"],
      },
    });
    const exchanged = store.exchange({
      ticket: ticket.ticket,
      origin: ORIGIN,
      serviceInstanceId: SERVICE,
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) {
      return;
    }
    expect(store.allowsRepository(exchanged.session, "repo_not_granted")).toBe(
      false,
    );
  });
});
