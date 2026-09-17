/**
 * Vite configuration for the static app.
 *
 * Tailwind v4 runs as a Vite plugin (no PostCSS config, one CSS entry with
 * `@import "tailwindcss"`), and the SvelteKit plugin drives the rest.
 */
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    // The host serves these names directly; a stable directory name makes the
    // hosting rules (hashed assets are cacheable, the document is not) easy to state.
    assetsDir: "_app/immutable",
  },
});
