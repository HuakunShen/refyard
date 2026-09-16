/**
 * Kunkun adapter coverage.
 *
 * The test uses a real Refyard GitClient and the real kkrpc channel over an
 * in-memory transport. It therefore separates the adapter proof from Kunkun's
 * Electron process, while still exercising the public GitService and error wire.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGitClient,
  createMutationClient,
  type GitClient,
} from "@refyard/git-client";
import type { EventEnvelope } from "@refyard/git-contract";
import { expose, type RPCMessage, type Transport } from "kkrpc/streaming";
import {
  createKunkunBackend,
} from "../../integrations/kunkun/backend.js";
import { createKunkunView } from "../../integrations/kunkun/view.js";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  type TestService,
} from "../support/service.js";

describe("Kunkun manifest", () => {
  it("declares a custom view and a narrowly scoped backend", async () => {
    // Prevents: a renderer-only plugin that falls back to direct localhost calls,
    // or a backend permission that silently grants arbitrary shell authority.
    const text = await readFile(
      join(process.cwd(), "integrations", "kunkun", "package.json"),
      "utf8",
    );
    const manifest = record(JSON.parse(text));
    const kunkun = record(manifest["kunkun"]);
    const commands = arrayOfRecords(kunkun["commands"]);
    const permissions = arrayOfRecords(kunkun["permissions"]);
    expect(kunkun["identifier"]).toBe("sh.refyard.git-workbench");
    expect(commands[0]).toMatchObject({
      mode: "custom-view",
      main: "dist/view/index.html",
    });
    const backendPermission = permissions.find(
      (permission) => permission["permission"] === "backend",
    );
    expect(backendPermission).toMatchObject({
      allow: [expect.objectContaining({ script: "dist/backend.js" })],
    });
    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ permission: "backend" }),
        expect.objectContaining({
          permission: "network",
          domains: expect.arrayContaining(["127.0.0.1", "localhost"]),
        }),
      ]),
    );
  });
});

describe("Kunkun kkrpc relay", () => {
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

  it("calls the public GitService through kkrpc while keeping the bearer in backend custody", async () => {
    // Prevents: the custom view learning the HTTP endpoint or the bearer and
    // bypassing the host-owned session boundary.
    const token = await service.pair();
    const client = createGitClient({
      baseUrl: service.baseUrl,
      fetch: (input, init) =>
        service.fetch(String(input).replace(service.baseUrl, ""), {
          ...init,
          token,
        }),
      token: () => token,
    });
    const mutations = createMutationClient({
      baseUrl: service.baseUrl,
      fetch: (input, init) =>
        service.fetch(String(input).replace(service.baseUrl, ""), {
          ...init,
          token,
        }),
      token: () => token,
    });
    const left = new MemoryTransport();
    const right = new MemoryTransport();
    left.peer = right;
    right.peer = left;
    const event: EventEnvelope = {
      sequence: 1,
      emittedAt: "2026-09-16T00:00:00.000Z",
      payload: { kind: "eventGap", fromSequence: 1, toSequence: 1 },
    };
    const backend = createKunkunBackend(client, {
      mutations,
      watchEvents: async function* () {
        yield event;
      },
    });
    const controller = expose(backend, right);
    const view = createKunkunView(left);

    const status = await view.git.status({ repositoryId: service.repositoryId });
    expect(status.repositoryId).toBe(service.repositoryId);
    expect(view).not.toHaveProperty("token");
    expect(view).not.toHaveProperty("exchangeTicket");
    const firstEvent = await view.watchEvents()[Symbol.asyncIterator]().next();
    expect(firstEvent.value).toEqual(event);

    view.dispose();
    controller.dispose();
  });

  it("preserves a Permission denied error across the kkrpc boundary", async () => {
    // Prevents: an adapter translating a host refusal into an empty success or
    // an invented allow result, which would make a Kunkun permission prompt lie.
    const denied: GitClient = {
      ...createGitClient({
        baseUrl: service.baseUrl,
        fetch: (input, init) =>
          service.fetch(String(input).replace(service.baseUrl, ""), init),
      }),
      status: async () => {
        throw new Error("Permission denied: backend channel");
      },
    };
    const left = new MemoryTransport();
    const right = new MemoryTransport();
    left.peer = right;
    right.peer = left;
    const token = await service.pair();
    const mutations = createMutationClient({
      baseUrl: service.baseUrl,
      fetch: (input, init) =>
        service.fetch(String(input).replace(service.baseUrl, ""), {
          ...init,
          token,
        }),
      token: () => token,
    });
    const controller = expose(
      createKunkunBackend(denied, { mutations }),
      right,
    );
    const view = createKunkunView(left);

    await expect(
      view.git.status({ repositoryId: service.repositoryId }),
    ).rejects.toThrow("Permission denied: backend channel");

    view.dispose();
    controller.dispose();
  });
});

class MemoryTransport implements Transport<RPCMessage> {
  peer: MemoryTransport | null = null;
  private readonly listeners = new Set<(message: RPCMessage) => void>();

  send(message: RPCMessage): void {
    for (const listener of this.peer?.listeners ?? []) {
      listener(message);
    }
  }

  subscribe(listener: (message: RPCMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("expected a JSON array");
  }
  return value.map(record);
}
