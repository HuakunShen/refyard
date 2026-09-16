/**
 * Hono-facing API discovery and MCP protocol coverage.
 *
 * These cases use the same isolated real service as the browser tests. A route that
 * only looks correct when called through a Hono unit-test helper is not enough: the
 * Node adapter, pairing boundary, bearer scope and MCP session headers all matter.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

describe("Hono API discovery", () => {
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

  it("publishes an OpenAPI document derived from the GitService routes", async () => {
    // Prevents: a documentation endpoint that describes a different API from the
    // authenticated routes the browser and other clients actually call.
    const response = await service.fetch("/openapi.json");
    expect(response.status).toBe(200);
    const document = record(await response.json());
    const info = record(document["info"]);
    expect(document["openapi"]).toBe("3.1.0");
    expect(info["title"]).toBe("Refyard GitService");
    const paths = record(document["paths"]);
    const statusPath = record(paths["/api/v1/status"]);
    const statusGet = record(statusPath["get"]);
    expect(statusGet).toMatchObject({
      operationId: "getStatus",
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: "repositoryId", in: "query" }),
      ]),
    });
    const statusResponses = record(statusGet["responses"]);
    const statusOk = record(statusResponses["200"]);
    const statusContent = record(statusOk["content"]);
    const statusJson = record(statusContent["application/json"]);
    expect(statusJson["schema"]).toBeDefined();
    const components = record(document["components"]);
    const securitySchemes = record(components["securitySchemes"]);
    expect(securitySchemes["BearerAuth"]).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("serves the Scalar reference UI without exposing repository data", async () => {
    // Prevents: a docs page that silently requires a bearer for its own navigation or
    // embeds a repository snapshot in HTML instead of linking to the API contract.
    const response = await service.fetch("/scalar");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html.toLowerCase()).toContain("scalar");
    expect(html).toContain("/openapi.json");
    expect(html).not.toContain(service.repositoryId);
  });
});

describe("read-only MCP", () => {
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

  it("initializes a session, lists only supported reads, and calls repo_status", async () => {
    // Prevents: exposing an unauthenticated shell or mutation-shaped MCP escape hatch
    // under the name of a convenient protocol adapter.
    const token = await service.pair();
    const initialize = await service.fetch("/mcp", {
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
          clientInfo: { name: "refyard-test", version: "1.0.0" },
        },
      }),
    });
    expect(initialize.status).toBe(200);
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initialized = record(await initialize.json());
    const initializedResult = record(initialized["result"]);
    const serverInfo = record(initializedResult["serverInfo"]);
    expect(serverInfo["name"]).toBe("refyard");

    const sessionHeaders = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      "mcp-session-id": sessionId ?? "missing",
    };
    const listed = await service.fetch("/mcp", {
      method: "POST",
      token,
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });
    expect(listed.status).toBe(200);
    const tools = record(await listed.json());
    const toolsResult = record(tools["result"]);
    const toolValues = Array.isArray(toolsResult["tools"])
      ? toolsResult["tools"]
      : [];
    const names = toolValues.map((tool) => record(tool)["name"]);
    expect(names).toEqual(
      expect.arrayContaining([
        "repo_status",
        "list_branches",
        "list_worktrees",
        "get_diff",
        "get_commit",
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(["search_commits", "get_file_history"]),
    );

    const called = await service.fetch("/mcp", {
      method: "POST",
      token,
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "repo_status",
          arguments: { repositoryId: service.repositoryId },
        },
      }),
    });
    expect(called.status).toBe(200);
    const result = record(await called.json());
    const callResult = record(result["result"]);
    expect(callResult["isError"]).not.toBe(true);
    const structuredContent = record(callResult["structuredContent"]);
    const data = record(structuredContent["data"]);
    expect(data["repositoryId"]).toBe(service.repositoryId);
  });

  it("refuses MCP without the existing bearer session", async () => {
    // Prevents: treating MCP as a second unauthenticated API that bypasses the
    // repository grant and origin checks applied to GitService routes.
    const response = await service.fetch("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });
});

function record(value: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  if (!parsed.success) {
    throw new Error("expected a JSON object");
  }
  return parsed.data;
}
