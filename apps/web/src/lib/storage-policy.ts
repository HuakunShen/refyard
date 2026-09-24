/**
 * Where the browser keeps what it remembers, as a rule rather than a lookup.
 *
 * This module knows which key goes to which store and nothing about the DOM, so the rules
 * — including the security one — are testable in Node, next to the rest of the unit suite,
 * instead of only in a browser. `storage.ts` is the thin part that finds the two stores on
 * `window` and hands them in.
 *
 * The split matters because the rule is easy to get wrong and was: a shipped build wrote
 * the session token to `localStorage` while the module's own header said it never did. The
 * design package lists a long-lived localStorage token among the shapes this product must
 * not have — it is a bearer for one service *process*, and `localStorage` outlives both the
 * tab and that process.
 */

const TOKEN_KEY = "refyard.session.token";
/**
 * The service instance the stored token belongs to.
 *
 * Kept beside the token because the two are only meaningful together: a token without its
 * instance is a credential for a service that may not be there any more, and the page
 * needs to notice that rather than retry against a stranger.
 */
const INSTANCE_KEY = "refyard.session.instance";
const BASE_URL_KEY = "refyard.baseUrl";
const ACCENT_KEY = "refyard.theme.accent";
const UPDATE_CHECK_KEY = "refyard.updates.checkOnStartup";
const BG_KEY = "refyard.theme.background";
const GLASS_KEY = "refyard.theme.glass";
/**
 * Author avatars from GitHub are on unless explicitly refused — the stored
 * value exists to record an opt-out, not permission.
 */
const AVATARS_KEY = "refyard.appearance.avatars";
/**
 * How much room a history row gets. The default is the compact end of the scale, which is
 * what a workbench reads best at: the most commits per screen, with the graph's own
 * proportions held constant so the denser rows are still legible. The value is a name,
 * never a pixel count, so a future change to the scale does not have to read old numbers.
 */
const DENSITY_KEY = "refyard.appearance.density";
const LANGUAGE_KEY = "refyard.appearance.language";

/** The two methods of the browser's `Storage` this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserStores {
  /** Died with the tab. The token belongs here, and only here. */
  readonly session: StorageLike;
  /** Outlives the tab. Preferences belong here; credentials do not. */
  readonly local: StorageLike;
}

export interface BrowserStorage {
  readStoredToken(): string | null;
  storeToken(token: string | null): void;
  readStoredBaseUrl(): string | null;
  storeBaseUrl(baseUrl: string | null): void;
  readStoredInstance(): string | null;
  storeInstance(instanceId: string | null): void;
  clearStoredSession(): void;
  readStoredAccent(): string;
  storeAccent(accent: string | null): void;
  readStoredBackground(): string;
  storeBackground(background: string | null): void;
  readStoredGlass(): boolean;
  storeGlass(enabled: boolean): void;
  readStoredUpdateCheck(): boolean;
  storeUpdateCheck(enabled: boolean): void;
  readStoredAvatars(): boolean;
  storeAvatars(enabled: boolean): void;
  readStoredDensity(): string;
  storeDensity(density: string | null): void;
  readStoredLanguage(): string;
  storeLanguage(language: string | null): void;
}

export function createBrowserStorage(stores: BrowserStores): BrowserStorage {
  function readFrom(store: StorageLike, key: string): string | null {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  }

  function writeTo(
    store: StorageLike,
    key: string,
    value: string | null,
  ): void {
    try {
      if (value === null) {
        store.removeItem(key);
      } else {
        store.setItem(key, value);
      }
    } catch {
      // A browser can refuse storage (private modes, blocked site data). A workbench that
      // failed to start because a preference could not be read would be worse than one
      // that forgets the preference.
    }
  }

  /**
   * Remove a credential an earlier build wrote into `localStorage`.
   *
   * That build wrote the token to both stores while this module's header said it never did,
   * so the copies exist in the wild. They are *deleted* on sight rather than read: honouring
   * a copy that outlived its service would keep exactly the shape the design forbids, and
   * the cost of refusing is one pairing URL.
   */
  function forgetLegacyLocal(key: string): void {
    writeTo(stores.local, key, null);
  }

  return {
    readStoredToken(): string | null {
      forgetLegacyLocal(TOKEN_KEY);
      return readFrom(stores.session, TOKEN_KEY);
    },
    storeToken(token: string | null): void {
      forgetLegacyLocal(TOKEN_KEY);
      writeTo(stores.session, TOKEN_KEY, token);
    },
    readStoredBaseUrl(): string | null {
      return readFrom(stores.local, BASE_URL_KEY);
    },
    storeBaseUrl(baseUrl: string | null): void {
      writeTo(stores.local, BASE_URL_KEY, baseUrl);
    },
    readStoredInstance(): string | null {
      forgetLegacyLocal(INSTANCE_KEY);
      return readFrom(stores.session, INSTANCE_KEY);
    },
    storeInstance(instanceId: string | null): void {
      forgetLegacyLocal(INSTANCE_KEY);
      writeTo(stores.session, INSTANCE_KEY, instanceId);
    },
    clearStoredSession(): void {
      writeTo(stores.session, TOKEN_KEY, null);
      writeTo(stores.local, TOKEN_KEY, null);
      writeTo(stores.session, INSTANCE_KEY, null);
      writeTo(stores.local, INSTANCE_KEY, null);
    },
    readStoredAccent(): string {
      return readFrom(stores.local, ACCENT_KEY) ?? "default";
    },
    storeAccent(accent: string | null): void {
      writeTo(stores.local, ACCENT_KEY, accent);
    },
    readStoredBackground(): string {
      return readFrom(stores.local, BG_KEY) ?? "none";
    },
    storeBackground(background: string | null): void {
      writeTo(stores.local, BG_KEY, background);
    },
    readStoredGlass(): boolean {
      return readFrom(stores.local, GLASS_KEY) === "true";
    },
    storeGlass(enabled: boolean): void {
      writeTo(stores.local, GLASS_KEY, enabled ? "true" : "false");
    },
    readStoredUpdateCheck(): boolean {
      return readFrom(stores.local, UPDATE_CHECK_KEY) === "true";
    },
    storeUpdateCheck(enabled: boolean): void {
      writeTo(stores.local, UPDATE_CHECK_KEY, enabled ? "true" : "false");
    },
    readStoredAvatars(): boolean {
      return readFrom(stores.local, AVATARS_KEY) !== "false";
    },
    storeAvatars(enabled: boolean): void {
      writeTo(stores.local, AVATARS_KEY, enabled ? "true" : "false");
    },
    readStoredDensity(): string {
      return readFrom(stores.local, DENSITY_KEY) ?? "compact";
    },
    storeDensity(density: string | null): void {
      writeTo(stores.local, DENSITY_KEY, density);
    },
    readStoredLanguage(): string {
      return readFrom(stores.local, LANGUAGE_KEY) ?? "auto";
    },
    storeLanguage(language: string | null): void {
      writeTo(stores.local, LANGUAGE_KEY, language);
    },
  };
}
