/**
 * The scenarios every backend adapter must pass, written once.
 *
 * The design's point in having one suite is that a component written against
 * `GitReadService` must not care which adapter is behind it — so the same cases run
 * against HTTP today and against Tauri IPC when that lands. A scenario that is only
 * meaningful for one transport belongs in that transport's own test file instead of
 * here, with a flag that pretends otherwise.
 */
import { describe, expect, it } from "vitest";
import { BackendError, type BackendSession } from "@refyard/git-service";

export interface ConformanceFixture {
  readonly headOid: string;
  readonly branchName: string;
  /** A tracked path that the fixture has modified in the working tree. */
  readonly modifiedPathName: string;
}

export interface ConformanceSubject {
  readonly name: string;
  /** A session that is ready to read the fixture repository. */
  connect(): Promise<BackendSession>;
  readonly repositoryId: string;
  readonly fixture: ConformanceFixture;
  /** Streams the adapter holds open right now, counted from the transport side. */
  activeSubscriptions(): number;
  /** A credential that must never appear in session metadata, if the transport has one. */
  readonly secret: string | null;
  dispose(): Promise<void>;
}

export function describeAdapterConformance(subject: ConformanceSubject): void {
  describe(`${subject.name} adapter conformance`, () => {
    it("reads status, refs, history and diff as contract DTOs", async () => {
      const session = await subject.connect();
      const status = await session.git.status({
        repositoryId: subject.repositoryId,
      });
      expect(status.head.kind).toBe("born");
      expect(status.head.oid).toBe(subject.fixture.headOid);
      expect(status.head.branchName).toBe(subject.fixture.branchName);
      expect(status.entries.map((entry) => entry.displayPath)).toContain(
        subject.fixture.modifiedPathName,
      );

      const refs = await session.git.refs({
        repositoryId: subject.repositoryId,
      });
      expect(refs.objectFormat).toBe("sha1");
      expect(
        refs.branches.some(
          (entry) => entry.name === subject.fixture.branchName,
        ),
      ).toBe(true);

      const history = await session.git.history({
        repositoryId: subject.repositoryId,
        worktreeId: undefined,
        limit: 10,
      });
      expect(history.commits.length).toBeGreaterThan(0);
      expect(history.commits[0]?.oid).toBe(subject.fixture.headOid);

      const diff = await session.git.diff({
        repositoryId: subject.repositoryId,
        kind: "unstaged",
      });
      expect(
        diff.files.some(
          (file) => file.displayPath === subject.fixture.modifiedPathName,
        ),
      ).toBe(true);
      await subject.dispose();
    });

    it("keeps a history cursor bound to the snapshot it came from", async () => {
      const session = await subject.connect();
      const first = await session.git.history({
        repositoryId: subject.repositoryId,
        limit: 1,
      });
      if (first.nextCursor === null) {
        // A one-commit fixture has nothing to continue; the case is then only about
        // the absence of a cursor, which the assertion below still checks.
        expect(first.commits.length).toBe(1);
      } else {
        const second = await session.git.history({
          repositoryId: subject.repositoryId,
          cursor: first.nextCursor,
        });
        expect(second.snapshotId).not.toBe(first.snapshotId);
        expect(second.commits.length).toBeGreaterThan(0);
      }
      await subject.dispose();
    });

    it("never puts the bearer in session metadata", async () => {
      const session = await subject.connect();
      expect(session.state().phase).toBe("ready");
      if (subject.secret !== null) {
        const serialized = JSON.stringify(session.metadata);
        expect(serialized).not.toContain(subject.secret);
        // The namespace exists so caches can be scoped, not so a credential can be
        // smuggled into a query key.
        expect(session.metadata.cacheNamespace).not.toContain(subject.secret);
      }
      await subject.dispose();
    });

    it("releases every subscription when the session is disposed", async () => {
      const session = await subject.connect();
      const subscription = await session.events.subscribe({
        onEvent: () => undefined,
        onGap: () => undefined,
        onState: () => undefined,
        onError: () => undefined,
      });
      expect(subject.activeSubscriptions()).toBeGreaterThan(0);
      await session.dispose();
      expect(subject.activeSubscriptions()).toBe(0);
      // A caller that keeps the handle must not resurrect the stream.
      await subscription.dispose();
      expect(subject.activeSubscriptions()).toBe(0);
      await subject.dispose();
    });

    it("disposes idempotently", async () => {
      const session = await subject.connect();
      await session.dispose();
      await session.dispose();
      expect(session.state().phase).toBe("disconnected");
      await subject.dispose();
    });

    it("fails a read after dispose instead of answering with stale data", async () => {
      const session = await subject.connect();
      await session.dispose();
      await expect(
        session.git.status({ repositoryId: subject.repositoryId }),
      ).rejects.toBeInstanceOf(BackendError);
      await subject.dispose();
    });

    it("reports a missing repository as a problem, not as an empty repository", async () => {
      const session = await subject.connect();
      await expect(
        session.git.status({ repositoryId: "repo_does_not_exist" }),
      ).rejects.toBeInstanceOf(BackendError);
      await subject.dispose();
    });
  });
}
