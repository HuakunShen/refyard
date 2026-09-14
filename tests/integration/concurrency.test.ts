/**
 * Concurrency: the queue's limits, and the event stream that reports on them.
 *
 * The queue's guarantees are narrow and worth stating exactly, because the design
 * forbids overclaiming them: this service serialises *its own* writes to one
 * repository. It does not lock out an IDE, a terminal or another agent, it never
 * deletes a Git lock file, and it never forces an operation to make progress.
 *
 * The cases here check the parts that are easy to get wrong in a scheduler:
 *
 * - a second writer for the same repository waits rather than running at once;
 * - reads are not blocked by an unrelated repository's write, and two reads of one
 *   repository are allowed while a third waits;
 * - the per-actor queue bound refuses work instead of growing without limit;
 * - a released permit is reusable, so one failed operation does not wedge the queue;
 * - the SSE stream replays what a client missed and reports a `eventGap` when the
 *   ring no longer holds its position.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createQueue,
  DEFAULT_QUEUE_LIMITS,
} from "../../packages/host-node/src/coordinator/queue.js";
import {
  createEventRing,
  sseFrame,
} from "../../packages/host-node/src/http/events.js";
import { LIMITS } from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";
import { createEffect } from "../../packages/host-node/src/coordinator/jobs.js";
import { z } from "zod";

describe("queue limits", () => {
  it("runs one writer per repository and queues the next", () => {
    const queue = createQueue<string>({ limits: { maxQueuedPerActor: 10 } });
    const releases: (() => void)[] = [];
    queue.enqueue({
      id: "a",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "a",
    });
    queue.enqueue({
      id: "b",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "b",
    });
    queue.run((ticket, release) => {
      releases.push(release);
      void ticket;
    });
    expect(queue.runningCount()).toBe(1);
    expect(queue.pendingCount()).toBe(1);
    expect(queue.state().writers).toEqual(["repo_a"]);

    // Releasing the first lets the second start on the next pump.
    releases[0]?.();
    queue.run((_ticket, release) => {
      releases.push(release);
    });
    expect(queue.runningCount()).toBe(1);
    expect(queue.pendingCount()).toBe(0);
    releases[1]?.();
  });

  it("runs reads of different repositories side by side", () => {
    const queue = createQueue<string>();
    queue.enqueue({
      id: "a",
      actor: "one",
      repositoryId: "repo_a",
      mode: "read",
      job: "a",
    });
    queue.enqueue({
      id: "b",
      actor: "one",
      repositoryId: "repo_b",
      mode: "read",
      job: "b",
    });
    const started: string[] = [];
    queue.run((ticket, release) => {
      started.push(ticket.id);
      void release;
    });
    expect(started.sort()).toEqual(["a", "b"]);
  });

  it("caps readers per repository and leaves a third one queued", () => {
    const queue = createQueue<string>();
    for (const id of ["a", "b", "c"]) {
      queue.enqueue({
        id,
        actor: "one",
        repositoryId: "repo_a",
        mode: "read",
        job: id,
      });
    }
    queue.run((_ticket, release) => {
      void release;
    });
    expect(queue.runningCount()).toBe(
      DEFAULT_QUEUE_LIMITS.maxReadersPerRepository,
    );
    expect(queue.pendingCount()).toBe(1);
  });

  it("does not start a read while the same repository is being written", () => {
    // Prevents: a status read racing an index rewrite and reporting a half-staged
    // state as the truth.
    const queue = createQueue<string>();
    queue.enqueue({
      id: "w",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "w",
    });
    queue.enqueue({
      id: "r",
      actor: "one",
      repositoryId: "repo_a",
      mode: "read",
      job: "r",
    });
    queue.run((_ticket, release) => {
      void release;
    });
    expect(queue.state().running).toEqual(["w"]);
    expect(queue.pendingCount()).toBe(1);
  });

  it("refuses work past the per-actor bound", () => {
    const queue = createQueue<string>({ limits: { maxQueuedPerActor: 2 } });
    expect(
      queue.enqueue({
        id: "1",
        actor: "one",
        repositoryId: "r",
        mode: "write",
        job: "1",
      }).ok,
    ).toBe(true);
    expect(
      queue.enqueue({
        id: "2",
        actor: "one",
        repositoryId: "r",
        mode: "write",
        job: "2",
      }).ok,
    ).toBe(true);
    const third = queue.enqueue({
      id: "3",
      actor: "one",
      repositoryId: "r",
      mode: "write",
      job: "3",
    });
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.reason).toBe("queue-full");
    }
    // Another actor is unaffected by this actor's depth.
    expect(
      queue.enqueue({
        id: "4",
        actor: "two",
        repositoryId: "r",
        mode: "write",
        job: "4",
      }).ok,
    ).toBe(true);
  });

  it("reuses a permit after a job finishes, however it finished", () => {
    const queue = createQueue<string>();
    queue.enqueue({
      id: "a",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "a",
    });
    const held: { release: (() => void) | null } = { release: null };
    queue.run((_ticket, release) => {
      held.release = release;
    });
    expect(queue.runningCount()).toBe(1);
    held.release?.();
    expect(queue.runningCount()).toBe(0);
    expect(queue.pendingCount()).toBe(0);
    // A second call to release must not double-count the permit.
    held.release?.();
    expect(queue.runningCount()).toBe(0);
    queue.enqueue({
      id: "b",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "b",
    });
    queue.run((_ticket, release) => {
      void release;
    });
    expect(queue.runningCount()).toBe(1);
  });

  it("cancels a queued job but never one that has started", () => {
    const queue = createQueue<string>();
    queue.enqueue({
      id: "a",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "a",
    });
    expect(queue.cancel("a")).toBe(true);
    expect(queue.pendingCount()).toBe(0);

    queue.enqueue({
      id: "b",
      actor: "one",
      repositoryId: "repo_a",
      mode: "write",
      job: "b",
    });
    queue.run((_ticket, release) => {
      void release;
    });
    expect(queue.cancel("b")).toBe(false);
    expect(queue.isRunning("b")).toBe(true);
  });

  it("uses the contract's concurrency numbers rather than private ones", () => {
    expect(DEFAULT_QUEUE_LIMITS.maxQueuedPerActor).toBe(
      LIMITS.queuedOperationsPerActor,
    );
    expect(DEFAULT_QUEUE_LIMITS.maxGlobalGitProcesses).toBe(
      LIMITS.concurrentGitProcesses,
    );
    expect(DEFAULT_QUEUE_LIMITS.maxReadersPerRepository).toBe(
      LIMITS.concurrentReadersPerRepository,
    );
  });
});

describe("event ring and stream", () => {
  it("replays only what a client has not seen", () => {
    const ring = createEventRing();
    ring.publish({
      kind: "repositoryChanged",
      repositoryId: "repo_a",
      worktreeIds: [],
      snapshotInvalidated: true,
    });
    ring.publish({
      kind: "repositoryChanged",
      repositoryId: "repo_b",
      worktreeIds: [],
      snapshotInvalidated: true,
    });
    const replay = ring.replay(1);
    expect(replay).toHaveLength(1);
    expect(replay[0]?.sequence).toBe(2);
  });

  it("reports a gap when the ring no longer holds the client's position", () => {
    // Prevents: a client that reconnects after a busy period believing it saw every
    // change, and keeping stale data on screen.
    const ring = createEventRing({ maxEvents: 2 });
    for (let index = 0; index < 5; index += 1) {
      ring.publish({
        kind: "repositoryChanged",
        repositoryId: "repo_a",
        worktreeIds: [],
        snapshotInvalidated: true,
      });
    }
    const replay = ring.replay(1);
    expect(replay[0]?.payload.kind).toBe("eventGap");
    if (replay[0]?.payload.kind === "eventGap") {
      expect(replay[0].payload.fromSequence).toBe(2);
      expect(replay[0].payload.toSequence).toBeLessThanOrEqual(3);
    }
    expect(ring.size()).toBe(2);
  });

  it("bounds the ring by bytes as well as by count", () => {
    const ring = createEventRing({ maxEvents: 1_000, maxBytes: 400 });
    for (let index = 0; index < 50; index += 1) {
      ring.publish({
        kind: "repositoryChanged",
        repositoryId: `repo_${index}`,
        worktreeIds: ["wt_1", "wt_2"],
        snapshotInvalidated: true,
      });
    }
    expect(ring.bytes()).toBeLessThanOrEqual(400);
    expect(ring.size()).toBeLessThan(20);
  });

  it("frames an event the way an SSE client expects", () => {
    const frame = sseFrame({
      sequence: 7,
      emittedAt: "2026-09-15T00:00:00.000Z",
      payload: { kind: "session", expiresAt: "2026-09-15T08:00:00.000Z" },
    });
    expect(frame).toContain("id: 7\n");
    expect(frame).toContain("event: session\n");
    expect(frame.endsWith("\n\n")).toBe(true);
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    expect(data).toBeDefined();
    expect(
      JSON.parse((data ?? "data: {}").slice("data: ".length)),
    ).toHaveProperty("sequence", 7);
  });

  it("delivers live events to a subscriber", () => {
    const ring = createEventRing();
    const seen: number[] = [];
    const unsubscribe = ring.subscribe((envelope) => {
      seen.push(envelope.sequence);
    });
    ring.publish({ kind: "session", expiresAt: "2026-09-15T08:00:00.000Z" });
    unsubscribe();
    ring.publish({ kind: "session", expiresAt: "2026-09-15T08:00:00.000Z" });
    expect(seen).toEqual([1]);
  });
});

describe("the stream over HTTP", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startTestService({ repo });
  });

  afterEach(async () => {
    await service.close();
    await repo.dispose();
  });

  it("requires a bearer and refuses a foreign origin", async () => {
    const noToken = await service.fetch("/api/v1/events");
    expect(noToken.status).toBe(401);
    const token = await service.pair();
    const foreign = await fetch(`${service.baseUrl}/api/v1/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://evil.example",
      },
    });
    expect(foreign.status).toBe(403);
  });

  it("streams an operation's transitions to a connected client and stops on abort", async () => {
    const stageSchema = z.strictObject({
      kind: z.literal("stagePaths"),
      pathIds: z.array(z.string()),
      previewTokens: z.array(z.string()),
    });
    const effect = createEffect({
      kind: "stagePaths",
      schema: stageSchema,
      async run() {
        return {
          kind: "succeeded",
          result: {
            summary: "staged",
            changedRefs: [],
            changedPaths: 1,
            snapshotInvalidated: true,
            newHeadOid: null,
          },
        };
      },
    });
    const streaming = await startTestService({ repo, effects: [effect] });
    try {
      const streamingToken = await streaming.pair();
      const controller = new AbortController();
      const response = await streaming.fetch("/api/v1/events", {
        token: streamingToken,
        signal: controller.signal,
        headers: { accept: "text/event-stream" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(response.body).not.toBeNull();

      const status = await streaming.fetch(
        `/api/v1/status?repositoryId=${streaming.repositoryId}`,
        { token: streamingToken },
      );
      const snapshot = (await status.json()) as {
        worktreeId: string;
        snapshotId: string;
      };
      const submitted = await streaming.fetch("/api/v1/operations", {
        method: "POST",
        token: streamingToken,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: "req-stream-1",
          target: {
            kind: "worktree",
            repositoryId: streaming.repositoryId,
            worktreeId: snapshot.worktreeId,
            expectedSnapshotId: snapshot.snapshotId,
          },
          operation: {
            kind: "stagePaths",
            pathIds: ["path_a"],
            previewTokens: ["pt_a"],
          },
        }),
      });
      expect([200, 202]).toContain(submitted.status);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      const deadline = Date.now() + 4_000;
      while (Date.now() < deadline && !text.includes("succeeded")) {
        const chunk = await reader?.read();
        if (chunk?.done === true) {
          break;
        }
        text += decoder.decode(chunk?.value, { stream: true });
      }
      expect(text).toContain("event: operation");
      expect(text).toContain("succeeded");

      controller.abort();
    } finally {
      await streaming.close();
    }
  });
});
