/**
 * T08 end to end: staging, unstaging, discarding, committing and amending.
 *
 * Every case runs the real product path — the service's effect implementations
 * over real Git in an isolated fixture repository, reached through the
 * authenticated HTTP API exactly as the browser reaches it. The cases are the
 * ones where a Git client can silently do the wrong thing: a staged rename that
 * forgets its origin, an unstage that rewrites working files, a discard that
 * destroys unbacked-up content, and a commit reported as rolled back when it
 * landed (or the reverse).
 */
import {
  chmod,
  lstat,
  readdir,
  readFile,
  symlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  previewsResponseSchema,
  statusSnapshotSchema,
  type OperationRecord,
} from "@refyard/git-contract";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";
import {
  startTestService,
  type StartTestServiceOptions,
  type TestService,
} from "../support/service.js";

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "needsAttention",
  "unknown",
]);

interface StatusEntry {
  readonly pathId: string;
  readonly displayPath: string;
  readonly originalDisplayPath: string | null;
  readonly indexStatus: string;
  readonly worktreeStatus: string;
}

async function readStatus(service: TestService): Promise<{
  snapshotId: string;
  worktreeId: string;
  entries: readonly StatusEntry[];
}> {
  const response = await service.fetch(
    `/api/v1/status?repositoryId=${service.repositoryId}`,
  );
  expect(response.status).toBe(200);
  const parsed = statusSnapshotSchema.parse(await response.json());
  return {
    snapshotId: parsed.snapshotId,
    worktreeId: parsed.worktreeId,
    entries: parsed.entries.map((entry) => ({
      pathId: entry.pathId,
      displayPath: entry.displayPath,
      originalDisplayPath: entry.originalDisplayPath,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    })),
  };
}

function pathIdOf(
  entries: readonly StatusEntry[],
  displayPath: string,
): string {
  const entry = entries.find(
    (candidate) => candidate.displayPath === displayPath,
  );
  if (entry === undefined) {
    throw new Error(`no status entry for ${displayPath}`);
  }
  return entry.pathId;
}

/** Preview the given paths and return token per path id, positionally aligned. */
async function previewTokens(
  service: TestService,
  worktreeId: string,
  pathIds: readonly string[],
): Promise<readonly string[]> {
  const response = await service.fetch("/api/v1/previews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      repositoryId: service.repositoryId,
      worktreeId,
      pathIds,
    }),
  });
  expect(response.status).toBe(200);
  const parsed = previewsResponseSchema.parse(await response.json());
  const byPath = new Map(parsed.tokens.map((token) => [token.pathId, token]));
  return pathIds.map((pathId) => {
    const token = byPath.get(pathId);
    if (token === undefined) {
      throw new Error(`no preview token issued for ${pathId}`);
    }
    return token.previewToken;
  });
}

