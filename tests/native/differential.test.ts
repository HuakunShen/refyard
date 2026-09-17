/**
 * The native service, compared against the Node service case by case.
 *
 * The Rust service is a port of the Node reads, so the Node answers are the oracle:
 * `scripts/export-native-fixtures.ts` recorded them into `tests/fixtures/native/` and
 * this suite replays the same requests against the fixture driver (a Rust example that
 * reads one JSON request and writes one JSON response). A difference must fail: the only
 * values normalised away are the ids this service mints per process and the read
 * timestamps, because those *are* supposed to differ between two runs. Paths, object
 * names, error codes, missing parents and truncation are compared exactly.
 *
 * Two documented divergences are deliberately not compared here, and each is named where
 * it lives instead of being normalised away:
 *
 * - the unicode case asks for a patch on the ASCII-space path only. The Node reference
 *   looks a fetched patch up by decoding the changed path byte-per-character, so a
 *   non-ASCII path never matches and is reported as "no patch was requested"; this port
 *   joins by raw bytes. `crates/refyard-host/src/reads/diff.rs` records the difference and
 *   `a_non_ascii_path_still_finds_its_patch` pins the Rust behaviour.
 * - capabilities are not compared, because host kind, Git version and the implemented
 *   read set legitimately differ. They are validated against the contract schema and
 *   against the honesty rule that no write may be advertised.
 */
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitiesResponseSchema } from "@refyard/git-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  nativeCases,
  type NativeReadRequest,
  type NativeRequestBody,
} from "../support/native-cases.js";
import type { GitFixtureRepo } from "../support/repo.js";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixtureRoot = join(repoRoot, "tests/fixtures/native");
const driverPath = join(repoRoot, "target/debug/examples/fixture_driver");

/** The prefixes whose ids are minted per process and therefore not comparable. */
const ID_PATTERN =
  /^(repo|wt|snap|cur|path|srcd|srvc|op|pt|root)_[A-Za-z0-9_-]+$/;

/** Keys whose value is a wall-clock instant rather than a fact about the repository. */
const TIMESTAMP_KEYS = new Set(["readAt", "expiresAt"]);

/**
 * Replaces the values that are *expected* to differ between two runs, and sorts keys so
 * two answers are compared by content rather than by the order a serializer happened to
 * write them in.
 *
 * Ids are renamed in order of first appearance, so two implementations that minted a
 * different number of ids still compare equal when the ids name the same things in the
 * same order. Commit timestamps are deliberately untouched: they are facts about the
 * fixture, and a difference there is a real difference.
 */
function normalise(value: unknown): unknown {
  const ids = new Map<string, string>();
  const counters = new Map<string, number>();
  const walk = (node: unknown, key: string | null): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, null));
    }
    if (node !== null && typeof node === "object") {
      const result: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(node).sort(
        ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
      )) {
        result[entryKey] = walk(entryValue, entryKey);
      }
      return result;
    }
    if (typeof node === "string") {
      if (key !== null && TIMESTAMP_KEYS.has(key)) {
        return "<timestamp>";
      }
      const match = ID_PATTERN.exec(node);
      if (match !== null && match[1] !== undefined) {
        const prefix = match[1];
        const known = ids.get(node);
        if (known !== undefined) {
          return known;
        }
        const next = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, next);
        const canonical = `${prefix}_${next}`;
        ids.set(node, canonical);
        return canonical;
      }
    }
    return node;
  };
  return walk(value, null);
}

function recordedRequestsOf(manifest: unknown): NativeReadRequest[] {
  const requests =
    manifest !== null && typeof manifest === "object"
      ? (manifest as { requests?: unknown }).requests
      : undefined;
  if (!Array.isArray(requests)) {
    throw new Error("the recording has no request list");
  }
  return requests as NativeReadRequest[];
}

