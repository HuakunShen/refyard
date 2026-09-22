<script lang="ts">
  /**
   * Open pull requests from the repository's forge, and the one form that
   * creates the connection.
   *
   * The panel is deliberately quiet about what it cannot know: without a
   * connection it shows the token form and nothing else; without the provider
   * module the sidebar never mounts it at all. The token is a password field
   * that lives only in this component's state — it is sent once to the host,
   * which validates it against the forge before storing it privately, and no
   * storage on this side of the boundary ever sees it.
   */
  import type { ProviderConnection, ProviderPullRequest } from "@refyard/git-contract";
  import { GitPullRequest, RefreshCw } from "@lucide/svelte";
  import { Button } from "./ui/button/index.js";
  import AuthorAvatar from "./AuthorAvatar.svelte";
  import { cn } from "../lib/utils.js";

  interface Props {
    connections: readonly ProviderConnection[];
    pullRequests?: readonly ProviderPullRequest[] | undefined;
    /** `cache` answers carry the time they were fetched; the age is shown. */
    source?: "upstream" | "cache" | undefined;
    cachedAt?: string | null | undefined;
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    onConnect: (token: string) => void;
    onDisconnect: () => void;
    onRefresh: () => void;
  }

  let {
    connections,
    pullRequests,
    source,
    cachedAt,
    loading = false,
    busy = false,
    error = null,
    onConnect,
    onDisconnect,
    onRefresh,
  }: Props = $props();

  const connected = $derived(connections.length > 0);
  let tokenDraft = $state("");
  let age = $state("");

  /** A ticked relative age so cached data never pretends to be fresh. */
  function ageOf(cachedAtMs: number | null): string {
    if (cachedAtMs === null) {
      return "";
    }
    const seconds = Math.max(0, Math.round((Date.now() - cachedAtMs) / 1000));
    if (seconds < 60) {
      return `just now`;
    }
    if (seconds < 3600) {
      return `${Math.round(seconds / 60)} min ago`;
    }
    return `${Math.round(seconds / 3600)} h ago`;
  }

  $effect(() => {
    if (cachedAt === null || cachedAt === undefined) {
      age = "";
      return;
    }
    const update = (): void => {
      age = ageOf(Date.parse(cachedAt));
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  });

  function submit(): void {
    const token = tokenDraft.trim();
    if (token.length === 0 || busy) {
      return;
    }
    onConnect(token);
    tokenDraft = "";
  }
</script>

<div class="flex flex-col gap-2" data-testid="pull-requests-panel">
  {#if !connected}
    <p class="text-xs text-ink-muted">
      Connect a GitHub account to see this repository's open pull requests.
      The token stays on this machine's service.
    </p>
    <form
      class="flex flex-col gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        class="w-full rounded border bg-transparent px-2 py-1 font-mono text-xs"
        type="password"
        autocomplete="off"
        placeholder="GitHub token (github_pat_… or ghp_…)"
        aria-label="GitHub personal access token"
        bind:value={tokenDraft}
        data-testid="provider-token-input"
      />
      <Button size="sm" disabled={busy || tokenDraft.trim().length === 0} onclick={submit} data-testid="provider-connect">
        {busy ? "Connecting…" : "Connect GitHub"}
      </Button>
    </form>
  {:else}
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
        {connections.map((entry) => entry.accountLogin).join(", ")}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={onDisconnect}
        title="Disconnect this account"
        data-testid="provider-disconnect"
      >
        <GitPullRequest class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={onRefresh}
        title="Refresh pull requests"
        data-testid="provider-refresh"
      >
        <RefreshCw class={cn("size-3.5", busy && "animate-spin")} />
      </Button>
    </div>
  {/if}

  {#if error !== null}
    <p class="text-xs text-warn" data-testid="provider-error">{error}</p>
  {/if}

  {#if connected}
    {#if loading && pullRequests === undefined}
      <p class="text-xs text-ink-muted">Reading pull requests…</p>
    {:else if pullRequests !== undefined && pullRequests.length === 0}
      <p class="text-xs text-ink-muted">No open pull requests.</p>
    {:else if pullRequests !== undefined}
      <ul class="flex flex-col gap-1" data-testid="provider-pull-requests">
        {#each pullRequests as pull (pull.number)}
          <li>
            <a
              class="flex items-center gap-2 rounded px-1 py-1 hover:bg-canvas-hover"
              href={pull.url}
              target="_blank"
              rel="noreferrer"
              data-testid={`provider-pull-${pull.number}`}
            >
              <AuthorAvatar
                email={`${pull.authorLogin}@users.noreply.github.com`}
                name={pull.authorLogin}
                size={16}
              />
              <span class="min-w-0 flex-1 truncate text-xs">
                <span class="font-mono text-ink-faint">#{pull.number}</span>
                {pull.title}
                {#if pull.isDraft}
                  <span class="ml-1 rounded bg-canvas-hover px-1 text-[10px] uppercase text-ink-faint">draft</span>
                {/if}
              </span>
              <span class="shrink-0 font-mono text-[10px] text-ink-faint">
                {pull.headRef}
              </span>
            </a>
          </li>
        {/each}
      </ul>
      <p class="text-[10px] text-ink-faint">
        {source === "cache" && age.length > 0 ? `read ${age} (cached)` : "live from GitHub"}
      </p>
    {/if}
  {/if}
</div>
