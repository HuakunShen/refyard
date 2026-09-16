/**
 * Browser-independent workbench session state.
 *
 * The Svelte page owns reactivity; this module owns the security-sensitive transitions that turn a
 * one-time pairing ticket into a remembered tab session. Keeping the mutations on a plain object
 * means the page can wrap it in `$state`, while Node tests can exercise the exact same logic.
 */
import { GitClientError } from "@refyard/git-client";
import {
  extractTicketFromText,
  parseSessionConfig,
  stripTicket,
} from "../connection.js";

export type PairPhase = "idle" | "connecting" | "failed";

export interface WorkbenchSessionState {
  baseUrl: string;
  ticket: string;
  hostedPassword: string;
  token: string | null;
  pairedInstance: string | null;
  pairPhase: PairPhase;
  pairMessage: string | undefined;
  readonly initialBaseUrl: string;
  readonly overriddenOnLoad: boolean;
  readonly hadTicketOnLoad: boolean;
}

export interface WorkbenchSessionInput {
  readonly href: string;
  readonly storedBaseUrl: string | null;
  readonly storedToken: string | null;
  readonly storedInstance: string | null;
}

export interface WorkbenchSessionPorts {
  exchangeTicket(
    ticket: string,
    password?: string,
  ): Promise<{ readonly token: string }>;
  health(): Promise<{ readonly serviceInstanceId: string }>;
  storeToken(token: string | null): void;
  storeInstance(instanceId: string | null): void;
  storeBaseUrl(baseUrl: string | null): void;
  clearStoredSession(): void;
  currentHref(): string;
  replaceHref(href: string): void;
}

export function createWorkbenchSessionState(
  input: WorkbenchSessionInput,
): WorkbenchSessionState {
  const initial = parseSessionConfig({
    href: input.href,
    storedBaseUrl: input.storedBaseUrl,
  });
  return {
    baseUrl: initial.baseUrl,
    ticket: initial.ticket ?? "",
    hostedPassword: "",
    token: input.storedToken,
    pairedInstance: input.storedInstance,
    pairPhase: "idle",
    pairMessage: undefined,
    initialBaseUrl: initial.baseUrl,
    overriddenOnLoad: initial.overridden,
    hadTicketOnLoad: initial.ticket !== null,
  };
}

export async function pairWorkbenchSession(
  state: WorkbenchSessionState,
  ports: WorkbenchSessionPorts,
): Promise<void> {
  const rawValue = state.ticket.trim();
  if (rawValue.length === 0) {
    return;
  }
  const value = extractTicketFromText(rawValue);
  if (value.length === 0) {
    return;
  }

  state.pairPhase = "connecting";
  state.pairMessage = undefined;
  try {
    const session = await ports.exchangeTicket(
      value,
      state.hostedPassword.length === 0 ? undefined : state.hostedPassword,
    );
    state.token = session.token;
    state.hostedPassword = "";
    ports.storeToken(session.token);

    const who = await ports.health();
    state.pairedInstance = who.serviceInstanceId;
    ports.storeInstance(who.serviceInstanceId);
    ports.storeBaseUrl(
      state.overriddenOnLoad || state.baseUrl !== state.initialBaseUrl
        ? state.baseUrl
        : null,
    );
    state.pairPhase = "idle";
  } catch (error) {
    state.pairPhase = "failed";
    state.pairMessage = describeClientProblem(error);
  } finally {
    // A rejected hosted password keeps the in-memory ticket so the user can retry without
    // asking the CLI for another URL. A successful exchange consumes it locally too.
    if (state.token !== null) {
      state.ticket = "";
    }
    scrubPairingUrl(ports);
  }
}

export async function consumeInitialPairingUrl(
  state: WorkbenchSessionState,
  ports: WorkbenchSessionPorts,
): Promise<void> {
  if (!state.hadTicketOnLoad || state.ticket.length === 0) {
    return;
  }
  if (state.token === null && state.pairPhase === "idle") {
    await pairWorkbenchSession(state, ports);
    return;
  }
  if (state.token !== null) {
    state.ticket = "";
    scrubPairingUrl(ports);
  }
}

export function clearWorkbenchCredentials(
  state: WorkbenchSessionState,
  ports: Pick<WorkbenchSessionPorts, "clearStoredSession">,
): void {
  state.token = null;
  state.pairedInstance = null;
  ports.clearStoredSession();
}

export function isDefaultSessionBaseUrl(state: WorkbenchSessionState): boolean {
  return !state.overriddenOnLoad && state.baseUrl === state.initialBaseUrl;
}

export function describeClientProblem(error: unknown): string {
  if (error instanceof GitClientError) {
    const correlation =
      error.correlationId === null ? "" : ` (${error.correlationId})`;
    return `${error.code}: ${error.message}${correlation}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function scrubPairingUrl(ports: WorkbenchSessionPorts): void {
  ports.replaceHref(stripTicket(ports.currentHref()));
}
