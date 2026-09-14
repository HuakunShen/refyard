/**
 * A minimal Svelte config so the package can be type-checked and, later, unit-tested with
 * a DOM harness by whoever consumes it.
 *
 * There is no `kit` block: this package is a component library with no routes, and the
 * whole point of it is that only `apps/web` knows about SvelteKit.
 */
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
