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

  interface DeviceConnectState {
    readonly state: "idle" | "awaiting-user" | "connected" | "denied" | "expired" | "failed";
    readonly userCode?: string;
    readonly verificationUri?: string;
    readonly message?: string;
  }

  interface Props {
    connections: readonly ProviderConnection[];
    pullRequests?: readonly ProviderPullRequest[] | undefined;
    /** `cache` answers carry the time they were fetched; the age is shown. */
    source?: "upstream" | "cache" | undefined;
    cachedAt?: string | null | undefined;
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    /** The host-side device exchange snapshot; absent from older hosts. */
    deviceState?: DeviceConnectState | null | undefined;
    onStartDeviceConnect: () => void;
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
    deviceState = null,
    onStartDeviceConnect,
    onConnect,
    onDisconnect,
    onRefresh,
  }: Props = $props();

  let showingTokenForm = $state(false);

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
    {#if deviceState?.state === "awaiting-user" && deviceState.userCode !== undefined}
      <div class="flex flex-col gap-2" data-testid="provider-device-awaiting">
        <p class="text-xs text-ink-muted">
          Enter this code at
          <a
            class="underline"
            href={deviceState.verificationUri ?? "https://github.com/login/device"}
            target="_blank"
            rel="noreferrer"
            data-testid="provider-device-link"
          >
            github.com/login/device
          </a>
        </p>
        <p
          class="self-start rounded border px-3 py-1.5 font-mono text-lg tracking-widest select-all"
          data-testid="provider-device-code"
        >
          {deviceState.userCode}
        </p>
        <p class="text-xs text-ink-faint">Waiting for authorization…</p>
      </div>
    {:else}
      <p class="text-xs text-ink-muted">
        Connect a GitHub account to see this repository's open pull requests.
        The token stays on this machine's service.
      </p>
      <Button
        size="sm"
        disabled={busy}
        onclick={onStartDeviceConnect}
        data-testid="provider-device-start"
      >
        {busy ? "Connecting…" : "Connect GitHub"}
      </Button>
      {#if deviceState?.state === "failed" || deviceState?.state === "denied"}
        <p class="text-xs text-warn" data-testid="provider-device-error">
          {deviceState.message ?? "GitHub denied the request."}
        </p>
      {/if}
      {#if showingTokenForm}
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
            {busy ? "Connecting…" : "Connect with token"}
          </Button>
        </form>
      {:else}
        <button
          class="self-start text-xs text-ink-faint underline"
          onclick={() => (showingTokenForm = true)}
          data-testid="provider-token-toggle"
        >
          use a personal access token instead
        </button>
      {/if}
    {/if}
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
