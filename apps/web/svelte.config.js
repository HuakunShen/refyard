/**
 * SvelteKit as a static SPA only.
 *
 * `adapter-static` with a `200.html` fallback is what lets one artifact be served by
 * the Node host (which returns the fallback for a client-side route) and by any
 * static host later. `strict: true` makes a route that would need a server a build
 * error rather than a surprise, and `precompress` writes the `.br`/`.gz` variants
 * the host can serve when a client asks for them.
 *
 * There are no server routes in this app by design: the Git API lives in the Node
 * host, and putting it in SvelteKit's server layer would split the authenticated
 * surface in two.
 */
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "200.html",
      strict: true,
      precompress: true,
    }),
    // No CSRF setting is configured because there is no SvelteKit server surface to
    // protect: the app holds no cookies, it talks to the API with a bearer token, and it
    // never submits a form to a route. `strict: true` above already turns a route that
    // would need a server into a build error.
  },
};

export default config;
