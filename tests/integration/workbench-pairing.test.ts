/**
 * Opening a page that carries a pairing ticket pairs, even in a browser that remembers an
 * earlier session.
 *
 * The two failure modes this pins are the ones a user meets without being able to do anything
 * about them:
 *
 * - **A remembered bearer is not evidence.** It proves nothing until the service answers it,
 *   and the ordinary way it dies is that the service restarted — every process mints new
 *   sessions. A page that discards its own ticket because storage looked non-empty turns into
 *   a pairing form asking for a URL the user already opened.
 * - **A live remembered session must not be replaced.** Re-pairing on every load would work,
 *   but it spends a single-use ticket and churns sessions for a browser that was already fine.
 *
 * Both run against a real service and a real temporary repository: the ticket, the origin, the
 * bearer and the expiry are the product's, not a stub's.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createWorkbenchRuntime } from "../../apps/web/src/lib/runtime/bootstrap.js";
import { createWorkbenchSessionState } from "../../apps/web/src/lib/workbench/session.js";
import {
  createAdapterHarness,
  type AdapterHarness,
} from "../support/adapter-harness.js";

let harness: AdapterHarness | null = null;

afterEach(async () => {
  await harness?.dispose();
  harness = null;
});

interface Memory {
  token: string | null;
  instance: string | null;
  baseUrl: string | null;
  cleared: number;
}

/** What a browser tab holds across a reload, plus the two URL ports the page owns. */
function tab(input: {
  readonly href: string;
  readonly storedToken: string | null;
  readonly storedInstance: string | null;
  readonly baseUrl: string;
}): {
  readonly form: ReturnType<typeof createWorkbenchSessionState>;
  readonly memory: Memory;
  readonly replaced: string[];
  readonly runtime: ReturnType<typeof createWorkbenchRuntime>;
} {
  const active = harness;
  if (active === null) {
    throw new Error("the harness must exist before a tab is built");
  }
  const memory: Memory = {
    token: input.storedToken,
    instance: input.storedInstance,
    baseUrl: input.baseUrl,
    cleared: 0,
  };
  const replaced: string[] = [];
  const form = createWorkbenchSessionState({
    href: input.href,
    storedBaseUrl: input.baseUrl,
    storedToken: input.storedToken,
    storedInstance: input.storedInstance,
  });
  const runtime = createWorkbenchRuntime({
    form,
    fetch: active.fetch,
    storage: {
      storeToken: (token) => {
        memory.token = token;
      },
      storeInstance: (instance) => {
        memory.instance = instance;
      },
      storeBaseUrl: (baseUrl) => {
        memory.baseUrl = baseUrl;
      },
      clearStoredSession: () => {
        memory.token = null;
        memory.instance = null;
        memory.cleared += 1;
      },
    },
    currentHref: () => input.href,
    replaceHref: (href) => {
      replaced.push(href);
    },
    onSession: () => undefined,
    onConnectionState: () => undefined,
    runtime: null,
  });
  return { form, memory, replaced, runtime };
}

/** A fresh, unspent ticket for the running service, as the CLI's `p` keystroke would mint. */
function freshTicket(): string {
  const active = harness;
  if (active === null) {
    throw new Error("the harness must exist before a ticket is minted");
  }
  const pairing = active.service.http.pairingUrl(active.baseUrl);
  const ticket = new URL(pairing).searchParams.get("pair");
  if (ticket === null) {
    throw new Error("the service issued no ticket");
  }
  return ticket;
}

describe("pairing from the URL the page was opened with", () => {
  it("spends the ticket when the remembered session belongs to a restarted service", async () => {
    // Prevents: a panel that exists to show the workbench instead asking for a pairing URL,
    // because the browser still holds a bearer the restarted service has never heard of.
    harness = await createAdapterHarness();
    const ticket = freshTicket();
    const stale = "rfs_bearer_from_a_previous_process";
    const { form, memory, runtime } = tab({
      href: `${harness.baseUrl}/?pair=${ticket}`,
      storedToken: stale,
      storedInstance: "srvc_previous",
      baseUrl: harness.baseUrl,
    });

    await runtime.start();

    expect(runtime.session()).not.toBeNull();
    expect(form.pairPhase).toBe("idle");
    expect(memory.token).not.toBe(stale);
    expect(memory.token).not.toBeNull();
    await runtime.dispose();
  });

  it("keeps a live remembered session and never spends the ticket", async () => {
    // Prevents: a ticket being burned on every load of a browser that was already paired —
    // tickets are single use, and the service records one session per exchange.
    harness = await createAdapterHarness();
    const ticket = freshTicket();
    const { form, replaced, runtime } = tab({
      href: `${harness.baseUrl}/?pair=${ticket}`,
      storedToken: harness.secretToken,
      storedInstance: harness.instanceId,
      baseUrl: harness.baseUrl,
    });

    await runtime.start();

    expect(runtime.session()).not.toBeNull();
    expect(form.pairPhase).toBe("idle");
    expect(form.ticket).toBe("");
    expect(replaced[replaced.length - 1] ?? "").not.toContain("pair=");
    await runtime.dispose();

    // The ticket is still exchangeable, which is what "not spent" means.
    const exchange = await harness.service.fetch("/api/v1/session/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    expect(exchange.status).toBe(200);
  });
});
