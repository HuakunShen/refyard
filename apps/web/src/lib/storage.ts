/**
 * The browser's two stores, handed to the policy that decides what goes where.
 *
 * Everything interesting — which key lives in which store, and the rule that a token never
 * goes to `localStorage` — is in `storage-policy.ts`, where it can be tested without a
 * browser. This file only finds `window.sessionStorage` and `window.localStorage` and
 * passes them along, and it tolerates a browser that has neither.
 */
import {
  createBrowserStorage,
  type BrowserStorage,
  type StorageLike,
} from "./storage-policy.js";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function storageFrom(name: "sessionStorage" | "localStorage"): StorageLike {
  const candidate = window[name];
  if (
    candidate === undefined ||
    candidate === null ||
    typeof candidate.getItem !== "function" ||
    typeof candidate.setItem !== "function" ||
    typeof candidate.removeItem !== "function"
  ) {
    return NO_STORAGE;
  }
  return candidate;
}

const storage: BrowserStorage = createBrowserStorage({
  session: storageFrom("sessionStorage"),
  local: storageFrom("localStorage"),
});

export const readStoredToken = (): string | null => storage.readStoredToken();
export const storeToken = (token: string | null): void =>
  storage.storeToken(token);
export const readStoredBaseUrl = (): string | null =>
  storage.readStoredBaseUrl();
export const storeBaseUrl = (baseUrl: string | null): void =>
  storage.storeBaseUrl(baseUrl);
export const readStoredInstance = (): string | null =>
  storage.readStoredInstance();
export const storeInstance = (instanceId: string | null): void =>
  storage.storeInstance(instanceId);
export const clearStoredSession = (): void => storage.clearStoredSession();
export const readStoredAccent = (): string => storage.readStoredAccent();
export const storeAccent = (accent: string | null): void =>
  storage.storeAccent(accent);
export const readStoredBackground = (): string =>
  storage.readStoredBackground();
export const storeBackground = (background: string | null): void =>
  storage.storeBackground(background);
export const readStoredGlass = (): boolean => storage.readStoredGlass();
export const storeGlass = (enabled: boolean): void =>
  storage.storeGlass(enabled);
export const readStoredUpdateCheck = (): boolean =>
  storage.readStoredUpdateCheck();
export const storeUpdateCheck = (enabled: boolean): void =>
  storage.storeUpdateCheck(enabled);
