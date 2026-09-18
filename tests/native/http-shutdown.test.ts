/**
 * Shutdown while a write is in flight.
 *
 * The property the journal exists for: a mutation whose fate died with the process must
 * come back as `unknown`, block the repository's next write, and yield only to an
 * explicit acknowledgement — never to a retry, and never rewritten into a success. The
 * test kills the release binary with SIGKILL (no graceful drain, the worst case) the
 * moment a commit is accepted, restarts against the same private state directory, and
 * interrogates the new process.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

const BINARY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../target/release/refyard-native",
);

interface Running {
  readonly url: string;
  readonly token: string;
  readonly child: ChildProcess;
  readonly stateDir: string;
}

async function startServe(
  repo: GitFixtureRepo,
  stateDir: string,
): Promise<Running> {
  const child = spawn(
    BINARY,
    ["serve", "--port", "0", "--json", "--no-open", repo.root],
    {
      env: { ...repo.env, REFYARD_STATE_DIR: stateDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) =>
    stdoutChunks.push(chunk.toString("utf8")),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    stderrChunks.push(chunk.toString("utf8")),
  );
  let readiness: { url: string } | null = null;
  for (let waited = 0; waited < 15_000 && readiness === null; waited += 25) {
    const line = stdoutChunks
      .join("")
      .split("\n")
      .find((line) => line.startsWith("{"));
    if (line !== undefined) {
      readiness = JSON.parse(line);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (readiness === null) {
    throw new Error(
      `the service did not start: ${stderrChunks.join("").slice(0, 300)}`,
    );
  }
  const pairingLine = stderrChunks
    .join("")
    .split("\n")
    .find((line) => line.includes("pairing URL (single use): "));
  const ticket = pairingLine?.split("pair=")[1]?.trim() ?? "";
  const exchanged = await fetch(`${readiness.url}/api/v1/session/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: readiness.url },
    body: JSON.stringify({ ticket }),
  });
  const { token } = (await exchanged.json()) as { token: string };
  return { url: readiness.url, token, child, stateDir };
}

type Answer = { status: number; body: any };

async function api(
  running: Running,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Answer> {
  const response = await fetch(`${running.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${running.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function stop(running: Running, signal: NodeJS.Signals): Promise<void> {
  await new Promise<void>((resolve) => {
    running.child.once("exit", () => resolve());
    running.child.kill(signal);
  });
}

let repo: GitFixtureRepo;
let stateDir: string;

beforeAll(async () => {
  repo = await createRepo({ initialCommit: true });
  stateDir = await mkdtemp(join(tmpdir(), "refyard-kill-state-"));
});

afterAll(async () => {
  await rm(stateDir, { recursive: true, force: true });
  await rm(repo.scratchRoot, { recursive: true, force: true });
});

describe("a process killed mid-write", () => {
  it("reports the operation unknown, blocks the next write, and acks without rewriting history", async () => {
    // First process: accept a commit and kill it hard before (or as) it finishes.
    let running = await startServe(repo, stateDir);
    const repositories = await api(running, "GET", "/api/v1/repositories");
    const repositoryId = repositories.body.repositories[0].repositoryId;
    const status = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    const worktreeId = status.body.worktreeId;
    repo.write("a.txt", "changed by the killed run\n");
    const changed = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    const pathId = changed.body.entries[0].pathId;
    const previews = await api(running, "POST", "/api/v1/previews", {
      repositoryId,
      worktreeId,
      pathIds: [pathId],
    });
    const submitted = await api(running, "POST", "/api/v1/operations", {
      clientRequestId: "kill-mid-write-commit",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId,
        expectedSnapshotId: changed.body.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [pathId],
        previewTokens: [previews.body.tokens[0].previewToken],
      },
    });
    expect(submitted.status).toBe(202);
    const operationId = submitted.body.operationId as string;
    // SIGKILL: no drain, no cleanup, the worst case the journal exists for.
    await stop(running, "SIGKILL");

    // Second process, same private state: the operation comes back as unknown and the
    // repository is blocked.
    running = await startServe(repo, stateDir);
    const record = await api(
      running,
      "GET",
      `/api/v1/operations?operationId=${operationId}`,
    );
    expect(record.status).toBe(200);
    const recovered = record.body.operations[0];
    expect(["unknown", "needsAttention"]).toContain(recovered.status);

    // A new write for the blocked repository is refused, not silently queued. A block
    // surfaces as a conflict-shaped refusal; which code depends on where the check
    // fires, so the assertion is that the write does NOT start.
    const status2 = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    expect(status2.status).toBe(200);
    const previews2 = await api(running, "POST", "/api/v1/previews", {
      repositoryId,
      worktreeId: status2.body.worktreeId,
      pathIds: [status2.body.entries[0]?.pathId ?? pathId].filter(Boolean),
    });
    if (previews2.status === 200) {
      const refused = await api(running, "POST", "/api/v1/operations", {
        clientRequestId: "after-the-kill",
        target: {
          kind: "worktree",
          repositoryId,
          worktreeId: status2.body.worktreeId,
          expectedSnapshotId: status2.body.snapshotId,
        },
        operation: {
          kind: "stagePaths",
          pathIds: [status2.body.entries[0]?.pathId ?? pathId].filter(Boolean),
          previewTokens: [previews2.body.tokens[0].previewToken],
        },
      });
      expect(refused.status).not.toBe(202);
      expect(refused.body.problem.code).not.toBe("InternalError");
    }

    // Acknowledging is a person's decision in three acts: a refusal to confirm is
    // refused; a confirmation against a snapshot the service never minted is refused;
    // a confirmation against the fresh status the person just looked at lifts the
    // block — and leaves the outcome `unknown`, never rewritten into success.
    const refusedAck = await api(
      running,
      "POST",
      "/api/v1/operations/acknowledge",
      {
        operationId: operationId,
        confirmedSnapshotId: "snap_whatever",
        confirmed: false,
      },
    );
    expect(refusedAck.status).toBe(400);

    const fresh = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    expect(fresh.status).toBe(200);
    const confirmedSnapshotId = fresh.body.snapshotId;
    const bogusSnapshot = await api(
      running,
      "POST",
      "/api/v1/operations/acknowledge",
      {
        operationId: operationId,
        confirmedSnapshotId: "snap_minted_by_nobody",
        confirmed: true,
      },
    );
    expect(bogusSnapshot.status).toBe(404);

    const acked = await api(running, "POST", "/api/v1/operations/acknowledge", {
      operationId: operationId,
      confirmedSnapshotId,
      confirmed: true,
    });
    expect(acked.status).toBe(200);
    expect(acked.body.status).toBe("unknown");

    // And the next write goes through: the block was the point, and it is gone.
    const previews3 = await api(running, "POST", "/api/v1/previews", {
      repositoryId,
      worktreeId: fresh.body.worktreeId,
      pathIds: [fresh.body.entries[0]?.pathId ?? pathId].filter(Boolean),
    });
    expect(previews3.status).toBe(200);
    const retry = await api(running, "POST", "/api/v1/operations", {
      clientRequestId: "after-the-ack",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId: fresh.body.worktreeId,
        expectedSnapshotId: fresh.body.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [fresh.body.entries[0]?.pathId ?? pathId].filter(Boolean),
        previewTokens: [previews3.body.tokens[0].previewToken],
      },
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(202);
    await stop(running, "SIGTERM");
  }, 30_000);
});

describe("a process stopped gracefully", () => {
  it("keeps finished work finished across the restart and accepts nothing while stopped", async () => {
    // A graceful stop is the opposite contract from SIGKILL: work that finished is
    // recorded as finished, the journal agrees with the repository, and the new
    // process unblocks immediately. Nothing may turn `unknown` on the way down.
    const gracefulState = await mkdtemp(
      join(tmpdir(), "refyard-graceful-state-"),
    );
    let running = await startServe(repo, gracefulState);
    const repositories = await api(running, "GET", "/api/v1/repositories");
    const repositoryId = repositories.body.repositories[0].repositoryId;
    const status = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    repo.write("graceful.txt", "written before a graceful stop\n");
    const changed = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    const pathId = changed.body.entries[0].pathId;
    const previews = await api(running, "POST", "/api/v1/previews", {
      repositoryId,
      worktreeId: status.body.worktreeId,
      pathIds: [pathId],
    });
    const staged = await api(running, "POST", "/api/v1/operations", {
      clientRequestId: "graceful-stage",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId: status.body.worktreeId,
        expectedSnapshotId: changed.body.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [pathId],
        previewTokens: [previews.body.tokens[0].previewToken],
      },
    });
    expect(staged.status, JSON.stringify(staged.body)).toBe(202);
    const stagedId = staged.body.operationId as string;
    const settledStaged = await pollOperation(running, stagedId);
    expect(settledStaged).toBe("succeeded");

    // Stop politely. The exit is clean, and while the process is down the port
    // answers nothing at all — a stopped service is not a half-serving one.
    const exitCode = await new Promise<number | null>((resolve) => {
      running.child.once("exit", (code) => resolve(code));
      running.child.kill("SIGTERM");
    });
    expect(exitCode).toBe(0);
    await expect(fetch(`${running.url}/api/v1/repositories`)).rejects.toThrow();

    // Restart on the same private state: the finished operation is still finished,
    // the repository writes again without any acknowledgement ceremony.
    running = await startServe(repo, gracefulState);
    const record = await api(
      running,
      "GET",
      `/api/v1/operations?operationId=${stagedId}`,
    );
    expect(record.status).toBe(200);
    expect(record.body.operations[0].status).toBe("succeeded");
    const fresh = await api(
      running,
      "GET",
      `/api/v1/status?repositoryId=${repositoryId}`,
    );
    expect(fresh.status).toBe(200);
    expect(fresh.body.entries.length).toBeGreaterThan(0);
    const previewsAfter = await api(running, "POST", "/api/v1/previews", {
      repositoryId,
      worktreeId: fresh.body.worktreeId,
      pathIds: [fresh.body.entries[0].pathId],
    });
    expect(previewsAfter.status).toBe(200);
    const written = await api(running, "POST", "/api/v1/operations", {
      clientRequestId: "after-graceful-restart",
      target: {
        kind: "worktree",
        repositoryId,
        worktreeId: fresh.body.worktreeId,
        expectedSnapshotId: fresh.body.snapshotId,
      },
      operation: {
        kind: "stagePaths",
        pathIds: [fresh.body.entries[0].pathId],
        previewTokens: [previewsAfter.body.tokens[0].previewToken],
      },
    });
    expect(written.status, JSON.stringify(written.body)).toBe(202);
    await stop(running, "SIGTERM");
    await rm(gracefulState, { recursive: true, force: true });
  }, 30_000);
});

/** Polls one operation until it leaves the queued/running states, and returns its status. */
async function pollOperation(
  running: Running,
  operationId: string,
): Promise<string> {
  for (let waited = 0; waited < 10_000; waited += 100) {
    const answer = await api(
      running,
      "GET",
      `/api/v1/operations?operationId=${operationId}`,
    );
    if (answer.status === 200) {
      const status = answer.body.operations[0]?.status as string | undefined;
      if (status !== undefined && !["queued", "running"].includes(status)) {
        return status;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`operation ${operationId} never settled`);
}
