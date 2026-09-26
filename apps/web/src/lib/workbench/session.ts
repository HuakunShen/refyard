/**
 * Browser-independent workbench session state.
 *
 * The Svelte page owns reactivity; this module owns the security-sensitive transitions that turn a
 * one-time pairing ticket into a remembered tab session. Keeping the mutations on a plain object
 * means the page can wrap it in `$state`, while Node tests can exercise the exact same logic.
 *
 * The bearer this state remembers belongs to the HTTP pairing form only. The adapter that owns the
 * connection keeps the credential in its own closure; nothing else in the workbench reads this
 * field, and no query key or capability gate is allowed to depend on it.
 */
import { GitClientError } from "@refyard/git-client";
import { problemSchema } from "@refyard/git-contract";
import { isBackendError } from "@refyard/git-service";
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
    state.pairMessage = describePairingFailure(error);
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
  // A remembered bearer proves nothing until the service answers it, and the ordinary way it
  // stops working is that the service restarted under the same address — every restart mints
  // new sessions. So the ticket this page arrived with is *kept* rather than scrubbed, and the
  // caller spends it when the remembered session turns out to be dead (see
  // `WorkbenchRuntime.start`). Discarding it here is what turns "open this URL to pair" into a
  // pairing form the user has no way to satisfy.
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

/**
 * The only failure describer the workbench display may use.
 *
 * A `BackendError` already carries the contract's problem code, retryability and
 * correlation id; a validated `Problem` (the connection state's own error type) is the
 * same vocabulary. Anything else is reported as an internal failure rather than read
 * for English text: guessing `Forbidden` from a message is how a transport detail
 * becomes a permission decision.
 */
export function describeBackendProblem(error: unknown): string {
  if (isBackendError(error)) {
    return formatProblem(error.code, error.message, error.correlationId);
  }
  const problem = problemSchema.safeParse(error);
  if (problem.success) {
    return formatProblem(problem.data.code, problem.data.message, null);
  }
  return "InternalError: the workbench hit an unexpected failure and cannot describe it";
}

/**
 * The pairing form's failure describer.
 *
 * It predates the adapter split and still reports a thrown error's message: the pairing
 * form is the one place a failure can arrive from a port the tests drive directly, and a
 * blank panel there would leave the user with no way to learn the ticket was refused.
 */
export function describePairingFailure(error: unknown): string {
  if (isBackendError(error)) {
    return formatProblem(error.code, error.message, error.correlationId);
  }
  if (error instanceof GitClientError) {
    return formatProblem(error.code, error.message, error.correlationId);
  }
  return error instanceof Error ? error.message : String(error);
}

function formatProblem(
  code: string,
  message: string,
  correlationId: string | null,
): string {
  return correlationId === null
    ? `${code}: ${message}`
    : `${code}: ${message} (${correlationId})`;
}

function scrubPairingUrl(ports: WorkbenchSessionPorts): void {
  ports.replaceHref(stripTicket(ports.currentHref()));
}
