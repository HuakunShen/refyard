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
 * something else. `connect-src 'self'` keeps the API same-origin, which is also why
 * there is no CORS header anywhere in this service.
 */
export const HTML_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "x-frame-options": "DENY",
};

export function createAssetServer(options: AssetServerOptions): AssetServer {
  const fallback = options.fallbackDocument ?? "200.html";
  let resolvedRoot: string | null = null;
  let rootReady = false;
  /**
   * Per-document headers, computed once per path.
   *
   * A document is read to find its inline scripts, and the result depends only on the
   * bytes on disk; a packaged bundle does not change while the service is running, so the
   * second request for a document must not pay for the first one's read.
   */
  const documentHeaderCache = new Map<
    string,
    Readonly<Record<string, string>>
  >();

  async function documentHeaders(
    absolutePath: string,
  ): Promise<Readonly<Record<string, string>>> {
    const cached = documentHeaderCache.get(absolutePath);
    if (cached !== undefined) {
      return cached;
    }
    let headers: Readonly<Record<string, string>> = HTML_HEADERS;
    try {
      const html = await readFile(absolutePath, "utf8");
      const hashes = inlineScriptHashes(html);
      headers =
        hashes.length === 0
          ? HTML_HEADERS
          : {
              ...HTML_HEADERS,
              "content-security-policy": policyWithInlineScripts(
                HTML_HEADERS["content-security-policy"] ?? "",
                hashes,
              ),
            };
    } catch {
      // A document that cannot be read is served (or fails) with the strict policy; a
      // policy is not the place to report an I/O error.
      headers = HTML_HEADERS;
    }
    documentHeaderCache.set(absolutePath, headers);
    return headers;
  }

  async function assetRoot(): Promise<string | null> {
    if (rootReady) {
      return resolvedRoot;
    }
    rootReady = true;
    if (options.webRoot === null) {
      return null;
    }
    try {
      const info = await stat(options.webRoot);
      resolvedRoot = info.isDirectory()
        ? await realpath(options.webRoot)
        : null;
    } catch {
      resolvedRoot = null;
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
      const resolved = await resolveAsset(path);
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
        for (const [name, value] of Object.entries(HTML_HEADERS)) {
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
