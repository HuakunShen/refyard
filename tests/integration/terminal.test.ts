/**
 * The terminal surface over the real HTTP boundary, with a real pty.
 *
 * The service-level rules have their own test; these cases prove the wire: that
 * the bearer is required, that a second browser session cannot drive a shell it
 * did not open, that the SSE stream carries contract frames a client can parse,
 * and that a shell's output actually arrives and its exit is observed. A host
 * built without a pty must answer 501 rather than pretend.
 */
import { realpath } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  capabilitiesResponseSchema,
  terminalFrameSchema,
  terminalOpenResponseSchema,
} from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposables.splice(0).reverse()) {
    await dispose();
  }
});

async function start(
  terminal:
    | { readonly mode: "off" }
    | { readonly mode: "on"; readonly command?: { shell: string; argv: readonly string[]; name: string } } = {
    mode: "on",
    command: { shell: "/bin/sh", argv: [], name: "sh" },
  },
): Promise<{ repo: GitFixtureRepo; service: TestService }> {
  const repo = await createRepo({ initialCommit: true });
  const service = await startTestService({ repo, terminal });
  disposables.push(async () => service.close());
  disposables.push(async () => repo.dispose());
  return { repo, service };
}

interface Opened {
  readonly sessionId: string;
  readonly shell: string;
  readonly cwd: string;
}

async function open(
  service: TestService,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const response = await service.fetch("/api/v1/terminal/open", {
    method: "POST",
    token,
    body: JSON.stringify({
      repositoryId: service.repositoryId,
      cols: 80,
      rows: 24,
    }),
  });
  return { status: response.status, body: await response.json() };
}

