/**
 * SvelteKit as a static SPA only, in two flavours of the same artifact.
 *
 * The `200.html` fallback build is what the Node host serves (it returns the fallback for
 * a client-side route) and what any static host can serve later. The `index.html` build is
 * what the desktop shell embeds: the Tauri asset protocol answers the root URL with
 * `index.html` and every later navigation is client-side, so a fallback file is not part
 * of that story.
 *
 * They also get separate working directories, because the two builds are expected to be
 * runnable at the same time — a browser test suite building the served artifact must not
 * be able to corrupt the one being embedded in an app bundle. `REFYARD_BUILD_TARGET` is
 * set by `scripts/build-desktop.ts`, which is the only caller that wants the second
 * flavour; everything else gets the served build.
 *
 * There are no server routes in this app by design: the Git API lives in the host, and
 * putting it in SvelteKit's server layer would split the authenticated surface in two.
 * `strict: true` turns a route that would need a server into a build error rather than a
 * surprise.
 */
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const forDesktop = process.env.REFYARD_BUILD_TARGET === "desktop";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: forDesktop ? "build-desktop" : "build",
      assets: forDesktop ? "build-desktop" : "build",
      fallback: forDesktop ? "index.html" : "200.html",
      strict: true,
      precompress: forDesktop ? false : true,
    }),
    outDir: forDesktop ? ".svelte-kit-desktop" : ".svelte-kit",
    // No CSRF setting is configured because there is no SvelteKit server surface to
    // protect: the app holds no cookies and never submits a form to a route. `strict:
    // true` above already turns a route that would need a server into a build error.
  },
};

export default config;
