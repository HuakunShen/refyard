import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// The webview bundle: one IIFE the extension host injects into the panel, plus one CSS
// file it inlines. The Tailwind scan reaches into @refyard/git-ui's source the same way
// the web app's stylesheet does — without it, utilities used only by the components
// would be missing and the panel would render unstyled.
export default defineConfig({
  // Everything lives under webview/; the build is invoked from the package root.
  root: "webview",
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    lib: {
      entry: "main.ts",
      name: "refyardWebview",
      formats: ["iife"],
      fileName: () => "workbench.js",
    },
    cssCodeSplit: false,
  },
});
