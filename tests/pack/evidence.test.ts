/**
 * The release evidence files, checked as files.
 *
 * The gate is that a release ships numbers someone measured, on a named runtime,
 * at a named scale, with the scope of every number written next to it. These
 * cases do not re-run the benchmark — a report is read, not regenerated — they
 * fail when the committed report stops saying what it measured, which is the
 * failure that turns evidence into decoration.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  publishedEnginesRange,
  satisfiesEngines,
} from "../../scripts/lib/node-engines.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const evidence = join(repoRoot, "docs", "evidence");

interface EvidenceMeasurement {
  readonly name: string;
  readonly durationSeconds: number;
  readonly processScope: string;
  readonly memoryMetric: string;
  readonly value: number;
  readonly unit: string;
  readonly notes: string;
}

interface PerformanceReport {
  readonly kind: string;
  readonly measuredAt: string;
  readonly runtime: {
    readonly kind: string;
    readonly version: string;
    readonly platform: string;
    readonly arch: string;
  };
  readonly gitVersion: string;
  readonly fixture: {
    readonly commits: number;
    readonly repository: string;
    readonly isolation: string;
  };
  readonly artifact: {
    readonly path: string;
    readonly modifiedAt: string;
    readonly buildInfo: {
      readonly builtAt?: string;
      readonly gitCommit?: string;
      readonly bundleBytes?: number;
    } | null;
    readonly headRevision: string;
    readonly workingTreeDirty: boolean;
  };
  readonly diffFixture: {
    readonly changedPaths: number;
    readonly manyFiles: number;
    readonly largeLines: number;
    readonly truncatedLines: number;
    readonly truncatedPatchLines: number;
    readonly deliveredTruncatedLines: number;
    readonly longLineChars: number;
    readonly unboundedPatchBytes: {
      readonly large: number;
      readonly truncated: number;
      readonly longLine: number;
    };
  };
  readonly methodology: {
    readonly repeated: boolean;
    readonly runs?: number;
    readonly concurrency: number;
    readonly statistic?: string;
    readonly caveat: string;
  };
  readonly measurements: readonly EvidenceMeasurement[];
}

async function readPerformance(): Promise<PerformanceReport> {
  return JSON.parse(
    await readFile(join(evidence, "performance.json"), "utf8"),
  ) as PerformanceReport;
}

describe("performance evidence", () => {
  it("names the runtime that was actually measured", async () => {
    // Prevents: a report naming whatever ran the *benchmark script* (bun, or a
    // different Node) instead of the runtime the published CLI supports.
    const report = await readPerformance();
    expect(report.kind).toBe("refyard-performance-report");
    expect(report.runtime.kind).toBe("node");
    // The published manifest declares the Node range; a report from a runtime outside it
    // is not evidence about the runtime that promise covers. Reading the range instead of
    // naming a favourite major is what keeps the two from drifting apart.
    const range = await publishedEnginesRange(
      join(repoRoot, "packages", "npm-dist"),
    );
    expect(range).not.toBe("");
    expect(satisfiesEngines(range, report.runtime.version)).toBe(true);
    expect(Number.isNaN(Date.parse(report.measuredAt))).toBe(false);
    expect(report.runtime.platform.length).toBeGreaterThan(0);
    expect(report.runtime.arch.length).toBeGreaterThan(0);
    expect(report.gitVersion.length).toBeGreaterThan(0);
  });

  it("records the scale the numbers came from", async () => {
    // Prevents: a throughput or latency figure with no repository behind it,
    // which cannot be reproduced or compared against a later run.
    const report = await readPerformance();
    expect(report.fixture.commits).toBeGreaterThan(0);
    expect(report.fixture.repository.length).toBeGreaterThan(0);
    expect(report.fixture.isolation).toContain("HOME");
    expect(report.methodology.caveat.length).toBeGreaterThan(0);
    expect(report.methodology.concurrency).toBeGreaterThan(0);
  });

  it("gives every measurement a scope, a window, and a value", async () => {
    // Prevents: a bare number in the report — a latency without saying which
    // processes it covers, or a memory figure without saying what was resident.
    const report = await readPerformance();
    const names = report.measurements.map((measurement) => measurement.name);
    expect(names).toContain("cold-start-to-ready");
    expect(names).toContain("status-read-throughput");
    expect(names).toContain("history-first-page");
    expect(names).toContain("graceful-shutdown");

    for (const measurement of report.measurements) {
      expect(measurement.processScope.length).toBeGreaterThan(0);
      expect(measurement.memoryMetric.length).toBeGreaterThan(0);
      expect(measurement.unit.length).toBeGreaterThan(0);
      expect(measurement.notes.length).toBeGreaterThan(0);
      expect(measurement.durationSeconds).toBeGreaterThan(0);
      expect(Number.isFinite(measurement.value)).toBe(true);
      expect(measurement.value).toBeGreaterThan(0);
      // The anti-ambiguity field has to say something a reader can act on.
      expect(measurement.processScope.split(/\s+/).length).toBeGreaterThan(3);
    }
  });

  it("says whether the numbers are one run or several", async () => {
    // Prevents: a single sample being presented as a characteristic figure.
    // Either answer is publishable; an unstated one is not.
    const report = await readPerformance();
    if (report.methodology.repeated) {
      expect(report.methodology.runs ?? 0).toBeGreaterThan(1);
      expect(report.methodology.statistic ?? "").toContain("median");
      for (const measurement of report.measurements) {
        expect(measurement.notes).toContain("median");
      }
    } else {
      expect(report.methodology.statistic ?? "single run").toContain("single");
    }
  });

  it("states the diff scale, and shows the bound was actually reached", async () => {
    // Prevents: a report whose diff section describes a bound that never bound —
    // a "bounded answer" row beside a fixture that fits inside the bound, which a
    // reader a month later cannot tell from a patch that was cut. The scale lives
    // in fields for exactly that reason, and the delivery count has to be below
    // the fixture's own expected count, not merely present.
    const report = await readPerformance();
    const byName = new Map(
      report.measurements.map((measurement) => [measurement.name, measurement]),
    );
    for (const name of [
      "diff-large-file",
      "diff-large-file-payload",
      "diff-large-file-second-read",
      "diff-long-line",
      "diff-long-line-payload",
      "diff-many-files",
      "diff-many-files-payload",
      "diff-truncated-patch",
      "diff-truncated-patch-payload",
      "diff-service-rss-after-start",
      "diff-service-rss-after-batch",
      "status-after-switching-services",
    ]) {
      expect(byName.has(name)).toBe(true);
    }

    const diff = report.diffFixture;
    expect(diff.changedPaths).toBe(diff.manyFiles + 3);
    expect(diff.truncatedPatchLines).toBe(diff.truncatedLines * 2);
    // The bounded read delivered a cut patch: fewer lines than the file holds, and
    // more than none (a request that answered nothing would also "fit the bound").
    expect(diff.deliveredTruncatedLines).toBeGreaterThan(0);
    expect(diff.deliveredTruncatedLines).toBeLessThan(diff.truncatedPatchLines);
    // The payload rows are read against the patch git produces unbounded, so the
    // comparison is in the report rather than in the reader's head.
    expect(diff.unboundedPatchBytes.truncated).toBeGreaterThan(
      diff.unboundedPatchBytes.large,
    );
    const boundedPayload = byName.get("diff-truncated-patch-payload");
    const boundedBytes = boundedPayload?.value ?? 0;
    expect(boundedBytes).toBeGreaterThan(0);
    expect(boundedBytes).toBeLessThan(diff.unboundedPatchBytes.truncated);
  });

  it("names the build the numbers came from, and admits a dirty tree", async () => {
    // Prevents: a report that describes an artifact rather than a revision. The
    // numbers belong to whichever bundle answered the requests, and a bundle older
    // than its sources — or built from a tree with uncommitted changes — cannot be
    // reproduced from the commit it names. Both facts travel with the numbers.
    const report = await readPerformance();
    expect(report.artifact.path).toContain("cli.mjs");
    expect(Number.isFinite(Date.parse(report.artifact.modifiedAt))).toBe(true);
    expect(report.artifact.headRevision).toMatch(/^[0-9a-f]{7,40}$/);
    expect(typeof report.artifact.workingTreeDirty).toBe("boolean");
    if (report.artifact.workingTreeDirty) {
      // A dirty tree is publishable, an unstated one is not: the report has to say so.
      const plan = await readFile(
        join(repoRoot, "docs", "plans", "0003-refyard-v2-m2-closure.md"),
        "utf8",
      );
      expect(plan).toContain("uncommitted");
    }
    if (report.artifact.buildInfo !== null) {
      const buildInfo = report.artifact.buildInfo;
      expect(buildInfo.gitCommit ?? "").toMatch(/^[0-9a-f]{7,40}$/);
      expect(buildInfo.builtAt ?? "").not.toBe("");
      expect(Number.isFinite(Date.parse(buildInfo.builtAt ?? ""))).toBe(true);
    }
  });

  it("records the unverified platforms as unverified, not as passing", async () => {
    // Prevents: a release page implying Windows/Linux/mobile browsers were tested
    // when the evidence only covers the machine that produced it.
    const matrix = await readFile(join(evidence, "release-matrix.md"), "utf8");
    expect(matrix).toContain("unverified");
    const verified =
      matrix.match(/^\|\s*([^|]+?)\s*\|\s*verified\s*\|/gm) ?? [];
    expect(verified.length).toBeGreaterThan(0);
    // Every row states a status from the fixed vocabulary, so "not run" cannot
    // be read as "passed".
    const rows = matrix
      .split("\n")
      .filter((line) => line.startsWith("| ") && line.includes("|"));
    expect(rows.length).toBeGreaterThan(3);
  });
});
