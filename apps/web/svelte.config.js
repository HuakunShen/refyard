/**
 * SvelteKit as a static SPA only, in three flavours of the same artifact.
 *
 * The `200.html` fallback build is what the Node host serves (it returns the fallback for
 * a client-side route) and what any static host can serve later. The `index.html` build is
 * what the desktop shell embeds: the Tauri asset protocol answers the root URL with
 * `index.html` and every later navigation is client-side, so a fallback file is not part
 * of that story. The `dsh` build is the one an embedding host serves under a path prefix,
 * beside its own routes.
 *
 * They also get separate working directories, because the builds are expected to be
 * runnable at the same time — a browser test suite building the served artifact must not be
 * able to corrupt the one being embedded in an app bundle. `REFYARD_BUILD_TARGET` is set by
 * `scripts/build-desktop.ts` and `scripts/build-dsh-plugin.ts`, which are the only callers
 * that want the other two flavours; everything else gets the served build.
 *
 * The embedded flavour differs in exactly two ways, and both are forced by where it runs:
 *
 * - **`paths.base`** is the prefix the host mounts it under (both sides read it from
 *   `REFYARD_EMBED_BASE`, so a mount point cannot be renamed in one place only). Without it
 *   the document's absolute asset URLs would leave the mount and hit the host's own routes.
 * - **no service worker.** Its scope is `/`, so a registered worker would intercept the
 *   host's own requests from inside the frame — the GUI's own traffic would start flowing
 *   through the embedded app's cache.
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
const forEmbed = target === "dsh";
const outDir = forDesktop ? "build-desktop" : forEmbed ? "build-dsh" : "build";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: outDir,
      assets: outDir,
      fallback: forDesktop ? "index.html" : "200.html",
      strict: true,
      precompress: forDesktop ? false : true,
    }),
    paths: {
      base: forEmbed ? (process.env.REFYARD_EMBED_BASE ?? "") : "",
    },
    outDir: forDesktop
      ? ".svelte-kit-desktop"
      : forEmbed
        ? ".svelte-kit-dsh"
        : ".svelte-kit",
    serviceWorker: {
      // The desktop shell loads over the tauri:// scheme, where the spec forbids
      // service workers — SvelteKit's auto-register would throw on every launch. The
      // embedded flavour must not register either, for the scope reason above. The
      // browser and Cloudflare flavours keep the PWA registration.
      register: !forDesktop && !forEmbed,
    },
    // No CSRF setting is configured because there is no SvelteKit server surface to
    // protect: the app holds no cookies and never submits a form to a route. `strict:
    // true` above already turns a route that would need a server into a build error.
  },
};

export default config;
