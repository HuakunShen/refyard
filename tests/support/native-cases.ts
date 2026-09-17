/**
 * The fixtures the native service is compared against, case by case.
 *
 * One definition, two consumers: `scripts/export-native-fixtures.ts` records what the
 * Node service answers for each request, and `tests/native/differential.test.ts` replays
 * the same requests against the Rust service. Sharing the definition is the point — a
 * case that changed on one side only would otherwise be compared against a stale
 * recording, so the differential test also checks that the recording still matches the
 * requests this module computes.
 *
 * Three rules make the recordings comparable:
 *
 * - every commit identity and instant is pinned by `createRepo`, so object names are
 *   reproducible and a fixture's OIDs are the same on every machine;
 * - nothing a case writes lands in a real repository: each case builds its own temporary
 *   checkout through `tests/support/repo.ts`;
 * - a request never carries a machine path. `path` and `fixtureHome` are added at call
 *   time by whoever runs the case, so a recorded response contains no home directory.
 */
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRepo, type GitFixtureRepo } from "./repo.js";

export interface NativeStatusBody {
  readonly op: "status";
  readonly includeIgnored?: boolean;
}

export interface NativeRefsBody {
  readonly op: "refs";
}

export interface NativeHistoryBody {
  readonly op: "history";
  readonly limit?: number;
  readonly detailOid?: string;
  readonly firstParentOnly?: boolean;
}

export interface NativeDiffBody {
  readonly op: "diff";
  readonly kind: "unstaged" | "staged" | "untracked" | "commit" | "range";
  readonly oid?: string;
  readonly from?: string;
  readonly to?: string;
  /**
   * The two-step flow a client performs: read the change set, take the `pathId` the
   * service minted for that display path, then ask for that one path's patch. Asking by
   * display path keeps the recorded request free of a random id.
   */
  readonly patchForDisplayPath?: string;
}

export type NativeRequestBody =
  NativeStatusBody | NativeRefsBody | NativeHistoryBody | NativeDiffBody;

/** One recorded read: where its response is written, and what was asked. */
export interface NativeReadRequest {
  readonly file: string;
  readonly body: NativeRequestBody;
}

export interface NativeCase {
  /** The fixture directory name under `tests/fixtures/native/`. */
  readonly name: string;
  /** What this case is for, in one line, so a failure says which state it broke. */
  readonly purpose: string;
  /** Builds the isolated temporary repository. */
  create(): Promise<GitFixtureRepo>;
  /** Drives it into the state this case is about. */
  prepare(repo: GitFixtureRepo): Promise<void>;
  /** The path whose reads are compared; defaults to the checkout itself. */
  subject(repo: GitFixtureRepo): string;
  /** The reads both sides are asked, each written to its own file. */
  requests(repo: GitFixtureRepo): Promise<readonly NativeReadRequest[]>;
}

/** The reads every case asks, so every case exercises the whole read surface. */
function standardRequests(headOid: string | null): NativeReadRequest[] {
  const requests: NativeReadRequest[] = [
    { file: "010-status.json", body: { op: "status" } },
    { file: "020-refs.json", body: { op: "refs" } },
    { file: "030-history.json", body: { op: "history", limit: 10 } },
    { file: "040-diff-unstaged.json", body: { op: "diff", kind: "unstaged" } },
    { file: "041-diff-staged.json", body: { op: "diff", kind: "staged" } },
    {
      file: "042-diff-untracked.json",
      body: { op: "diff", kind: "untracked" },
    },
  ];
  if (headOid !== null) {
    // A detail read and a commit diff both name an object, so they only exist once the
    // repository has one.
    requests.push({
      file: "031-history-detail.json",
      body: { op: "history", limit: 10, detailOid: headOid },
    });
    requests.push({
      file: "043-diff-commit.json",
      body: { op: "diff", kind: "commit", oid: headOid },
    });
  }
  return requests;
}

