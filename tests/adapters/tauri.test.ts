/**
 * The native adapter's transport and lifecycle.
 *
 * What these cases are really about: a component must not be able to tell whether it is
 * talking to a WebView or to a service, and the ways that could leak are a command that
 * is not in the table, a response that was never validated, an event meant for another
 * window, and a subscription that outlives its session.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTauriBackendAdapter } from "@refyard/backend-tauri";
import { BackendError } from "@refyard/git-service";
import type { BackendSession } from "@refyard/git-service";
import {
  createRecordingNativePorts,
  nativeSessionPayload,
  nativeStatusPayload,
  respondForRead,
  type RecordingNativePorts,
} from "../support/native-ports.js";

let ports: RecordingNativePorts | null = null;
const sessions: BackendSession[] = [];

function recordingPorts(): RecordingNativePorts {
  if (ports === null)
    throw new Error("the native port harness was not started");
  return ports;
}

async function connect(): Promise<BackendSession> {
  const adapter = createTauriBackendAdapter({
    ports: recordingPorts(),
    nextSubscriptionId: () => "sub_1",
  });
  const session = await adapter.connect({});
  sessions.push(session);
  return session;
}

afterEach(async () => {
  for (const session of sessions) await session.dispose();
  sessions.length = 0;
  ports = null;
});

function startPorts(): RecordingNativePorts {
  const created = createRecordingNativePorts();
  created.respond("refyard_connect", () => nativeSessionPayload());
  created.respond("refyard_disconnect", () => null);
  created.respond("refyard_events_unsubscribe", () => null);
  created.respond("refyard_git_read", respondForRead);
  ports = created;
  return created;
}

async function expectBackendError(
  run: () => Promise<unknown>,
): Promise<BackendError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BackendError) return error;
    throw new Error(`expected a BackendError, received ${String(error)}`);
  }
  throw new Error("expected the call to fail");
}

describe("native adapter reads", () => {
  it("uses native IPC and never a localhost HTTP call", async () => {
    const harness = startPorts();
    const session = await connect();
    const status = await session.git.status({ repositoryId: "repo_1" });
    expect(status.head.branchName).toBe("main");
    expect(harness.lastCall("refyard_git_read")?.readMethod).toBe("status");
    // The whole command table is native: there is no fetch port to leak through, and
    // the adapter has no way to open a socket.
    for (const call of harness.calls) {
      expect(call.command.startsWith("refyard_")).toBe(true);
    }
  });

  it("carries the session id on every read so the host can bind it to this window", async () => {
    const harness = startPorts();
    const session = await connect();
    await session.git.refs({ repositoryId: "repo_1" });
    const call = harness.lastCall("refyard_git_read");
    expect(call?.args?.["sessionId"]).toBe("sess_1");
  });

  it("rejects a response that breaks the contract instead of rendering empty data", async () => {
    const harness = startPorts();
    harness.respond("refyard_git_read", () =>
      nativeStatusPayload({ entries: "not-an-array" }),
    );
    const session = await connect();
    const error = await expectBackendError(() =>
      session.git.status({ repositoryId: "repo_1" }),
    );
    expect(error.code).toBe("InternalError");
    expect(error.message).toContain("cannot validate");
  });

  it("maps a native problem body onto the shared error type", async () => {
    const harness = startPorts();
    harness.fail("refyard_git_read", {
      problem: { code: "Forbidden", message: "not in scope", retryable: false },
    });
    const session = await connect();
    const error = await expectBackendError(() =>
      session.git.status({ repositoryId: "repo_elsewhere" }),
    );
    expect(error.code).toBe("Forbidden");
  });

  it("refuses to pair a native session with an HTTP ticket", async () => {
    startPorts();
    const adapter = createTauriBackendAdapter({ ports: recordingPorts() });
    const error = await expectBackendError(() =>
      adapter.connect({ ticket: "tkt_1" }),
    );
    expect(error.code).toBe("InvalidRequest");
    expect(recordingPorts().calls).toHaveLength(0);
  });

  it("refuses a handshake the host answers with the wrong shape", async () => {
    const harness = startPorts();
    harness.respond("refyard_connect", () => ({ sessionId: "sess_1" }));
    const adapter = createTauriBackendAdapter({ ports: harness });
    const error = await expectBackendError(() => adapter.connect({}));
    expect(error.code).toBe("InternalError");
  });
});

describe("native adapter events", () => {
  const frame = (
    sequence: number,
    subscriptionId = "sub_1",
    sessionId = "sess_1",
  ) => ({
    sessionId,
    subscriptionId,
    serviceInstanceId: "srvc_1",
    event: {
      sequence,
      emittedAt: "2026-09-18T00:00:00.000Z",
      payload: {
        kind: "repositoryChanged",
        repositoryId: "repo_1",
        worktreeIds: ["wt_1"],
        snapshotInvalidated: false,
      },
    },
  });

  it("listens before subscribing and delivers the replay plus what arrived meanwhile", async () => {
    const harness = startPorts();
    harness.respond("refyard_events_subscribe", () => ({
      subscriptionId: "sub_1",
      serviceInstanceId: "srvc_1",
      highWatermark: 1,
      replay: [frame(1).event],
    }));
    const session = await connect();
    const seen: number[] = [];
    // The live event arrives while the handshake is still in flight: an adapter that
    // registered its listener second would lose it.
    harness.respond("refyard_events_subscribe", async () => {
      harness.emit(frame(2));
      return {
        subscriptionId: "sub_1",
        serviceInstanceId: "srvc_1",
        highWatermark: 1,
        replay: [frame(1).event],
      };
    });
    const subscription = await session.events.subscribe({
      onEvent: (event) => seen.push(event.sequence),
      onGap: () => undefined,
      onState: () => undefined,
      onError: () => undefined,
    });
    expect(seen).toEqual([1, 2]);
    await subscription.dispose();
  });

  it("drops an event it already replayed instead of delivering it twice", async () => {
    const harness = startPorts();
    harness.respond("refyard_events_subscribe", async () => {
      // The same event arrives live *and* in the replay: the caller must see one.
      harness.emit(frame(1));
      return {
        subscriptionId: "sub_1",
        serviceInstanceId: "srvc_1",
        highWatermark: 1,
        replay: [frame(1).event],
      };
    });
    const session = await connect();
    const seen: number[] = [];
    const subscription = await session.events.subscribe({
      onEvent: (event) => seen.push(event.sequence),
      onGap: () => undefined,
      onState: () => undefined,
      onError: () => undefined,
    });
    expect(seen).toEqual([1]);
    await subscription.dispose();
  });

  it("ignores a frame addressed to another window", async () => {
    // Window B must not receive window A's repository events, even if a frame is
    // broadcast by mistake.
    const harness = startPorts();
    harness.respond("refyard_events_subscribe", () => ({
      subscriptionId: "sub_1",
      serviceInstanceId: "srvc_1",
      highWatermark: 0,
      replay: [],
    }));
    const session = await connect();
    const seen: number[] = [];
    const subscription = await session.events.subscribe({
      onEvent: (event) => seen.push(event.sequence),
      onGap: () => undefined,
      onState: () => undefined,
      onError: () => undefined,
    });
    harness.emit(frame(5, "sub_2"));
    harness.emit(frame(6, "sub_1", "sess_other"));
    harness.emit(frame(7));
    expect(seen).toEqual([7]);
    await subscription.dispose();
  });

  it("reports a gap rather than pretending the sequence is continuous", async () => {
    const harness = startPorts();
    harness.respond("refyard_events_subscribe", () => ({
      subscriptionId: "sub_1",
      serviceInstanceId: "srvc_1",
      highWatermark: 0,
      replay: [],
    }));
    const session = await connect();
    const gaps: { fromSequence: number; toSequence: number }[] = [];
    const subscription = await session.events.subscribe({
      onEvent: () => undefined,
      onGap: (gap) => gaps.push(gap),
      onState: () => undefined,
      onError: () => undefined,
    });
    harness.emit({
      sessionId: "sess_1",
      subscriptionId: "sub_1",
      serviceInstanceId: "srvc_1",
      event: {
        sequence: 9,
        emittedAt: "2026-09-18T00:00:00.000Z",
        payload: { kind: "eventGap", fromSequence: 3, toSequence: 9 },
      },
    });
    expect(gaps).toEqual([{ fromSequence: 3, toSequence: 9 }]);
    await subscription.dispose();
  });

  it("stops listening when the session is disposed", async () => {
    const harness = startPorts();
    harness.respond("refyard_events_subscribe", () => ({
      subscriptionId: "sub_1",
      serviceInstanceId: "srvc_1",
      highWatermark: 0,
      replay: [],
    }));
    const session = await connect();
    await session.events.subscribe({
      onEvent: () => undefined,
      onGap: () => undefined,
      onState: () => undefined,
      onError: () => undefined,
    });
    expect(harness.activeListeners()).toBe(1);
    await session.dispose();
    expect(harness.activeListeners()).toBe(0);
    expect(harness.lastCall("refyard_events_unsubscribe")).toBeDefined();
    expect(harness.lastCall("refyard_disconnect")).toBeDefined();
  });
});

describe("native adapter mutations", () => {
  it("does not send a second submission when the first response is lost", async () => {
    // The failure this prevents: a dropped response read as "it did not happen", so a
    // single commit is submitted twice.
    const harness = startPorts();
    harness.fail("refyard_mutation_submit", {
      problem: {
        code: "Unavailable",
        message: "the session ended before the host answered",
        retryable: true,
      },
    });
    const session = await connect();
    await expectBackendError(() =>
      session.mutations.submit({
        clientRequestId: "req-1",
        target: {
          kind: "repository",
          repositoryId: "repo_1",
          expectedSnapshotId: "snap_1",
        },
        operation: {
          kind: "createBranch",
          branchName: "feature",
          startOid: null,
          switchToIt: false,
        },
      }),
    );
    const submissions = harness.calls.filter(
      (call) => call.command === "refyard_mutation_submit",
    );
    expect(submissions).toHaveLength(1);
  });

  it("reports a replayed submission as a duplicate rather than a new operation", async () => {
    const harness = startPorts();
    harness.respond("refyard_mutation_submit", () => ({
      kind: "duplicate",
      record: {
        operationId: "op_1",
        clientRequestId: "req-1",
        kind: "createBranch",
        target: {
          kind: "repository",
          repositoryId: "repo_1",
          expectedSnapshotId: "snap_1",
        },
        status: "succeeded",
        sequence: 2,
        acceptedAt: "2026-09-18T00:00:00.000Z",
        startedAt: "2026-09-18T00:00:00.000Z",
        finishedAt: "2026-09-18T00:00:01.000Z",
        result: null,
        problem: null,
      },
    }));
    const session = await connect();
    const result = await session.mutations.submit({
      clientRequestId: "req-1",
      target: {
        kind: "repository",
        repositoryId: "repo_1",
        expectedSnapshotId: "snap_1",
      },
      operation: {
        kind: "createBranch",
        branchName: "feature",
        startOid: null,
        switchToIt: false,
      },
    });
    expect(result.kind).toBe("duplicate");
  });
});
