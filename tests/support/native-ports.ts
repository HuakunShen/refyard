/**
 * A recording stand-in for Tauri's `invoke` and `listen`.
 *
 * The adapter takes its ports as an argument precisely so this can exist: the whole
 * command table, the handshake ordering and the event filtering are testable without a
 * WebView, and a case can assert *which* command was called as well as what came back.
 * What this cannot prove is that the Rust side implements those commands — that is the
 * desktop crate's own test's job, and the acceptance run's.
 */
import type { NativePorts } from "@refyard/backend-tauri";

export interface RecordedCall {
  readonly command: string;
  readonly args: Record<string, unknown> | undefined;
  /** The read method inside a `refyard_git_read` envelope, when there is one. */
  readonly readMethod: string | undefined;
}

export type NativeResponder = (
  args: Record<string, unknown> | undefined,
) => unknown | Promise<unknown>;

export interface RecordingNativePorts extends NativePorts {
  readonly calls: readonly RecordedCall[];
  /** Queue a response for a command; the last one set wins. */
  respond(command: string, responder: NativeResponder): void;
  /** Make a command reject, as the Rust side does with a `{ problem }` body. */
  fail(command: string, problem: Record<string, unknown>): void;
  /** Deliver an event to every live listener, as `emit_to` would. */
  emit(payload: unknown): void;
  activeListeners(): number;
  lastCall(command: string): RecordedCall | undefined;
  reset(): void;
  /** Subscription ids this harness handed out, so a case can name one. */
  readonly subscriptions: readonly string[];
}

export function createRecordingNativePorts(): RecordingNativePorts {
  const calls: RecordedCall[] = [];
  const listeners = new Set<(event: { payload: unknown }) => void>();
  const responders = new Map<string, NativeResponder>();
  const failures = new Map<string, Record<string, unknown>>();
  const subscriptions: string[] = [];

  const ports: RecordingNativePorts = {
    calls,
    subscriptions,
    respond(command, responder) {
      failures.delete(command);
      responders.set(command, responder);
    },
    fail(command, problem) {
      responders.delete(command);
      failures.set(command, problem);
    },
    emit(payload) {
      for (const listener of [...listeners]) listener({ payload });
    },
    activeListeners: () => listeners.size,
    lastCall: (command) =>
      [...calls].reverse().find((call) => call.command === command),
    reset() {
      calls.length = 0;
      subscriptions.length = 0;
      responders.clear();
      failures.clear();
    },
    async invoke<T>(
      command: Parameters<NativePorts["invoke"]>[0],
      args?: Record<string, unknown>,
    ): Promise<T> {
      const readRequest = args?.["request"];
      const readMethod =
        command === "refyard_git_read" &&
        typeof readRequest === "object" &&
        readRequest !== null
          ? String(Reflect.get(readRequest, "method"))
          : undefined;
      calls.push({ command, args, readMethod });
      const failure = failures.get(command);
      if (failure !== undefined) {
        // The Rust side rejects with `{ problem }`; matching that shape here keeps the
        // adapter's error mapping under test instead of bypassed.
        throw failure;
      }
      const responder = responders.get(command);
      if (responder === undefined) {
        throw {
          problem: {
            code: "UnsupportedOperation",
            message: `${command} is not stubbed`,
            retryable: false,
          },
        };
      }
      const value = await responder(args);
      if (command === "refyard_events_subscribe")
        subscriptions.push(String(readSubscription(args)));
      return value as T;
    },
    async listen(
      _event: string,
      handler: (event: { readonly payload: unknown }) => void,
    ): Promise<() => void> {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
  return ports;
}

function readSubscription(args: Record<string, unknown> | undefined): string {
  return args === undefined ? "" : String(args["subscriptionId"] ?? "");
}

/** A complete, schema-valid status snapshot for tests that only care about transport. */
export function nativeStatusPayload(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    snapshotId: "snap_1",
    repositoryId: "repo_1",
    worktreeId: "wt_1",
    readAt: "2026-09-18T00:00:00.000Z",
    head: {
      kind: "born",
      branchName: "main",
      oid: "1".repeat(40),
      detached: false,
    },
    upstream: null,
    operationInProgress: null,
    entries: [],
    entryCount: 0,
    truncated: false,
    ...overrides,
  };
}

/** A complete native session handshake response. */
export function nativeSessionPayload(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    sessionId: "sess_1",
    serviceInstanceId: "srvc_1",
    cacheNamespace: "native/srvc_1/sess_1",
    backendLabel: "Refyard",
    ...overrides,
  };
}

/** A complete, schema-valid refs snapshot for tests that only care about transport. */
export function nativeRefsPayload(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    snapshotId: "snap_1",
    repositoryId: "repo_1",
    readAt: "2026-09-18T00:00:00.000Z",
    objectFormat: "sha1",
    head: {
      kind: "born",
      branchName: "main",
      oid: "1".repeat(40),
      detached: false,
    },
    branches: [
      {
        name: "main",
        fullName: "refs/heads/main",
        oid: "1".repeat(40),
        isCurrent: true,
        upstream: null,
      },
    ],
    remoteBranches: [],
    tags: [],
    remotes: [],
    otherRefs: [],
    truncated: false,
    ...overrides,
  };
}

/** Answers a `refyard_git_read` envelope with the payload its method expects. */
export function respondForRead(
  args: Record<string, unknown> | undefined,
): unknown {
  const request = args?.["request"];
  const method =
    typeof request === "object" && request !== null
      ? Reflect.get(request, "method")
      : undefined;
  if (method === "refs") return nativeRefsPayload();
  return nativeStatusPayload();
}
