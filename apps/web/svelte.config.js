/**
 * SvelteKit as a static SPA with separate browser, desktop, and Xross outputs.
 *
 * The `200.html` fallback build is what the Node host serves (it returns the fallback for
 * a client-side route) and what any static host can serve later. The `index.html` build is
 * what the desktop shell embeds: the Tauri asset protocol answers the root URL with
 * `index.html` and every later navigation is client-side, so a fallback file is not part
 * of that story.
 *
 * They also get separate working directories, because the builds are expected to be
 * runnable at the same time — a browser test suite building the served artifact must not be
 * able to corrupt the one being embedded in an app bundle. `REFYARD_BUILD_TARGET` is set by
 * the desktop and Xross build scripts; everything else gets the served browser build.
 *
 * There are no server routes in this app by design: the Git API lives in the host, and
 * putting it in SvelteKit's server layer would split the authenticated surface in two.
 * `strict: true` turns a route that would need a server into a build error rather than a
 * surprise.
 */
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const target = process.env.REFYARD_BUILD_TARGET ?? "web";
const forDesktop = target === "desktop";
const forXrossLocal = target === "xross-local";
const output =
  {
    desktop: "build-desktop",
    "xross-local": "build-xross-local",
    "xross-hosted": "build-xross-hosted",
  }[target] ?? "build";
const working =
  {
    desktop: ".svelte-kit-desktop",
    "xross-local": ".svelte-kit-xross-local",
    "xross-hosted": ".svelte-kit-xross-hosted",
  }[target] ?? ".svelte-kit";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: output,
      assets: output,
      fallback: forDesktop || forXrossLocal ? "index.html" : "200.html",
      strict: true,
      precompress: !forDesktop && !forXrossLocal,
    }),
    outDir: working,
    serviceWorker: {
      // The desktop shell loads over the tauri:// scheme, where the spec forbids
      // service workers — SvelteKit's auto-register would throw on every launch. The local
      // Xross UI shares that origin behavior.
      register: !forDesktop,
    },
    // No CSRF setting is configured because there is no SvelteKit server surface to
    // protect: the app holds no cookies and never submits a form to a route. `strict:
    // true` above already turns a route that would need a server into a build error.
  },
};

export default config;
