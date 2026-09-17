/**
 * HTTP-specific adapter behaviour: pairing, where the bearer is allowed to travel,
 * what an older service is honestly allowed to claim, and the exactly-once write.
 *
 * The transport-neutral scenarios live in the shared conformance suite; these cases
 * exist because HTTP has properties no other adapter shares — a bearer, an Origin
 * header, a service that may predate the extension.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpBackendAdapter } from "@refyard/backend-http";
import { BackendError, type BackendSession } from "@refyard/git-service";
import {
  createAdapterHarness,
  type AdapterHarness,
} from "../support/adapter-harness.js";
import { ticketFrom } from "../support/service.js";
import type { OperationRecord } from "@refyard/git-contract";

let harness: AdapterHarness;

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

/** Waits for a queued operation to reach a terminal state through the adapter. */
async function waitForTerminal(
  session: BackendSession,
  operationId: string,
): Promise<OperationRecord> {
  const terminal = new Set([
    "succeeded",
    "failed",
    "needsAttention",
    "unknown",
    "cancelled",
  ]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await session.mutations.get(operationId);
    if (terminal.has(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`operation ${operationId} never reached a terminal state`);
}

beforeEach(async () => {
  harness = await createAdapterHarness();
  await harness.repo.write("a.txt", "base\nmodified in the working tree\n");
});

afterEach(async () => {
  await harness.dispose();
});

describe("http adapter pairing", () => {
  it("exchanges a ticket once and reports the session it obtained", async () => {
    // A ticket is single-use, so this asks the service for a fresh one rather than
    // reusing the ticket the harness already spent on its own bearer.
    const ticket = ticketFrom(harness.service.http.pairingUrl(harness.baseUrl));
    const session = await harness.connectHttp({ ticket });
    expect(session.state().phase).toBe("ready");
    expect(session.metadata.serviceInstanceId).toBe(harness.instanceId);
    expect(session.metadata.sessionId).not.toBeNull();
    const exchanges = harness.requestLog.filter((entry) =>
      entry.url.endsWith("/api/v1/session/exchange"),
    );
    expect(exchanges).toHaveLength(1);
    expect(harness.tokenEvents[0]).toMatch(/^rfs_/);
  });

  it("refuses to connect without a ticket or a stored bearer", async () => {
    // An unpaired browser must be told to pair, not handed a session whose every
    // read will fail with a 401 in some panel.
    const error = await expectBackendError(() =>
      harness.connectHttp({ token: null }),
    );
    expect(error.code).toBe("Unauthenticated");
    expect(
      harness.requestLog.filter((entry) =>
        entry.url.includes("/session/exchange"),
      ),
    ).toHaveLength(0);
  });

  it("drops a stored bearer the service rejects so the caller can re-pair", async () => {
    const error = await expectBackendError(() =>
      harness.connectHttp({ token: "rfs_not_a_real_token" }),
    );
    expect(error.code).toBe("Unauthenticated");
    expect(harness.tokenEvents).toEqual([null]);
  });

  it("never sends the bearer in a URL", async () => {
    const session = await harness.connectHttp();
    await session.git.repositories();
    for (const entry of harness.requestLog) {
      expect(entry.url).not.toContain(harness.secretToken);
    }
    const repositories = harness.requestLog.find((entry) =>
      entry.url.endsWith("/api/v1/repositories"),
    );
    expect(repositories?.headers["authorization"]).toBe(
      `Bearer ${harness.secretToken}`,
    );
  });
});

describe("http adapter against a service without execution targets", () => {
  it("reports legacy host capabilities instead of pretending ssh works", async () => {
    const session = await harness.connectHttp();
    const capabilities = await session.host.capabilities();
    expect(capabilities).toEqual({
      sshConfig: false,
      localFolderPicker: false,
      uncertainOperationAcknowledgement: false,
      targetKinds: ["local"],
    });
  });

  it("refuses ssh host listing with UnsupportedOperation, not an empty list", async () => {
    const session = await harness.connectHttp();
    const error = await expectBackendError(() => session.host.sshHosts());
    expect(error.code).toBe("UnsupportedOperation");
  });

  it("refuses the native folder dialog because a browser cannot open one", async () => {
    const session = await harness.connectHttp();
    const error = await expectBackendError(() =>
      session.host.pickLocalDirectory(),
    );
    expect(error.code).toBe("UnsupportedOperation");
  });

  it("does not turn a refused host probe into 'no ssh support'", async () => {
    // A 403 from the host capability route is an authorization failure. Reading it
    // as a missing feature would hide a scope problem behind a version story.
    const adapter = createHttpBackendAdapter({
      baseUrl: harness.baseUrl,
      fetch: (input, init) =>
        typeof input === "string" && input.includes("/api/v1/host/capabilities")
          ? Promise.resolve(
              Response.json(
                {
                  problem: {
                    code: "Forbidden",
                    message: "scope",
                    retryable: false,
                  },
                },
                { status: 403 },
              ),
            )
          : harness.fetch(input, init),
      initialToken: harness.secretToken,
    });
    const session: BackendSession = await adapter.connect({});
    const error = await expectBackendError(() => session.host.capabilities());
    expect(error.code).toBe("Forbidden");
    await session.dispose();
  });
});

describe("http adapter mutations", () => {
  it("stages one selected path and treats a repeat of the same request as a duplicate", async () => {
    const session = await harness.connectHttp();
    const repositoryId = harness.repositoryId;
    const status = await session.git.status({ repositoryId });
    const entry = status.entries.find(
      (candidate) => candidate.displayPath === "a.txt",
    );
    if (entry === undefined)
      throw new Error("the fixture lost its modified a.txt");

    const previews = await session.git.previews({
      repositoryId,
      worktreeId: status.worktreeId,
      pathIds: [entry.pathId],
    });
    const previewToken = previews.tokens[0]?.previewToken;
    if (previewToken === undefined)
      throw new Error("no preview token was issued");

    const request = {
      clientRequestId: "adapter-conformance-stage-1",
      target: {
        kind: "worktree" as const,
        repositoryId,
        worktreeId: status.worktreeId,
        expectedSnapshotId: status.snapshotId,
      },
      operation: {
        kind: "stagePaths" as const,
        pathIds: [entry.pathId],
        previewTokens: [previewToken],
      },
    };

    const first = await session.mutations.submit(request);
    expect(first.kind).toBe("accepted");
    if (first.kind !== "accepted")
      throw new Error("the first submit was not accepted");
    const second = await session.mutations.submit(request);
    expect(second.kind).toBe("duplicate");
    if (second.kind !== "duplicate")
      throw new Error("the repeat was not a duplicate");

    // The write is queued, so the Git state is only meaningful once the operation
    // has a terminal status — asserting earlier would assert the queue's speed.
    const record = await waitForTerminal(session, first.accepted.operationId);
    expect(record.status).toBe("succeeded");
    expect(record.operationId).toBe(second.record.operationId);

    const staged = new TextDecoder().decode(
      await harness.repo.git(["diff", "--cached", "--name-only"]),
    );
    expect(staged.trim()).toBe("a.txt");
    // b.txt stays untouched: staging one path must not become "stage everything".
    const other = new TextDecoder().decode(
      await harness.repo.git(["diff", "--cached", "--stat"]),
    );
    expect(other.split("\n").filter((line) => line.includes("|")).length).toBe(
      1,
    );
  });
});
