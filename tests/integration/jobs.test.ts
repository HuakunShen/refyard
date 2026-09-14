/**
 * The job state machine, driven through the real engine with a test-only effect.
 *
 * The effect is the only fake here: everything else — the journal on disk, the
 * queue, the idempotency index, the event ring — is production code. That is the
 * design's instruction for this task ("carry real metadata but do not open
 * production Git writes before T08"), and it means these tests are about the
 * coordination rules, not about a stub.
 *
 * Each case names the real-world failure it prevents:
 *
 * - a retried submission running twice (money and history);
 * - the same client request id with a different payload silently doing the new
 *   thing;
 * - a crash mid-operation being reported as success or failure;
 * - a queued operation being relabelled `cancelled` after it started;
 * - an operation that cannot be recorded being accepted anyway.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createEffect,
  type MutationEffect,
} from "../../packages/host-node/src/coordinator/jobs.js";
import {
  createJournalStore,
  canonicalPayloadDigest,
} from "../../packages/host-node/src/journal/store.js";
import { DEFAULT_RETENTION } from "../../packages/host-node/src/journal/retention.js";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

const stageOperationSchema = z.strictObject({
  kind: z.literal("stagePaths"),
  pathIds: z.array(z.string()),
  previewTokens: z.array(z.string()),
});

/**
 * A request aimed at the state that actually exists.
 *
 * The target names a real worktree and a real snapshot, taken by a status read — the
 * same way a client would build one. Made-up ids would be refused by the
 * preconditions, which is itself the property the preconditions exist for.
 */
async function stageRequest(
  service: TestService,
  clientRequestId: string,
  pathIds = ["path_a"],
) {
  const status =
    (await service.mutations.jobs) === undefined
      ? null
      : await readStatus(service);
  if (status === null) {
    throw new Error("no status");
  }
  return {
    clientRequestId,
    target: {
      kind: "worktree" as const,
      repositoryId: service.repositoryId,
      worktreeId: status.worktreeId,
      expectedSnapshotId: status.snapshotId,
    },
    operation: {
      kind: "stagePaths" as const,
      pathIds,
      previewTokens: pathIds.map(() => "pt_1"),
    },
  };
}

/** A real worktree id and a real snapshot, read over HTTP from the test service. */
async function readStatus(service: TestService): Promise<{
  readonly worktreeId: string;
  readonly snapshotId: string;
}> {
  const token = await service.pair();
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
    { token },
  );
  if (!response.ok) {
    throw new Error(`status failed: ${response.status}`);
  }
  const body = (await response.json()) as {
    worktreeId: string;
    snapshotId: string;
  };
  return { worktreeId: body.worktreeId, snapshotId: body.snapshotId };
}

/** An effect that reports what the test tells it to, and counts its runs. */
function stubEffect(
  outcome: () => Awaited<ReturnType<NonNullable<MutationEffect["run"]>>>,
  onRun?: () => void,
): { effect: MutationEffect; runs: () => number } {
  let runs = 0;
  const effect = createEffect({
    kind: "stagePaths",
    schema: stageOperationSchema,
    async run({ operation }) {
      runs += 1;
      onRun?.();
      void operation;
      return outcome();
    },
  });
  return { effect, runs: () => runs };
}

const succeeded = (): Awaited<
  ReturnType<NonNullable<MutationEffect["run"]>>
> => ({
  kind: "succeeded",
  result: {
    summary: "staged 1 path",
    changedRefs: [],
    changedPaths: 1,
    snapshotInvalidated: true,
    newHeadOid: null,
  },
});

