/**
 * The HTTP event service: the existing authenticated fetch-SSE stream, wrapped so
 * the UI sees the same `EventService` the native adapter will provide.
 *
 * Two properties are inherited deliberately, not re-implemented: the bearer travels
 * in a header (never a query string, which would end up in logs), and a resumed
 * stream asks for `?since=<sequence>` so the service's ring buffer can replay rather
 * than the client guessing what it missed. A gap is reported as a gap.
 */
import { createEventStream } from "@refyard/git-client";
import type {
  EventObserver,
  EventService,
  EventSubscription,
} from "@refyard/git-service";

export interface HttpEventPorts {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly token: () => string | null;
}

export function createHttpEventService(ports: HttpEventPorts): EventService {
  return {
    async subscribe(observer: EventObserver): Promise<EventSubscription> {
      const stream = createEventStream({
        baseUrl: ports.baseUrl,
        fetch: ports.fetch,
        token: ports.token,
        onEvent: (event) => observer.onEvent(event),
        onGap: (gap) => observer.onGap(gap),
        onError: (error) => {
          // The stream cannot retry an unauthenticated session, so the honest state
          // is closed rather than a reconnection that will never succeed.
          const unauthenticated = error.code === "Unauthenticated";
          observer.onState(unauthenticated ? "closed" : "reconnecting");
          observer.onError({
            code: unauthenticated ? "Unauthenticated" : "Unavailable",
            message: error.message,
            retryable: !unauthenticated,
          });
        },
      });
      observer.onState("connecting");
      await stream.start();
      observer.onState("live");
      return {
        async dispose(): Promise<void> {
          stream.stop();
          observer.onState("closed");
        },
      };
    },
  };
}
