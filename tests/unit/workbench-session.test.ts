/**
 * Workbench session state without a browser component.
 *
 * The page should compose this state machine, not implement pairing itself. These cases pin the
 * security-sensitive transitions so moving them out of +page.svelte cannot change their meaning.
 */
import { describe, expect, it, vi } from "vitest";
import {
  clearWorkbenchCredentials,
  consumeInitialPairingUrl,
  createWorkbenchSessionState,
  isDefaultSessionBaseUrl,
  pairWorkbenchSession,
  type WorkbenchSessionPorts,
} from "../../apps/web/src/lib/workbench/session.js";

interface Harness {
  readonly ports: WorkbenchSessionPorts;
  readonly stored: {
    token: string | null;
    instance: string | null;
    baseUrl: string | null;
    cleared: number;
    replaced: string[];
  };
  readonly exchange: ReturnType<typeof vi.fn>;
  readonly health: ReturnType<typeof vi.fn>;
}

function harness(input: {
  href?: string;
  token?: string;
  instance?: string;
  exchangeError?: Error;
} = {}): Harness {
  const stored = {
    token: null as string | null,
    instance: null as string | null,
    baseUrl: null as string | null,
    cleared: 0,
    replaced: [] as string[],
  };
  const exchange = vi.fn(async (ticket: string, password?: string) => {
    if (input.exchangeError !== undefined) {
      throw input.exchangeError;
    }
    expect(ticket).toBe("ticket-123");
    expect(password).toBe("secret-pass");
    return { token: "bearer-456" };
  });
  const health = vi.fn(async () => ({ serviceInstanceId: "srvc_new" }));
  let href = input.href ?? "http://127.0.0.1:9595/?pair=ticket-123";
  return {
    exchange,
    health,
    stored,
    ports: {
      exchangeTicket: exchange,
      health,
      storeToken(value) {
        stored.token = value;
      },
      storeInstance(value) {
        stored.instance = value;
      },
      storeBaseUrl(value) {
        stored.baseUrl = value;
      },
      clearStoredSession() {
        stored.cleared += 1;
      },
      currentHref: () => href,
      replaceHref(value) {
        stored.replaced.push(value);
        href = value;
      },
    },
  };
}

describe("workbench session state", () => {
  it("initializes from the same URL/storage precedence as the browser connection", () => {
    const state = createWorkbenchSessionState({
      href: "https://app.example.test/?api=http://127.0.0.1:5000&pair=abc",
      storedBaseUrl: "http://127.0.0.1:6000",
      storedToken: "tok_saved",
      storedInstance: "srvc_saved",
    });

    expect(state.baseUrl).toBe("http://127.0.0.1:5000");
    expect(state.ticket).toBe("abc");
    expect(state.token).toBe("tok_saved");
    expect(state.pairedInstance).toBe("srvc_saved");
    expect(state.hadTicketOnLoad).toBe(true);
    expect(isDefaultSessionBaseUrl(state)).toBe(false);
  });

  it("pairs, persists the bearer/instance, and scrubs the ticket URL", async () => {
    const h = harness();
    const state = createWorkbenchSessionState({
      href: "http://127.0.0.1:9595/?pair=ticket-123",
      storedBaseUrl: null,
      storedToken: null,
      storedInstance: null,
    });
    state.hostedPassword = "secret-pass";

    await pairWorkbenchSession(state, h.ports);

    expect(state.token).toBe("bearer-456");
    expect(state.pairedInstance).toBe("srvc_new");
    expect(state.ticket).toBe("");
    expect(state.hostedPassword).toBe("");
    expect(state.pairPhase).toBe("idle");
    expect(h.stored.token).toBe("bearer-456");
    expect(h.stored.instance).toBe("srvc_new");
    expect(h.stored.baseUrl).toBeNull();
    expect(h.stored.replaced).toEqual(["http://127.0.0.1:9595/"]);
  });

  it("keeps a rejected hosted ticket in memory but removes it from browser history", async () => {
    const hostedHref =
      "https://app.example.test/?api=https://api.example.test&pair=ticket-123";
    const h = harness({
      href: hostedHref,
      exchangeError: new Error("password rejected"),
    });
    const state = createWorkbenchSessionState({
      href: hostedHref,
      storedBaseUrl: null,
      storedToken: null,
      storedInstance: null,
    });
    state.hostedPassword = "secret-pass";

    await pairWorkbenchSession(state, h.ports);

    expect(state.token).toBeNull();
    expect(state.ticket).toBe("ticket-123");
    expect(state.hostedPassword).toBe("secret-pass");
    expect(state.pairPhase).toBe("failed");
    expect(state.pairMessage).toBe("password rejected");
    expect(h.stored.replaced).toEqual([
      "https://app.example.test/?api=https%3A%2F%2Fapi.example.test",
    ]);
  });

  it("scrubs an initial ticket without exchanging it when this tab is already paired", async () => {
    const h = harness();
    const state = createWorkbenchSessionState({
      href: "http://127.0.0.1:9595/?pair=ticket-123",
      storedBaseUrl: null,
      storedToken: "tok_existing",
      storedInstance: "srvc_existing",
    });

    await consumeInitialPairingUrl(state, h.ports);

    expect(h.exchange).not.toHaveBeenCalled();
    expect(state.token).toBe("tok_existing");
    expect(state.ticket).toBe("");
    expect(h.stored.replaced).toEqual(["http://127.0.0.1:9595/"]);
  });

  it("clears credentials and storage without owning repository selection", () => {
    const h = harness();
    const state = createWorkbenchSessionState({
      href: "http://127.0.0.1:9595/",
      storedBaseUrl: null,
      storedToken: "tok_existing",
      storedInstance: "srvc_existing",
    });

    clearWorkbenchCredentials(state, h.ports);

    expect(state.token).toBeNull();
    expect(state.pairedInstance).toBeNull();
    expect(h.stored.cleared).toBe(1);
  });
});
