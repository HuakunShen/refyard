/**
 * Native event subscription: listener first, then the handshake, then ordered delivery.
 *
 * The ordering is the whole design. Events emitted between "the host recorded my
 * subscription" and "I started listening" would be lost forever if the listener were
 * registered second, so it is registered first and live events are buffered until the
 * handshake reply says where the replay ends. After that point the two streams are
 * merged by sequence number: the reply carries everything up to `highWatermark`, and a
 * buffered event at or below it was already replayed, so it is dropped rather than
 * delivered twice.
 *
 * Nothing here becomes a second source of truth: an event says something changed, and
 * the caller re-reads. A gap is reported as a gap so the caller refreshes instead of
 * trusting a continuity it no longer has.
 */
import { z } from "zod";
import { eventEnvelopeSchema, type EventEnvelope } from "@refyard/git-contract";
import type {
  EventObserver,
  EventService,
  EventSubscription,
  ScopedEventFrame,
} from "@refyard/git-service";

import {
  problemFromInvocation,
  subscriptionAckSchema,
  type NativePorts,
} from "./commands.js";

/** Fixed by the adapter contract; scoped to the calling WebView by the Rust side. */
export const NATIVE_EVENT_NAME = "refyard://event";

/** How many events may be buffered before the handshake reply arrives. */
export const MAX_BUFFERED_EVENTS = 256;

export const scopedEventFrameSchema = z
  .strictObject({
    sessionId: z.string().min(1),
    subscriptionId: z.string().min(1),
    serviceInstanceId: z.string().min(1),
    event: eventEnvelopeSchema,
  })
  .meta({ id: "ScopedEventFrame" });

export interface NativeEventPorts {
  readonly ports: NativePorts;
  readonly sessionId: string;
  readonly serviceInstanceId: string;
  readonly nextSubscriptionId: () => string;
}

export function createNativeEventService(
  ports: NativeEventPorts,
): EventService {
  return {
    async subscribe(observer: EventObserver): Promise<EventSubscription> {
      const subscriptionId = ports.nextSubscriptionId();
      const buffered: EventEnvelope[] = [];
      let handshakeDone = false;
      let closed = false;
      let lastSequence = 0;

      const deliver = (envelope: EventEnvelope): void => {
        if (closed) return;
        // A replayed event and a live one are the same event: sequence order is what
        // decides, not which path it arrived by.
        if (envelope.sequence <= lastSequence) return;
        lastSequence = envelope.sequence;
        if (envelope.payload.kind === "eventGap") {
          observer.onGap({
            fromSequence: envelope.payload.fromSequence,
            toSequence: envelope.payload.toSequence,
          });
          return;
        }
        observer.onEvent(envelope);
      };

      observer.onState("connecting");

      // 1. Listen before asking: an event published between the subscribe call and its
      //    reply must not be lost.
      const unlisten = await ports.ports.listen(NATIVE_EVENT_NAME, (event) => {
        const parsed = scopedEventFrameSchema.safeParse(event.payload);
        if (!parsed.success) return;
        const frame: ScopedEventFrame = parsed.data;
        // A frame for another session, subscription or service instance belongs to
        // another window; it is discarded rather than merged into this repository.
        if (frame.sessionId !== ports.sessionId) return;
        if (frame.subscriptionId !== subscriptionId) return;
        if (frame.serviceInstanceId !== ports.serviceInstanceId) return;
        if (handshakeDone) {
          deliver(frame.event);
          return;
        }
        buffered.push(frame.event);
        if (buffered.length > MAX_BUFFERED_EVENTS) {
          // The handshake is taking long enough that continuity cannot be promised.
          // Say so and stop pretending: the caller refreshes after the handshake.
          observer.onGap({
            fromSequence: lastSequence,
            toSequence: frame.event.sequence,
          });
          buffered.length = 0;
        }
      });

      // 2. Record the subscription and learn where the replay ends.
      let ack;
      try {
        const raw = await ports.ports.invoke<unknown>(
          "refyard_events_subscribe",
          {
            sessionId: ports.sessionId,
            subscriptionId,
            afterSequence: lastSequence,
          },
        );
        const parsed = subscriptionAckSchema.safeParse(raw);
        if (!parsed.success) {
          throw problemFromInvocation({
            problem: {
              code: "InternalError",
              message:
                "the native host answered the event handshake with a shape this client cannot validate",
              retryable: false,
            },
          });
        }
        ack = parsed.data;
      } catch (error) {
        closed = true;
        await unlisten();
        observer.onState("closed");
        throw problemFromInvocation(error);
      }

      // 3. Replay, then whatever was buffered above the watermark.
      for (const envelope of ack.replay) {
        const parsed = eventEnvelopeSchema.safeParse(envelope);
        if (parsed.success) deliver(parsed.data);
      }
      for (const envelope of buffered) deliver(envelope);
      buffered.length = 0;
      handshakeDone = true;
      observer.onState("live");

      let disposed = false;
      return {
        async dispose(): Promise<void> {
          if (disposed) return;
          disposed = true;
          // Inactive locally first: a frame arriving during the unsubscribe must not
          // reach a caller that has already let go.
          closed = true;
          try {
            await ports.ports.invoke("refyard_events_unsubscribe", {
              sessionId: ports.sessionId,
              subscriptionId,
            });
          } finally {
            // The listener is removed even when the host refuses, or this window keeps
            // receiving frames for a subscription nobody holds.
            await unlisten();
            observer.onState("closed");
          }
        },
      };
    },
  };
}
