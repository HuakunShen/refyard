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

  /**
   * Accept a bare ticket or a full pairing URL in either spelling.
   *
   * A URL is the thing the CLI actually prints, so pasting one must work: the ticket is
   * lifted from the query string first, then the fragment, and anything else is taken as
   * the ticket itself.
   */
  function acceptTicket(raw: string): void {
    const trimmed = raw.trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        const fromUrl =
          clean(url.searchParams.get("pair")) ??
          clean(url.searchParams.get("ticket")) ??
          clean(
            url.hash.length > 1
              ? (new URLSearchParams(url.hash.slice(1)).get("pair") ??
                  new URLSearchParams(url.hash.slice(1)).get("ticket"))
              : null,
          );
        if (fromUrl !== null) {
          onTicket(fromUrl);
          return;
        }
      } catch {
        // Not a parseable URL after all; treat the text as a bare ticket below.
      }
    }
    onTicket(trimmed);
  }

  function clean(value: string | null): string | null {
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
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
      hint="Paste the pairing URL (any spelling) or just its ticket. It is single use and expires after 60 seconds."
      value={ticket}
      placeholder="http://127.0.0.1:47831/?pair=…"
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
