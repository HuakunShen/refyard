<script lang="ts">
  /** The dedicated Xross view entry; a missing native host is a visible refusal. */
  import { onMount } from "svelte";
  import { createGitViewI18n } from "@refyard/git-ui/lib/i18n/catalog";
  import type { XrossSession } from "$lib/workbench/xross-session.svelte.js";
  import { createXrossWorkbenchRuntime } from "$lib/runtime/bootstrap.js";
  import XrossWorkbench from "$lib/components/workbench/XrossWorkbench.svelte";

  const standalone = createGitViewI18n("en");
  let session = $state<XrossSession | null>(null);
  let problem = $state<string | null>(null);
  let loading = $state(true);

  async function connect(): Promise<void> {
    loading = true;
    problem = null;
    session = null;
    try {
      session = await createXrossWorkbenchRuntime().start();
    } catch (error) {
      problem = error instanceof Error ? error.message : standalone.t("xross.host.unavailable");
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void connect();
  });
</script>

<svelte:head>
  <title>{standalone.t("xross.title.label")}</title>
</svelte:head>

{#if loading}
  <main class="mx-auto max-w-5xl p-6" aria-live="polite">{standalone.t("xross.read.loading")}</main>
{:else if problem !== null}
  <main class="mx-auto max-w-5xl p-6" role="alert">
    <h1 class="text-xl font-semibold">{standalone.t("xross.title.label")}</h1>
    <p class="mt-3">{problem}</p>
    <button type="button" class="mt-4 rounded-md border px-3 py-2" onclick={() => void connect()}>{standalone.t("xross.read.retry")}</button>
  </main>
{:else if session !== null}
  <XrossWorkbench {session} onReconnect={connect} />
{/if}