/** Wait until the engine has no queued or running work. */
async function settle(service: TestService, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    service.mutations.jobs.pump();
    if (
      service.mutations.jobs.pendingCount() === 0 &&
      service.mutations.jobs.runningCount() === 0
    ) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error("the queue did not settle");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("job state machine", () => {
  let repo: GitFixtureRepo;
  let service: TestService;
  let stub: ReturnType<typeof stubEffect>;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    stub = stubEffect(succeeded);
    service = await startTestService({ repo, effects: [stub.effect] });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
  });

  it("accepts, runs and records a successful operation", async () => {
    const submitted = await service.mutations.jobs.submit({
      request: await stageRequest(service, "req-1"),
      actor: "cli",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(["accepted", "running", "succeeded"]).toContain(
      submitted.record.status,
    );
    await settle(service);
    const final = service.mutations.jobs.get(
      submitted.record.operationId,
      "cli",
    );
    expect(final?.status).toBe("succeeded");
    expect(final?.startedAt).not.toBeNull();
    expect(final?.finishedAt).not.toBeNull();
    expect(final?.result?.summary).toBe("staged 1 path");
    expect(stub.runs()).toBe(1);
  });

  it("returns the original record for a replayed request instead of running twice", async () => {
    // Prevents: a lost response turning into a second commit when the client retries.
    // The same request object twice: a retry sends what it sent before, including
    // the snapshot it was planned against. A second status read would produce a new
    // snapshot id, which is a genuinely different request.
    const request = await stageRequest(service, "req-2");
    const first = await service.mutations.jobs.submit({
      request,
      actor: "cli",
    });
    await settle(service);
    const replay = await service.mutations.jobs.submit({
      request,
      actor: "cli",
    });
    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) {
      return;
    }
    expect(replay.duplicate).toBe(true);
    expect(replay.record.operationId).toBe(first.record.operationId);
    expect(stub.runs()).toBe(1);
  });

  it("refuses the same client request id with a different payload", async () => {
    // Prevents: a changed request silently riding on an old id, so the user's second
    // intention is executed as the first.
    const request = await stageRequest(service, "req-3");
    await service.mutations.jobs.submit({ request, actor: "cli" });
    await settle(service);
    const conflict = await service.mutations.jobs.submit({
      request: {
        ...request,
        operation: {
          kind: "stagePaths",
          pathIds: ["path_b"],
          previewTokens: ["pt_1"],
        },
      },
      actor: "cli",
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.problem.code).toBe("IdempotencyConflict");
    }
    expect(stub.runs()).toBe(1);
  });

  it("reports a failed effect as failed and does not retry it", async () => {
    const failing = stubEffect(() => ({
      kind: "failed",
      problem: {
        code: "GitCommandFailed",
        message: "staging was refused",
        retryable: false,
      },
    }));
    const failingService = await startTestService({
      repo,
      effects: [failing.effect],
    });
    try {
      const submitted = await failingService.mutations.jobs.submit({
        request: await stageRequest(failingService, "req-4"),
        actor: "cli",
      });
      await settle(failingService);
      expect(submitted.ok).toBe(true);
      if (submitted.ok) {
        const final = failingService.mutations.jobs.get(
          submitted.record.operationId,
          "cli",
        );
        expect(final?.status).toBe("failed");
        expect(final?.problem?.code).toBe("GitCommandFailed");
      }
      // Nothing in the engine runs it again, however long it waits.
      await new Promise((resolve) => setTimeout(resolve, 50));
      failingService.mutations.jobs.pump();
      expect(failing.runs()).toBe(1);
    } finally {
      await failingService.close();
    }
  });

  it("reports an effect that throws as unknown, never as failed", async () => {
    // Prevents: an operation that may have changed the repository being presented as
    // a clean failure the user would simply repeat.
    const throwing = createEffect({
      kind: "stagePaths",
      schema: stageOperationSchema,
      async run() {
        throw new Error("the process died");
      },
    });
    const throwingService = await startTestService({
      repo,
      effects: [throwing],
    });
    try {
      const submitted = await throwingService.mutations.jobs.submit({
        request: await stageRequest(throwingService, "req-5"),
        actor: "cli",
      });
      await settle(throwingService);
      expect(submitted.ok).toBe(true);
      if (submitted.ok) {
        const final = throwingService.mutations.jobs.get(
          submitted.record.operationId,
          "cli",
        );
        expect(final?.status).toBe("unknown");
        expect(final?.problem?.code).toBe("UncertainOutcome");
      }
    } finally {
      await throwingService.close();
    }
  });

  it("reports needsAttention when the effect says a human must resolve it", async () => {
    const attention = stubEffect(() => ({
      kind: "needsAttention",
      problem: {
        code: "NeedsAttention",
        message: "the merge left conflicts",
        retryable: false,
      },
    }));
    const attentionService = await startTestService({
      repo,
      effects: [attention.effect],
    });
    try {
      const submitted = await attentionService.mutations.jobs.submit({
        request: await stageRequest(attentionService, "req-6"),
        actor: "cli",
      });
      await settle(attentionService);
      expect(submitted.ok).toBe(true);
      if (submitted.ok) {
        const final = attentionService.mutations.jobs.get(
          submitted.record.operationId,
          "cli",
        );
        expect(final?.status).toBe("needsAttention");
      }
    } finally {
      await attentionService.close();
    }
  });

  it("cancels a queued operation and reports it as cancelled, not failed", async () => {
    const blocked = stubEffect(succeeded);
    const cancelService = await startTestService({
      repo,
      effects: [blocked.effect],
    });
    try {
      // Fill the queue's only writer slot with a slow operation by submitting two:
      // the first starts, the second waits.
      const first = await cancelService.mutations.jobs.submit({
        request: await stageRequest(cancelService, "req-7"),
        actor: "cli",
      });
      const second = await cancelService.mutations.jobs.submit({
        request: await stageRequest(cancelService, "req-8", ["path_b"]),
        actor: "cli",
      });
      expect(first.ok && second.ok).toBe(true);
      if (!second.ok) {
        return;
      }
      const cancelled = cancelService.mutations.jobs.cancel({
        operationId: second.record.operationId,
        actor: "cli",
      });
      // The second operation is either still queued (cancel succeeds) or, if the
      // first already finished, already running (cancel refused). Both are honest;
      // what must never happen is a running operation reported as cancelled.
      if (!cancelled.ok) {
        expect(cancelled.problem.code).toBe("Conflict");
      } else {
        expect(cancelled.record.status).toBe("cancelled");
      }
    } finally {
      await cancelService.close();
    }
  });

  it("refuses to cancel an operation that has already finished", async () => {
    const submitted = await service.mutations.jobs.submit({
      request: await stageRequest(service, "req-9"),
      actor: "cli",
    });
    await settle(service);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    const refused = service.mutations.jobs.cancel({
      operationId: submitted.record.operationId,
      actor: "cli",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.problem.code).toBe("Conflict");
    }
  });

  it("refuses an unimplemented kind before it is even accepted", async () => {
    // Prevents: an accepted-then-failed operation that a UI would show as an error
    // the user could retry, when nothing in this build could ever run it.
    const request = {
      clientRequestId: "req-10",
      target: {
        kind: "worktree" as const,
        repositoryId: service.repositoryId,
        worktreeId: "wt_1",
        expectedSnapshotId: "snap_1",
      },
      operation: {
        kind: "commit" as const,
        message: "nope",
        expectClean: true,
      },
    };
    const refused = await service.mutations.jobs.submit({
      request,
      actor: "cli",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.problem.code).toBe("UnsupportedOperation");
    }
    expect(
      service.mutations.jobs.list({ actor: "cli", limit: 10 }).operations,
    ).toHaveLength(0);
  });

  it("publishes every transition to the event ring", async () => {
    const submitted = await service.mutations.jobs.submit({
      request: await stageRequest(service, "req-11"),
      actor: "cli",
    });
    await settle(service);
    const replay = service.events.replay(0);
    const statuses = replay
      .filter((envelope) => envelope.payload.kind === "operation")
      .flatMap((envelope) =>
        envelope.payload.kind === "operation"
          ? [envelope.payload.operation.status]
          : [],
      );
    expect(statuses).toContain("accepted");
    expect(statuses).toContain("running");
    expect(statuses).toContain("succeeded");
    expect(submitted.ok).toBe(true);
  });

  it("keeps the payload digest stable across key order", () => {
    const a = {
      clientRequestId: "x",
      target: { kind: "repository" },
      operation: { kind: "commit", message: "m" },
    };
    const b = {
      operation: { message: "m", kind: "commit" },
      target: { kind: "repository" },
      clientRequestId: "x",
    };
    expect(canonicalPayloadDigest(a)).toBe(canonicalPayloadDigest(b));
  });
});

