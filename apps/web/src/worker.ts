/// <reference types="@cloudflare/workers-types" />
/**
 * Cloudflare Worker entrypoint for the static Refyard PWA.
 *
 * This Worker serves assets only. It has no Git binding, repository path, bearer token,
 * API proxy or mutation route. The explicit `/api/` refusal is required because the
 * Static Assets SPA fallback would otherwise turn an API typo into a successful HTML
 * document. The backend remains the user's local Node CLI, reached only through an
 * explicitly configured HTTPS endpoint and its own exact-origin/bearer checks.
 */

const COMMON_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return apiNotFound();
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          allow: "GET, HEAD",
          ...COMMON_HEADERS,
        },
      });
    }

    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [name, value] of Object.entries(COMMON_HEADERS)) {
      headers.set(name, value);
    }
    headers.set(
      "content-security-policy",
      contentSecurityPolicy(env.PUBLIC_API_ORIGINS),
    );
    headers.set("cache-control", cacheControl(url.pathname));
    return new Response(asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;

function apiNotFound(): Response {
  return new Response(
    JSON.stringify({
      problem: {
        code: "NotFound",
        message: "the Cloudflare UI Worker does not host the Git API",
        retryable: false,
      },
    }),
    {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        ...COMMON_HEADERS,
      },
    },
  );
}

function cacheControl(pathname: string): string {
  if (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/200.html" ||
    pathname === "/service-worker.js" ||
    pathname === "/manifest.webmanifest"
  ) {
    return "no-store";
  }
  if (pathname.startsWith("/_app/immutable/")) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=300";
}

function contentSecurityPolicy(configured: string): string {
  const origins = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value) => isHttpsOrigin(value));
  const connectSources =
    origins.length === 0 && configured.trim().length === 0
      ? ["'self'"]
      : ["'self'", ...new Set(origins)];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; ");
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}
