/**
 * Dropping one commit from the checked-out branch through the API.
 *
 * Drop is history rewriting, so the refusals are the feature: the cases pin
 * what must never be rewritten and what the user sees when a replay stops.
 *
 * - a clean middle drop removes the commit and its content while the commits
 *   after it survive;
 * - a descendant that depended on the dropped commit stops the replay into
 *   `needsAttention`, and the existing rebase continue finishes it after the
 *   conflict is resolved;
 * - a merge commit is refused without choosing anything;
 * - a commit that is not on the checked-out branch is refused;
 * - the branch's first commit is refused — there is no parent to replay onto.
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
  readonly unmerged: readonly { readonly displayPath: string }[];
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
    unmerged: status.entries
      .filter((entry) => entry.kind === "unmerged")
      .map((entry) => ({ displayPath: entry.displayPath })),
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

async function submitDrop(
  service: TestService,
  oid: string,
): Promise<Awaited<ReturnType<typeof submitAndWait>>> {
  return submitAndWait(service, {
    clientRequestId: `drop-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation: { kind: "dropCommit", oid, confirmed: true },
  });
}

/** base → A → B → C on main; returns the oids of A, B, C. */
async function threeCommitBranch(repo: GitFixtureRepo): Promise<{
  readonly a: string;
  readonly b: string;
  readonly c: string;
}> {
  await repo.write("a.txt", "A\n");
  const a = await repo.commitAll("A");
  await repo.write("b.txt", "B\n");
  const b = await repo.commitAll("B");
  await repo.write("c.txt", "C\n");
  const c = await repo.commitAll("C");
  return { a, b, c };
}

describe("dropping a commit", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("removes the middle commit and replays the descendants", async () => {
    const { b, c } = await threeCommitBranch(repo);

    const record = await submitDrop(service, b);
    expect(record.status).toBe("succeeded");
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s"]))
      .trim()
      .split("\n");
    expect(subjects).toEqual(["C", "A", "base"]);
    expect((await repo.headOid()).trim()).not.toEqual(c);
    // The dropped commit's content is gone; the neighbours' content survives.
    const bTracked = await repo.gitResult(["ls-files", "--", "b.txt"]);
    expect(new TextDecoder().decode(bTracked.stdout).trim()).toEqual("");
    expect(await repo.readText("a.txt")).toEqual("A\n");
    expect(await repo.readText("c.txt")).toEqual("C\n");
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("stops a dependent descendant into needsAttention, then continues", async () => {
    // C edits b.txt, which the drop of B removes — the replay must conflict.
    await repo.write("a.txt", "A\n");
    await repo.commitAll("A");
    await repo.write("b.txt", "B\n");
    await repo.commitAll("B");
    await repo.write("b.txt", "B edited\n");
    const c = await repo.commitAll("C edits b");
    const b = (await repo.git(["rev-parse", "HEAD~1"])
      .then((bytes) => new TextDecoder().decode(bytes).trim()));

    const record = await submitDrop(service, b);
    expect(record.status).toBe("needsAttention");
    expect(record.problem?.details?.conflictedPaths).toEqual(1);
    expect((await readStatus(service)).operationInProgress).toEqual("rebase");

    // Resolve outside — this build never edits a conflicted file — then the
    // rebase family's own continue finishes the drop.
    await repo.write("b.txt", "resolved\n");
    await repo.git(["add", "--", "b.txt"]);
    const done = await submitAndWait(service, {
      clientRequestId: "drop-continue",
      target: await worktreeTarget(service),
      operation: { kind: "continueRebase" },
    });
    expect(done.status).toBe("succeeded");
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s", "-2"]))
      .trim()
      .split("\n");
    expect(subjects).toEqual(["C edits b", "A"]);
    void c;
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("refuses a merge commit without choosing anything", async () => {
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "side\n");
    const side = await repo.commitAll("side");
    await repo.git(["switch", "main"]);
    await repo.git(["merge", "--no-ff", "-m", "merge side", side]);
    const mergeOid = (await repo.headOid()).trim();

    const record = await submitDrop(service, mergeOid);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("InvalidRequest");
    expect(record.problem?.message).toMatch(/merge/i);
    expect((await repo.headOid()).trim()).toEqual(mergeOid);
  });

  it("refuses a commit that is not on the checked-out branch", async () => {
    await repo.write("main.txt", "main\n");
    await repo.commitAll("main work");
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "side\n");
    const sideTip = await repo.commitAll("side work");
    await repo.git(["switch", "main"]);

    const record = await submitDrop(service, sideTip);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("InvalidRequest");
    expect(record.problem?.message).toMatch(/not on the checked-out branch/i);
  });

  it("refuses the branch's first commit", async () => {
    const root = (await repo.headOid()).trim();

    const record = await submitDrop(service, root);
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("InvalidRequest");
    expect(record.problem?.message).toMatch(/first commit/i);
  });
});
