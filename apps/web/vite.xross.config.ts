/** A separate Vite graph: SvelteKit's root route and session transports never enter this pack. */
import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const mode = process.env.REFYARD_BUILD_TARGET;
if (mode !== "xross-local" && mode !== "xross-hosted") {
  throw new Error("REFYARD_BUILD_TARGET must be xross-local or xross-hosted");
}

const forbiddenGraphPaths = [
  /\/apps\/web\/src\/routes\/\+page\.svelte$/,
  /\/apps\/web\/src\/lib\/runtime\/(?:bootstrap|backend-registry)\.ts$/,
  /\/apps\/web\/src\/lib\/(?:connection|workbench\/session)\.ts$/,
  /\/packages\/backend-(?:http|tauri)\//,
  /\/apps\/web\/src\/service-worker\.ts$/,
];
const isolatedGraph: Plugin = {
  name: "refyard-xross-isolated-graph",
  generateBundle(_options, bundle) {
    for (const output of Object.values(bundle)) {
      if (output.type !== "chunk") continue;
      for (const source of Object.keys(output.modules)) {
        if (forbiddenGraphPaths.some((pattern) => pattern.test(source))) {
          throw new Error(`legacy browser/desktop module entered Xross pack: ${source}`);
        }
      }
    }
  },
};

export default defineConfig({
  base: "./",
  publicDir: false,
  resolve: { alias: { $lib: resolve(import.meta.dirname, "src/lib") } },
  plugins: [tailwindcss(), svelte(), isolatedGraph],
  build: {
    outDir: mode === "xross-local" ? "build-xross-local" : "build-xross-hosted",
    emptyOutDir: true,
    assetsDir: "_app/immutable",
    rollupOptions: { input: resolve(import.meta.dirname, "xross/index.html") },
  },
});
