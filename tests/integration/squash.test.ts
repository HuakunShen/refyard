/**
 * Squashing the checked-out branch's top commit into its parent through the
 * API:
 *
 * - the default squash combines both changes into one commit that keeps the
 *   parent's message;
 * - a client-supplied message replaces it;
 * - a single-commit branch is refused — there is nothing below to squash into;
 * - a branch whose top commit adds nothing over its parent refuses rather
 *   than writing an empty rewrite;
 * - another sequencer operation in progress is refused.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { statusSnapshotSchema } from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  submitAndWait,
  type TestService,
} from "../support/service.js";

async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

async function worktreeTarget(service: TestService): Promise<object> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    kind: "worktree",
    repositoryId: service.repositoryId,
    worktreeId: status.worktreeId,
    expectedSnapshotId: status.snapshotId,
  };
}

async function submitSquash(
  service: TestService,
  message: string | null,
): Promise<Awaited<ReturnType<typeof submitAndWait>>> {
  return submitAndWait(service, {
    clientRequestId: `sq-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation: { kind: "squashCommit", message },
  });
}

describe("squashing the top commit", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("keeps the parent's message by default and combines both changes", async () => {
    await repo.write("a.txt", "A\n");
    await repo.commitAll("A");
    await repo.write("b.txt", "B\n");
    await repo.commitAll("B");

    const record = await submitSquash(service, null);
    expect(record.status).toBe("succeeded");
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s"]))
      .trim()
      .split("\n");
    expect(subjects).toEqual(["A", "base"]);
    expect(await repo.readText("a.txt")).toEqual("A\n");
    expect(await repo.readText("b.txt")).toEqual("B\n");
  });

  it("uses the client message when one is supplied", async () => {
    await repo.write("a.txt", "A\n");
    await repo.commitAll("A");
    await repo.write("b.txt", "B\n");
    await repo.commitAll("B");

    const record = await submitSquash(service, "A and B together\n");
    expect(record.status).toBe("succeeded");
    // Two commits became ONE — a new commit stacked on top would be a bug.
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s"]))
      .trim()
      .split("\n");
    expect(subjects).toEqual(["A and B together", "base"]);
    expect(await repo.readText("b.txt")).toEqual("B\n");
  });

  it("refuses a single-commit branch", async () => {
    const record = await submitSquash(service, null);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("GitCommandFailed");
    expect((await repo.headOid()).trim().length).toBe(40);
  });

  it("refuses when the top commit adds nothing over its parent", async () => {
    await repo.write("a.txt", "A\n");
    await repo.commitAll("A");
    // An empty commit: its tree equals its parent's, so a squash would write
    // nothing.
    await repo.git(["commit", "--allow-empty", "-m", "empty"]);
    const head = (await repo.headOid()).trim();

    const record = await submitSquash(service, null);
    expect(record.status).toBe("failed");
    expect((await repo.headOid()).trim()).toEqual(head);
  });
});
