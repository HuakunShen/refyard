/**
 * The two pieces of browser state the app keeps.
 *
 * They are stored in different places on purpose, because they are different kinds of
 * thing:
 *
 * - the **session token** is a credential, so it lives in `sessionStorage`: it survives a
 *   reload (which is otherwise a dead end — the pairing ticket is single use) and dies with
 *   the tab. It is never in `localStorage`, where it would outlive the service process.
 * - the **service address** is a preference, so it lives in `localStorage`.
 *
 * Both are wrapped because a browser can throw on storage access (private modes, blocked
 * site data), and a workbench that fails to start because a preference could not be read
 * is worse than one that forgets the preference.
 */

const TOKEN_KEY = "refyard.session.token";
const BASE_URL_KEY = "refyard.baseUrl";
/**
 * The service instance the stored token belongs to.
 *
 * Kept beside the token because the two are only meaningful together: a token without
 * its instance is a credential for a service that may not be there any more, and the
 * page needs to notice that rather than retry against a stranger.
 */
const INSTANCE_KEY = "refyard.session.instance";

export function readStoredToken(): string | null {
  return readSession(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  writeSession(TOKEN_KEY, token);
}

export function readStoredBaseUrl(): string | null {
  return readLocal(BASE_URL_KEY);
}

export function storeBaseUrl(baseUrl: string | null): void {
  writeLocal(BASE_URL_KEY, baseUrl);
}

export function readStoredInstance(): string | null {
  return readSession(INSTANCE_KEY);
}

export function storeInstance(instanceId: string | null): void {
  writeSession(INSTANCE_KEY, instanceId);
}

/** Forget the whole session: used when the service is not the one we paired with. */
export function clearStoredSession(): void {
  storeToken(null);
  storeInstance(null);
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // Storage being unavailable changes nothing about the session that is already open.
  }
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Same as above: a preference is not worth failing over.
  }
}
