/**
 * Tests for the operation follower.
 *
 * The properties here are safety properties, not conveniences: a lost poll must not
 * become a second write, and a terminal record must be reported as the state it is.
 * Both are invisible in a browser until the day they matter, which is why they are
 * tested against a fake reader that fails on purpose.
 */
import { describe, expect, it } from "vitest";
import type { OperationRecord } from "@refyard/git-contract";
import {
  followOperation,
  type OperationReader,
} from "../../apps/web/src/lib/operation-follow.ts";

function record(status: OperationRecord["status"]): OperationRecord {
  return {
    operationId: "op_1",
    clientRequestId: "req-1",
    kind: "merge",
    target: { kind: "repository", repositoryId: "repo_1", expectedSnapshotId: "s1" },
    status,
    sequence: 1,
    acceptedAt: "2026-09-15T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    result:
      status === "succeeded"
        ? {
            summary: "merged the source into the current branch",
            changedRefs: [],
            changedPaths: null,
            snapshotInvalidated: true,
            newHeadOid: null,
          }
        : null,
    problem:
      status === "needsAttention"
        ? {
            code: "GitCommandFailed",
            message: "the merge stopped with 1 conflicted path(s)",
            retryable: false,
          }
        : null,
  };
}

const noSleep = (): Promise<void> => Promise.resolve();

describe("following an operation", () => {
  it("returns the summary of a succeeded record", async () => {
    const reader: OperationReader = {
      get: () => Promise.resolve(record("succeeded")),
    };
    expect(await followOperation(reader, "op_1", { sleep: noSleep })).toEqual(
      "merged the source into the current branch",
    );
  });

  it("reports needsAttention as itself, with the host's message", async () => {
    const reader: OperationReader = {
      get: () => Promise.resolve(record("needsAttention")),
    };
    const message = await followOperation(reader, "op_1", { sleep: noSleep });
    expect(message).toContain("needsAttention");
    expect(message).toContain("1 conflicted path(s)");
  });

  it("keeps polling while the record is still running", async () => {
    let calls = 0;
    const reader: OperationReader = {
      get: () => {
        calls += 1;
        return Promise.resolve(record(calls < 3 ? "running" : "succeeded"));
      },
    };
    await followOperation(reader, "op_1", { sleep: noSleep });
    expect(calls).toBe(3);
  });

  it("re-reads through a dropped connection instead of giving up", async () => {
    let calls = 0;
    const reader: OperationReader = {
      get: () => {
        calls += 1;
        if (calls < 3) {
          return Promise.reject(new Error("fetch failed"));
        }
        return Promise.resolve(record("succeeded"));
      },
    };
    const message = await followOperation(reader, "op_1", { sleep: noSleep });
    expect(message).toContain("merged the source");
    expect(calls).toBe(3);
  });

  it("names the operation id when the service stays unreachable, and never resubmits", async () => {
    let calls = 0;
    const reader: OperationReader = {
      get: () => {
        calls += 1;
        return Promise.reject(new Error("fetch failed"));
      },
    };
    const message = await followOperation(reader, "op_7", {
      sleep: noSleep,
      transportFailuresAllowed: 3,
    });
    expect(message).toContain("op_7");
    expect(message).toContain("not resubmitted");
    // Only reads were attempted: the follower has no other call to make.
    expect(calls).toBe(3);
  });

  it("says the operation is unfinished when the poll budget runs out", async () => {
    const reader: OperationReader = {
      get: () => Promise.resolve(record("running")),
    };
    const message = await followOperation(reader, "op_9", {
      sleep: noSleep,
      attempts: 4,
    });
    expect(message).toContain("op_9");
    expect(message).toContain("did not finish in time");
  });
});
