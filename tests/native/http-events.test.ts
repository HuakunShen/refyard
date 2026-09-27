/**
 * The event stream on the wire.
 *
 * Framing and replay are unit-tested in Rust; nothing there proves a *socket* answer
 * carries them. This suite subscribes to the release binary's `/api/v1/events` the way
 * the workbench does (`fetch`, bearer in a header, body read as a stream), runs a real
 * write while subscribed, and holds every frame to the contract: `retry` after the
 * replay, `id` as the monotonic sequence, `event` as the payload kind, `data` an
 * envelope the contract's own schema accepts. Reconnecting with `?since=` replays what
 * the cursor names, oldest first, before the reconnect hint.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGitClient, createMutationClient, type GitClient, type MutationClient } from "@refyard/git-client";
import {
  eventEnvelopeSchema,
  previewsResponseSchema,
  repositoriesResponseSchema,
  statusSnapshotSchema,
} from "@refyard/git-contract";

import { startNativeService, type RunningNativeService } from "./native-server.ts";

let service: RunningNativeService;
let token: string;
let client: GitClient;
let mutations: MutationClient;

beforeAll(async () => {
  service = await startNativeService();
  token = await service.pair();
  const bearer = (): string => token;
  client = createGitClient({
    baseUrl: service.baseUrl,
    fetch: (input, init) => fetch(input, init),
    token: bearer,
  });
  mutations = createMutationClient({
    baseUrl: service.baseUrl,
    fetch: (input, init) => fetch(input, init),
    token: bearer,
  });
});

afterAll(async () => {
  await service.stop();
});

/** One live subscription, read incrementally: the response body stays open. */
class Stream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  private pumping = true;

  private constructor(readonly response: Response) {
    this.reader = (response.body as ReadableStream<Uint8Array>).getReader();
    void this.pump();
  }

  static async open(baseUrl: string, token: string, since?: number): Promise<Stream> {
    const suffix = since === undefined ? "" : `?since=${since}`;
    const response = await fetch(`${baseUrl}/api/v1/events${suffix}`, {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    });
    if (response.status !== 200) {
      throw new Error(`the subscription was refused: ${response.status} ${await response.text()}`);
    }
    return new Stream(response);
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder();
    // A stream the service takes away (shutdown, cancel) ends this loop quietly: a
    // reader error after close is the socket's answer, not a test failure.
    try {
      while (this.pumping) {
        const next = await this.reader.read();
        if (next.done) {
          this.pumping = false;
          return;
        }
        this.buffer += decoder.decode(next.value, { stream: true });
      }
    } catch {
      this.pumping = false;
    }
  }

  /** Waits until the buffer satisfies the predicate; a quiet stream is a failure, not a hang. */
  async until(predicate: (buffer: string) => boolean, timeoutMs = 10_000): Promise<void> {
    const started = Date.now();
    while (!predicate(this.buffer)) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`the stream never satisfied the predicate; received so far:\n${this.buffer}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  text(): string {
    return this.buffer;
  }

  async close(): Promise<void> {
    this.pumping = false;
    await this.reader.cancel().catch(() => {});
  }
}

/** Parses `id:`/`event:`/`data:` triples out of the raw frame text. */
function frames(buffer: string): { id: number; kind: string; envelope: unknown }[] {
  return buffer
    .split("\n\n")
    .filter((block) => block.startsWith("id: "))
    .map((block) => {
      const id = Number(block.match(/^id: (\d+)$/m)?.[1]);
      const kind = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const data = block.match(/^data: (.+)$/m)?.[1] ?? "";
      return { id, kind, envelope: JSON.parse(data) };
    });
}

describe("the native event stream on the wire", () => {
  it("refuses a subscription without a bearer", async () => {
    const response = await fetch(`${service.baseUrl}/api/v1/events`);
    expect(response.status).toBe(401);
    await response.body?.cancel();
  });

  it("delivers a write's events as framed, contract-valid envelopes", async () => {
    const stream = await Stream.open(service.baseUrl, token);
    // A fresh service has nothing to replay: the stream opens with the reconnect hint.
    // (The heartbeat's first tick lands immediately after it, so the hint is asserted
    // as a prefix, not as the whole buffer.)
    await stream.until((buffer) => buffer.startsWith("retry: 3000\n\n"));

    // A real write while the subscription is open.
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;
    const status = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    await service.repo.write("events.txt", "an event should name this\n");
    const changed = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    const pathId = changed.entries[0]?.pathId as string;
    const previews = previewsResponseSchema.parse(
      await client.previews({ repositoryId, worktreeId: status.worktreeId, pathIds: [pathId] }),
    );
    const stage = await mutations.submit({
      clientRequestId: "wire-events-stage",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId: status.worktreeId,
        expectedSnapshotId: changed.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [pathId],
        previewTokens: [previews.tokens[0]?.previewToken as string],
      },
    });
    expect(stage.kind).toBe("accepted");

    // The write's lifecycle arrives as frames: monotonic ids, a known event kind, and
    // data that is a whole envelope the contract accepts.
    await stream.until((buffer) => frames(buffer).some((frame) => frame.kind === "operation"));
    const parsed = frames(stream.text()).map((frame) => ({
      ...frame,
      envelope: eventEnvelopeSchema.parse(frame.envelope),
    }));
    expect(parsed.length).toBeGreaterThan(0);
    const sequences = parsed.map((frame) => frame.id);
    expect([...sequences].sort((left, right) => left - right)).toEqual(sequences);
    expect(new Set(sequences).size).toBe(sequences.length);
    for (const frame of parsed) {
      expect(frame.id).toBe(frame.envelope.sequence);
      expect(["operation", "repositoryChanged", "session", "eventGap"]).toContain(frame.kind);
    }
    // The staged operation itself was named on the stream.
    const operationId = stage.kind === "accepted" ? stage.accepted.operationId : "";
    const record = parsed.find(
      (frame) =>
        frame.envelope.payload.kind === "operation" &&
        (frame.envelope.payload.operation as { operationId?: string }).operationId === operationId,
    );
    expect(record).toBeDefined();

    await stream.close();
  });

  it("replays from ?since before the reconnect hint", async () => {
    // A write while nobody is subscribed: the ring now holds events no live reader saw.
    const repositories = repositoriesResponseSchema.parse(await client.repositories());
    const repositoryId = repositories.repositories[0]?.repositoryId as string;
    const status = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    await service.repo.write("replay.txt", "written while nobody listened\n");
    const changed = statusSnapshotSchema.parse(await client.status({ repositoryId }));
    const pathId = changed.entries[0]?.pathId as string;
    const previews = previewsResponseSchema.parse(
      await client.previews({ repositoryId, worktreeId: status.worktreeId, pathIds: [pathId] }),
    );
    const stage = await mutations.submit({
      clientRequestId: "replay-stage",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId: status.worktreeId,
        expectedSnapshotId: changed.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [pathId],
        previewTokens: [previews.tokens[0]?.previewToken as string],
      },
    });
    expect(stage.kind).toBe("accepted");
    const operationId = stage.kind === "accepted" ? stage.accepted.operationId : "";

    // A subscription that names cursor 0 replays what it missed, oldest first, and only
    // then sends the reconnect hint.
    const stream = await Stream.open(service.baseUrl, token, 0);
    await stream.until((buffer) => buffer.includes("retry: 3000"));
    const hintIndex = stream.text().indexOf("retry: 3000");
    const replayText = stream.text().slice(0, hintIndex);
    const parsed = frames(replayText).map((frame) => eventEnvelopeSchema.parse(frame.envelope));
    const replayed = parsed.filter(
      (envelope) =>
        envelope.payload.kind === "operation" || envelope.payload.kind === "repositoryChanged",
    );
    expect(replayed.length).toBeGreaterThanOrEqual(2);
    const sequences = replayed.map((envelope) => envelope.sequence);
    expect([...sequences].sort((left, right) => left - right)).toEqual(sequences);
    // The stage this test submitted was named on the replayed stream.
    expect(
      parsed.some(
        (envelope) =>
          envelope.payload.kind === "operation" &&
          (envelope.payload.operation as { operationId?: string }).operationId === operationId,
      ),
    ).toBe(true);
    // The submitted operation is in the replay before the hint. Live frames may
    // legitimately arrive after that hint on the still-open stream.
    await stream.close();

    // A cursor at the newest replayed sequence replays nothing — but the operation's
    // *later* lifecycle events may still arrive live, which is correct. What must hold
    // is that nothing on this stream is at or before the cursor.
    const newest = Math.max(...parsed.map((envelope) => envelope.sequence));
    const caughtUp = await Stream.open(service.baseUrl, token, newest);
    await caughtUp.until((buffer) => buffer.includes("retry: 3000\n\n"));
    for (const frame of frames(caughtUp.text())) {
      expect(frame.id).toBeGreaterThan(newest);
    }
    await caughtUp.close();
  });
});
