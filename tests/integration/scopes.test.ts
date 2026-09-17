/**
 * Session scope enforcement over the real Hono boundary.
 *
 * Repository/root grants answer "where" a session may act; these cases prove scopes answer
 * "what kind of act" independently. Each mutation is a real contract-shaped request against an
 * isolated Git fixture, so a 403 here means the operation never reached the coordinator.
 */
import { afterEach, describe, expect, it } from "vitest";
import { refsSnapshotSchema } from "@refyard/git-contract";
import {
  createBareRemote,
  createRepo,
  type BareRemoteFixture,
  type GitFixtureRepo,
} from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposables.splice(0).reverse()) {
    await dispose();
  }
});

async function start(
  scopes: readonly string[],
): Promise<{ repo: GitFixtureRepo; service: TestService }> {
  const repo = await createRepo({ initialCommit: true });
  const service = await startTestService({ repo, scopes });
  disposables.push(async () => service.close());
  disposables.push(async () => repo.dispose());
  return { repo, service };
}

async function repositoryTarget(service: TestService): Promise<object> {
  const token = await service.pair();
  const response = await service.fetch(
    `/api/v1/refs?repositoryId=${service.repositoryId}`,
    { token },
  );
  expect(response.status).toBe(200);
  const refs = refsSnapshotSchema.parse(await response.json());
  return {
    kind: "repository",
    repositoryId: service.repositoryId,
    expectedSnapshotId: refs.snapshotId,
  };
}

async function submit(service: TestService, body: unknown): Promise<Response> {
  const token = await service.pair();
  return service.fetch("/api/v1/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    token,
    body: JSON.stringify(body),
  });
}

async function expectScopeDenied(
  response: Response,
  scope: string,
): Promise<void> {
  expect(response.status).toBe(403);
  const body = (await response.json()) as {
    problem: { code: string; message: string };
  };
  expect(body.problem.code).toBe("Forbidden");
  expect(body.problem.message).toContain(scope);
}

describe("authorization scopes", () => {
  it("lets a read-only session read but refuses a local repository mutation", async () => {
    const { service } = await start(["repository:read"]);
    const target = await repositoryTarget(service);
    const response = await submit(service, {
      clientRequestId: "scope-read-only-branch",
      target,
      operation: {
        kind: "createBranch",
        branchName: "blocked",
        startOid: null,
        switchToIt: false,
      },
    });
    await expectScopeDenied(response, "repository:write");
  });

  it("lets write authority submit a local mutation but refuses network authority", async () => {
    const { repo, service } = await start([
      "repository:read",
      "repository:write",
    ]);
    const remote: BareRemoteFixture = await createBareRemote();
    disposables.push(async () => remote.dispose());
    await repo.git(["remote", "add", "origin", remote.path]);
    const target = await repositoryTarget(service);

    const local = await submit(service, {
      clientRequestId: "scope-write-branch",
      target,
      operation: {
        kind: "createBranch",
        branchName: "allowed",
        startOid: null,
        switchToIt: false,
      },
    });
    expect(local.status).toBe(202);

    const network = await submit(service, {
      clientRequestId: "scope-write-fetch",
      target,
      operation: {
        kind: "fetch",
        remoteName: "origin",
        prune: false,
        tags: "none",
      },
    });
    await expectScopeDenied(network, "repository:network");
  });

  it("lets network authority submit fetch without repository write authority", async () => {
    const { repo, service } = await start([
      "repository:read",
      "repository:network",
    ]);
    const remote: BareRemoteFixture = await createBareRemote();
    disposables.push(async () => remote.dispose());
    await repo.git(["remote", "add", "origin", remote.path]);
    const target = await repositoryTarget(service);
    const response = await submit(service, {
      clientRequestId: "scope-network-fetch",
      target,
      operation: {
        kind: "fetch",
        remoteName: "origin",
        prune: false,
        tags: "none",
      },
    });
    expect(response.status).toBe(202);
  });

  it("refuses SSE without repository read authority", async () => {
    const { service } = await start(["repository:write"]);
    const token = await service.pair();
    const response = await service.fetch("/api/v1/events", { token });
    if (response.status !== 403) {
      await response.body?.cancel();
    }
    await expectScopeDenied(response, "repository:read");
  });

  it("refuses MCP session initialization without repository read authority", async () => {
    const { service } = await start(["repository:write"]);
    const token = await service.pair();
    const response = await service.fetch("/mcp", {
      method: "POST",
      token,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "scope-test", version: "1.0.0" },
        },
      }),
    });
    await expectScopeDenied(response, "repository:read");
  });

  it("refuses repository registration without workspace management authority", async () => {
    const { service } = await start([
      "repository:read",
      "repository:write",
      "repository:network",
    ]);
    const token = await service.pair();
    const response = await service.fetch("/api/v1/repositories/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      token,
      body: JSON.stringify({ path: "/tmp/refyard-scope-must-not-register" }),
    });
    await expectScopeDenied(response, "workspace:manage");
  });
});
