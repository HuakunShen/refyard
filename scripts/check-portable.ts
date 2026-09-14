/**
 * `pnpm check:portable` — build the neutral bundle and run it without a host.
 *
 * The check itself lives in `scripts/lib/portable.ts` so the Vitest suite
 * (`tests/portable/core.test.ts`) and this command prove exactly the same thing.
 * The output is a smoke report: bundle size, whether the bundle referenced any
 * host global, and what the planners and parsers saw inside the sandbox. It is not
 * a performance measurement and not a second-engine result.
 */
import { runPortableSmoke } from "./lib/portable.js";

const result = await runPortableSmoke();
const report = result.evaluated;

if (report.error !== null) {
  console.error(`check:portable FAILED — the bundle threw: ${report.error}`);
  process.exit(1);
}
if (result.forbiddenReferences.length > 0) {
  console.error(
    `check:portable FAILED — the neutral bundle referenced host globals: ${result.forbiddenReferences.join(", ")}`,
  );
  process.exit(1);
}
const expectations: [string, boolean][] = [
  [
    "status parsed",
    report.statusKind === "ordinary" && report.statusPathBytes.length > 0,
  ],
  ["topology parsed", report.topologyRows > 0],
  ["refs parsed", report.refNames > 0],
  [
    "stash subject split",
    report.stashSubject === "present" && report.stashBranch === "present",
  ],
  ["numstat parsed", report.numstatInsertions === 2],
  ["patch parsed", report.patchHunks > 0],
  ["commit object parsed", report.commitParents > 0],
  ["worktrees parsed", report.worktreeCount > 0],
  ["layout parsed", report.objectFormatLine === "sha1"],
  ["operation marker mapped", report.operationMarker === "merge"],
  ["planner argv produced", report.planArgv.status.includes("status")],
];
const failed = expectations.filter(([, ok]) => !ok);
if (failed.length > 0) {
  console.error(
    `check:portable FAILED — ${failed.map(([name]) => name).join(", ")}`,
  );
  process.exit(1);
}
console.log(
  `check:portable: neutral IIFE of ${result.bundleBytes} bytes ran with no host globals and no Node shims; all ${expectations.length} planner/parser checks passed (portability smoke, not a QuickJS result)`,
);
