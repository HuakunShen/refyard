<script lang="ts">
  /**
   * Pairing the page with a running service.
   *
   * The form takes a *ticket*, not a password: the CLI prints a URL that carries a
   * single-use, 60-second ticket, and the page pairs itself on load. Pasting the whole
   * URL is therefore expected and is handled — the component extracts the ticket itself
   * so a user cannot be told "invalid ticket" for pasting the thing the CLI actually
   * printed.
   *
   * The service address defaults to this page's own origin, because the service serving
   * the page is the service that will answer; a different address is only for the case
   * where the UI is loaded from elsewhere.
   *
   * The fields are assembled from the generated shadcn `Input` rather than being a
   * hand-written component of their own: a label, the input, and a hint line.
   */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { Card, CardContent } from "./ui/card/index.js";
  import { Input } from "./ui/input/index.js";
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

  /** The text of an input element, without casting: narrow, then read. */
  function inputText(element: EventTarget | null): string {
    return element instanceof HTMLInputElement ? element.value : "";
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

  <Card>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium text-ink-muted"
          for="refyard-base-url"
        >
          Service address
        </label>
        <Input
          id="refyard-base-url"
          placeholder="http://127.0.0.1:47831"
          value={baseUrl}
          oninput={(event: Event) => onBaseUrl(inputText(event.currentTarget))}
        />
        <p class="text-xs text-ink-faint">
          {baseUrlIsDefault
            ? "Taken from this page's origin — the service that served this page."
            : "Overridden for this browser; clear it to fall back to this page's origin."}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-ink-muted" for="refyard-ticket">
          Pairing ticket
        </label>
        <Input
          id="refyard-ticket"
          placeholder="http://127.0.0.1:47831/?pair=…"
          class="font-mono text-xs"
          value={ticket}
          oninput={(event: Event) =>
            acceptTicket(inputText(event.currentTarget))}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === "Enter") {
              onConnect();
            }
          }}
        />
        <p class="text-xs text-ink-faint">
          Paste the pairing URL (any spelling) or just its ticket. It is single
          use and expires after 60 seconds.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <Button
          disabled={phase === "connecting" || ticket.length === 0}
          onclick={onConnect}
        >
          {phase === "connecting" ? "Pairing…" : "Pair"}
        </Button>
        {#if baseUrlIsDefault}
          <Badge variant="secondary">same origin</Badge>
        {/if}
      </div>
    </CardContent>
  </Card>

  {#if phase === "failed"}
    <StateBanner
      state="error"
      title="Pairing failed"
      detail={message ??
        "The ticket may have expired, already been used, or belong to a different service instance."}
    />
  {/if}

  <div
    class="flex flex-col gap-2 rounded-lg border border-border/70 bg-panel/50 p-3.5 text-xs text-ink-muted"
  >
    <div class="flex items-center gap-1.5 font-medium text-ink">
      <span>💡 How to get a fresh pairing link</span>
    </div>
    <ul class="list-disc space-y-1 pl-4 text-ink-muted">
      <li>
        If Refyard is running in your terminal, press <kbd
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >p</kbd
        > + <kbd
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >Enter</kbd
        > to print a fresh single-use pairing URL.
      </li>
      <li>
        Or run <code class="font-mono text-ink">refyard open &lt;path&gt;</code>
        in the repository you want to inspect.
      </li>
      <li>
        Once paired, your session is remembered in this browser, so reopening or opening new tabs will connect automatically without requiring a ticket.
      </li>
    </ul>
  </div>
</section>
