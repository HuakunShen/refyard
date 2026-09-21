/**
 * Where the browser keeps the two things it remembers.
 *
 * The distinction is the whole point of the module and it is a security rule, not a
 * preference: the session token is a credential for a *process*, and a copy in
 * `localStorage` outlives both the tab and the service. A build shipped with such a copy
 * while the module header claimed otherwise, so the rule is pinned here — with the
 * migration path, because the copies that build wrote are still out there.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserStorage,
  type BrowserStorage,
  type StorageLike,
} from "../../apps/web/src/lib/storage-policy.ts";

/** A `Storage` good enough for the policy: strings in a Map, and a flag to make it throw. */
class FakeStorage implements StorageLike {
  readonly entries = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    if (this.failWrites) {
      throw new Error("storage is not available");
    }
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) {
      throw new Error("storage is not available");
    }
    this.entries.set(key, value);
  }
}

const TOKEN_KEY = "refyard.session.token";
const INSTANCE_KEY = "refyard.session.instance";

describe("the browser's stored session", () => {
  let session: FakeStorage;
  let local: FakeStorage;
  let storage: BrowserStorage;
  let storeToken: (token: string | null) => void;
  let storeInstance: (instanceId: string | null) => void;
  let storeBaseUrl: (baseUrl: string | null) => void;

  beforeEach(() => {
    session = new FakeStorage();
    local = new FakeStorage();
    storage = createBrowserStorage({ session, local });
    storeToken = (token) => storage.storeToken(token);
    storeInstance = (instanceId) => storage.storeInstance(instanceId);
    storeBaseUrl = (baseUrl) => storage.storeBaseUrl(baseUrl);
  });

  it("keeps the token out of localStorage, where it would outlive the service", () => {
    // Prevents: a bearer token that survives the browser restarting and the service
    // exiting — a credential for a process that no longer exists, readable by anything
    // that runs on this origin until somebody clears it. The design package lists a
    // long-lived localStorage token among the shapes this product must not have.
    storeToken("tok_abc");

    expect(session.getItem(TOKEN_KEY)).toBe("tok_abc");
    expect(local.getItem(TOKEN_KEY)).toBeNull();
  });

  it("keeps the service instance beside the token and in the same place", () => {
    // The two are only meaningful together: an instance id in one store and a token in
    // the other would let a page decide it is paired when it only half is.
    storeInstance("srvc_a");

    expect(session.getItem(INSTANCE_KEY)).toBe("srvc_a");
    expect(local.getItem(INSTANCE_KEY)).toBeNull();
  });

  it("drops a token an earlier build left in localStorage instead of using it", () => {
    // Prevents: the migration being a silent downgrade. A build that wrote the token to
    // both stores is still in a service-worker cache somewhere, so a stale copy must be
    // *removed* on sight rather than honoured — re-pairing costs one command, and that
    // is the correct price for not keeping a credential where it does not belong.
    local.setItem(TOKEN_KEY, "tok_legacy");
    local.setItem(INSTANCE_KEY, "srvc_legacy");

    expect(storage.readStoredToken()).toBeNull();
    expect(storage.readStoredInstance()).toBeNull();
    expect(local.getItem(TOKEN_KEY)).toBeNull();
    expect(local.getItem(INSTANCE_KEY)).toBeNull();
  });

  it("still remembers the session across a reload in the same tab", () => {
    // The reason the token is allowed to persist at all: a pairing ticket is single use,
    // so forgetting the token on reload would make every refresh dead end.
    storeToken("tok_reload");
    storeInstance("srvc_reload");

    expect(storage.readStoredToken()).toBe("tok_reload");
    expect(storage.readStoredInstance()).toBe("srvc_reload");
  });

  it("forgets both when the session is cleared", () => {
    storeToken("tok_clear");
    storeInstance("srvc_clear");

    storage.clearStoredSession();

    expect(storage.readStoredToken()).toBeNull();
    expect(storage.readStoredInstance()).toBeNull();
    expect(session.getItem(TOKEN_KEY)).toBeNull();
  });

  it("keeps preferences in localStorage, because they are not credentials", () => {
    // The address and the appearance settings are the reason localStorage is used at
    // all: they must outlive the tab, and losing them is an annoyance rather than a leak.
    storeBaseUrl("http://127.0.0.1:9595");

    expect(storage.readStoredBaseUrl()).toBe("http://127.0.0.1:9595");
    expect(local.getItem("refyard.baseUrl")).toBe("http://127.0.0.1:9595");
    expect(session.getItem("refyard.baseUrl")).toBeNull();
  });

  it("reads a row density as a name, and defaults to the roomy one", () => {
    // Stored as a name rather than a pixel count: a later change to the density scale
    // must not have to interpret numbers written by an older build. Roomy is
    // GitKraken's spacing, which is the experience this history table is built to match.
    expect(storage.readStoredDensity()).toBe("roomy");

    storage.storeDensity("roomy");

    expect(storage.readStoredDensity()).toBe("roomy");
    expect(local.getItem("refyard.appearance.density")).toBe("roomy");
  });

  it("reads as unpaired when the browser refuses storage entirely", () => {
    // Private modes and blocked site data must not turn into a crash: the workbench opens
    // unpaired, and the pairing URL still works.
    session.failWrites = true;
    local.failWrites = true;

    expect(() => {
      storeToken("tok_blocked");
      storeBaseUrl("http://127.0.0.1:9595");
    }).not.toThrow();
    expect(storage.readStoredToken()).toBeNull();
  });
});
