/**
 * The legacy host's answer to the target-aware contract.
 *
 * The 1.2.0 contract lets a client name an execution target; this host has exactly
 * one, on the machine it runs on. These cases pin the refusal: answering anyway
 * would describe *this* machine while the caller believes it is talking about
 * another one, which is the one mistake a user cannot see from the UI.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capabilitiesResponseSchema } from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

describe("execution target selectors on a single-target host", () => {
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

  it("still answers the empty capability query, which is the default local target", async () => {
    const response = await service.fetch("/api/v1/capabilities", {
      token: await service.pair(),
    });
    expect(response.status).toBe(200);
    const body = capabilitiesResponseSchema.safeParse(await response.json());
    expect(body.success).toBe(true);
    if (body.success) {
      expect(body.data.contractVersion).toBe("1.2.0");
      expect(body.data.host.kind).toBe("node");
    }
  });

  it("answers a capability query that names a repository it knows", async () => {
    const response = await service.fetch(
      `/api/v1/capabilities?repositoryId=${service.repositoryId}`,
      { token: await service.pair() },
    );
    expect(response.status).toBe(200);
  });

  it("refuses a capability query that names an execution target it does not have", async () => {
    const response = await service.fetch(
      "/api/v1/capabilities?targetId=tgt_other",
      {
        token: await service.pair(),
      },
    );
    expect(response.status).toBe(501);
    const body = (await response.json()) as {
      problem: { code: string; message: string };
    };
    expect(body.problem.code).toBe("UnsupportedOperation");
    expect(body.problem.message).toContain("targetId");
  });

  it("refuses to browse the local filesystem for a target it does not have", async () => {
    // The dangerous reading is the opposite one: answering with this machine's
    // directories while the UI shows an SSH host.
    const response = await service.fetch(
      "/api/v1/filesystem/entries?path=%2Ftmp&targetId=tgt_other",
      { token: await service.pair() },
    );
    expect(response.status).toBe(501);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("UnsupportedOperation");
  });

  it("refuses to register a repository against a target it does not have", async () => {
    const response = await service.fetch("/api/v1/repositories/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: repo.root, targetId: "tgt_other" }),
      token: await service.pair(),
    });
    expect(response.status).toBe(501);
    const body = (await response.json()) as { problem: { code: string } };
    expect(body.problem.code).toBe("UnsupportedOperation");

    // Nothing was approved: the refusal happens before the registry is touched.
    const repositories = await service.fetch("/api/v1/repositories", {
      token: await service.pair(),
    });
    const listed = (await repositories.json()) as {
      repositories: { displayPath: string }[];
    };
    expect(
      listed.repositories.some((entry) => entry.displayPath.endsWith(".git")),
    ).toBe(false);
  });
});
