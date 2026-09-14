/**
 * Where the app connects, decided at runtime.
 *
 * The bundle is static: it is built once and served by whatever service happens to be
 * running, so the service address cannot be baked in at build time. It is resolved here,
 * in a pure function, so the rules are testable without a browser:
 *
 * 1. an explicit `?api=` in the URL (a service on another port, or a tunnel);
 * 2. a remembered address from a previous visit in this browser;
 * 3. otherwise this page's own origin — the normal case, because the service serves the
 *    page it is protecting, which is also why there is no CORS in the default path.
 *
 * The pairing ticket is read from the URL *fragment* and never from the query string: a
 * fragment is not sent to a server and does not appear in an access log, which is the
 * whole reason the CLI puts it there.
 */
export interface SessionConfig {
  readonly baseUrl: string;
  /** The one-time pairing ticket, when this page was opened from a pairing URL. */
  readonly ticket: string | null;
  /** True when `baseUrl` came from an explicit override rather than this page's origin. */
  readonly overridden: boolean;
}

export interface SessionConfigInput {
  readonly href: string;
  /** Address remembered in this browser, if any. */
  readonly storedBaseUrl: string | null;
}

export function parseSessionConfig(input: SessionConfigInput): SessionConfig {
  const url = safeUrl(input.href);
  const fromQuery = clean(url?.searchParams.get("api") ?? null);
  const fromStorage = clean(input.storedBaseUrl);

  const chosen = firstValidUrl(fromQuery, fromStorage, url?.origin ?? null);
  return {
    baseUrl: chosen.value,
    ticket: readTicket(url),
    overridden: chosen.source === "query" || chosen.source === "storage",
  };
}

/** The same URL with the ticket removed, so reloading does not replay a used ticket. */
export function stripTicket(href: string): string {
  const url = safeUrl(href);
  if (url === null) {
    return href;
  }
  url.hash = "";
  return url.toString();
}

export function readTicket(url: URL | null): string | null {
  if (url === null || url.hash.length <= 1) {
    return null;
  }
  const fragment = new URLSearchParams(url.hash.slice(1));
  // `pair` is what the CLI mints (`/#pair=…`). `ticket` is accepted as well because it is
  // the spelling the design package uses, and a pairing URL is a thing users paste around:
  // rejecting the other name would turn a working URL into an authentication failure.
  return clean(fragment.get("pair")) ?? clean(fragment.get("ticket"));
}

/** A normalised `http(s)` origin, or null when the value is missing or unusable. */
export function normalizeBaseUrl(value: string | null): string | null {
  const trimmed = clean(value);
  if (trimmed === null) {
    return null;
  }
  const url = safeUrl(trimmed);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return null;
  }
  // The path, query and fragment of a service address are meaningless: every request is
  // built as `${baseUrl}${path}`, so a trailing slash would produce `//api/v1/…`.
  return url.origin;
}

function firstValidUrl(...candidates: readonly (string | null)[]): {
  value: string;
  source: "query" | "storage" | "origin";
} {
  const sources = ["query", "storage", "origin"] as const;
  for (const [index, candidate] of candidates.entries()) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized !== null) {
      return { value: normalized, source: sources[index] ?? "origin" };
    }
  }
  // `url.origin` is always present for an absolute href, so this is a last resort for a
  // caller that passed something unparseable rather than a case that happens in a browser.
  return { value: "http://127.0.0.1:47831", source: "origin" };
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function clean(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
