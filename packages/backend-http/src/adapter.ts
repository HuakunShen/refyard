/**
 * `createHttpBackendAdapter` — the browser/Node way to reach a Refyard service.
 *
 * `connect()` is where a bearer is obtained and checked. A ticket is exchanged
 * here and nowhere else; the token stays in this closure and is never part of the
 * session object a component sees. The caller decides persistence, through
 * `onToken` — the adapter itself never writes to storage.
 *
 * An unpaired browser is not a session: connecting without a ticket or a stored
 * bearer fails with `Unauthenticated` so the composition root shows the pairing
 * panel, rather than handing the UI a session whose every read will 401.
 */
import { createGitClient } from "@refyard/git-client";
import {
  BackendError,
  type BackendAdapter,
  type BackendConnectOptions,
  type BackendSession,
} from "@refyard/git-service";
import { createHttpBackendSession, toBackendError } from "./session.js";

export interface HttpBackendAdapterOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  /** Bearer restored by the caller from its own storage, if it keeps one. */
  readonly initialToken?: string | null;
  /** Called when this adapter obtains a bearer, so the caller can persist it. */
  readonly onToken?: (token: string | null) => void;
  readonly backendLabel?: string;
}

export function createHttpBackendAdapter(
  options: HttpBackendAdapterOptions,
): BackendAdapter {
  return {
    kind: "http",
    async connect(
      connectOptions: BackendConnectOptions,
    ): Promise<BackendSession> {
      let token = options.initialToken ?? null;
      let sessionId: string | null = null;

      if (connectOptions.ticket !== undefined) {
        const client = createGitClient({
          baseUrl: options.baseUrl,
          fetch: options.fetch,
          token: () => token,
        });
        const exchanged = await client.exchangeTicket(
          connectOptions.ticket,
          connectOptions.password,
        );
        token = exchanged.token;
        sessionId = exchanged.sessionId;
        options.onToken?.(token);
      } else if (connectOptions.password !== undefined) {
        throw new BackendError({
          code: "InvalidRequest",
          message:
            "a hosted password can only be sent together with a pairing ticket",
          retryable: false,
        });
      }

      if (token === null) {
        throw new BackendError({
          code: "Unauthenticated",
          message:
            "this browser has no service session; open the pairing link the service printed",
          retryable: false,
        });
      }

      // `health` is unauthenticated and tells us who we are talking to; the
      // authenticated capabilities read then proves the bearer is still accepted,
      // so a stale token fails here instead of inside the first panel the user opens.
      const probe = createGitClient({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        token: () => token,
      });
      let serviceInstanceId: string;
      try {
        const health = await probe.health();
        serviceInstanceId = health.serviceInstanceId;
        await probe.capabilities();
      } catch (error) {
        const failure = toBackendError(error);
        // A bearer the service rejected is not worth keeping: the caller is told so
        // it can clear its own storage and re-pair.
        if (failure.code === "Unauthenticated") options.onToken?.(null);
        throw failure;
      }

      return createHttpBackendSession({
        baseUrl: options.baseUrl,
        fetch: options.fetch,
        token: () => token,
        sessionId,
        serviceInstanceId,
        ...(options.backendLabel === undefined
          ? {}
          : { backendLabel: options.backendLabel }),
      });
    },
  };
}
