/**
 * The published documentation site.
 *
 * Generated with `pnpx create-fumadocs-app --template astro` and then adapted: Astro
 * rather than Next on purpose — this is a static site of prose, the build is vite, and
 * the output is plain HTML with a small React island for the Fumadocs shell. The
 * framework's own docs call the Astro integration partial support: the Fumadocs *UI* is
 * used as React islands and the content layer is Astro's Content Collections, wired into
 * `fumadocs-core` by `src/lib/source.ts`. Search is a static Orama index built at build
 * time, so the site needs no server.
 *
 * Nothing here is part of the product — `refyard` never loads this output — so the site
 * may use a toolchain the runtime may not (AGENTS.md §5: build-time JS tooling is
 * allowed, product runtimes are not).
 *
 * The site deploys to its own subdomain (docs.refyard.huakun.tech, a Cloudflare
 * worker over the built assets), so there is no `base`: every link is root-relative
 * and cannot lose a prefix. The GitHub Pages spelling lived here before and was
 * dropped with the domain move.
 */
// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import { unified } from "@astrojs/markdown-remark";
import {
  rehypeCode,
  remarkCodeTab,
  remarkHeading,
  remarkNpm,
  remarkStructure,
} from "fumadocs-core/mdx-plugins";

const remarkPlugins = [
  remarkHeading,
  remarkCodeTab,
  remarkNpm,
  [remarkStructure, { exportAs: "structuredData" }],
];
const rehypePlugins = [rehypeCode];

export default defineConfig({
  site: "https://docs.refyard.huakun.tech",
  markdown: {
    processor: unified({
      syntaxHighlight: false,
      remarkPlugins,
      rehypePlugins,
    }),
  },
  integrations: [
    react(),
    mdx({
      extendMarkdownConfig: true,
      syntaxHighlight: false,
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
