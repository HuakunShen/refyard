/**
 * The Node listener and the Hono application have different jobs.
 *
 * Hono owns every API/discovery route and its security semantics. `server.ts` may bind the
 * socket, initialize the origin policy, account for shutdown and serve non-API static assets,
 * but it must not keep a second GitService dispatcher that can drift from Hono.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const serverPath = join(
  repoRoot,
  "packages",
  "host-node",
  "src",
  "http",
  "server.ts",
);

describe("HTTP application ownership", () => {
  it("keeps GitService routing in Hono rather than a shadow Node dispatcher", async () => {
    // Prevents: fixing an auth/scope rule in Hono while an unreachable second copy remains
    // in server.ts and later becomes reachable again with different semantics.
    const source = await readFile(serverPath, "utf8");

    expect(source).toContain("createHonoHttpApp");
    expect(source).toContain("assets.serve");
    for (const shadowOwner of [
      "readRoutes",
      "mutationRoutes",
      "sessionExchangeRequestSchema",
      "eventsQuerySchema",
      "readJsonBody",
      "function checkScope",
      "repositoryIdForScope",
      "allowedRootIdForScope",
    ]) {
      expect(source, `${shadowOwner} still belongs to server.ts`).not.toContain(
        shadowOwner,
      );
    }
  });
});
