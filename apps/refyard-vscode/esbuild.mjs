import esbuild from "esbuild";

// The extension host bundle: CommonJS for VS Code's Node runtime, `vscode` provided by
// the editor itself, everything else (the workspace git packages, zod) bundled in.
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: true,
  logLevel: "info",
});
