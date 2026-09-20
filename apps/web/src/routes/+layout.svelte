<script lang="ts">
  /**
   * The app shell: styles, the theme watcher, a query client, and nothing else.
   *
   * SvelteKit's layout exists here to own three things the core UI package must not know
   * about — the stylesheet, dark-mode plumbing, and the data-cache client — and to render
   * its child route.
   *
   * `<ModeWatcher />` is shadcn-svelte's dark-mode recipe: it owns the `dark` class on
   * `<html>` (light/dark/system, persisted per browser) that the theme tokens and Tailwind's
   * `dark:` variant both key off.
   *
   * `retry: false` on queries is deliberate. A failed Git read is reported with its problem
   * code; retrying it automatically would hide the reason and, for a repository that has
   * been removed from the disk, would keep asking. `staleTime` is short because another
   * program on this machine can change the repository at any moment, and the SSE stream is
   * what tells this app when that happened.
   */
  import "../app.css";
  import { ModeWatcher } from "mode-watcher";
  import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import type { Snippet } from "svelte";

  const { children }: { children: Snippet } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 2_000,
      },
    },
  });

  /**
   * The WebView's default context menu (Reload and friends) is not part of this
   * app's interface, and right-click is a real gesture here — every commit row
   * and ref label has its own menu. Text still needs the native menu for
   * copy/paste, so editable targets keep it.
   */
  function suppressContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable]")
    ) {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:document oncontextmenu={suppressContextMenu} />

<QueryClientProvider client={queryClient}>
  <ModeWatcher />
  {@render children()}
</QueryClientProvider>
