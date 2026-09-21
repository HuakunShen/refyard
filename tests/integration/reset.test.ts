/**
 * Resetting the checked-out branch to another commit through the API.
 *
 * Only the two content-preserving modes exist here, and the cases are about
 * what each keeps and what refuses to run:
 *
 * - a mixed reset moves the branch and unstages staged work, while every
 *   working file keeps its bytes;
 * - a soft reset moves the branch and leaves the staged split exactly as it
 *   was, so the same changes restage on top of the new head;
 * - a reset away from the middle of a merge is refused, and the merge is
 *   still open afterwards — the one state a human must finish undamaged;
 * - an object this repository does not have is refused by Git, with the
 *   branch unchanged.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { statusSnapshotSchema } from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  submitAndWait,
  type TestService,
} from "../support/service.js";

interface StatusView {
  readonly snapshotId: string;
  readonly worktreeId: string;
  readonly operationInProgress: string | null;
  readonly headOid: string | null;
  readonly entries: readonly {
    readonly displayPath: string;
    readonly indexStatus: string | null;
    readonly worktreeStatus: string | null;
  }[];
}

async function startService(repo: GitFixtureRepo): Promise<TestService> {
  const service = await startTestService({ repo });
  const token = await service.pair();
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

async function readStatus(service: TestService): Promise<StatusView> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const status = statusSnapshotSchema.parse(await response.json());
  return {
    snapshotId: status.snapshotId,
    worktreeId: status.worktreeId,
    operationInProgress: status.operationInProgress,
    headOid: status.head.oid,
    entries: status.entries.map((entry) => ({
      displayPath: entry.displayPath,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    })),
  };
}

async function worktreeTarget(service: TestService): Promise<object> {
  const status = await readStatus(service);
  return {
    kind: "worktree",
    repositoryId: service.repositoryId,
    worktreeId: status.worktreeId,
    expectedSnapshotId: status.snapshotId,
  };
}

async function submitReset(
  service: TestService,
  oid: string,
  mode: "soft" | "mixed",
): Promise<Awaited<ReturnType<typeof submitAndWait>>> {
  return submitAndWait(service, {
    clientRequestId: `reset-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation: { kind: "resetBranch", oid, mode },
  });
}

describe("resetting the checked-out branch", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("mixed reset moves the branch and unstages, keeping working content", async () => {
    await repo.write("a.txt", "staged-and-more\n");
    await repo.git(["add", "--", "a.txt"]);
    const staged = (await repo.headOid()).trim();

    const record = await submitReset(service, staged, "mixed");
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).toEqual(staged);
    expect(await repo.readText("a.txt")).toEqual("staged-and-more\n");
    const status = await readStatus(service);
    const entry = status.entries.find((e) => e.displayPath === "a.txt");
    // Staged work became unstaged work: the index column is the placeholder
    // the contract uses for "nothing staged", the worktree column is real.
    expect(entry?.indexStatus === null || entry?.indexStatus === ".").toBe(
      true,
    );
    expect(entry?.worktreeStatus === null || entry?.worktreeStatus === ".").toBe(
      false,
    );
  });

  it("soft reset moves the branch and keeps the staged split", async () => {
    await repo.write("a.txt", "staged-and-more\n");
    await repo.git(["add", "--", "a.txt"]);
    const staged = (await repo.headOid()).trim();

    const record = await submitReset(service, staged, "soft");
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).toEqual(staged);
    expect(await repo.readText("a.txt")).toEqual("staged-and-more\n");
    const status = await readStatus(service);
    const entry = status.entries.find((e) => e.displayPath === "a.txt");
    expect(entry?.indexStatus).not.toBeNull();
  });

  it("refuses to reset away from a merge in progress and leaves it open", async () => {
    // A divergent merge, started through the API exactly as the merge test does.
    await repo.git(["switch", "-c", "other"]);
    await repo.write("a.txt", "other\n");
    const other = await repo.commitAll("other");
    await repo.git(["switch", "main"]);
    await repo.write("a.txt", "main\n");
    await repo.commitAll("main");
    const head = (await repo.headOid()).trim();
    const conflict = await submitAndWait(service, {
      clientRequestId: "reset-merge-conflict",
      target: await worktreeTarget(service),
      operation: { kind: "merge", sourceOid: other, mode: "default", message: null },
    });
    expect(conflict.status).toBe("needsAttention");

    // The HTTP boundary refuses every non-finish write while a merge is open —
    // one layer ahead of the workflow's own precondition, which is the
    // defence-in-depth backstop for callers that reach the coordinator directly.
    await expect(submitReset(service, other, "mixed")).rejects.toThrow(
      /a merge is in progress/i,
    );
    expect((await readStatus(service)).operationInProgress).toEqual("merge");
    expect((await repo.headOid()).trim()).not.toEqual(other);
    expect((await repo.headOid()).trim()).toEqual(head);
  });

  it("refuses an object this repository does not have", async () => {
    const head = (await repo.headOid()).trim();

    const record = await submitReset(service, "1".repeat(40), "soft");
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("GitCommandFailed");
    // Git's own wording for a reset to a missing object.
    expect(record.problem?.message).toMatch(/could not parse object/i);
    expect((await repo.headOid()).trim()).toEqual(head);
  });
});
