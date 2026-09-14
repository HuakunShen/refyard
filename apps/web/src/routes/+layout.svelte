<script lang="ts">
  /**
   * The app shell: styles, a query client, and nothing else.
   *
   * SvelteKit's layout exists here to own two things the core UI package must not know
   * about — the stylesheet and the data-cache client — and to render its child route.
   *
   * `retry: false` is deliberate. A failed Git read is reported with its problem code;
   * retrying it automatically would hide the reason and, for a repository that has been
   * removed from the disk, would keep asking. `staleTime` is short because another program
   * on this machine can change the repository at any moment, and the SSE stream is what
   * tells this app when that happened.
   */
  import "../app.css";
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
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
