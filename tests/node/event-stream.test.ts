/**
 * The event stream client.
 *
 * These cases exist because the client had no tests of its own: the server side of SSE was
 * covered while the consumer was not, and a consumer with an untested `start()` contract is
 * how a UI ends up showing "connecting…" forever against a perfectly healthy stream.
 *
 * Everything here runs against a stub `fetch` that returns a real `Response` with a real
 * `ReadableStream`, so the framing, the resume query and the failure classification are all
 * exercised without a socket.
 */
import { describe, expect, it } from "vitest";
import { createEventStream } from "@refyard/git-client";

interface StubStream {
  readonly response: Response;
  send(text: string): void;
  close(): void;
}

/** A response whose body stays open until the test decides otherwise. */
function streamingResponse(status = 200): StubStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    response: new Response(stream, { status }),
    send(text) {
      controller?.enqueue(new TextEncoder().encode(text));
    },
    close() {
      controller?.close();
    },
  };
}

/**
 * Let the client's read loop consume what the stub has sent.
 *
 * The loop runs on its own task: `stub.send` hands bytes to a stream, and nothing has been
 * parsed by the time the next line of the test runs.
 */
async function settle(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function frame(sequence: number, payload: unknown): string {
  return `data: ${JSON.stringify({ sequence, emittedAt: "2026-09-15T00:00:00.000Z", payload })}\n\n`;
}

describe("createEventStream", () => {
  it("resolves start() once the stream is up, not when it ends", async () => {
    const stub = streamingResponse();
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => stub.response,
      token: () => "token",
      onEvent: () => {},
      onGap: () => {},
    });

    await stream.start();
    expect(stream.connected()).toBe(true);

    // Still connected after start resolved — that is the whole contract.
    stub.send(": keep-alive\n\n");
    expect(stream.connected()).toBe(true);
    stream.stop();
  });

  it("delivers parsed events and remembers the sequence for a resume", async () => {
    const stub = streamingResponse();
    const seen: number[] = [];
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => stub.response,
      token: () => "token",
      onEvent: (envelope) => seen.push(envelope.sequence),
      onGap: () => {},
    });

    await stream.start();
    stub.send(
      frame(1, { kind: "session", expiresAt: "2026-09-15T01:00:00.000Z" }),
    );
    stub.send(
      frame(2, { kind: "session", expiresAt: "2026-09-15T01:00:00.000Z" }),
    );
    // Frames are separated by a blank line: a partial frame must not be parsed early.
    stub.send(
      'data: {"sequence":3,"emittedAt":"2026-09-15T00:00:00.000Z","pay',
    );
    await settle();
    expect(seen).toEqual([1, 2]);

    stub.send(
      'load":{"kind":"session","expiresAt":"2026-09-15T01:00:00.000Z"}}\n\n',
    );
    await settle();
    expect(seen).toEqual([1, 2, 3]);
    expect(stream.lastSequence()).toBe(3);
    stream.stop();
  });

  it("reports a gap to onGap instead of passing it on as an event", async () => {
    const stub = streamingResponse();
    const gaps: number[] = [];
    let events = 0;
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => stub.response,
      token: () => "token",
      onEvent: () => {
        events += 1;
      },
      onGap: (gap) => gaps.push(gap.fromSequence),
    });

    await stream.start();
    stub.send(frame(1, { kind: "eventGap", fromSequence: 0, toSequence: 7 }));
    await settle();

    // A gap is an instruction to re-read, not data: a listener that treated it as an event
    // would try to interpret a payload that does not exist.
    expect(gaps).toEqual([0]);
    expect(events).toBe(0);
    stream.stop();
  });

  it("stops on an unauthenticated response rather than retrying", async () => {
    let calls = 0;
    const errors: string[] = [];
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => {
        calls += 1;
        return new Response("nope", { status: 401 });
      },
      token: () => "token",
      onEvent: () => {},
      onGap: () => {},
      onError: (error) => errors.push(error.code),
      wait: async () => {},
    });

    await stream.start();
    // A dead session needs a human, so a loop here would be a busy-wait on a locked door.
    expect(errors).toEqual(["Unauthenticated"]);
    expect(calls).toBe(1);
    expect(stream.connected()).toBe(false);
  });

  it("resumes from the last sequence it saw after the stream drops", async () => {
    const first = streamingResponse();
    const second = streamingResponse();
    const urls: string[] = [];
    let calls = 0;
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async (input) => {
        urls.push(String(input));
        calls += 1;
        return calls === 1 ? first.response : second.response;
      },
      token: () => "token",
      onEvent: () => {},
      onGap: () => {},
      wait: async () => {},
    });

    await stream.start();
    first.send(
      frame(4, { kind: "session", expiresAt: "2026-09-15T01:00:00.000Z" }),
    );
    await settle();
    // The stream ends: the client reconnects on its own, and it must ask for what it missed
    // rather than restarting from the beginning.
    first.close();
    for (let attempt = 0; attempt < 50 && urls.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(urls[1]).toContain("?since=4");
    stream.stop();
  });

  it("reports an error when there is no session to stream with", async () => {
    const errors: string[] = [];
    const stream = createEventStream({
      baseUrl: "http://127.0.0.1:1",
      fetch: async () => streamingResponse().response,
      token: () => null,
      onEvent: () => {},
      onGap: () => {},
      onError: (error) => errors.push(error.code),
    });

    await stream.start();
    expect(errors).toEqual(["Unauthenticated"]);
  });
});
