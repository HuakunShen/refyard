/**
 * Events are hints; reads are the facts.
 *
 * A subscription delivers invalidation notices — an operation changed, a repository
 * changed — never Git output and never a replacement for a read. A client that
 * missed every event must still be able to recover by reading `status`/`operations`
 * again, which is what makes gap handling a refresh instead of data loss.
 */
import type { EventEnvelope, Problem } from "@refyard/git-contract";

export interface EventObserver {
  onEvent(event: EventEnvelope): void;
  /** Events `fromSequence…toSequence` were dropped; re-read rather than guess. */
  onGap(gap: {
    readonly fromSequence: number;
    readonly toSequence: number;
  }): void;
  onState(state: "connecting" | "live" | "reconnecting" | "closed"): void;
  onError(problem: Problem): void;
}

export interface EventSubscription {
  dispose(): Promise<void>;
}

export interface EventService {
  subscribe(observer: EventObserver): Promise<EventSubscription>;
}

/** What a subscribe handshake returns: identity plus everything up to the mark. */
export interface SubscriptionAck {
  readonly subscriptionId: string;
  readonly serviceInstanceId: string;
  readonly highWatermark: number;
  readonly replay: readonly EventEnvelope[];
}

/**
 * A live event as delivered to one WebView. The session/subscription/service
 * identity travels with it so a frame meant for another window is discarded rather
 * than merged into the wrong repository's cache.
 */
export interface ScopedEventFrame {
  readonly sessionId: string;
  readonly subscriptionId: string;
  readonly serviceInstanceId: string;
  readonly event: EventEnvelope;
}
