/** Real Git semantics for bounded literal history search and commit locators. */
import { describe, expect, it } from "vitest";
import type { GitEngine } from "@refyard/git-core/workflows/engine";
import {
  readHistoryPage,
  resolveCommitPrefix,
  isCommitReachableFrom,
} from "@refyard/git-core/workflows/history";
import {
  parseCommitCandidates,
  parseDisambiguatedOids,
} from "@refyard/git-core/parse/meta";
import {
  planCatFileObjectTypes,
  planDisambiguateCommitPrefix,
  planIsCommitAncestor,
} from "@refyard/git-core/plan/refs";
import { planRevList } from "@refyard/git-core/plan/status";
import { createRepo, type GitFixtureRepo } from "../support/repo.js";

function engineFor(repo: GitFixtureRepo): GitEngine {
  return {
    async run(spec) {
      const result = await repo.gitResult(spec.argv, {
        ...(spec.stdin === undefined ? {} : { stdin: spec.stdin }),
        ...(spec.textSearchLocale === "unicode"
          ? { env: { LC_ALL: "C.UTF-8" } }
          : {}),
      });
      return {
        termination: result.signal === null ? "exit" : "signal",
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        stderrTruncated: false,
        durationMs: null,
      };
    },
  };
}

async function commit(
  repo: GitFixtureRepo,
  message: string,
  seconds: number,
  author = "Alice (Dev)",
): Promise<string> {
  await repo.git(["add", "-A"]);
  await repo.git(["commit", "--quiet", "--allow-empty", "-m", message], {
    env: {
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_DATE: `@${seconds} +0000`,
      GIT_COMMITTER_DATE: `@${seconds} +0000`,
    },
  });
  return repo.headOid();
}

const context = { cwdHandle: "fixture" };
describe("literal history filters", () => {
  it("plans fixed predicates, traversing date limits and literal paths", () => {
    // Search punctuation and pathspec magic must never broaden the user's query.
    const spec = planRevList(context, {
      tips: ["a".repeat(40)],
      maxCount: 3,
      skip: 2,
      message: "fix [literal].*",
      author: "Alice (Dev)",
      committedAfterSeconds: 1700000000,
      committedBeforeSeconds: 1700000002,
      pathText: ":(glob)*.ts",
    });
    expect(spec.argv).toEqual([
      "--literal-pathspecs",
      "rev-list",
      "--topo-order",
      "--parents",
      "--max-count=3",
      "--skip=2",
      "--fixed-strings",
      "--regexp-ignore-case",
      "--grep=fix [literal].*",
      "--author=Alice (Dev)",
      "--since-as-filter=@1700000000 +0000",
      "--min-age=1700000002",
      "--stdin",
      "--",
      ":(glob)*.ts",
    ]);
  });

  it("composes literal message, author and inclusive dates without stopping at old descendants", async () => {
    // Commit times need not increase along ancestry; an old child must not hide a matching parent.
    const repo = await createRepo();
    try {
      const first = await commit(repo, "FIX [literal].*", 1700000001);
      await commit(repo, "fix literal wildcard", 1700000002, "Bob");
      const third = await commit(repo, "fix [literal].*", 1700000000);
      const engine = engineFor(repo);
      const input = {
        ...context,
        tips: [third],
        maxCount: 10,
        skip: 0,
        decoration: new Map<string, readonly string[]>(),
      };
      const matched = await readHistoryPage(engine, {
        ...input,
        message: "fix [literal].*",
        author: "alice (dev)",
        committedAfterSeconds: 1700000001,
        committedBeforeSeconds: 1700000001,
      });
      expect(matched.commits.map((c) => c.oid)).toEqual([first]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            onlyOid: third,
            message: "fix [literal].*",
            committedAfterSeconds: 1700000001,
          })
        ).commits,
      ).toEqual([]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            onlyOid: first,
            message: "FIX [literal].*",
          })
        ).commits.map((c) => c.oid),
      ).toEqual([first]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            onlyOid: third,
            message: "fix [literal].*",
          })
        ).commits.map((c) => c.oid),
      ).toEqual([third]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            onlyOid: first,
            author: "Bob",
          })
        ).commits,
      ).toEqual([]);
      const page1 = await readHistoryPage(engine, {
        ...input,
        message: "fix [literal].*",
        maxCount: 1,
      });
      const page2 = await readHistoryPage(engine, {
        ...input,
        message: "fix [literal].*",
        maxCount: 1,
        skip: 1,
      });
      expect([...page1.commits, ...page2.commits].map((c) => c.oid)).toEqual([
        third,
        first,
      ]);
    } finally {
      await repo.dispose();
    }
  });

  it("keeps exact wildcard and magic paths literal and true sparse parents", async () => {
    // Path-limited rev-list rewrites parents; summaries must retain commit-object parents.
    const repo = await createRepo();
    try {
      await repo.write("odd[1].ts", "one");
      const first = await commit(repo, "first", 1700000000);
      await repo.write("odd1.ts", "other");
      const middle = await commit(repo, "middle", 1700000001);
      await repo.write("odd[1].ts", "two");
      const last = await commit(repo, "last", 1700000002);
      const input = {
        ...context,
        tips: [last],
        maxCount: 10,
        skip: 0,
        decoration: new Map<string, readonly string[]>(),
      };
      const page = await readHistoryPage(engineFor(repo), {
        ...input,
        pathText: "odd[1].ts",
      });
      expect(page.commits.map((c) => c.oid)).toEqual([last, first]);
      expect(page.commits[0]?.parents).toEqual([middle]);
      expect(
        (
          await readHistoryPage(engineFor(repo), {
            ...input,
            pathText: ":(glob)*.ts",
          })
        ).commits,
      ).toEqual([]);
    } finally {
      await repo.dispose();
    }
  });
});