async function submit(service: TestService, body: unknown): Promise<Response> {
  return service.fetch("/api/v1/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Submit and poll until a terminal status; an accepted operation is not an outcome. */
async function submitAndWait(
  service: TestService,
  body: unknown,
): Promise<OperationRecord> {
  const submitted = await submit(service, body);
  const text = await submitted.text();
  if (submitted.status !== 200 && submitted.status !== 202) {
    throw new Error(
      `submit failed with HTTP ${submitted.status}: ${text.slice(0, 400)}`,
    );
  }
  // A fresh acceptance returns the accepted envelope; a replay returns the whole
  // record under `operation`. Both carry the operation id this helper waits on.
  const parsed = JSON.parse(text) as {
    operationId?: string;
    operation?: { operationId: string };
  };
  const operationId = parsed.operationId ?? parsed.operation?.operationId;
  if (operationId === undefined) {
    throw new Error(
      `submit response carried no operation id: ${text.slice(0, 200)}`,
    );
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await service.fetch(
      `/api/v1/operations?operationId=${operationId}`,
    );
    if (response.status === 200) {
      const body = (await response.json()) as { operations: OperationRecord[] };
      const record = body.operations[0];
      if (record !== undefined && TERMINAL_STATUSES.has(record.status)) {
        return record;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("operation did not reach a terminal status in time");
}

async function startStagingService(
  repo: GitFixtureRepo,
  overrides: Omit<StartTestServiceOptions, "repo"> = {},
): Promise<TestService> {
  const service = await startTestService({ repo, ...overrides });
  const token = await service.pair();
  // Every request this file makes is an authenticated client, so the bearer is
  // attached once here instead of threaded through each call.
  return {
    ...service,
    fetch: (path, init = {}) => service.fetch(path, { ...init, token }),
  };
}

describe("staging and unstaging", () => {
  it("stages exactly the selected path and leaves the rest alone", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "changed");
    await repo.write("b.txt", "also changed");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "stage-a-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "stagePaths",
          pathIds: [aPath],
          previewTokens: tokens,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readStatus(service);
      expect(pathIdOf(after.entries, "a.txt")).toBe(aPath);
      const a = after.entries.find((entry) => entry.displayPath === "a.txt");
      const b = after.entries.find((entry) => entry.displayPath === "b.txt");
      expect(a?.indexStatus).toBe("M");
      expect(a?.worktreeStatus).toBe(".");
      // b.txt is a new file this test never staged: still untracked, untouched.
      expect(b?.indexStatus).toBe("?");
      expect(b?.worktreeStatus).toBe("?");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("stages the deletion of a tracked file", async () => {
    const repo = await createRepo({ initialCommit: true });
    await rm(join(repo.root, "a.txt"));
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "stage-deleted-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "stagePaths",
          pathIds: [aPath],
          previewTokens: tokens,
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readStatus(service);
      const a = after.entries.find((entry) => entry.displayPath === "a.txt");
      expect(a?.indexStatus).toBe("D");
      expect(a?.worktreeStatus).toBe(".");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("staging a rename stages the origin path too", async () => {
    // Prevents: a staged rename that only records the new name, leaving the index
    // with both the old file and the new one. A worktree rename is a deletion and
    // a new file until both are staged, so both paths are selected.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("b.txt", "base\n");
    await rm(join(repo.root, "a.txt"));
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const bPath = pathIdOf(status.entries, "b.txt");
      const tokens = await previewTokens(service, status.worktreeId, [
        aPath,
        bPath,
      ]);
      const record = await submitAndWait(service, {
        clientRequestId: "stage-rename-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "stagePaths",
          pathIds: [bPath, aPath],
          previewTokens: [tokens[1] ?? "", tokens[0] ?? ""],
        },
      });
      expect(record.status).toBe("succeeded");
      const after = await readStatus(service);
      const b = after.entries.find((entry) => entry.displayPath === "b.txt");
      expect(b?.indexStatus).toBe("R");
      expect(b?.worktreeStatus).toBe(".");
      expect(b?.originalDisplayPath).toEqual("a.txt");
      expect(
        after.entries.find((entry) => entry.displayPath === "a.txt"),
      ).toBeUndefined();
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("unstage does not change working file bytes", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "changed");
    await repo.git(["add", "--", "a.txt"]);
    const service = await startStagingService(repo);
    try {
      const before = await repo.readText("a.txt");
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const record = await submitAndWait(service, {
        clientRequestId: "unstage-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "unstagePaths", pathIds: [aPath] },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual(before);
      const after = await readStatus(service);
      const a = after.entries.find((entry) => entry.displayPath === "a.txt");
      expect(a?.indexStatus).toBe(".");
      expect(a?.worktreeStatus).toBe("M");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("unstage on an unborn branch removes the index entry and keeps the file", async () => {
    // Prevents: `restore --staged` against a repository with no commits, which has
    // no HEAD to restore from and would fail — or worse, be worked around by
    // deleting the file.
    const repo = await createRepo({ initialCommit: false });
    await repo.write("a.txt", "new file");
    await repo.git(["add", "--", "a.txt"]);
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const record = await submitAndWait(service, {
        clientRequestId: "unstage-unborn-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "unstagePaths", pathIds: [aPath] },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual("new file");
      const after = await readStatus(service);
      const a = after.entries.find((entry) => entry.displayPath === "a.txt");
      // Untracked now, in both columns: the index no longer holds it.
      expect(a?.indexStatus).toBe("?");
      expect(a?.worktreeStatus).toBe("?");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("discarding", () => {
  it("restores a modified tracked file to the index content and writes a backup", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "modified, will be discarded");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "discard-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual("base\n");
      // The backup holds what the discard destroyed, under the service's private
      // state root — never inside the repository. The recovery area lays entries
      // out as <operationId>/<timestamp>/<relative path> next to its index.
      const backupRoot = join(service.stateRoot, "backups");
      const operationDirs = (await readdir(backupRoot)).filter(
        (name) => name !== "index.json",
      );
      expect(operationDirs.length).toBe(1);
      const operationDir = join(backupRoot, operationDirs[0] ?? "");
      const stampDirs = await readdir(operationDir);
      expect(stampDirs.length).toBe(1);
      const backupFiles = await readdir(join(operationDir, stampDirs[0] ?? ""));
      expect(backupFiles).toContain("a.txt");
      const backupContent = await readFile(
        join(operationDir, stampDirs[0] ?? "", backupFiles[0] ?? ""),
      );
      expect(backupContent.toString()).toEqual("modified, will be discarded");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("restores a deleted tracked file from the index", async () => {
    const repo = await createRepo({ initialCommit: true });
    await rm(join(repo.root, "a.txt"));
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "discard-deleted-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(await repo.readText("a.txt")).toEqual("base\n");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses an untracked path and changes nothing", async () => {
    // Prevents: "discard" silently turning into `git clean` for untracked work.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("notes.md", "untracked work");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const notesPath = pathIdOf(status.entries, "notes.md");
      const tokens = await previewTokens(service, status.worktreeId, [
        notesPath,
      ]);
      const record = await submitAndWait(service, {
        clientRequestId: "discard-untracked-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [notesPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.code).toBe("UnsupportedOperation");
      expect(await repo.readText("notes.md")).toEqual("untracked work");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a tracked path whose worktree entry became a symlink", async () => {
    // Prevents: writing index content through a symbolic link to a file outside
    // the worktree.
    const repo = await createRepo({ initialCommit: true });
    await rm(join(repo.root, "a.txt"));
    await symlink("/etc/hostname", join(repo.root, "a.txt"));
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "discard-symlink-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("failed");
      const link = await lstat(join(repo.root, "a.txt"));
      expect(link.isSymbolicLink()).toBe(true);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("is refused when a previewed file changed after the preview", async () => {
    // Prevents: discarding content the user was never shown — a `git status`
    // marker alone cannot tell that the file was rewritten after the preview.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "previewed content");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      await repo.write("a.txt", "changed after the preview");
      const record = await submitAndWait(service, {
        clientRequestId: "discard-stale-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.code).toBe("StalePreview");
      expect(await repo.readText("a.txt")).toEqual("changed after the preview");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("is refused without touching the file when the backup cannot be written", async () => {
    // Prevents: the destroy step running when the safety step failed.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "must survive");
    const service = await startStagingService(repo, {
      backupStore: {
        backUp: async () => ({
          kind: "refused" as const,
          reason: "the backup budget is exhausted",
        }),
      },
    });
    try {
      const status = await readStatus(service);
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const record = await submitAndWait(service, {
        clientRequestId: "discard-backup-fail-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      });
      expect(record.status).toBe("failed");
      expect(await repo.readText("a.txt")).toEqual("must survive");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a preview token that was already used", async () => {
    // Prevents: a replayed request discarding a file the user has not been shown
    // again. Tokens are single-use, all-or-nothing per batch.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "will be discarded once");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      // The path id is stable for these bytes in this worktree, so it stays
      // valid even after the first discard removes the file from the change set.
      const aPath = pathIdOf(status.entries, "a.txt");
      const tokens = await previewTokens(service, status.worktreeId, [aPath]);
      const request = {
        clientRequestId: "discard-replay-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "discardTrackedPaths",
          pathIds: [aPath],
          previewTokens: tokens,
          confirmed: true,
        },
      };
      const first = await submitAndWait(service, request);
      expect(first.status).toBe("succeeded");
      // The discard is worktree-only, but it emptied the change set, so the
      // snapshot taken before it is stale by the product's own definition; the
      // replay pairs the spent token with a fresh snapshot.
      const fresh = await readStatus(service);
      const replay = await submitAndWait(service, {
        ...request,
        clientRequestId: "discard-replay-2",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: fresh.worktreeId,
          expectedSnapshotId: fresh.snapshotId,
        },
      });
      expect(replay.status).toBe("failed");
      expect(replay.problem?.code).toBe("StalePreview");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("committing and amending", () => {
  it("commits the index and reports the new head", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "committed content");
    await repo.git(["add", "--", "a.txt"]);
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const record = await submitAndWait(service, {
        clientRequestId: "commit-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "commit", message: "stage a.txt\n" },
      });
      expect(record.status).toBe("succeeded");
      expect(record.result?.newHeadOid).not.toBeNull();
      expect(record.result?.newHeadOid).toEqual(await repo.headOid());
      const after = await readStatus(service);
      expect(after.entries).toHaveLength(0);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses to commit when the index holds no change", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const record = await submitAndWait(service, {
        clientRequestId: "commit-empty-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "commit", message: "nothing\n" },
      });
      expect(record.status).toBe("failed");
      expect(record.problem?.code).toBe("Conflict");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("rejects an empty message at the boundary without creating an operation", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const response = await submit(service, {
        clientRequestId: "commit-empty-message-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "commit", message: "" },
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("reports a failing pre-commit hook as failed with the head unchanged", async () => {
    // Prevents: labelling an operation "unknown" (or "succeeded") when evidence
    // — a re-read Head — shows exactly what happened.
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "hook will block this");
    await repo.git(["add", "--", "a.txt"]);
    const hook = join(repo.root, ".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nexit 1\n");
    await chmod(hook, 0o755);
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const before = await repo.headOid();
      const record = await submitAndWait(service, {
        clientRequestId: "commit-hook-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "commit", message: "blocked by hook\n" },
      });
      expect(record.status).toBe("failed");
      expect(await repo.headOid()).toEqual(before);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("amend with a new message rewrites the tip and keeps the parent", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("b.txt", "second\n");
    await repo.commitAll("second");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const parentBefore = await repo.git(["rev-parse", "HEAD~1"]);
      const record = await submitAndWait(service, {
        clientRequestId: "amend-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "amendCommit",
          message: "amended message\n",
          confirmed: true,
        },
      });
      expect(record.status).toBe("succeeded");
      expect(record.result?.newHeadOid).not.toBeNull();
      const log = new TextDecoder().decode(
        await repo.git(["log", "--format=%s", "-1"]),
      );
      expect(log).toContain("amended message");
      expect(await repo.git(["rev-parse", "HEAD~1"])).toEqual(parentBefore);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("amend without a message keeps the existing message", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const subjectBefore = new TextDecoder().decode(
        await repo.git(["log", "--format=%s", "-1"]),
      );
      const record = await submitAndWait(service, {
        clientRequestId: "amend-keep-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "amendCommit", message: null, confirmed: true },
      });
      expect(record.status).toBe("succeeded");
      expect(
        new TextDecoder().decode(await repo.git(["log", "--format=%s", "-1"])),
      ).toEqual(subjectBefore);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("rejects an amend without explicit confirmation at the boundary", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const response = await submit(service, {
        clientRequestId: "amend-unconfirmed-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "amendCommit", message: null },
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses to amend when the branch has no commits", async () => {
    const repo = await createRepo({ initialCommit: false });
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const record = await submitAndWait(service, {
        clientRequestId: "amend-unborn-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: {
          kind: "amendCommit",
          message: "nothing to rewrite\n",
          confirmed: true,
        },
      });
      expect(record.status).toBe("failed");
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

describe("operation bookkeeping", () => {
  it("returns the original operation for a repeated client request id", async () => {
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "changed");
    await repo.git(["add", "--", "a.txt"]);
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const body = {
        clientRequestId: "idempotent-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "commit", message: "once\n" },
      };
      const first = await submitAndWait(service, body);
      expect(first.status).toBe("succeeded");
      const response = await submit(service, body);
      expect(response.status).toBe(200);
      const replayed = (await response.json()) as {
        duplicate: boolean;
        operation: { operationId: string };
      };
      expect(replayed.duplicate).toBe(true);
      expect(replayed.operation.operationId).toEqual(first.operationId);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("refuses a selection with no paths at the boundary", async () => {
    // Prevents: an empty or default selection becoming "stage everything".
    const repo = await createRepo({ initialCommit: true });
    await repo.write("a.txt", "changed");
    const service = await startStagingService(repo);
    try {
      const status = await readStatus(service);
      const response = await submit(service, {
        clientRequestId: "stage-empty-1",
        target: {
          kind: "worktree",
          repositoryId: service.repositoryId,
          worktreeId: status.worktreeId,
          expectedSnapshotId: status.snapshotId,
        },
        operation: { kind: "stagePaths", pathIds: [], previewTokens: [] },
      });
      expect(response.status).toBe(400);
    } finally {
      await service.close();
      await repo.dispose();
    }
  });

  it("reports the implemented staging operations in capabilities", async () => {
    const repo = await createRepo({ initialCommit: true });
    const service = await startStagingService(repo);
    try {
      const response = await service.fetch("/api/v1/capabilities");
      expect(response.status).toBe(200);
      const capabilities = (await response.json()) as {
        operations: { kind: string }[];
      };
      const kinds = capabilities.operations.map((operation) => operation.kind);
      for (const kind of [
        "stagePaths",
        "unstagePaths",
        "discardTrackedPaths",
        "commit",
        "amendCommit",
      ]) {
        expect(kinds).toContain(kind);
      }
    } finally {
      await service.close();
      await repo.dispose();
    }
  });
});

// The real effect factory is wired inside tests/support/service.ts, exactly as
// apps/cli wires it; this file exercises it through the HTTP API only.
