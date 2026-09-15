/**
 * Rewrite the `$lib/…` alias imports that `shadcn-svelte add` generates into relative
 * imports, so `@refyard/git-ui` stays usable from any host.
 *
 * The CLI writes components whose imports use the consuming project's aliases (`$lib` is a
 * SvelteKit alias). This package is not a SvelteKit app on purpose — Kunkun and a native
 * host mount the same components — so after every `shadcn-svelte add` run this script makes
 * the new files self-contained. Run it from the repository root: `bun scripts/fix-shadcn-imports.ts`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = "packages/git-ui/src/components/ui";

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesIn(path)));
    } else if (/\.(svelte|ts)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

let rewritten = 0;
for (const path of await filesIn(ROOT)) {
  const source = await readFile(path, "utf8");
  // From `src/components/ui/<dir>/<file>`, `$lib/components/ui/<other>` is `../<other>`, and `$lib/` is `../../../lib/`.
  let updated = source.replaceAll(
    /\$lib\/components\/ui\//g,
    () =>
      `${relative(join(path, ".."), "packages/git-ui/src/components/ui").replaceAll("\\", "/")}/`,
  );
  updated = updated.replaceAll(
    /\$lib\//g,
    () =>
      `${relative(join(path, ".."), "packages/git-ui/src/lib").replaceAll("\\", "/")}/`,
  );
  // Also clean up any accidental ../../../lib/components/ui
  updated = updated.replaceAll(
    /\.\.\/\.\.\/\.\.\/lib\/components\/ui\//g,
    () =>
      `${relative(join(path, ".."), "packages/git-ui/src/components/ui").replaceAll("\\", "/")}/`,
  );
  if (updated !== source) {
    await writeFile(path, updated);
    rewritten += 1;
  }
}
console.log(`fix-shadcn-imports: rewrote ${rewritten} files under ${ROOT}`);