describe.each(["sha1", "sha256"])("%s commit locators", (format) => {
  it("resolves none, one, noncommit and ancestry using real objects", async () => {
    const repo = await createRepo({ initArgs: [`--object-format=${format}`] });
    try {
      const first = await commit(repo, "first", 1700000000);
      const second = await commit(repo, "second", 1700000001);
      const engine = engineFor(repo);
      expect(
        await resolveCommitPrefix(engine, {
          ...context,
          prefix: first.slice(0, 12),
        }),
      ).toEqual({ kind: "one", oid: first });
      expect(
        await resolveCommitPrefix(engine, {
          ...context,
          prefix: "0".repeat(first.length),
        }),
      ).toBe("none");
      const tree = new TextDecoder()
        .decode(await repo.git(["rev-parse", `${first}^{tree}`]))
        .trim();
      expect(
        await resolveCommitPrefix(engine, { ...context, prefix: tree }),
      ).toBe("none");
      expect(
        await isCommitReachableFrom(engine, {
          ...context,
          ancestorOid: first,
          descendantOid: second,
        }),
      ).toBe(true);
      expect(
        await isCommitReachableFrom(engine, {
          ...context,
          ancestorOid: second,
          descendantOid: first,
        }),
      ).toBe(false);
    } finally {
      await repo.dispose();
    }
  });

  it("reports multiple matching commit objects honestly", async () => {
    // Prefix collisions are normal and must never select an arbitrary commit.
    const repo = await createRepo({ initArgs: [`--object-format=${format}`] });
    try {
      const tree = new TextDecoder()
        .decode(await repo.git(["mktree"], { stdin: new Uint8Array() }))
        .trim();
      const seen = new Map<string, string>();
      let prefix: string | null = null;
      for (let i = 0; i < 2000 && prefix === null; i += 1) {
        const oid = new TextDecoder()
          .decode(await repo.git(["commit-tree", tree, "-m", `collision ${i}`]))
          .trim();
        const key = oid.slice(0, 4);
        if (seen.has(key)) prefix = key;
        else seen.set(key, oid);
      }
      if (prefix === null)
        throw new Error("fixture did not find a prefix collision");
      expect(
        await resolveCommitPrefix(engineFor(repo), { ...context, prefix }),
      ).toEqual({ kind: "ambiguous" });
    } finally {
      await repo.dispose();
    }
  }, 30000);
});

