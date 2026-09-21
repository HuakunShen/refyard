/**
 * Rebasing the checked-out branch onto another commit through the API.
 *
 * The rebase lifecycle mirrors the cherry-pick's — stop, resolve outside,
 * continue — scaled to a range of commits, and the cases cover what each
 * transition guarantees:
 *
 * - a clean rebase replays the branch onto the target, keeping its commits'
 *   subjects;
 * - a conflicted rebase is `needsAttention` with the conflict visible in the
 *   status read and `operationInProgress: rebase`;
 * - a continue while paths are still unmerged stays stopped; after they are
 *   staged the continue finishes the replay without opening an editor;
 * - an abort restores the branch to where the rebase started;
 * - an already-up-to-date rebase succeeds by changing nothing.
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

async function submit(
  service: TestService,
  operation: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof submitAndWait>>> {
  return submitAndWait(service, {
    clientRequestId: `rb-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation,
  } as never);
}

/** `a.txt` diverges, so rebasing `side` onto `main` must conflict. */
async function diverge(repo: GitFixtureRepo): Promise<string> {
  await repo.git(["switch", "-c", "side"]);
  await repo.write("a.txt", "from side\n");
  await repo.commitAll("from side");
  await repo.git(["switch", "main"]);
  await repo.write("a.txt", "from main\n");
  await repo.commitAll("from main");
  return (await repo.headOid()).trim();
}

describe("rebasing the checked-out branch", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("replays the branch onto the target and keeps the subjects", async () => {
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "from side\n");
    await repo.commitAll("side one");
    await repo.write("side2.txt", "from side two\n");
    await repo.commitAll("side two");
    await repo.git(["switch", "main"]);
    await repo.write("main.txt", "from main\n");
    const mainTip = await repo.commitAll("from main");
    // The operation rebases the checked-out branch, so `side` must be the
    // worktree's branch when the request runs.
    await repo.git(["switch", "side"]);

    const record = await submit(service, { kind: "rebase", upstreamOid: mainTip });
    expect(record.status).toBe("succeeded");
    // The first replayed commit's parent is the new base (HEAD itself is the
    // second replayed commit).
    const parents = new TextDecoder()
      .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD~1"]))
      .trim()
      .split(" ");
    expect(parents[1]).toEqual(mainTip);
    const subjects = new TextDecoder()
      .decode(await repo.git(["log", "--format=%s", "-3"]))
      .trim()
      .split("\n");
    expect(subjects).toEqual(["side two", "side one", "from main"]);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("reports a conflicted rebase as needsAttention and keeps the stop open", async () => {
    const mainTip = await diverge(repo);
    await repo.git(["switch", "side"]);

    const record = await submit(service, { kind: "rebase", upstreamOid: mainTip });
    expect(record.status).toBe("needsAttention");
    expect(record.problem?.details?.conflictedPaths).toEqual(1);

    const status = await readStatus(service);
    expect(status.operationInProgress).toEqual("rebase");
    expect(status.unmerged.map((entry) => entry.displayPath)).toEqual(["a.txt"]);
  });

  it("refuses a continue while unresolved, then finishes once staged", async () => {
    const mainTip = await diverge(repo);
    await repo.git(["switch", "side"]);
    const started = await submit(service, { kind: "rebase", upstreamOid: mainTip });
    expect(started.status).toBe("needsAttention");

    const early = await submit(service, { kind: "continueRebase" });
    expect(early.status).toBe("needsAttention");

    await repo.write("a.txt", "resolved\n");
    await repo.git(["add", "--", "a.txt"]);
    const done = await submit(service, { kind: "continueRebase" });
    expect(done.status).toBe("succeeded");
    // The replayed commit sits directly on the new base.
    const parents = new TextDecoder()
      .decode(await repo.git(["rev-list", "--parents", "-n", "1", "HEAD"]))
      .trim()
      .split(" ");
    expect(parents[1]).toEqual(mainTip);
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual("from side");
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("aborts a stopped rebase and restores the branch it started from", async () => {
    const mainTip = await diverge(repo);
    await repo.git(["switch", "side"]);
    // Captured BEFORE the rebase: while a rebase is stopped, HEAD is detached
    // at the replayed-so-far commit, and the abort returns to the branch tip.
    const startedHead = (await repo.headOid()).trim();
    const started = await submit(service, { kind: "rebase", upstreamOid: mainTip });
    expect(started.status).toBe("needsAttention");

    const record = await submit(service, {
      kind: "abortRebase",
      confirmed: true,
    });
    expect(record.status).toBe("succeeded");
    expect((await repo.headOid()).trim()).toEqual(startedHead);
    expect(await repo.readText("a.txt")).toEqual("from side\n");
    const status = await readStatus(service);
    expect(status.operationInProgress).toBeNull();
    expect(status.unmerged).toEqual([]);
  });

  it("succeeds without change when the branch is already on the target", async () => {
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "from side\n");
    await repo.commitAll("side one");
    const tip = (await repo.headOid()).trim();

    const record = await submit(service, { kind: "rebase", upstreamOid: tip });
    expect(record.status).toBe("succeeded");
    expect((await repo.headOid()).trim()).toEqual(tip);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });
});
