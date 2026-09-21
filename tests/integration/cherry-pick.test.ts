/**
 * Cherry-picking one commit onto the checked-out branch through the API.
 *
 * Cherry-pick is the second write that stops *in the middle*, and unlike a
 * revert its stopped state is worth finishing, so the cases cover the whole
 * lifecycle:
 *
 * - a clean pick writes a new commit with the original message and author;
 * - a conflicted pick is `needsAttention` with the conflict visible in the
 *   status read and `operationInProgress: cherry-pick` — the state the sidebar's
 *   conflict panel finishes;
 * - a continue while paths are still unmerged stays stopped, and after they are
 *   staged the continue commits with the original message;
 * - an abort restores the head and clears the stopped state;
 * - a pick of a change that is already present is refused with the branch
 *   unchanged, because an empty commit is a trap, not a result.
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
    clientRequestId: `cp-${Math.random().toString(36).slice(2, 8)}`,
    target: await worktreeTarget(service),
    operation,
  } as never);
}

/**
 * `a.txt` diverges: `side` changes it one way, `main` another, so picking
 * `side`'s commit onto `main` must conflict.
 */
async function diverge(repo: GitFixtureRepo): Promise<string> {
  await repo.git(["switch", "-c", "side"]);
  await repo.write("a.txt", "from side\n");
  const side = await repo.commitAll("from side");
  await repo.git(["switch", "main"]);
  await repo.write("a.txt", "from main\n");
  await repo.commitAll("from main");
  return side;
}

describe("cherry-picking", () => {
  let repo: GitFixtureRepo;
  let service: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    service = await startService(repo);
  });

  it("applies a clean pick with the original message and author", async () => {
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "from side\n");
    const side = await repo.commitAll("from side");
    await repo.git(["switch", "main"]);
    await repo.write("main.txt", "main own\n");
    await repo.commitAll("main own");
    const author = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%an <%ae>", side]))
      .trim();
    const before = (await repo.headOid()).trim();

    const record = await submit(service, { kind: "cherryPick", oid: side });
    expect(record.status).toBe("succeeded");
    expect(record.result?.newHeadOid).not.toEqual(before);
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual("from side");
    const got = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%an <%ae>"]))
      .trim();
    expect(got).toEqual(author);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("reports a conflicted pick as needsAttention and keeps the stop open", async () => {
    const side = await diverge(repo);

    const record = await submit(service, { kind: "cherryPick", oid: side });
    expect(record.status).toBe("needsAttention");
    expect(record.problem?.details?.conflictedPaths).toEqual(1);

    const status = await readStatus(service);
    expect(status.operationInProgress).toEqual("cherry-pick");
    expect(status.unmerged.map((entry) => entry.displayPath)).toEqual(["a.txt"]);
  });

  it("refuses a continue while unresolved, then commits the resolved pick", async () => {
    const side = await diverge(repo);
    const started = await submit(service, { kind: "cherryPick", oid: side });
    expect(started.status).toBe("needsAttention");

    // A continue with the conflict still in the index cannot commit anything.
    const early = await submit(service, { kind: "continueCherryPick" });
    expect(early.status).toBe("needsAttention");

    // Resolve outside — this build never edits a conflicted file — then continue.
    await repo.write("a.txt", "resolved\n");
    await repo.git(["add", "--", "a.txt"]);
    const done = await submit(service, { kind: "continueCherryPick" });
    expect(done.status).toBe("succeeded");
    const subject = new TextDecoder()
      .decode(await repo.git(["log", "-1", "--format=%s"]))
      .trim();
    expect(subject).toEqual("from side");
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("aborts a stopped pick and restores the head it started from", async () => {
    const side = await diverge(repo);
    const before = (await repo.headOid()).trim();
    const started = await submit(service, { kind: "cherryPick", oid: side });
    expect(started.status).toBe("needsAttention");

    const record = await submit(service, {
      kind: "abortCherryPick",
      confirmed: true,
    });
    expect(record.status).toBe("succeeded");
    expect((await repo.headOid()).trim()).toEqual(before);
    expect(await repo.readText("a.txt")).toEqual("from main\n");
    const status = await readStatus(service);
    expect(status.operationInProgress).toBeNull();
    expect(status.unmerged).toEqual([]);
  });

  it("refuses a repeat pick whose change is already present", async () => {
    // Picking the same commit twice is the real-world duplicate: the second
    // patch applies nothing, Git refuses the empty commit, and the workflow
    // aborts the stop so the branch is left exactly as the first pick made it.
    await repo.git(["switch", "-c", "side"]);
    await repo.write("side.txt", "from side\n");
    const side = await repo.commitAll("from side");
    await repo.git(["switch", "main"]);
    const first = await submit(service, { kind: "cherryPick", oid: side });
    expect(first.status).toBe("succeeded");
    const head = (await repo.headOid()).trim();

    const record = await submit(service, { kind: "cherryPick", oid: side });
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("Conflict");
    expect(record.problem?.message).toMatch(/empty/i);
    expect((await repo.headOid()).trim()).toEqual(head);
    expect((await readStatus(service)).operationInProgress).toBeNull();
  });

  it("refuses a merge commit without choosing a parent", async () => {
    await repo.git(["switch", "-c", "m"]);
    await repo.write("m.txt", "m\n");
    const m = await repo.commitAll("m");
    await repo.git(["switch", "main"]);
    await repo.git(["merge", "--no-ff", "-m", "merge m", m]);
    const mergeOid = (await repo.headOid()).trim();

    const record = await submit(service, { kind: "cherryPick", oid: mergeOid });
    expect(record.status).toBe("failed");
    expect(record.problem?.code).toBe("InvalidRequest");
    expect(record.problem?.message).toMatch(/merge/i);
    expect((await repo.headOid()).trim()).toEqual(mergeOid);
  });
});
