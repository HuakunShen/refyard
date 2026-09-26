/** Cursor, snapshot and exact-sequence behavior at the typed facade boundary. */
import { describe, expect, it, vi } from "vitest";
import { compareUInt64, createXrossPageQuery } from "./xross-queries.svelte.js";
import { createXrossQueries } from "./xross-queries.svelte.js";
import { createXrossSession } from "./xross-session.svelte.js";
import vectors from "../../../../../integrations/xross/contracts/view-v1/vectors/method-responses.json";
import { REFYARD_VIEW_METHODS_V1 } from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { parseRefyardId } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";

describe("Xross query pages", () => {
  it("requests continuation only after an explicit action and keeps source text unchanged", async () => {
    const read = vi.fn(async (cursor?: string) => ({
      snapshotId: "rsnapshot_00000000000000000000000000000001",
      items: [{ displayPath: "e\u0301.txt" }],
      truncated: cursor === undefined,
      nextCursor: cursor === undefined ? "cur_second" : null,
    }));
    const query = createXrossPageQuery(read);
    await query.load();
    expect(read).toHaveBeenCalledTimes(1);
    expect(query.current().nextCursor).toBe("cur_second");
    expect(query.current().truncated).toBe(true);
    await query.continue();
    expect(read).toHaveBeenLastCalledWith("cur_second");
    expect(query.current().items[0]?.displayPath).toBe("e\u0301.txt");
  });

  it("discards pages from a changed snapshot and rereads the scoped query", async () => {
    const read = vi.fn().mockResolvedValueOnce({ snapshotId: "a", items: [1], truncated: true, nextCursor: "cur_2" })
      .mockResolvedValueOnce({ snapshotId: "b", items: [2], truncated: false, nextCursor: null })
      .mockResolvedValueOnce({ snapshotId: "b", items: [3], truncated: false, nextCursor: null });
    const query = createXrossPageQuery(read);
    await query.load();
    await query.continue();
    expect(query.current().items).toEqual([3]);
    expect(read).toHaveBeenLastCalledWith(undefined);
  });

  it("discards a stale cursor and retries page one after StaleSnapshot", async () => {
    const read = vi.fn().mockResolvedValueOnce({ snapshotId: "a", items: [1], truncated: true, nextCursor: "cur_2" })
      .mockRejectedValueOnce({ code: "StaleSnapshot" })
      .mockResolvedValueOnce({ snapshotId: "b", items: [3], truncated: false, nextCursor: null });
    const query = createXrossPageQuery(read);
    await query.load();
    await query.continue();
    expect(read.mock.calls).toEqual([[undefined], ["cur_2"], [undefined]]);
    expect(query.current()).toMatchObject({ snapshotId: "b", items: [3], nextCursor: null });
  });

  it("retains a continuation error and retries only on another explicit action", async () => {
    const read = vi.fn().mockResolvedValueOnce({ snapshotId: "a", items: [1], truncated: true, nextCursor: "cur_2" })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ snapshotId: "a", items: [2], truncated: false, nextCursor: null });
    const query = createXrossPageQuery(read);
    await query.load();
    await query.continue();
    expect(query.current()).toMatchObject({ items: [1], nextCursor: "cur_2", truncated: true });
    expect(query.current().problem).toContain("offline");
    expect(read).toHaveBeenCalledTimes(2);
    await query.continue();
    expect(query.current().items).toEqual([1, 2]);
  });

  it("drops stale pages and their cursor when the bridge generation changes", async () => {
    const read = vi.fn().mockResolvedValueOnce({ snapshotId: "a", items: [1], truncated: true, nextCursor: "cur_2" })
      .mockRejectedValueOnce({ code: "StaleGeneration" });
    const query = createXrossPageQuery(read);
    await query.load();
    await query.continue();
    expect(query.current().items).toEqual([]);
    expect(query.current().nextCursor).toBeNull();
    expect(query.current().problem).toContain("StaleGeneration");
  });

  it("invalidates a cursor immediately on a stream gap before a fresh read", async () => {
    const gate: { finishRead?: (page: { snapshotId: string; items: number[]; truncated: boolean; nextCursor: string | null }) => void } = {};
    const read = vi.fn().mockResolvedValueOnce({ snapshotId: "a", items: [1], truncated: true, nextCursor: "cur_2" })
      .mockImplementationOnce(() => new Promise((resolve) => { gate.finishRead = resolve; }));
    const query = createXrossPageQuery<number>(read);
    await query.load();
    query.reset();
    expect(query.current().items).toEqual([]);
    expect(query.current().nextCursor).toBeNull();
    const reload = query.load();
    expect(read).toHaveBeenLastCalledWith(undefined);
    gate.finishRead?.({ snapshotId: "b", items: [2], truncated: false, nextCursor: null });
    await reload;
    expect(query.current().items).toEqual([2]);
  });

  it("compares maximum u64 exactly without converting to number", () => {
    expect(compareUInt64("18446744073709551615", "18446744073709551614")).toBe(1);
    expect(compareUInt64("9007199254740992", "9007199254740993")).toBe(-1);
    expect(() => compareUInt64("18446744073709551616", "1")).toThrow();
    expect(() => compareUInt64("01", "1")).toThrow();
    expect(() => compareUInt64("-1", "0")).toThrow();
    expect(() => compareUInt64("1.0", "1")).toThrow();
  });

  it("does not call a read the target did not advertise", async () => {
    const methods = Object.fromEntries(REFYARD_VIEW_METHODS_V1.map((method) => [method, vi.fn()]));
    const context = vi.fn(async () => vectors.responses.refyard.context.value);
    const capabilities = vi.fn(async () => vectors.responses.refyard.capabilities.value);
    const listRepositories = vi.fn();
    const session = await createXrossSession(async () => ({ ...methods, context, capabilities, listRepositories }));
    const queries = createXrossQueries(session);
    await queries.repositories.load();
    expect(queries.repositories.current().problem).toContain("does not advertise repositories");
    expect(listRepositories).not.toHaveBeenCalled();
  });

  it("keeps status, history, refs, stashes, submodules and diff cursors explicit and scoped", async () => {
    const snapshotId = "rsnapshot_00000000000000000000000000000001";
    const nextCursor = "cur_second";
    const methods = Object.fromEntries(REFYARD_VIEW_METHODS_V1.map((method) => [method, vi.fn()]));
    const response = (field: "entries" | "commits" | "items" | "files", cursor: string | undefined) => ({
      snapshotId, [field]: [cursor === undefined ? "first" : "second"],
      truncated: cursor === undefined, nextCursor: cursor === undefined ? nextCursor : null,
    });
    const read = (field: "entries" | "commits" | "items" | "files") => vi.fn(async (request: { query: { cursor?: string } }) => response(field, request.query.cursor));
    const getStatus = read("entries");
    const historyPage = read("commits");
    const listRefs = read("items");
    const listStashes = read("items");
    const listSubmodules = read("items");
    const readDiff = read("files");
    const session = await createXrossSession(async () => ({ ...methods,
      context: vi.fn(async () => vectors.responses.refyard.context.value),
      capabilities: vi.fn(async () => ({ ...vectors.responses.refyard.capabilities.value,
        reads: ["status", "history", "refs", "stashes", "submodules", "diff"] })),
      getStatus, historyPage, listRefs, listStashes, listSubmodules, readDiff,
    }));
    const repositoryId = parseRefyardId("repo", "repo_demo");
    const worktreeId = parseRefyardId("wt", "wt_main");
    if (repositoryId === null || worktreeId === null) throw new Error("invalid test ID");
    const scoped = createXrossQueries(session).forRepository(repositoryId, worktreeId);
    const cases: { query: { load(): Promise<void>; continue(): Promise<void>; current(): unknown }; method: ReturnType<typeof read> }[] = [
      { query: scoped.status, method: getStatus }, { query: scoped.history(), method: historyPage },
      { query: scoped.refs, method: listRefs }, { query: scoped.stashes, method: listStashes },
      { query: scoped.submodules, method: listSubmodules },
      { query: scoped.diff({ kind: "unstaged", worktreeId, limit: 2 }), method: readDiff },
    ];
    for (const { query, method } of cases) {
      await query.load();
      expect(method).toHaveBeenCalledTimes(1);
      expect(query.current()).toMatchObject({ snapshotId, items: ["first"], truncated: true, nextCursor });
      await query.continue();
      expect(method).toHaveBeenCalledTimes(2);
      expect(method.mock.calls[1]?.[0].query.cursor).toBe(nextCursor);
      expect(query.current()).toMatchObject({ snapshotId, items: ["first", "second"], truncated: false, nextCursor: null });
    }
  });
});
