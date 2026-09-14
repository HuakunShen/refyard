/**
 * The event stream client.
 *
 * It uses `fetch`, not `EventSource`, for one reason: `EventSource` cannot send an
 * `Authorization` header, and this service puts the bearer in a header rather than
 * in a URL — a token in a query string would end up in logs and history. The client
 * therefore parses the SSE framing itself, which is a few lines of text handling and
 * the price of keeping the credential out of the URL.
 *
 * Reconnection is explicit and honest about what it lost:
 *
 * - it resumes from the last sequence it saw, so a short disconnect replays only
 *   what was missed;
 * - if the server answers with `eventGap`, the client tells its listener that events
 *   were missed, and the listener invalidates its caches instead of assuming it is
 *   up to date;
 * - it stops on `Unauthenticated` rather than retrying forever, because a dead
 *   session needs a human to pair again, not a loop.
 *
 * Events are hints. Nothing here is a source of truth: a consumer that receives no
 * event at all still produces correct state the next time it reads.
 */
import type { EventEnvelope } from "@refyard/git-contract";

export interface EventStreamOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
  readonly onEvent: (envelope: EventEnvelope) => void;
  /** Called when the ring no longer holds the client's position. */
  readonly onGap: (gap: {
    readonly fromSequence: number;
    readonly toSequence: number;
  }) => void;
  readonly onError?: (error: {
    readonly message: string;
    readonly code: string;
  }) => void;
  /**
   * Wait between reconnection attempts.
   *
   * Injected so a test can drive reconnection without real time passing. The timer
   * handle never leaves this module, which is what keeps the package free of both
   * Node and DOM timer types: a browser and Node disagree about what `setTimeout`
   * returns, and nothing here needs to know.
   */
  readonly wait?: (ms: number) => Promise<void>;
  readonly baseRetryMs?: number;
}

export interface EventStream {
  /** Begin connecting; resolves when the first connection is established. */
  start(): Promise<void>;
  stop(): void;
  lastSequence(): number;
  connected(): boolean;
}

export function createEventStream(options: EventStreamOptions): EventStream {
  const wait =
    options.wait ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => {
        // The handle stays inside this expression; nothing outside sees its type.
        setTimeout(resolve, ms);
      }));
  const baseRetryMs = options.baseRetryMs ?? 1_000;
  let sequence = 0;
  let stopped = false;
  let controller: AbortController | null = null;
  let isConnected = false;
  let attempt = 0;
  let loopRunning = false;

  // Resolved when the first response is accepted, so `start` can hand control back while
  // the body keeps streaming.
  let markConnected: (() => void) | null = null;
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve;
  });
  function connectedSignal(): Promise<void> {
    return connected;
  }

  /** Reconnect with bounded backoff until stopped. */
  async function reconnectLoop(): Promise<void> {
    if (loopRunning) {
      return;
    }
    loopRunning = true;
    try {
      while (!stopped) {
        attempt += 1;
        // Bounded exponential backoff: a restarting service is not hammered, and a
        // client that is close behind does not wait a minute either.
        await wait(Math.min(baseRetryMs * 2 ** Math.min(attempt, 4), 15_000));
        if (stopped) {
          return;
        }
        await connect();
        if (!stopped && isConnected) {
          // `connect` returned because the stream ended; the next iteration waits.
          attempt = 0;
        }
      }
    } finally {
      loopRunning = false;
    }
  }

  async function connect(): Promise<void> {
    if (stopped) {
      return;
    }
    const token = options.token();
    if (token === null) {
      stopped = true;
      options.onError?.({
        code: "Unauthenticated",
        message: "no session to stream with",
      });
      return;
    }
    controller = new AbortController();
    try {
      const response = await options.fetch(
        `${options.baseUrl}/api/v1/events${sequence > 0 ? `?since=${sequence}` : ""}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "text/event-stream",
          },
          signal: controller.signal,
          cache: "no-store",
          credentials: "omit",
        },
      );
      if (!response.ok || response.body === null) {
        if (response.status === 401 || response.status === 403) {
          // A dead session needs a human to pair again, not a retry loop.
          stopped = true;
          options.onError?.({
            code: response.status === 401 ? "Unauthenticated" : "Forbidden",
            message: `the event stream was refused with ${response.status}; pair again`,
          });
          return;
        }
        isConnected = false;
        return;
      }
      isConnected = true;
      attempt = 0;
      markConnected?.();
      markConnected = null;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        // Frames are separated by a blank line; anything else is a partial frame and
        // stays in the buffer until its terminator arrives.
        let separator = buffer.indexOf("\n\n");
        while (separator !== -1) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          handleFrame(frame);
          separator = buffer.indexOf("\n\n");
        }
      }
      isConnected = false;
    } catch (error) {
      isConnected = false;
      if (stopped) {
        return;
      }
      options.onError?.({
        code: "Unavailable",
        message:
          error instanceof Error ? error.message : "the event stream failed",
      });
    }
  }

  function handleFrame(frame: string): void {
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) {
        // A comment (the keep-alive heartbeat) carries no data.
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      options.onError?.({
        code: "InternalError",
        message: "the event stream sent unparsable data",
      });
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const envelope = parsed as Partial<EventEnvelope>;
    if (
      typeof envelope.sequence !== "number" ||
      typeof envelope.payload !== "object" ||
      envelope.payload === null
    ) {
      return;
    }
    sequence = Math.max(sequence, envelope.sequence);
    const payload = envelope.payload;
    if ("kind" in payload && payload.kind === "eventGap") {
      const gap = payload;
      options.onGap({
        fromSequence:
          typeof gap.fromSequence === "number" ? gap.fromSequence : 0,
        toSequence:
          typeof gap.toSequence === "number"
            ? gap.toSequence
            : envelope.sequence,
      });
      return;
    }
    options.onEvent(envelope as EventEnvelope);
  }

  return {
    async start(): Promise<void> {
      stopped = false;
      // `connect` reads until the stream ends, which for a healthy stream is "until the
      // service stops". Awaiting it would make `start` resolve at exactly the wrong moment
      // — after the connection is gone — so the two are separated: readiness is signalled
      // when the response is accepted, and the read loop runs on its own.
      const connection = connect();
      void connection.then(() => {
        if (!stopped) {
          // The first connection has ended; keep it up from here on.
          void reconnectLoop();
        }
      });
      // Ready when the stream is up, or when it has already ended (a refused or failed
      // connection has reported itself through `onError`, and a caller waiting forever for
      // a socket that will not open is a hang, not a retry).
      await Promise.race([connectedSignal(), connection]);
    },
    stop(): void {
      stopped = true;
      controller?.abort();
      controller = null;
      isConnected = false;
    },
    lastSequence(): number {
      return sequence;
    },
    connected(): boolean {
      return isConnected;
    },
  };
}
