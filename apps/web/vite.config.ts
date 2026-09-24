/**
 * Vite configuration for the static app.
 *
 * Tailwind v4 runs as a Vite plugin (no PostCSS config, one CSS entry with
 * `@import "tailwindcss"`), and the SvelteKit plugin drives the rest. Paraglide compiles
 * the message catalogues that `packages/git-ui` holds, because that package owns the
 * workbench's strings and must not reach into this app for them.
 */
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

/** The i18n project lives with the components whose strings it carries. */
const gitUiRoot = resolve(import.meta.dirname, "../../packages/git-ui");

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    paraglideVitePlugin({
      project: resolve(gitUiRoot, "project.inlang"),
      outdir: resolve(gitUiRoot, "src/i18n/paraglide"),
      emitTsDeclarations: true,
      // A static SPA has no server to read a URL strategy from, so the locale is one
      // variable the app sets from its own persisted setting; `baseLocale` is the fallback
      // while nothing has set it.
      strategy: ["globalVariable", "baseLocale"],
    }),
  ],
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
