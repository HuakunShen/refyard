import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsPage, type DocsPageProps } from "fumadocs-ui/layouts/docs/page";
import type { Root } from "fumadocs-core/page-tree";
import type { ReactNode } from "react";
import { navigate } from "astro:transitions/client";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { AstroProviderProps } from "fumadocs-core/framework/astro";
import SearchDialog from "./search";

/**
 * The Fumadocs shell for every page.
 *
 * The generated template hardcoded a dark body and turned the theme switch off; this
 * site keeps both themes — the product ships both and a reader's OS preference should be
 * honoured — so the provider owns the theme and the switch stays enabled.
 */
export function Docs({
  tree,
  children,
  pathname,
  params,
  page,
}: {
  tree: Root;
  children: ReactNode;
  pathname: string;
  params: AstroProviderProps["params"];
  page?: DocsPageProps;
}) {
  return (
    <RootProvider
      pathname={pathname}
      params={params}
      navigate={navigate}
      search={{ SearchDialog }}
    >
      <DocsLayout
        tree={tree}
        nav={{
          title: "Refyard",
          url: "/",
          transparentMode: "top",
        }}
        links={[
          {
            text: "GitHub",
            url: "https://github.com/HuakunShen/refyard",
            external: true,
          },
          {
            text: "npm",
            url: "https://www.npmjs.com/package/refyard",
            external: true,
          },
        ]}
      >
        <DocsPage {...page}>{children}</DocsPage>
      </DocsLayout>
    </RootProvider>
  );
}
