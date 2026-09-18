/**
 * The workbench runtime: pairing form in, live `BackendSession` out.
 *
 * This is the composition root's helper. It owns the one decision the rest of the page
 * must not make — which adapter this WebView needs — and the lifecycle around it:
 * connecting at startup from a pairing URL or a remembered session, adopting the
 * session's connection state, and releasing the session on disconnect. The page keeps
 * the reactive holders and passes callbacks; nothing here reads `window` directly, so
 * the same code runs in the desktop WebView and in a plain browser tab.
 *
 * The bearer is never part of what the page sees. It travels from the HTTP adapter's
 * `onToken` callback into the pairing form and its storage port, which is what keeps
 * `+page.svelte` free of a credential-shaped condition.
 */
import type {
  BackendConnectOptions,
  BackendSession,
  ConnectionState,
} from "@refyard/git-service";
import { BackendError } from "@refyard/git-service";
import type { NativePorts } from "@refyard/backend-tauri";
import { stripTicket } from "../connection.js";
import {
  clearWorkbenchCredentials,
  consumeInitialPairingUrl,
  describeBackendProblem,
  describePairingFailure,
  pairWorkbenchSession,
  type WorkbenchSessionPorts,
  type WorkbenchSessionState,
} from "../workbench/session.js";
import {
  createBackendRegistry,
  isNativeWebview,
  type BackendKind,
} from "./backend-registry.js";

export interface WorkbenchStoragePorts {
  storeToken(token: string | null): void;
  storeInstance(instanceId: string | null): void;
  storeBaseUrl(baseUrl: string | null): void;
  clearStoredSession(): void;
}

export interface WorkbenchRuntimeOptions {
  /** The page-owned reactive pairing form; the runtime mutates it in place. */
  readonly form: WorkbenchSessionState;
  readonly fetch: typeof fetch;
  readonly storage: WorkbenchStoragePorts;
  readonly currentHref: () => string;
  readonly replaceHref: (href: string) => void;
  readonly onSession: (session: BackendSession | null) => void;
  readonly onConnectionState: (state: ConnectionState) => void;
  /** The surface detection looks at; a test passes a fake instead of a WebView. */
  readonly runtime?: unknown;
  readonly loadNativePorts?: () => Promise<NativePorts>;
}

export interface WorkbenchRuntime {
  readonly kind: BackendKind;
  session(): BackendSession | null;
  /** Connects from the pairing URL, the remembered session, or the WebView itself. */
  start(): Promise<void>;
  pair(): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
}

export function createWorkbenchRuntime(
  options: WorkbenchRuntimeOptions,
): WorkbenchRuntime {
  const form = options.form;
  // Detection is the registry's rule; asking it here only names the flow this page
  // takes, and connecting goes through the registry so there is still one chooser.
  const kind: BackendKind = isNativeWebview(options.runtime) ? "tauri" : "http";

  let session: BackendSession | null = null;
  let releaseState: (() => void) | null = null;
  /**
   * The bearer the adapter most recently reported. It stays here and in the form's
   * storage port; no query, gate, or component reads it.
   */
  let issuedToken: string | null = form.token;

  function registry() {
    return createBackendRegistry({
      runtime: options.runtime,
      rememberedInstanceId: form.pairedInstance,
      ...(options.loadNativePorts === undefined
        ? {}
        : { loadNativePorts: options.loadNativePorts }),
      http: {
        baseUrl: form.baseUrl,
        fetch: options.fetch,
        initialToken: form.token,
        onToken: (token) => {
          issuedToken = token;
          form.token = token;
          options.storage.storeToken(token);
        },
      },
    });
  }

  function adopt(connected: BackendSession): void {
    releaseState?.();
    session = connected;
    releaseState = connected.onState(options.onConnectionState);
    options.onSession(connected);
    options.onConnectionState(connected.state());
  }

  async function connect(
    connectOptions: BackendConnectOptions,
  ): Promise<BackendSession | null> {
    if (session !== null) return session;
    form.pairPhase = "connecting";
    form.pairMessage = undefined;
    try {
      const connected = await registry().connect(connectOptions);
      adopt(connected);
      form.pairPhase = "idle";
      form.pairMessage = undefined;
      // A successful connect that reused the stored session reports no token; the form
      // must keep the one it started with in that case.
      form.token = issuedToken;
      return connected;
    } catch (error) {
      form.pairPhase = "failed";
      form.pairMessage = describeBackendProblem(error);
      options.onConnectionState({ phase: "disconnected", problem: null });
      return null;
    }
  }

  const pairingPorts: WorkbenchSessionPorts = {
    exchangeTicket: async (ticket, password) => {
      const connected = await connect({
        ticket,
        ...(password === undefined ? {} : { password }),
      });
      if (connected === null) {
        // `connect` already recorded the real reason on the form; the state machine
        // needs a thrown failure to keep the ticket for a retry.
        throw new BackendError({
          code: "Unauthenticated",
          message: form.pairMessage ?? "the service refused the pairing ticket",
          retryable: false,
        });
      }
      return { token: form.token ?? "" };
    },
    health: async () => {
      const connected = session;
      if (connected === null) {
        throw new BackendError({
          code: "InternalError",
          message: "the session connected but reports no read service",
          retryable: false,
        });
      }
      const health = await connected.git.health();
      return { serviceInstanceId: health.serviceInstanceId };
    },
    storeToken: options.storage.storeToken,
    storeInstance: options.storage.storeInstance,
    storeBaseUrl: options.storage.storeBaseUrl,
    clearStoredSession: options.storage.clearStoredSession,
    currentHref: options.currentHref,
    replaceHref: options.replaceHref,
  };

  async function start(): Promise<void> {
    if (kind === "tauri") {
      // A ticket is an HTTP pairing artifact. A native session must not spend one, but
      // it must also not leave it in the address bar for the next reload.
      if (form.ticket.length > 0) {
        form.ticket = "";
        options.replaceHref(stripTicket(options.currentHref()));
      }
      await connect({});
      return;
    }
    await consumeInitialPairingUrl(form, pairingPorts);
    if (session === null && form.token !== null) {
      await connect({});
    }
    if (session === null) {
      options.onConnectionState({ phase: "disconnected", problem: null });
    }
  }

  async function release(): Promise<void> {
    const previous = session;
    session = null;
    releaseState?.();
    releaseState = null;
    options.onSession(null);
    if (previous !== null) await previous.dispose();
  }

  return {
    kind,
    session: () => session,
    start,
    async pair(): Promise<void> {
      if (session !== null) return;
      try {
        await pairWorkbenchSession(form, pairingPorts);
      } catch (error) {
        // The state machine normally reports failures itself; this is the last resort
        // for a port that threw where it was not expected to.
        form.pairPhase = "failed";
        form.pairMessage = describePairingFailure(error);
      }
      if (session === null) {
        options.onConnectionState({ phase: "disconnected", problem: null });
      }
    },
    async disconnect(): Promise<void> {
      clearWorkbenchCredentials(form, {
        clearStoredSession: options.storage.clearStoredSession,
      });
      // The form starts clean: a message from the session that was just released would
      // otherwise sit next to the credentials fields as if the next attempt had failed.
      form.pairPhase = "idle";
      form.pairMessage = undefined;
      await release();
      options.onConnectionState({ phase: "disconnected", problem: null });
    },
    async dispose(): Promise<void> {
      await release();
    },
  };
}
