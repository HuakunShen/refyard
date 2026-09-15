/**
 * The event stream: SSE over `fetch`, with a bounded ring behind it.
 *
 * Events are *hints that invalidate cached reads*, never the source of truth — the
 * design says so, and every choice here follows from it:
 *
 * - the ring holds at most 1,024 events or 1 MiB, whichever comes first; when it
 *   overflows the oldest are dropped and the next subscriber is told with an
 *   `eventGap` that carries the sequence range it missed, so a UI refreshes instead
 *   of assuming nothing happened;
 * - an event payload is small (an operation record, or a repository id and worktree
 *   ids); a diff, a file list or a source excerpt is never put in the stream;
 * - `Last-Event-ID` is not used: this protocol carries the resume point in the
 *   `since` query parameter, which the contract validates, because the same stream
 *   has to be reachable by a client that stores its cursor with the rest of its
 *   state;
 * - a heartbeat comment keeps intermediaries from closing an idle connection
 *   without inventing an event the client would act on.
 */
import type { ServerResponse } from "node:http";
import {
  LIMITS,
  eventEnvelopeSchema,
  type EventEnvelope,
  type EventPayload,
} from "@refyard/git-contract";

export interface EventRingOptions {
  readonly maxEvents?: number;
  readonly maxBytes?: number;
  readonly now?: () => number;
  /**
   * Called when a payload the contract refuses is dropped.
   *
   * The reason belongs in the host's log: a dropped hint is survivable, a silent one is
   * not — a UI that stops updating needs a record somewhere of why.
   */
  readonly onInvalidPayload?: (error: unknown, payload: EventPayload) => void;
}

export interface EventRing {
  /**
   * Publish one hint, or drop it and answer null when the contract refuses the payload.
   *
   * Null rather than a throw: see the comment in the implementation — a validation error
   * raised inside a journal transition used to end the service process.
   */
  publish(payload: EventPayload): EventEnvelope | null;
  /** Events after `since`, or a gap notice when the ring no longer holds that point. */
  replay(since: number | undefined): readonly EventEnvelope[];
  subscribe(listener: (envelope: EventEnvelope) => void): () => void;
  latestSequence(): number;
  size(): number;
  bytes(): number;
}

export function createEventRing(options: EventRingOptions = {}): EventRing {
  const maxEvents = options.maxEvents ?? LIMITS.eventRingMaxEvents;
  const maxBytes = options.maxBytes ?? LIMITS.eventRingMaxBytes;
  const now = options.now ?? Date.now;
  const events: EventEnvelope[] = [];
  const listeners = new Set<(envelope: EventEnvelope) => void>();
  let sequence = 0;
  let bytes = 0;

  function sizeOf(envelope: EventEnvelope): number {
    return Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }

  function trim(): void {
    while (events.length > maxEvents || bytes > maxBytes) {
      const dropped = events.shift();
      if (dropped === undefined) {
        break;
      }
      bytes -= sizeOf(dropped);
    }
  }

  return {
    publish(payload): EventEnvelope | null {
      const candidate: EventEnvelope = {
        sequence: sequence + 1,
        emittedAt: new Date(now()).toISOString(),
        payload,
      };
      // Validated before the sequence is spent: an event that breaks the contract would
      // break every client at once. A refused payload is *dropped*, not thrown — it is a
      // hint, never a source of truth, and a thrown validation error inside a journal
      // transition kills the service process. (It did: a workspace operation's write key
      // reached `repositoryChanged`'s repository-id field, and the CLI exited with a
      // `ZodError` while a mutation was in flight.)
      const validated = eventEnvelopeSchema.safeParse(candidate);
      if (!validated.success) {
        options.onInvalidPayload?.(validated.error, payload);
        return null;
      }
      sequence += 1;
      events.push(validated.data);
      bytes += sizeOf(validated.data);
      trim();
      for (const listener of listeners) {
        listener(validated.data);
      }
      return validated.data;
    },

    replay(since): readonly EventEnvelope[] {
      if (since === undefined) {
        return [];
      }
      const oldest = events[0];
      if (oldest === undefined) {
        // Nothing buffered. If the client is ahead of us it missed nothing we know
        // of; if it is behind, the gap is reported so the UI reloads.
        return since < sequence
          ? [
              {
                sequence,
                emittedAt: new Date(now()).toISOString(),
                payload: {
                  kind: "eventGap",
                  fromSequence: since + 1,
                  toSequence: sequence,
                },
              },
            ]
          : [];
      }
      if (since + 1 < oldest.sequence) {
        return [
          {
            sequence,
            emittedAt: new Date(now()).toISOString(),
            payload: {
              kind: "eventGap",
              fromSequence: since + 1,
              toSequence: oldest.sequence - 1,
            },
          },
          ...events,
        ];
      }
      return events.filter((envelope) => envelope.sequence > since);
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    latestSequence(): number {
      return sequence;
    },

    size(): number {
      return events.length;
    },

    bytes(): number {
      return bytes;
    },
  };
}

export interface SseSession {
  start(input: {
    readonly response: ServerResponse;
    readonly since: number | undefined;
  }): Promise<void>;
  close(): void;
}

/** Format one envelope as an SSE frame. */
export function sseFrame(envelope: EventEnvelope): string {
  return `id: ${envelope.sequence}\nevent: ${envelope.payload.kind}\ndata: ${JSON.stringify(
    envelope,
  )}\n\n`;
}

export function createSseSession(
  ring: EventRing,
  options: { readonly heartbeatMs?: number } = {},
): SseSession {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;

  return {
    async start({ response, since }): Promise<void> {
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.setHeader("connection", "keep-alive");
      // A proxy that buffers would defeat the point of a stream.
      response.setHeader("x-accel-buffering", "no");
      response.writeHead(200);

      for (const envelope of ring.replay(since)) {
        response.write(sseFrame(envelope));
      }
      // The retry hint is deliberately conservative: a client that reconnects too
      // quickly after a restart adds load without learning anything.
      response.write("retry: 3000\n\n");

      unsubscribe = ring.subscribe((envelope) => {
        if (!closed) {
          response.write(sseFrame(envelope));
        }
      });
      heartbeat = setInterval(() => {
        if (!closed) {
          // A comment line keeps the connection alive without inventing an event.
          response.write(": keep-alive\n\n");
        }
      }, heartbeatMs);
      heartbeat.unref?.();

      await new Promise<void>((resolve) => {
        response.on("close", () => {
          this.close();
          resolve();
        });
        response.on("error", () => {
          this.close();
          resolve();
        });
      });
    },

    close(): void {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  };
}