/** A request for one path's patch, appended after the change-set request. */
function patchRequest(
  file: string,
  kind: NativeDiffBody["kind"],
  displayPath: string,
): NativeReadRequest {
  return { file, body: { op: "diff", kind, patchForDisplayPath: displayPath } };
}

/** Requests for a repository that has a HEAD. */
async function withHead(
  repo: GitFixtureRepo,
  extra: (headOid: string) => readonly NativeReadRequest[],
): Promise<readonly NativeReadRequest[]> {
  const headOid = await repo.headOid();
  return [...standardRequests(headOid), ...extra(headOid)];
}

export function nativeCases(): readonly NativeCase[] {
  return [
    {
      name: "unborn",
      purpose:
        "a repository with no commits: an empty history, an unborn HEAD, and untracked files",
      create: () => createRepo(),
      prepare: async (repo) => {
        await repo.write("untracked.txt", "fresh\n");
      },
      subject: (repo) => repo.root,
      requests: async () => [
        ...standardRequests(null),
        patchRequest("050-untracked-patch.json", "untracked", "untracked.txt"),
      ],
    },
    {
      name: "detached",
      purpose: "HEAD detached from every branch",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.write("b.txt", "second\n");
        await repo.commitAll("second");
        await repo.git(["checkout", "--quiet", "--detach", "HEAD"]);
      },
      subject: (repo) => repo.root,
      requests: (repo) => withHead(repo, () => []),
    },
    {
      name: "rename",
      purpose: "a staged rename Git recognises by similarity",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.git(["mv", "a.txt", "renamed.txt"]);
      },
      subject: (repo) => repo.root,
      requests: (repo) =>
        withHead(repo, (headOid) => [
          patchRequest("050-staged-rename-patch.json", "staged", "renamed.txt"),
          {
            file: "051-history-detail-rename.json",
            body: { op: "history", limit: 5, detailOid: headOid },
          },
        ]),
    },
    {
      name: "unicode",
      purpose: "a file named 名 前.txt and a file with a space in its name",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.write("名 前.txt", "unicode name\n");
        await repo.write("b file.txt", "space name\n");
        await repo.commitAll("unicode names");
        // Modified afterwards, so both names appear in an unstaged change set.
        await repo.write("名 前.txt", "unicode name changed\n");
        await repo.write("b file.txt", "space name changed\n");
      },
      subject: (repo) => repo.root,
      requests: (repo) =>
        withHead(repo, () => [
          // Deliberately the ASCII-space path: the Node reference looks a fetched patch
          // up by decoding the changed path byte-per-character, so a non-ASCII path never
          // matches and is reported as "no patch was requested". That divergence is
          // documented in `crates/refyard-host/src/reads/diff.rs` and pinned by a Rust
          // integration test rather than normalised away here.
          patchRequest("050-space-name-patch.json", "unstaged", "b file.txt"),
        ]),
    },
    {
      name: "binary",
      purpose: "a binary file, modified in the working tree",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.write("bin.dat", new Uint8Array([0, 1, 2, 3, 255]));
        await repo.commitAll("binary");
        await repo.write("bin.dat", new Uint8Array([0, 1, 2, 4, 255]));
      },
      subject: (repo) => repo.root,
      requests: (repo) =>
        withHead(repo, () => [
          patchRequest("050-binary-patch.json", "unstaged", "bin.dat"),
        ]),
    },
    {
      name: "shallow",
      purpose: "a shallow clone, whose oldest row is a boundary",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.write("b.txt", "second\n");
        await repo.commitAll("second");
        const remote = join(repo.scratchRoot, "remote.git");
        await repo.git(["clone", "--bare", "--quiet", repo.root, remote]);
        const shallow = join(repo.scratchRoot, "shallow");
        // `file://` is required: Git ignores `--depth` for a plain local path and would
        // quietly produce a full history, which is the state this case is not about.
        await repo.git([
          "clone",
          "--quiet",
          "--depth=1",
          `file://${remote}`,
          shallow,
        ]);
        // The clone's configured URL is a machine path; it is replaced with a fixed one
        // so the recorded response contains no home directory.
        await repo.git(
          ["remote", "set-url", "origin", "https://example.test/upstream.git"],
          { cwd: shallow },
        );
      },
      subject: (repo) => join(repo.scratchRoot, "shallow"),
      requests: (repo) => withHead(repo, () => []),
    },
    {
      name: "worktree",
      purpose:
        "a linked worktree, whose Git directory is inside the common one",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        const linked = join(repo.scratchRoot, "linked");
        await repo.git(["worktree", "add", "--quiet", linked, "-b", "feature"]);
        await writeFile(join(linked, "a.txt"), "changed in the worktree\n");
        await writeFile(join(linked, "linked-file.txt"), "untracked here\n");
      },
      subject: (repo) => join(repo.scratchRoot, "linked"),
      requests: (repo) => withHead(repo, () => []),
    },
    {
      name: "sha256",
      purpose: "a repository whose object names are 64 hexadecimal characters",
      create: () =>
        createRepo({
          initialCommit: true,
          initArgs: ["--object-format=sha256"],
        }),
      prepare: async (repo) => {
        await repo.write("b.txt", "second\n");
        await repo.commitAll("second");
        await repo.git(["tag", "-a", "v1", "-m", "release"]);
        await repo.git([
          "remote",
          "add",
          "origin",
          "https://example.test/sha256.git",
        ]);
      },
      subject: (repo) => repo.root,
      requests: (repo) => withHead(repo, () => []),
    },
    {
      name: "plain",
      purpose:
        "staged, unstaged, untracked, deleted and ignored states beside a stash",
      create: () => createRepo({ initialCommit: true }),
      prepare: async (repo) => {
        await repo.write(".gitignore", "ignored.txt\n");
        await repo.write("staged.txt", "one\n");
        await repo.write("unstaged.txt", "one\n");
        await repo.write("deleted.txt", "one\n");
        await repo.write("gone-staged.txt", "one\n");
        await repo.commitAll("files");
        // A stash leaves `refs/stash` behind, which the refs read reports as an other-ref
        // of kind `stash`, and leaves the working tree clean for the states below.
        await repo.write("a.txt", "stashed change\n");
        await repo.git(["stash", "push", "--quiet", "-m", "wip"]);
        await repo.write("staged.txt", "two\n");
        await repo.git(["add", "staged.txt"]);
        await repo.write("unstaged.txt", "two\n");
        await rm(join(repo.root, "deleted.txt"));
        await repo.git(["rm", "--quiet", "gone-staged.txt"]);
        await repo.write("untracked.txt", "fresh\n");
        await repo.write("ignored.txt", "noise\n");
        await repo.git([
          "remote",
          "add",
          "origin",
          "https://user:token@example.test/plain.git",
        ]);
      },
      subject: (repo) => repo.root,
      requests: (repo) =>
        withHead(repo, () => [
          // The ignored state is only visible when it is asked for, on both sides.
          {
            file: "011-status-ignored.json",
            body: { op: "status", includeIgnored: true },
          },
          // Two commits and a page of one: the cursor a client would continue with
          // exists, both sides must mint one, and `truncated` reports the page as short.
          { file: "032-history-page.json", body: { op: "history", limit: 1 } },
          patchRequest("050-unstaged-patch.json", "unstaged", "unstaged.txt"),
          patchRequest("051-staged-patch.json", "staged", "staged.txt"),
          patchRequest(
            "052-untracked-patch.json",
            "untracked",
            "untracked.txt",
          ),
        ]),
    },
  ];
}

/** The case with this name, or a failure naming what exists. */
export function nativeCase(name: string): NativeCase {
  const found = nativeCases().find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(
      `no native fixture case named ${name}; known cases: ${nativeCases()
        .map((candidate) => candidate.name)
        .join(", ")}`,
    );
  }
  return found;
}
