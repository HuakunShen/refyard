/**
 * SvelteKit as a static SPA with separate browser, desktop, and Xross outputs.
 *
 * The `200.html` fallback build is what the Node host serves (it returns the fallback for
 * a client-side route) and what any static host can serve later. The `index.html` build is
 * what the desktop shell embeds: the Tauri asset protocol answers the root URL with
 * `index.html` and every later navigation is client-side, so a fallback file is not part
 * of that story.
 *
 * They also get separate working directories so concurrently built artifacts do not
 * overwrite each other's route manifests. `REFYARD_BUILD_TARGET` is set by the desktop
 * and Xross build scripts; everything else gets the served browser build.
 *
 * There are no server routes in this app by design: the Git API lives in the host, and
 * putting it in SvelteKit's server layer would split the authenticated surface in two.
 * `strict: true` turns a route that would need a server into a build error rather than a
 * surprise.
 */
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const target = process.env.REFYARD_BUILD_TARGET;
const forDesktop = target === "desktop";
const forXrossLocal = target === "xross-local";
const forXrossHosted = target === "xross-hosted";
const output = forDesktop ? "build-desktop" : forXrossLocal ? "build-xross-local" : forXrossHosted ? "build-xross-hosted" : "build";
const working = forDesktop ? ".svelte-kit-desktop" : forXrossLocal ? ".svelte-kit-xross-local" : forXrossHosted ? ".svelte-kit-xross-hosted" : ".svelte-kit";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: output,
      assets: output,
      fallback: forDesktop || forXrossLocal ? "index.html" : "200.html",
      strict: true,
      precompress: forDesktop || forXrossLocal ? false : true,
    }),
    outDir: working,
    serviceWorker: {
      // The desktop shell loads over the tauri:// scheme, where the spec forbids
      // service workers — SvelteKit's auto-register would throw on every launch.
      // The browser and Cloudflare flavours keep the PWA registration.
      register: !forDesktop && !forXrossLocal,
    },
    // No CSRF setting is configured because there is no SvelteKit server surface to
    // protect: the app holds no cookies and never submits a form to a route. `strict:
    // true` above already turns a route that would need a server into a build error.
  },
};

export default config;
