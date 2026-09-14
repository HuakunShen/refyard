/**
 * Restart behaviour: what the next process does with an unresolved operation.
 *
 * The rules are the ones from the design, and each test is written to fail if the
 * rule is dropped rather than if an implementation detail changes:
 *
 * - a record left in `accepted` or `running` becomes `unknown` — not `failed`, not
 *   `succeeded`, and never retried;
 * - the repository it touched is blocked for writes until a human resolves it;
 * - reads keep working, so the user can see what the previous process was doing;
 * - a journal that cannot be read is refused rather than interpreted.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore } from "@refyard/host-node/journal/store";
import { DEFAULT_RETENTION } from "@refyard/host-node/journal/retention";
import { createRecovery } from "@refyard/host-node/journal/recovery";
import { createEventRing } from "@refyard/host-node/http/events";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import { startTestService, type TestService } from "../support/service.js";

const TARGET = {
  kind: "worktree" as const,
  repositoryId: "repo_placeholder",
  worktreeId: "wt_placeholder",
  expectedSnapshotId: "snap_placeholder",
};

describe("journal recovery", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "refyard-restart-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("marks an operation left running as unknown and blocks its repository", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await journal.append({
      operationId: "op_crashed",
      clientRequestId: "req_crashed",
      actor: "cli",
      kind: "commit",
      target: TARGET,
      status: "running",
      sequence: 1,
      acceptedAtMs: 1_000,
      startedAtMs: 1_001,
      finishedAtMs: null,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_a",
      result: null,
      problem: null,
      unknownReason: null,
    });

    // A new process: a fresh store over the same file, then recovery.
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await reopened.load();
    const recovery = createRecovery({ journal: reopened });
    const report = await recovery.run();

    expect(report.reconciled).toHaveLength(1);
    expect(report.reconciled[0]?.previousStatus).toBe("running");
    const record = reopened.get("op_crashed");
    expect(record?.status).toBe("unknown");
    expect(record?.problem?.code).toBe("UncertainOutcome");
    expect(record?.unknownReason).toContain("restart");
    // The write block is per repository, not global.
    expect(recovery.blockedRepositories()).toEqual(["repo_a"]);
    expect(recovery.blockFor("repo_a")?.operationIds).toEqual(["op_crashed"]);
    expect(recovery.blockFor("repo_b")).toBeNull();
  });

  it("does not touch an operation that already finished", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await journal.append({
      operationId: "op_done",
      clientRequestId: "req_done",
      actor: "cli",
      kind: "commit",
      target: TARGET,
      status: "succeeded",
      sequence: 1,
      acceptedAtMs: 1_000,
      startedAtMs: 1_000,
      finishedAtMs: 2_000,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_a",
      result: null,
      problem: null,
      unknownReason: null,
    });
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await reopened.load();
    const recovery = createRecovery({ journal: reopened });
    const report = await recovery.run();
    expect(report.reconciled).toHaveLength(0);
    expect(reopened.get("op_done")?.status).toBe("succeeded");
  });

  it("clears a block only when asked, and reports that it did", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await journal.append({
      operationId: "op_blocked",
      clientRequestId: "req_blocked",
      actor: "cli",
      kind: "commit",
      target: TARGET,
      status: "accepted",
      sequence: 1,
      acceptedAtMs: 1_000,
      startedAtMs: null,
      finishedAtMs: null,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_a",
      result: null,
      problem: null,
      unknownReason: null,
    });
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await reopened.load();
    const recovery = createRecovery({ journal: reopened });
    await recovery.run();
    expect(
      recovery.resolveBlock("repo_a", "checked the repository by hand"),
    ).toBe(true);
    expect(recovery.blockFor("repo_a")).toBeNull();
    // Resolving a block twice is not an error; it simply reports nothing changed.
    expect(recovery.resolveBlock("repo_a", "again")).toBe(false);
  });

  it("refuses a journal with an unreadable record instead of interpreting it", async () => {
    // Prevents: a file edited or truncated by something else being read as if the
    // remaining lines were a complete history of what happened.
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await writeFile(
      journal.filePath(),
      `{"operationId":"op_a","clientRequestId":"r","actor":"cli","kind":"commit","target":{"kind":"repository","repositoryId":"repo_a","expectedSnapshotId":"snap_a"},"status":"succeeded","sequence":1,"acceptedAt":"2026-01-01T00:00:00.000Z","payloadDigest":"${"d".repeat(64)}","repositoryId":"repo_a"}\nnot json at all\n{"operationId":"op_c","clientRequestId":"r","actor":"cli","kind":"commit","target":{"kind":"repository","repositoryId":"repo_a","expectedSnapshotId":"snap_a"},"status":"succeeded","sequence":3,"acceptedAt":"2026-01-01T00:00:00.000Z","payloadDigest":"${"d".repeat(64)}","repositoryId":"repo_a"}\n`,
      "utf8",
    );
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await expect(reopened.load()).rejects.toThrow(/unreadable record/);
  });

  it("announces a reconciled record so a UI can refresh", async () => {
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await journal.append({
      operationId: "op_running",
      clientRequestId: "req_running",
      actor: "cli",
      kind: "commit",
      target: TARGET,
      status: "running",
      sequence: 1,
      acceptedAtMs: 1_000,
      startedAtMs: 1_000,
      finishedAtMs: null,
      payloadDigest: "d".repeat(64),
      repositoryId: "repo_a",
      result: null,
      problem: null,
      unknownReason: null,
    });
    const events = createEventRing();
    const reopened = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await reopened.load();
    const recovery = createRecovery({
      journal: reopened,
      onReconciled: (entry) => {
        events.publish({
          kind: "operation",
          operation: {
            operationId: entry.operationId,
            clientRequestId: entry.clientRequestId,
            kind: entry.kind,
            target: entry.target,
            status: entry.status,
            sequence: entry.sequence,
            acceptedAt: new Date(entry.acceptedAtMs).toISOString(),
            startedAt: null,
            finishedAt: null,
            result: null,
            problem: entry.problem,
          },
        });
      },
    });
    await recovery.run();
    const published = events.replay(0);
    expect(published).toHaveLength(1);
    expect(published[0]?.payload.kind).toBe("operation");
  });
});

describe("restart with a live service", () => {
  let repo: GitFixtureRepo;
  let first: TestService;

  beforeEach(async () => {
    repo = await createRepo({ initialCommit: true });
    first = await startTestService({ repo });
  });

  afterEach(async () => {
    await first.close();
    await repo.dispose();
  });

  it("blocks writes in the repository a previous process left unfinished", async () => {
    // Prevents: a new process writing on top of an operation whose outcome nobody
    // has confirmed.
    const stateRoot = first.stateRoot;
    const journal = createJournalStore({
      stateRoot,
      retention: DEFAULT_RETENTION,
    });
    await journal.load();
    await journal.append({
      operationId: "op_left_running",
      clientRequestId: "req_left",
      actor: "local-user",
      kind: "commit",
      target: {
        kind: "worktree",
        repositoryId: first.repositoryId,
        worktreeId: "wt_whatever",
        expectedSnapshotId: "snap_whatever",
      },
      status: "running",
      sequence: 999,
      acceptedAtMs: 1_000,
      startedAtMs: 1_000,
      finishedAtMs: null,
      payloadDigest: "d".repeat(64),
      repositoryId: first.repositoryId,
      result: null,
      problem: null,
      unknownReason: null,
    });
    await first.close();

    const restarted = await startTestService({ repo, stateRoot });
    try {
      // The block is visible, and reads still work so the user can look around.
      expect(restarted.mutations.blockedRepositories()).toContain(
        first.repositoryId,
      );
      const token = await restarted.pair();
      const status = await restarted.fetch(
        `/api/v1/status?repositoryId=${restarted.repositoryId}`,
        { token },
      );
      expect(status.status).toBe(200);

      // The unresolved operation is queryable and reported as unknown.
      const record = restarted.journal.get("op_left_running");
      expect(record?.status).toBe("unknown");
    } finally {
      await restarted.close();
    }
  });
});
