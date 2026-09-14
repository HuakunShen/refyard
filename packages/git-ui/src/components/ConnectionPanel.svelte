<script lang="ts">
  /**
   * Pairing the page with a running service.
   *
   * The form takes a *ticket*, not a password: the CLI prints a URL whose fragment
   * carries a single-use, 60-second ticket, and the fragment is never sent to a server
   * by the browser. Pasting the whole URL is therefore expected and is handled — the
   * component extracts the fragment itself so a user cannot be told "invalid ticket"
   * for pasting the thing the CLI actually printed.
   *
   * The service address defaults to this page's own origin, because the service serving
   * the page is the service that will answer; a different address is only for the case
   * where the UI is loaded from elsewhere.
   */
  import Badge from "../ui/Badge.svelte";
  import Button from "../ui/Button.svelte";
  import Input from "../ui/Input.svelte";
  import StateBanner from "./StateBanner.svelte";

  interface Props {
    baseUrl: string;
    ticket: string;
    phase: "idle" | "connecting" | "failed";
    message?: string;
    /** True when the service address came from this page's own origin. */
    baseUrlIsDefault: boolean;
    onBaseUrl: (value: string) => void;
    onTicket: (value: string) => void;
    onConnect: () => void;
  }

  let {
    baseUrl,
    ticket,
    phase,
    message,
    baseUrlIsDefault,
    onBaseUrl,
    onTicket,
    onConnect,
  }: Props = $props();

  /** Accept a bare ticket or a full pairing URL; the fragment is the part that matters. */
  function acceptTicket(raw: string): void {
    const trimmed = raw.trim();
    const hashIndex = trimmed.indexOf("#");
    if (hashIndex !== -1) {
      const fragment = new URLSearchParams(trimmed.slice(hashIndex + 1));
      const fromFragment = fragment.get("pair") ?? fragment.get("ticket");
      if (fromFragment !== null && fromFragment.length > 0) {
        onTicket(fromFragment);
        return;
      }
    }
    onTicket(trimmed);
  }
</script>

<section class="mx-auto flex w-full max-w-xl flex-col gap-4">
  <header class="flex flex-col gap-1">
    <h1 class="text-lg font-semibold text-ink">Connect to the local service</h1>
    <p class="text-sm text-ink-muted">
      The service runs on this machine and reads repositories you approved when
      you started it. Reads are authenticated, so the page needs the ticket the
      CLI printed.
    </p>
  </header>

  <div class="flex flex-col gap-4 rounded-lg border border-border bg-panel p-4">
    <Input
      id="refyard-base-url"
      label="Service address"
      hint={baseUrlIsDefault
        ? "Taken from this page's origin — the service that served this page."
        : "Overridden for this browser; clear it to fall back to this page's origin."}
      value={baseUrl}
      placeholder="http://127.0.0.1:47831"
      oninput={onBaseUrl}
    />

    <Input
      id="refyard-ticket"
      label="Pairing ticket"
      hint="Paste the pairing URL or just its ticket. It is single use and expires after 60 seconds."
      value={ticket}
      placeholder="http://127.0.0.1:47831/#pair=…"
      monospace
      oninput={acceptTicket}
      onsubmit={onConnect}
    />

    <div class="flex items-center gap-3">
      <Button
        variant="primary"
        disabled={phase === "connecting" || ticket.length === 0}
        onclick={onConnect}
      >
        {phase === "connecting" ? "Pairing…" : "Pair"}
      </Button>
      {#if baseUrlIsDefault}
        <Badge tone="muted">same origin</Badge>
      {/if}
    </div>
  </div>

  {#if phase === "failed"}
    <StateBanner
      state="error"
      title="Pairing failed"
      detail={message ??
        "The ticket may have expired, already been used, or belong to a different service instance."}
    />
  {/if}

  <p class="text-xs text-ink-faint">
    Run <code class="font-mono">refyard open &lt;path&gt;</code> in the repository
    you want to read. The ticket is exchanged for an in-memory session and this page
    clears the fragment from the address bar.
  </p>
</section>
