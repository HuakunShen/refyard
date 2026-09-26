<script lang="ts">
  /**
   * Pairing the page with a running service.
   *
   * The normal form takes a *ticket*: the CLI prints a URL that carries a single-use,
   * 60-second ticket, and the page pairs itself on load. A separately hosted service may
   * also require a second password, which is typed for this exchange only and never
   * stored by the component.
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
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  interface Props {
    baseUrl: string;
    ticket: string;
    hosted: boolean;
    password: string;
    phase: "idle" | "connecting" | "failed";
    message?: string;
    /** True when the service address came from this page's own origin. */
    baseUrlIsDefault: boolean;
    onBaseUrl: (value: string) => void;
    onTicket: (value: string) => void;
    onPassword: (value: string) => void;
    onConnect: () => void;
  }

  let {
    baseUrl,
    ticket,
    hosted,
    password,
    phase,
    message,
    baseUrlIsDefault,
    onBaseUrl,
    onTicket,
    onPassword,
    onConnect,
  }: Props = $props();
  const { t } = useGitViewI18n();

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
    <h1 class="text-lg font-semibold text-ink">{t("connection.title")}</h1>
    <p class="text-sm text-ink-muted">
      {t("connection.description")}
    </p>
  </header>

  <Card>
    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label
          class="text-xs font-medium text-ink-muted"
          for="refyard-base-url"
        >
          {t("connection.address")}
        </label>
        <Input
          id="refyard-base-url"
          placeholder={t("connection.addressExample")}
          value={baseUrl}
          oninput={(event: Event) => onBaseUrl(inputText(event.currentTarget))}
        />
        <p class="text-xs text-ink-faint">
          {baseUrlIsDefault
            ? t("connection.addressDefault")
            : t("connection.addressOverride")}
        </p>
      </div>

      {#if hosted}
        <div class="flex flex-col gap-1">
          <label
            class="text-xs font-medium text-ink-muted"
            for="refyard-hosted-password"
          >
            {t("connection.password")}
          </label>
          <Input
            id="refyard-hosted-password"
            type="password"
            autocomplete="current-password"
            placeholder={t("connection.passwordPlaceholder")}
            value={password}
            oninput={(event: Event) =>
              onPassword(inputText(event.currentTarget))}
            onkeydown={(event: KeyboardEvent) => {
              if (event.key === "Enter") {
                onConnect();
              }
            }}
          />
          <p class="text-xs text-ink-faint">
            {t("connection.passwordHelp")}
          </p>
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-ink-muted" for="refyard-ticket">
          {t("connection.ticket")}
        </label>
        <Input
          id="refyard-ticket"
          placeholder={t("connection.ticketExample")}
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
          {t("connection.ticketHelp")}
        </p>
      </div>

      <div class="flex items-center gap-3">
        <Button
          disabled={phase === "connecting" || ticket.length === 0}
          onclick={onConnect}
        >
          {t(phase === "connecting" ? "connection.pairing" : "connection.pair")}
        </Button>
        {#if baseUrlIsDefault}
          <Badge variant="secondary">{t("connection.sameOrigin")}</Badge>
        {/if}
      </div>
    </CardContent>
  </Card>

  {#if phase === "failed"}
    <StateBanner
      state="error"
      title={t("connection.failed")}
      detail={message ??
        t("connection.failedHelp")}
    />
  {/if}

  <div
    class="flex flex-col gap-2 rounded-lg border border-border/70 bg-panel/50 p-3.5 text-xs text-ink-muted"
  >
    <div class="flex items-center gap-1.5 font-medium text-ink">
      <span>💡 {t("connection.freshLink")}</span>
    </div>
    <ul class="list-disc space-y-1 pl-4 text-ink-muted">
      <li>
        {t("connection.press")}
        <kbd
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >p</kbd
        >
        +
        <kbd
          class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-ink"
          >Enter</kbd
        > {t("connection.printLink")}
      </li>
      <li>
        {t("connection.orRun")} <code class="font-mono text-ink">refyard open &lt;path&gt;</code>
        {t("connection.inRepository")}
      </li>
      <li>
        {t("connection.remembered")}
      </li>
    </ul>
  </div>
</section>