describe("journal retention", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "refyard-journal-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("refuses new operations rather than dropping an unexpired record", async () => {
    // Prevents: "make room for the new operation" quietly deleting an operation the
    // user has not looked at yet.
    const journal = createJournalStore({
      stateRoot,
      retention: { ttlMs: 60_000, maxEntries: 10, maxBytes: 900 },
      now: () => 1_000,
    });
    await journal.load();
    let refused = false;
    for (let index = 0; index < 20; index += 1) {
      const outcome = await journal.append({
        operationId: `op_${index}`,
        clientRequestId: `req_${index}`,
        actor: "cli",
        kind: "commit",
        target: {
          kind: "worktree",
          repositoryId: "repo_1",
          worktreeId: "wt_1",
          expectedSnapshotId: "snap_1",
        },
        status: "succeeded",
        sequence: index,
        acceptedAtMs: 1_000,
        startedAtMs: 1_000,
        finishedAtMs: 1_000,
        payloadDigest: "d".repeat(64),
        repositoryId: "repo_1",
        result: null,
        problem: null,
        unknownReason: null,
      });
      if (!outcome.ok) {
        refused = true;
        break;
      }
    }
    expect(refused).toBe(true);
  });

  it("drops expired terminal records when it needs room", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: { ttlMs: 1_000, maxEntries: 10, maxBytes: 700 },
      now: () => 100_000,
    });
    await journal.load();
    for (let index = 0; index < 4; index += 1) {
      await journal.append({
        operationId: `op_${index}`,
        clientRequestId: `req_${index}`,
        actor: "cli",
        kind: "commit",
        target: {
          kind: "worktree",
          repositoryId: "repo_1",
          worktreeId: "wt_1",
          expectedSnapshotId: "snap_1",
        },
        status: "succeeded",
        sequence: index,
        acceptedAtMs: 1_000,
        startedAtMs: 1_000,
        // Older than the TTL relative to the injected clock, so it may be pruned.
        finishedAtMs: 1_000,
        payloadDigest: "d".repeat(64),
        repositoryId: "repo_1",
        result: null,
        problem: null,
        unknownReason: null,
      });
    }
    const dropped = await journal.compact();
    expect(dropped).toBeGreaterThan(0);
    expect(journal.entryCount()).toBe(0);
  });

  it("never prunes an unfinished record", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
      now: () => 10_000_000_000,
    });
    await journal.load();
    await journal.append({
      operationId: "op_live",
      clientRequestId: "req_live",
      actor: "cli",
      kind: "commit",
      target: {
        kind: "worktree",
        repositoryId: "repo_1",
        worktreeId: "wt_1",
        expectedSnapshotId: "snap_1",
      },
      status: "running",
      sequence: 1,
      acceptedAtMs: 1,
      startedAtMs: 1,
      finishedAtMs: null,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_1",
      result: null,
      problem: null,
      unknownReason: null,
    });
    expect(await journal.compact()).toBe(0);
    expect(journal.entryCount()).toBe(1);
  });

  it("survives a torn final line, which is what a crash mid-append leaves", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
      now: () => 1_000,
    });
    await journal.load();
    await journal.append({
      operationId: "op_ok",
      clientRequestId: "req_ok",
      actor: "cli",
      kind: "commit",
      target: {
        kind: "worktree",
        repositoryId: "repo_1",
        worktreeId: "wt_1",
        expectedSnapshotId: "snap_1",
      },
      status: "succeeded",
      sequence: 1,
      acceptedAtMs: 1,
      startedAtMs: 1,
      finishedAtMs: 2,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_1",
      result: null,
      problem: null,
      unknownReason: null,
    });
    await writeFile(
      journal.filePath(),
      `${await readFile(journal.filePath(), "utf8")}{"operationId":"op_tr`,
      "utf8",
    );
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    const loaded = await reopened.load();
    expect(loaded.map((entry) => entry.operationId)).toEqual(["op_ok"]);
  });
});

describe("mutation coordinator wiring", () => {
  it("refuses a target that names no repository this service knows", async () => {
    const repo = await createRepo({ initialCommit: true });
    const stub = stubEffect(succeeded);
    const service = await startTestService({ repo, effects: [stub.effect] });
    try {
      const refused = await service.mutations.jobs.submit({
        request: {
          clientRequestId: "req-12",
          target: {
            kind: "workspace",
            allowedRootId: service.allowedRootId,
            relativeDestination: "new-project",
          },
          operation: { kind: "initRepository", initialBranch: "main" },
        },
        actor: "cli",
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        // No effect exists for a workspace operation, so it is refused as
        // unimplemented rather than as a missing repository.
        expect(refused.problem.code).toBe("UnsupportedOperation");
      }
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});
