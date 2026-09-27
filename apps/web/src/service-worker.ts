/// <reference types="@sveltejs/kit" />
/**
 * The service worker: an offline app shell, and nothing else.
 *
 * The rules it exists to enforce:
 *
 * - **Only this build's own assets are cached**, and the cache is keyed by the build
 *   version, so a new build never serves the previous one's modules and the old cache
 *   is deleted on activation. `$service-worker` gives exactly those lists.
 * - **`/api` is never cached and never served from cache**, for any method. A stale Git
 *   read is a lie about the repository, and a cached mutation response would tell a UI
 *   an operation succeeded when nothing ran. Requests under `/api` are left entirely to
 *   the network — this worker does not even call `respondWith` for them.
 * - **No background sync, no push, no periodic work.** A write is never deferred to a
 *   moment when the user is not looking; the page refuses while offline and says so.
 * - **A navigation falls back to the cached shell**, which is what makes a reload while
 *   offline show "not connected" instead of the browser's error page.
 */
import { build, files, version } from "$service-worker";

const CACHE = `refyard-shell-${version}`;
/**
 * The shell: this build's JS/CSS, the static files, and the two documents.
 *
 * `build` and `files` are versioned by the build; the documents are not in either list —
 * adapter-static writes them as the prerendered page and its `200.html` fallback — so they
 * are named here. Without them a reload while offline has nothing to fall back to, which
 * is how this was found: the offline reload failed with `net::ERR_FAILED`.
 */
const SHELL = [...build, ...files];
const xrossHosted = import.meta.env.VITE_REFYARD_BUILD_TARGET === "xross-hosted";
const DOCUMENTS = xrossHosted ? ["/xross/index.html", "/200.html"] : ["/index.html", "/200.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Individually, so a missing document cannot fail the whole install the way
      // `addAll` would.
      await Promise.allSettled(
        DOCUMENTS.map((document) => cache.add(document)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // The API and the session exchange are the service's, not this cache's.
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  // Only same-origin GETs are cacheable at all, and only this app's own responses.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // A navigation is answered from the cached shell when the network is gone: the page
  // then reports its own connection state, which is more useful than the browser's.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(xrossHosted ? "/xross/index.html" : "/index.html");
        return cached ?? Response.error();
      }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached !== undefined) {
        return cached;
      }
      return fetch(request);
    }),
  );
});