describe("strict bounded commit resolution", () => {
  it("plans only dedicated object operations with byte-framed stdin", () => {
    const oid = "a".repeat(40);
    expect(planDisambiguateCommitPrefix(context, "abcd").argv).toEqual([
      "rev-parse",
      "--disambiguate=abcd",
    ]);
    const check = planCatFileObjectTypes(context, [oid]);
    expect(check.argv).toEqual([
      "cat-file",
      "--batch-check=%(objectname) %(objecttype)",
    ]);
    expect(new TextDecoder().decode(check.stdin)).toBe(`${oid}\n`);
    expect(planIsCommitAncestor(context, oid, "b".repeat(40)).argv).toEqual([
      "merge-base",
      "--is-ancestor",
      oid,
      "b".repeat(40),
    ]);
    // Arbitrary revisions/options must never reach a command from a locator.
    expect(() => planDisambiguateCommitPrefix(context, "--all")).toThrow();
    expect(() => planIsCommitAncestor(context, "HEAD", oid)).toThrow();
    expect(() =>
      planRevList(context, {
        tips: [],
        maxCount: 1,
        skip: 0,
        onlyOid: "HEAD~1",
      }),
    ).toThrow();
  });

  it("refuses malformed, incomplete and excessive candidate output", () => {
    // A partial or guessed enumeration could falsely resolve an ambiguous prefix.
    const oid = "a".repeat(40);
    const other = "b".repeat(64);
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(parseDisambiguatedOids(encode(`${oid}\n${other}\n`), 2)).toEqual([
      oid,
      other,
    ]);
    expect(() =>
      parseDisambiguatedOids(encode(`${oid}\n${other}\n`), 1),
    ).toThrow();
    expect(() => parseDisambiguatedOids(encode("bad-object\n"), 2)).toThrow();
    expect(() =>
      parseCommitCandidates(encode(`${oid} missing\n`), [oid]),
    ).toThrow();
    expect(() =>
      parseCommitCandidates(encode(`${oid} commit\n`), [oid, other]),
    ).toThrow();
    expect(() =>
      parseCommitCandidates(encode(`${other} commit\n`), [oid]),
    ).toThrow();
    expect(() =>
      parseCommitCandidates(encode(`${oid} executable\n`), [oid]),
    ).toThrow();
  });

  it("does not turn command termination or ancestry errors into negative answers", async () => {
    // A timeout or Git error is unknown, not evidence that a commit does not exist.
    const failure: GitEngine = {
      async run() {
        return {
          termination: "timeout",
          exitCode: null,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
          stderrTruncated: false,
          durationMs: null,
        };
      },
    };
    await expect(
      resolveCommitPrefix(failure, { ...context, prefix: "abcd" }),
    ).rejects.toMatchObject({ code: "GitTimedOut" });
    await expect(
      isCommitReachableFrom(failure, {
        ...context,
        ancestorOid: "a".repeat(40),
        descendantOid: "b".repeat(40),
      }),
    ).rejects.toMatchObject({ code: "GitTimedOut" });
  });
});

