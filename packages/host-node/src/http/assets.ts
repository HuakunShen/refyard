/**
 * Static assets: the packaged web build, and nothing else.
 *
 * The HTTP layer serves exactly one directory — the web bundle the CLI was shipped
 * with. It never serves a repository, a Git directory, a log or a configuration
 * file, and it never builds a path from client input without proving the result is
 * inside that directory.
 *
 * The rules, and the failure each one prevents:
 *
 * - **No traversal.** The decoded, normalised path must stay inside the asset root,
 *   compared after `realpath` so a symlink inside the bundle cannot point at `/etc`.
 * - **No NUL and no encoded separators.** `%00`, `%2f` and a literal `\0` are
 *   refused rather than passed to the filesystem, where a NUL truncates a path and
 *   an encoded slash can defeat a naive prefix check.
 * - **A missing asset is a 404, not the SPA.** The app shell may answer for a route
 *   (`/repos/x`), but `/assets/app-123.js` must never return HTML: a browser that
 *   receives HTML where it expected JavaScript reports a syntax error instead of a
 *   missing file, and a service worker would cache the wrong thing.
 * - **`/api/*` never falls through.** An unknown API path is a JSON 404, so a
 *   client cannot mistake an HTML shell for an API answer.
 * - **CSP and friends.** The page loads only its own bytes: no remote script, no
 *   CDN, no remote font, no framing by another origin. A document's own inline
 *   bootstrap script is named by hash rather than permitted in general (see `csp.ts`),
 *   which is what lets a static single-page app boot without `'unsafe-inline'`.
 *   An embedding static host may add exact API origins to `connect-src`; the API's
 *   own origin and bearer checks remain separate and authoritative.
 */
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { ServerResponse } from "node:http";
import type { Problem } from "@refyard/git-contract";
import { inlineScriptHashes, policyWithInlineScripts } from "./csp.js";

export interface AssetServer {
  /** Serve one path, or report why it cannot be. */
  serve(input: {
    readonly path: string;
    readonly response: ServerResponse;
    readonly headOnly: boolean;
  }): Promise<"served" | "not-found" | "refused">;
  root(): string | null;
}

export interface AssetServerOptions {
  /** Directory of the built web app; when absent, no static asset can be served. */
  readonly webRoot: string | null;
  /** Fallback document for client-side routes, e.g. `200.html`. */
  readonly fallbackDocument?: string;
  /**
   * A document served when there is no web build.
   *
   * The CLI ships before the Svelte app does, and a service that answers every
   * browser request with 503 looks broken. This page says what is true — the API is
   * running, the UI is not in this build — and is served only for document-shaped
   * paths, never for a missing asset or an API path.
  */
  readonly inlineDocument?: string;
  /** Exact API origins an embedding static host needs to call from its own origin. */
  readonly connectOrigins?: readonly string[];
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/**
 * Headers every HTML response carries.
 *
 * `default-src 'self'` plus `script-src 'self'` is what makes "no external CDN
 * script, no remote font" enforceable rather than aspirational; `object-src 'none'`
 * and `frame-ancestors 'none'` close the two ways a page can be made to load
 * something else. The default `connect-src 'self'` keeps the API same-origin, which
 * is also why there is no CORS header anywhere in this service. An embedding host can
 * opt into exact API origins without changing that default.
 *
 * Author avatars are the one cross-origin image: GitHub serves the photo for a
 * noreply commit email, fetched with no referrer and no credentials.
 */
export const HTML_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://github.com https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "x-frame-options": "DENY",
};

