/**
 * The adapter harness: a real service, a real temporary repository, and a
 * browser-like fetch that records what crossed the wire.
 *
 * Nothing here stubs the HTTP protocol. The point of an adapter test is that the
 * DTOs, the bearer handling and the lifecycle survive contact with the real
 * service — so the service is `startTestService`, the same wiring the CLI uses, and
 * the repository is an isolated fixture.
 */
import { createHttpBackendAdapter } from "@refyard/backend-http";
import type { BackendSession } from "@refyard/git-service";
import { createRepo, type GitFixtureRepo } from "./repo.js";
import { startTestService, type TestService } from "./service.js";

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface AdapterHarness {
  readonly service: TestService;
  readonly repo: GitFixtureRepo;
  readonly baseUrl: string;
  readonly instanceId: string;
  readonly repositoryId: string;
  /** The bearer a browser would hold after pairing. Must never reach metadata. */
  readonly secretToken: string;
  readonly requestLog: readonly RecordedRequest[];
  /** Streams the adapter still holds open, counted from the transport side. */
  activeSubscriptions(): number;
  readonly fetch: typeof fetch;
  connectHttp(options?: {
    readonly ticket?: string;
    readonly token?: string | null;
  }): Promise<BackendSession>;
  readonly sessions: readonly BackendSession[];
  /** What the adapter reported through onToken, in order. */
  readonly tokenEvents: readonly (string | null)[];
  closeServiceOnly(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createAdapterHarness(): Promise<AdapterHarness> {
  const repo = await createRepo({ initialCommit: true });
  const service = await startTestService({ repo });
  const secretToken = await service.pair();
  const origin = service.baseUrl;

  const requestLog: RecordedRequest[] = [];
  const tokenEvents: (string | null)[] = [];
  const sessions: BackendSession[] = [];
  let streams = 0;
  let disposed = false;

  /**
   * A browser sends `Origin` on these requests and then cannot read `Authorization`
   * back out. Both properties matter to the service, so the recording fetch keeps
   * them rather than hiding them behind a stub.
   */
  const fetchImpl: typeof fetch = (input, init) => {
    const asRequest = input instanceof Request ? input : null;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = init?.method ?? asRequest?.method ?? "GET";
    const headers = new Headers(
      init?.headers ?? asRequest?.headers ?? undefined,
    );
    if (!headers.has("origin")) headers.set("origin", origin);
    requestLog.push({
      method,
      url,
      headers: Object.fromEntries(headers.entries()),
    });

    if (url.includes("/api/v1/events")) {
      streams += 1;
      const signal = init?.signal;
      if (signal !== undefined && signal !== null) {
        signal.addEventListener(
          "abort",
          () => {
            streams -= 1;
          },
          { once: true },
        );
      }
    }
    return globalThis.fetch(input, { ...init, headers });
  };

  return {
    service,
    repo,
    baseUrl: service.baseUrl,
    instanceId: service.instanceId,
    repositoryId: service.repositoryId,
    secretToken,
    requestLog,
    fetch: fetchImpl,
    sessions,
    tokenEvents,
    activeSubscriptions: () => streams,
    async connectHttp(options = {}) {
      const adapter = createHttpBackendAdapter({
        baseUrl: service.baseUrl,
        fetch: fetchImpl,
        initialToken: options.token === undefined ? secretToken : options.token,
        onToken: (token) => {
          tokenEvents.push(token);
        },
      });
      const session = await adapter.connect(
        options.ticket === undefined ? {} : { ticket: options.ticket },
      );
      sessions.push(session);
      return session;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const session of sessions) await session.dispose();
      sessions.length = 0;
      await service.close();
      await repo.dispose();
    },
    /** Stops the service without touching the fixture; used to simulate a restart. */
    async closeServiceOnly() {
      if (disposed) return;
      await service.close();
    },
  };
}
