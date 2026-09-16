/**
 * Pins the native-host evaluation as an evidence document rather than an open-ended spike.
 *
 * The headings are part of the review contract: omitting one makes a decision look complete
 * while leaving a required portability, lifecycle, or permission question unanswered.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const EVALUATION_URL = new URL(
  "../../docs/research/native-host-evaluation.md",
  import.meta.url,
);

const REQUIRED_SECTIONS = [
  "measured-node-bottleneck",
  "tested-vm-version",
  "async-and-bytes-conformance",
  "process-cleanup-limitations",
  "full-artifact-size",
  "same-workload-memory",
  "xross-permission-impact",
  "decision-and-user-approval",
] as const;

function sectionBody(document: string, slug: string): string {
  const heading = `## ${slug}`;
  const start = document.indexOf(heading);
  const next = document.indexOf("\n## ", start + heading.length);
  return document.slice(start + heading.length, next === -1 ? document.length : next);
}

describe("native-host evaluation evidence", () => {
  it("keeps every design-package review question backed by a non-empty section", async () => {
    // Prevents: a native runtime being adopted after a report drops one of the required
    // measurements, especially the unverified VM, process, or Xross permission questions.
    const document = await readFile(EVALUATION_URL, "utf8");

    for (const slug of REQUIRED_SECTIONS) {
      expect(document).toContain(`## ${slug}`);
      expect(sectionBody(document, slug).trim().length).toBeGreaterThan(80);
    }
  });

  it("labels an unmeasured native runtime instead of presenting the review budget as a result", async () => {
    // Prevents: the 512 KiB / 5 MiB review rule or a neutral portable bundle being
    // misreported as a measured QuickJS/JSC runtime result.
    const document = await readFile(EVALUATION_URL, "utf8");

    expect(document).toMatch(/native[^\n]*unverified|unverified[^\n]*native/i);
    expect(document).toMatch(/512 KiB/);
    expect(document).toMatch(/5 MiB/);
    expect(document).toMatch(/continue on Node/i);
  });
});