/** Reads SSE frames until the exit frame; every data line must be a contract frame. */
async function readUntilExit(
  service: TestService,
  token: string,
  sessionId: string,
  onFrame?: (frame: { kind: string }) => void,
): Promise<{ exitCode: number | null; output: string }> {
  const controller = new AbortController();
  const response = await fetch(
    `${service.baseUrl}/api/v1/terminal/output?sessionId=${sessionId}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        origin: service.baseUrl,
        accept: "text/event-stream",
      },
      signal: controller.signal,
    },
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("the terminal output stream has no body");
  }
  const decoder = new TextDecoder();
  let buffered = "";
  let output = "";
  const deadline = Date.now() + 15_000;
  try {
    while (Date.now() < deadline) {
      const timed = await Promise.race([
        reader.read(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 5_000),
        ),
      ]);
      if (timed === "timeout") {
        continue;
      }
      buffered += decoder.decode(timed.value, { stream: true });
      let boundary = buffered.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        boundary = buffered.indexOf("\n\n");
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data: ")) {
            continue;
          }
          const frame = terminalFrameSchema.parse(
            JSON.parse(line.slice("data: ".length)),
          );
          onFrame?.(frame);
          if (frame.kind === "output") {
            output += new TextDecoder().decode(
              Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0)),
            );
          } else {
            return { exitCode: frame.exitCode, output };
          }
        }
      }
    }
    throw new Error("the terminal output stream never delivered an exit frame");
  } finally {
    controller.abort();
  }
}

describe("a host without a pty module", () => {
  it("omits the terminal capability and answers 501, never a fake session", async () => {
    const { service } = await start({ mode: "off" });
    const token = await service.pair();
    const capabilities = capabilitiesResponseSchema.parse(
      await (
        await service.fetch("/api/v1/capabilities", { token })
      ).json(),
    );
    expect(capabilities.terminal).toBeUndefined();
    const { status, body } = await open(service, token);
    expect(status).toBe(501);
    expect(body).toMatchObject({ problem: { code: "UnsupportedOperation" } });
  });
});

describe("a host with a pty module", () => {
  it("advertises the shell in capabilities and opens a session in the approved repository", async () => {
    const { repo, service } = await start();
    const token = await service.pair();
    const capabilities = capabilitiesResponseSchema.parse(
      await (
        await service.fetch("/api/v1/capabilities", { token })
      ).json(),
    );
    expect(capabilities.terminal).toEqual({ shell: "sh" });

    const { status, body } = await open(service, token);
    expect(status).toBe(200);
    const opened = terminalOpenResponseSchema.parse(body);
    expect(opened.shell).toBe("sh");
    // The approved root is stored realpath'd (macOS /var → /private/var), and
    // the terminal starts exactly there — not at the spell the fixture used.
    expect(opened.cwd).toBe(await realpath(repo.root));
  });

  it("requires the bearer like every other read", async () => {
    const { service } = await start();
    const response = await fetch(
      `${service.baseUrl}/api/v1/terminal/open`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: service.baseUrl,
        },
        body: JSON.stringify({
          repositoryId: service.repositoryId,
          cols: 80,
          rows: 24,
        }),
      },
    );
    expect(response.status).toBe(401);
  });

  it("carries a shell's output to the stream and reports a real exit", async () => {
    const { service } = await start();
    const token = await service.pair();
    const opened = terminalOpenResponseSchema.parse(
      (await open(service, token)).body,
    );
    const marker = `refyard_term_${Math.random().toString(36).slice(2, 8)}`;
    const echo = await service.fetch("/api/v1/terminal/input", {
      method: "POST",
      token,
      body: JSON.stringify({
        sessionId: opened.sessionId,
        data: btoa(`echo ${marker}\n`),
      }),
    });
    expect(echo.status).toBe(200);
    // Exit is requested before the stream attaches, so the exit frame arrives
    // through the same path a viewer that opened late would see.
    const exitInput = await service.fetch("/api/v1/terminal/input", {
      method: "POST",
      token,
      body: JSON.stringify({ sessionId: opened.sessionId, data: btoa("exit\n") }),
    });
    expect(exitInput.status).toBe(200);

    const seen = await readUntilExit(
      service,
      token,
      opened.sessionId,
      undefined,
    );
    expect(seen.output).toContain(marker);
    // The exit is the shell's own, not a fabricated zero.
    expect(seen.exitCode).toBe(0);
  });

  it("a second browser session cannot drive a shell it did not open", async () => {
    const { service } = await start();
    const token = await service.pair();
    const opened = terminalOpenResponseSchema.parse(
      (await open(service, token)).body,
    );
    // A fresh ticket means a fresh bearer session: same person, different grant.
    const secondTicket = service.http.pairingUrl(service.baseUrl);
    const secondResponse = await fetch(
      `${service.baseUrl}/api/v1/session/exchange`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: service.baseUrl,
        },
        body: JSON.stringify({
          ticket: secondTicket.split("pair=")[1],
        }),
      },
    );
    const second = (await secondResponse.json()) as { token: string };
    const response = await service.fetch("/api/v1/terminal/input", {
      method: "POST",
      token: second.token,
      body: JSON.stringify({
        sessionId: opened.sessionId,
        data: btoa("echo nope\n"),
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      problem: { code: "Forbidden" },
    });
  });

  it("resize is accepted and unknown sessions are refused", async () => {
    const { service } = await start();
    const token = await service.pair();
    const opened = terminalOpenResponseSchema.parse(
      (await open(service, token)).body,
    );
    const resize = await service.fetch("/api/v1/terminal/resize", {
      method: "POST",
      token,
      body: JSON.stringify({
        sessionId: opened.sessionId,
        cols: 120,
        rows: 40,
      }),
    });
    expect(resize.status).toBe(200);

    const missing = await service.fetch("/api/v1/terminal/resize", {
      method: "POST",
      token,
      body: JSON.stringify({
        sessionId: "term_does_not_exist",
        cols: 120,
        rows: 40,
      }),
    });
    expect(missing.status).toBe(404);

    const closed = await service.fetch("/api/v1/terminal/close", {
      method: "POST",
      token,
      body: JSON.stringify({ sessionId: opened.sessionId }),
    });
    expect(closed.status).toBe(200);
  });
});
