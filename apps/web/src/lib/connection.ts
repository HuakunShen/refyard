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
 * The pairing ticket travels in the URL so that opening it pairs without typing anything.
 * It is read from the fragment first and from the query string as an equal citizen (the
 * user's 2026-09-15 direction: some browser flows drop the fragment, and a URL that pairs
 * by being opened is the point). The query form is acceptable here because the exposure is
 * bounded on every side: the host's request log never records a query string, documents are
 * served with `Referrer-Policy: no-referrer`, the ticket is single-use and expires in sixty
 * seconds, and the page clears it from the address bar the moment it is spent (`stripTicket`).
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
  // Both spellings, wherever they travelled: what matters is that a spent ticket is not
  // left sitting in the address bar, the session history, or a bookmark.
  url.searchParams.delete("pair");
  url.searchParams.delete("ticket");
  return url.toString();
}

/**
 * The ticket this URL carries, from the fragment or the query string.
 *
 * `pair` is what the CLI mints. `ticket` is accepted in both positions because it is the
 * spelling the design package uses, and a pairing URL is a thing users paste around:
 * rejecting the other name would turn a working URL into an authentication failure.
 */
export function readTicket(url: URL | null): string | null {
  if (url === null) {
    return null;
  }
  const fragment =
    url.hash.length > 1 ? new URLSearchParams(url.hash.slice(1)) : null;
  return (
    clean(fragment?.get("pair") ?? null) ??
    clean(fragment?.get("ticket") ?? null) ??
    clean(url.searchParams.get("pair")) ??
    clean(url.searchParams.get("ticket"))
  );
}

/**
 * Extract a bare ticket from user input, which may be either a bare ticket or a full pairing URL.
 */
export function extractTicketFromText(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const extracted = readTicket(url);
      if (extracted !== null) {
        return extracted;
      }
    } catch {
      // Not a valid URL, treat as bare ticket
    }
  }
  return trimmed;
}

/**
 * A normalised `http(s)` service address, or null when the value is missing or unusable.
 *
 * The path is part of the address, not noise. A service mounted under a prefix — an
 * embedding host that serves the workbench at `/refyard` beside its own routes — is a real
 * deployment, and dropping the path there would send every request to the host's own
 * `/api/v1/…`. The query and fragment stay meaningless, and trailing slashes are removed
 * because every request is built as `${baseUrl}${path}`: keeping one would request
 * `//api/v1/…`.
 */
export function normalizeBaseUrl(value: string | null): string | null {
  const trimmed = clean(value);
  if (trimmed === null) {
    return null;
  }
  const url = safeUrl(trimmed);
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
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
  return { value: "http://127.0.0.1:9595", source: "origin" };
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