describe("exact early dates and Unicode search", () => {
  it("handles epoch and pre-epoch bounds while traversing an epoch child", async () => {
    // Approximate Git dates parse @0/@-1 as unrelated instants, and small positives are affected too.
    const repo = await createRepo();
    try {
      await repo.git(
        ["commit", "--quiet", "--allow-empty", "-m", "one second"],
        {
          env: {
            GIT_AUTHOR_DATE: "1970-01-01T00:00:01Z",
            GIT_COMMITTER_DATE: "1970-01-01T00:00:01Z",
          },
        },
      );
      const first = await repo.headOid();
      await repo.git(
        ["commit", "--quiet", "--allow-empty", "-m", "epoch child"],
        {
          env: {
            GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
            GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
          },
        },
      );
      const epoch = await repo.headOid();
      const modern = await commit(repo, "modern", 1700000000);
      const engine = engineFor(repo);
      const input = {
        ...context,
        tips: [modern],
        maxCount: 10,
        skip: 0,
        decoration: new Map<string, readonly string[]>(),
      };
      for (const bound of [-1, 0]) {
        expect(
          (
            await readHistoryPage(engine, {
              ...input,
              committedAfterSeconds: bound,
            })
          ).commits.map((c) => c.oid),
        ).toEqual([modern, epoch, first]);
      }
      expect(
        (
          await readHistoryPage(engine, { ...input, committedAfterSeconds: 1 })
        ).commits.map((c) => c.oid),
      ).toEqual([modern, first]);
      expect(
        (
          await readHistoryPage(engine, { ...input, committedBeforeSeconds: 0 })
        ).commits.map((c) => c.oid),
      ).toEqual([epoch]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            committedBeforeSeconds: -1,
          })
        ).commits,
      ).toEqual([]);
      expect(
        (
          await readHistoryPage(engine, { ...input, committedBeforeSeconds: 1 })
        ).commits.map((c) => c.oid),
      ).toEqual([epoch, first]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            committedAfterSeconds: 1,
            committedBeforeSeconds: 1,
          })
        ).commits.map((c) => c.oid),
      ).toEqual([first]);
      expect(
        (
          await readHistoryPage(engine, {
            ...input,
            onlyOid: epoch,
            committedAfterSeconds: 1,
          })
        ).commits,
      ).toEqual([]);
    } finally {
      await repo.dispose();
    }
  });

  it.each([
    "1970-01-01T00:00:01Z",
    "2000-02-29T23:59:59Z",
    "2100-03-01T00:00:00Z",
    "9999-12-31T23:59:59Z",
  ])(
    "represents %s as an exact raw UTC cutoff accepted by Git",
    async (date) => {
      // Leap-century and far-future mistakes silently change a user's committed-after instant.
      const seconds = Date.parse(date) / 1000;
      const plan = planRevList(context, {
        tips: ["a".repeat(40)],
        maxCount: 1,
        skip: 0,
        committedAfterSeconds: seconds,
      });
      expect(plan.argv).toContain(`--since-as-filter=@${seconds} +0000`);
      const repo = await createRepo();
      try {
        const parsed = new TextDecoder()
          .decode(await repo.git(["rev-parse", `--since=@${seconds} +0000`]))
          .trim();
        expect(parsed).toBe(`--max-age=${seconds}`);
        const oid = await commit(repo, "calendar boundary", seconds);
        const input = {
          ...context,
          tips: [oid],
          maxCount: 10,
          skip: 0,
          decoration: new Map<string, readonly string[]>(),
        };
        const engine = engineFor(repo);
        expect(
          (
            await readHistoryPage(engine, {
              ...input,
              committedAfterSeconds: seconds,
              committedBeforeSeconds: seconds,
            })
          ).commits.map((c) => c.oid),
        ).toEqual([oid]);
        expect(
          (
            await readHistoryPage(engine, {
              ...input,
              committedAfterSeconds: seconds + 1,
            })
          ).commits,
        ).toEqual([]);
        expect(
          (
            await readHistoryPage(engine, {
              ...input,
              committedBeforeSeconds: seconds - 1,
            })
          ).commits,
        ).toEqual([]);
      } finally {
        await repo.dispose();
      }
    },
  );

  it("keeps impossible negative upper bounds empty and negative lower bounds unbounded", () => {
    // Git commit timestamps are unsigned; negative stored timestamps are unsupported Git objects.
    const input = { tips: ["a".repeat(40)], maxCount: 10, skip: 0 };
    const before = planRevList(context, {
      ...input,
      committedBeforeSeconds: -1,
    });
    expect(before.argv).toContain("--max-count=0");
    expect(before.argv.some((arg) => arg.startsWith("--min-age="))).toBe(false);
    const after = planRevList(context, { ...input, committedAfterSeconds: -1 });
    expect(after.argv.some((arg) => arg.startsWith("--since-as-filter="))).toBe(
      false,
    );
  });

  it("requests the closed Unicode locale hint only for literal text filters", () => {
    const input = { tips: ["a".repeat(40)], maxCount: 1, skip: 0 };
    expect(
      planRevList(context, { ...input, message: "éclair" }).textSearchLocale,
    ).toBe("unicode");
    expect(
      planRevList(context, { ...input, author: "élodie" }).textSearchLocale,
    ).toBe("unicode");
    expect(planRevList(context, input).textSearchLocale).toBeUndefined();
    expect(
      planRevList(context, { ...input, committedBeforeSeconds: 1 })
        .textSearchLocale,
    ).toBeUndefined();
  });

  it("matches Unicode case pairs through the command locale hint", async () => {
    // LC_ALL=C only folds ASCII; author and message search must also fold non-ASCII case pairs.
    const repo = await createRepo();
    try {
      const oid = await commit(
        repo,
        "Éclair [literal].*",
        1700000000,
        "Élodie (Dev)",
      );
      const input = {
        ...context,
        tips: [oid],
        maxCount: 10,
        skip: 0,
        decoration: new Map<string, readonly string[]>(),
      };
      expect(
        (
          await readHistoryPage(engineFor(repo), {
            ...input,
            message: "éclair [literal].*",
            author: "élodie (dev)",
          })
        ).commits.map((c) => c.oid),
      ).toEqual([oid]);
    } finally {
      await repo.dispose();
    }
  });
});
