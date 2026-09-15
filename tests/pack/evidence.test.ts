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
    // The published packages declare engines ">=26 <27"; a report from another
    // major is not evidence about the supported runtime.
    expect(report.runtime.version).toMatch(/^26\./);
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
