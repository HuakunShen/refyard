/** Verifies that the published docs use the actual Refyard application branding. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(docsRoot, "dist");
const appAssets = join(docsRoot, "../web/static");

const home = readFileSync(join(distRoot, "index.html"), "utf8");
const docs = readFileSync(join(distRoot, "docs/index.html"), "utf8");
const demo = readFileSync(join(distRoot, "demo/index.html"), "utf8");

// Regression: the landing nav and footer once showed an invented Git glyph.
const brandMarks = home.match(/<img\b[^>]*class="showcase-mark"[^>]*src="\/refyard-mark\.svg"[^>]*>/g) ?? [];
assert.equal(brandMarks.length, 2, "Landing header and footer must display the app's real mark");

// Regression: the Fumadocs navigation previously displayed text with no product logo.
assert.match(docs, /<img\b[^>]*src="\/refyard-mark\.svg"[^>]*>/, "Docs navigation must display the app's real mark");

// Regression: the fullscreen sandbox had no branded browser tab icon.
for (const [name, html] of [["home", home], ["docs", docs], ["demo", demo]] as const) {
  assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?\s*>/, `${name} page must use the app favicon`);
}

// Regression: the marketing site previously shipped a different, handmade favicon.
for (const asset of ["favicon.svg", "refyard-mark.svg"]) {
  assert.deepEqual(
    readFileSync(join(distRoot, asset)),
    readFileSync(join(appAssets, asset)),
    `${asset} must be byte-for-byte identical to the application asset`,
  );
}

console.log("Refyard branding matches the product assets on all public entry points.");