export function createAssetServer(options: AssetServerOptions): AssetServer {
  const fallback = options.fallbackDocument ?? "200.html";
  const htmlHeaders = headersWithConnectOrigins(options.connectOrigins);
  let resolvedRoot: string | null = null;
  let rootReady = false;
  /**
   * Per-document headers, keyed by the file's identity and not by its path.
   *
   * The policy names the hash of the document's own inline scripts, so it is only correct
   * for the bytes it was computed from. A packaged bundle does not change while the
   * service runs — but a development build does: `pnpm build` rewrites these files under
   * a running service, and a cache keyed by path alone would keep answering with the old
   * hash. The browser would then refuse the new document's inline bootstrap, and the app
   * would never start. mtime and size are what the filesystem changes on a rewrite.
   */
  const documentHeaderCache = new Map<
    string,
    {
      readonly mtimeMs: number;
      readonly size: number;
      readonly headers: Readonly<Record<string, string>>;
    }
  >();

  async function documentHeaders(
    absolutePath: string,
  ): Promise<Readonly<Record<string, string>>> {
    let stamp: { readonly mtimeMs: number; readonly size: number } | null =
      null;
    try {
      const info = await stat(absolutePath);
      stamp = { mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      // A document that cannot be stat-ed cannot be cached; the read below reports the
      // same failure with the strict policy.
      stamp = null;
    }
    const cached = documentHeaderCache.get(absolutePath);
    if (
      cached !== undefined &&
      stamp !== null &&
      cached.mtimeMs === stamp.mtimeMs &&
      cached.size === stamp.size
    ) {
      return cached.headers;
    }
    let headers: Readonly<Record<string, string>> = htmlHeaders;
    try {
      const html = await readFile(absolutePath, "utf8");
      const hashes = inlineScriptHashes(html);
      headers =
        hashes.length === 0
          ? HTML_HEADERS
          : {
              ...htmlHeaders,
              "content-security-policy": policyWithInlineScripts(
                htmlHeaders["content-security-policy"] ?? "",
                hashes,
              ),
            };
    } catch {
      // A document that cannot be read is served (or fails) with the strict policy; a
      // policy is not the place to report an I/O error.
      headers = htmlHeaders;
    }
    if (stamp !== null) {
      documentHeaderCache.set(absolutePath, { ...stamp, headers });
    }
    return headers;
  }

  /**
   * The resolved asset root, memoised until a request misses because of it.
   *
   * `refresh` drops the memo and resolves again. It is used once per request that could
   * not be answered — see `serve` — because `realpath` is what turns a symlinked web root
   * into an absolute path, and a rebuild that retargets the link (or replaces the
   * directory) leaves this process holding the old one forever: the app would answer
   * "not found" for its own shell until someone restarted the service.
   */
  async function assetRoot(refresh = false): Promise<string | null> {
    if (rootReady && !refresh) {
      return resolvedRoot;
    }
    rootReady = true;
    if (options.webRoot === null) {
      resolvedRoot = null;
      return null;
    }
    const previous = resolvedRoot;
    try {
      const info = await stat(options.webRoot);
      resolvedRoot = info.isDirectory()
        ? await realpath(options.webRoot)
        : null;
    } catch {
      resolvedRoot = null;
    }
    if (refresh && resolvedRoot === previous) {
      // Nothing changed: the miss was a genuine 404, not a stale root.
      return resolvedRoot;
    }
    return resolvedRoot;
  }

  async function resolveAsset(
    path: string,
  ): Promise<
    | { readonly kind: "file"; readonly absolutePath: string }
    | { readonly kind: "not-found" }
    | { readonly kind: "refused"; readonly problem: Problem }
  > {
    const root = await assetRoot();
    if (root === null) {
      return { kind: "not-found" };
    }
    if (path.includes("\u0000") || path.includes("%00")) {
      return {
        kind: "refused",
        problem: {
          code: "InvalidRequest",
          message: "the path contains a NUL byte",
          retryable: false,
        },
      };
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return {
        kind: "refused",
        problem: {
          code: "InvalidRequest",
          message: "the path is not valid percent-encoding",
          retryable: false,
        },
      };
    }
    if (
      decoded.includes("\u0000") ||
      decoded.includes(sep === "/" ? "\u0000" : "\\\u0000")
    ) {
      return {
        kind: "refused",
        problem: {
          code: "InvalidRequest",
          message: "the decoded path contains a NUL byte",
          retryable: false,
        },
      };
    }
    const candidate = normalize(join(root, decoded));
    // Lexical containment first (cheap, and catches `..`), then a realpath check
    // when the file exists (catches a symlink out of the bundle).
    if (candidate !== root && !candidate.startsWith(root + sep)) {
      return {
        kind: "refused",
        problem: {
          code: "Forbidden",
          message: "that path is outside the web assets",
          retryable: false,
        },
      };
    }
    try {
      const info = await stat(candidate);
      if (!info.isFile()) {
        return { kind: "not-found" };
      }
      const real = await realpath(candidate);
      if (real !== root && !real.startsWith(root + sep)) {
        return {
          kind: "refused",
          problem: {
            code: "Forbidden",
            message: "that asset resolves outside the web assets",
            retryable: false,
          },
        };
      }
      return { kind: "file", absolutePath: real };
    } catch {
      return { kind: "not-found" };
    }
  }

  async function sendFile(input: {
    readonly absolutePath: string;
    readonly response: ServerResponse;
    readonly headOnly: boolean;
    readonly isDocument: boolean;
  }): Promise<void> {
    const extension = extname(input.absolutePath).toLowerCase();
    const headers = input.isDocument
      ? await documentHeaders(input.absolutePath)
      : {
          "content-type":
            CONTENT_TYPES[extension] ?? "application/octet-stream",
          // Hashed asset names change when their contents change, so a short cache
          // is safe; the document itself is always revalidated.
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
        };
    for (const [name, value] of Object.entries(headers)) {
      input.response.setHeader(name, value);
    }
    if (input.headOnly) {
      input.response.writeHead(200);
      input.response.end();
      return;
    }
    input.response.writeHead(200);
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(input.absolutePath);
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.pipe(input.response);
    });
  }

  return {
    root(): string | null {
      return resolvedRoot;
    },

    async serve({
      path,
      response,
      headOnly,
    }): Promise<"served" | "not-found" | "refused"> {
      let resolved = await resolveAsset(path);
      if (resolved.kind === "not-found") {
        // The root is resolved once per process, so a rebuild that replaced it — or a
        // symlink that was retargeted at the new build — would leave this service
        // answering "not found" for its own shell until someone restarted it. One retry
        // after re-resolving is the difference between "the UI is gone" and "the next
        // request lands in the new build", and it costs a `stat` on a miss.
        const before = resolvedRoot;
        const after = await assetRoot(true);
        if (after !== null && after !== before) {
          resolved = await resolveAsset(path);
        }
      }
      if (resolved.kind === "refused") {
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.writeHead(
          resolved.problem.code === "Forbidden"
            ? 403
            : resolved.problem.code === "InvalidRequest"
              ? 400
              : 503,
        );
        response.end(JSON.stringify({ problem: resolved.problem }));
        return "refused";
      }
      if (resolved.kind === "file") {
        await sendFile({
          absolutePath: resolved.absolutePath,
          response,
          headOnly,
          isDocument: extname(resolved.absolutePath).toLowerCase() === ".html",
        });
        return "served";
      }

      // Not a file. A path that looks like an asset (or an API call) is a 404; only
      // a route-shaped path falls back to the app shell.
      const looksLikeAsset = /\.[A-Za-z0-9]+$/.test(path);
      if (looksLikeAsset || path.startsWith("/api/")) {
        return "not-found";
      }
      const root = await assetRoot();
      if (root === null) {
        if (options.inlineDocument === undefined) {
          return "not-found";
        }
        // No web build in this installation: answer a document request with a page
        // that says exactly that, instead of a 503 that reads like a failure.
        for (const [name, value] of Object.entries(htmlHeaders)) {
          response.setHeader(name, value);
        }
        response.writeHead(200);
        if (headOnly) {
          response.end();
        } else {
          response.end(options.inlineDocument);
        }
        return "served";
      }
      const fallbackPath = join(root, fallback);
      try {
        const info = await stat(fallbackPath);
        if (!info.isFile()) {
          return "not-found";
        }
      } catch {
        return "not-found";
      }
      await sendFile({
        absolutePath: fallbackPath,
        response,
        headOnly,
        isDocument: true,
      });
      return "served";
    },
  };
}

/** Add only exact configured API origins to the static document's connect policy. */
function headersWithConnectOrigins(
  origins: readonly string[] | undefined,
): Readonly<Record<string, string>> {
  const valid = [
    ...new Set((origins ?? []).filter((origin) => isHttpOrigin(origin))),
  ];
  if (valid.length === 0) {
    return HTML_HEADERS;
  }
  const policy = HTML_HEADERS["content-security-policy"] ?? "";
  return {
    ...HTML_HEADERS,
    "content-security-policy": policy.replace(
      "connect-src 'self'",
      `connect-src 'self' ${valid.join(" ")}`,
    ),
  };
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}