/** Runs one request through the Rust driver and returns its JSON response. */
function drive(
  repo: GitFixtureRepo,
  subject: string,
  body: NativeRequestBody,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly problem: unknown } {
  const response = spawnSync(driverPath, [], {
    input: JSON.stringify({ ...body, path: subject, fixtureHome: repo.home }),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (response.error !== undefined) {
    throw new Error(
      `the fixture driver could not be started: ${response.error.message}`,
    );
  }
  const stdout = response.stdout ?? "";
  if (response.status !== 0) {
    let problem: unknown = stdout;
    try {
      problem = JSON.parse(stdout);
    } catch {
      // The driver always writes a problem envelope; a non-JSON answer is itself the
      // diagnostic and is shown as it arrived.
    }
    return { ok: false, problem };
  }
  try {
    return { ok: true, value: JSON.parse(stdout) };
  } catch (error) {
    throw new Error(
      `the fixture driver did not answer with JSON: ${stdout.slice(0, 400)} (${String(error)})`,
    );
  }
}

beforeAll(
  () => {
    // One build for the whole suite; `cargo build` is a no-op when nothing changed.
    const build = spawnSync(
      "cargo",
      ["build", "-p", "refyard-host", "--example", "fixture_driver"],
      { cwd: repoRoot, encoding: "utf8", timeout: 10 * 60 * 1000 },
    );
    if (build.status !== 0) {
      throw new Error(
        `the fixture driver did not build (exit ${build.status}):\n${build.stdout}\n${build.stderr}`,
      );
    }
  },
  10 * 60 * 1000,
);

describe("native read parity", () => {
  for (const fixtureCase of nativeCases()) {
    describe(fixtureCase.name, () => {
      let repo: GitFixtureRepo;
      let subject: string;

      beforeAll(async () => {
        repo = await fixtureCase.create();
        await fixtureCase.prepare(repo);
        subject = fixtureCase.subject(repo);
      }, 60_000);

      afterAll(async () => {
        await repo.dispose();
      });

      /**
       * The recorded requests are an oracle only for the requests that produced them.
       *
       * A case that changed without a re-export would otherwise be compared against a
       * recording of a different fixture, and the comparison would pass while testing
       * nothing.
       */
      it("records the requests this case asks for", async () => {
        const manifest: unknown = JSON.parse(
          await readFile(
            join(fixtureRoot, fixtureCase.name, "manifest.json"),
            "utf8",
          ),
        );
        const requested = await fixtureCase.requests(repo);
        expect(recordedRequestsOf(manifest)).toEqual([...requested]);
      });

      it("records one response per request", async () => {
        const files = await readdir(join(fixtureRoot, fixtureCase.name));
        const expected = (await fixtureCase.requests(repo)).map(
          (request) => request.file,
        );
        expect(
          files
            .filter(
              (file) => file.endsWith(".json") && file !== "manifest.json",
            )
            .sort(),
        ).toEqual([...expected].sort());
      });

      it("answers every request exactly as the Node service did", async () => {
        const manifest: unknown = JSON.parse(
          await readFile(
            join(fixtureRoot, fixtureCase.name, "manifest.json"),
            "utf8",
          ),
        );
        const mismatches: string[] = [];
        for (const { file, body } of recordedRequestsOf(manifest)) {
          const expected: unknown = JSON.parse(
            await readFile(join(fixtureRoot, fixtureCase.name, file), "utf8"),
          );
          const driven = drive(repo, subject, body);
          if (!driven.ok) {
            mismatches.push(
              `${file}: the Rust driver refused the request: ${JSON.stringify(driven.problem)}`,
            );
            continue;
          }
          const rust = JSON.stringify(normalise(driven.value), null, 2);
          const node = JSON.stringify(normalise(expected), null, 2);
          if (rust !== node) {
            mismatches.push(
              `${file}: Rust and Node disagree.\n--- Node ---\n${node}\n--- Rust ---\n${rust}`,
            );
          }
        }
        expect(mismatches.join("\n\n")).toBe("");
      }, 120_000);
    });
  }
});

describe("native capabilities", () => {
  it("satisfies the published contract and advertises no write", () => {
    const serialized = spawnSync(driverPath, [], {
      input: JSON.stringify({ op: "capabilities" }),
      encoding: "utf8",
    });
    expect(serialized.status).toBe(0);
    const capabilities: unknown = JSON.parse(serialized.stdout ?? "");
    const parsed = capabilitiesResponseSchema.safeParse(capabilities);
    if (!parsed.success) {
      throw new Error(
        `the Rust capabilities response is not the published shape: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    expect(parsed.data.host.kind).toBe("rust");
    // Only what is implemented. A write named here would be a promise this build cannot
    // keep, and a read named here is one the UI will poll.
    expect(parsed.data.operations).toEqual([]);
    expect([...parsed.data.reads].sort()).toEqual([
      "capabilities",
      "diff",
      "filesystem",
      "history",
      "refs",
      "repositories",
      "status",
    ]);
    expect(parsed.data.unavailable.length).toBeGreaterThan(0);
  });
});
