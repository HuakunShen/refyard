/** Explicit, snapshot-bound cursor pages and exact decimal-u64 event ordering. */
import { parseUInt64V1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/types.js";
import { parseRefyardId, type RepositoryIdV1, type WorktreeIdV1 } from "../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";
import type { DiffQueryV1, HistoryQueryV1, RefyardListQueryV1 } from "../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
import { assertCurrentXrossContext, type XrossSession } from "./xross-session.svelte.js";

export function compareUInt64(left: string, right: string): -1 | 0 | 1 {
  if (parseUInt64V1(left) === null || parseUInt64V1(right) === null) {
    throw new Error("invalid decimal-u64 sequence");
  }
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export interface XrossCursorPage<T, Source = unknown> {
  readonly snapshotId: string | null;
  readonly items: readonly T[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly source?: Source;
}

export interface XrossPageState<T, Source = unknown> extends XrossCursorPage<T, Source> {
  readonly loading: boolean;
  readonly problem: string | null;
}

function isStaleSnapshot(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "StaleSnapshot";
}

function isStaleGeneration(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "StaleGeneration";
}

function problemMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string") {
    return String(Reflect.get(error, "code"));
  }
  return String(error);
}

export function createXrossPageQuery<T, Source = unknown>(read: (cursor?: string) => Promise<XrossCursorPage<T, Source>>) {
  let current = $state<XrossPageState<T, Source>>({
    snapshotId: null, items: [], truncated: false, nextCursor: null, loading: false, problem: null,
  });
  let epoch = 0;

  function reset(): void {
    ++epoch;
    current = { snapshotId: null, items: [], truncated: false, nextCursor: null,
      loading: false, problem: null };
  }

  async function load(): Promise<void> {
    const ownEpoch = ++epoch;
    current = { snapshotId: null, items: [], truncated: false, nextCursor: null, loading: true, problem: null };
    try {
      const page = await read(undefined);
      if (ownEpoch !== epoch) return;
      current = { ...page, loading: false, problem: null };
    } catch (error) {
      if (ownEpoch !== epoch) return;
      current = { ...current, loading: false, problem: problemMessage(error) };
    }
  }

  async function continuePage(): Promise<void> {
    const cursor = current.nextCursor;
    if (cursor === null || current.loading) return;
    const ownEpoch = epoch;
    const original = current;
    current = { ...current, loading: true, problem: null };
    try {
      const page = await read(cursor);
      if (ownEpoch !== epoch) return;
      if (page.snapshotId !== original.snapshotId) {
        await load();
        return;
      }
      current = { ...page, items: [...original.items, ...page.items], loading: false, problem: null };
    } catch (error) {
      if (ownEpoch !== epoch) return;
      if (isStaleGeneration(error)) {
        ++epoch;
        current = { snapshotId: null, items: [], truncated: false, nextCursor: null,
          loading: false, problem: problemMessage(error) };
      } else if (isStaleSnapshot(error)) await load();
      else current = { ...original, loading: false, problem: problemMessage(error) };
    }
  }

  return { current: () => current, load, continue: continuePage, reset, invalidate: load };
}

function cursorQuery(cursor: string | undefined, limit: number): RefyardListQueryV1 {
  if (cursor === undefined) return { limit };
  const parsed = parseRefyardId("cur", cursor);
  if (parsed === null) throw new Error("invalid Xross cursor");
  return { cursor: parsed, limit };
}

/** Every read verifies the captured native context before applying a response. */
export function createXrossQueries(session: XrossSession) {
  const { host, context } = session;
  function requireRead(kind: (typeof session.capabilities.reads)[number]): void {
    if (!session.capabilities.reads.includes(kind)) {
      throw new Error(`Xross target does not advertise ${kind} reads`);
    }
  }
  async function current<T>(read: () => Promise<T>): Promise<T> {
    assertCurrentXrossContext(context, await host.context());
    const result = await read();
    assertCurrentXrossContext(context, await host.context());
    return result;
  }

  const roots = createXrossPageQuery(async (cursor?: string) => {
    requireRead("filesystem");
    const page = await current(() => host.listWorkspaceRoots({ query: cursorQuery(cursor, 100) }));
    return { ...page, snapshotId: null, truncated: page.nextCursor !== null, source: page };
  });
  const repositories = createXrossPageQuery(async (cursor?: string) => {
    requireRead("repositories");
    const page = await current(() => host.listRepositories({ query: cursorQuery(cursor, 100) }));
    return { ...page, snapshotId: null, truncated: page.nextCursor !== null, source: page };
  });

  function forRepository(repositoryId: RepositoryIdV1, worktreeId: WorktreeIdV1) {
    const status = createXrossPageQuery(async (cursor?: string) => {
      requireRead("status");
      const page = await current(() => host.getStatus({ repositoryId,
        query: { worktreeId, ...cursorQuery(cursor, 100) } }));
      return { ...page, items: page.entries, source: page };
    });
    const refs = createXrossPageQuery(async (cursor?: string) => {
      requireRead("refs");
      const page = await current(() => host.listRefs({ repositoryId, query: cursorQuery(cursor, 100) }));
      return { ...page, source: page };
    });
    const stashes = createXrossPageQuery(async (cursor?: string) => {
      requireRead("stashes");
      const page = await current(() => host.listStashes({ repositoryId, query: cursorQuery(cursor, 100) }));
      return { ...page, source: page };
    });
    const submodules = createXrossPageQuery(async (cursor?: string) => {
      requireRead("submodules");
      const page = await current(() => host.listSubmodules({ repositoryId, worktreeId,
        query: cursorQuery(cursor, 100) }));
      return { ...page, source: page };
    });
    function history(query: Omit<HistoryQueryV1, "cursor"> = {}) {
      return createXrossPageQuery(async (cursor?: string) => {
        requireRead("history");
        const parsedCursor = cursor === undefined ? null : parseRefyardId("cur", cursor);
        if (cursor !== undefined && parsedCursor === null) throw new Error("invalid Xross cursor");
        const page = await current(() => host.historyPage({ repositoryId,
          query: { ...query, worktreeId, ...(parsedCursor === null ? {} : { cursor: parsedCursor }) } }));
        return { ...page, items: page.commits, source: page };
      });
    }
    function diff(query: Omit<DiffQueryV1, "cursor">) {
      return createXrossPageQuery(async (cursor?: string) => {
        requireRead("diff");
        const parsedCursor = cursor === undefined ? null : parseRefyardId("cur", cursor);
        if (cursor !== undefined && parsedCursor === null) throw new Error("invalid Xross cursor");
        const page = await current(() => host.readDiff({ repositoryId,
          query: { ...query, ...(parsedCursor === null ? {} : { cursor: parsedCursor }) } }));
        return { ...page, items: page.files, source: page };
      });
    }
    async function worktrees() {
      requireRead("worktrees");
      return current(() => host.listWorktrees({ repositoryId }));
    }
    return { status, refs, stashes, submodules, history, diff, worktrees };
  }
  return { roots, repositories, forRepository, current };
}
