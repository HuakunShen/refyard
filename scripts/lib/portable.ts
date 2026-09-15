/**
 * The portability smoke check.
 *
 * This proves a narrow, specific claim: **the portable packages plan and parse
 * without a host.** It bundles `git-core` into a neutral IIFE — esbuild's `neutral`
 * platform refuses `node:` and `bun:` specifiers, and refuses to synthesise a
 * `require` or a `process` shim — and then evaluates the bundle inside a VM context
 * that has *no* host globals: no `process`, `Buffer`, `require`, `console`,
 * `TextEncoder`, `TextDecoder`, `setTimeout`, `URL` or `fetch`. Only the JavaScript
 * engine's own intrinsics are there.
 *
 * The entry point it evaluates runs real planners and parsers over the committed
 * byte fixtures and reports what it saw. If any of those modules reached for a host
 * global, the bundle would either fail to build or throw while running, and the
 * check would fail rather than pass quietly.
 *
 * What this is *not*: a QuickJS, JSC or native-host result. No second engine was
 * built or run, no bundle size budget is measured here, and the numbers this check
 * prints are not performance measurements.
 */
import { build } from "esbuild";
import { createContext, Script } from "node:vm";
import { BYTE_FIXTURES } from "../../tests/fixtures/bytes.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface PortableSmokeResult {
  readonly bundleBytes: number;
  readonly evaluated: PortableSelfTestReport;
  /** Specifiers the neutral build would have rejected or that appeared in the output. */
  readonly forbiddenReferences: readonly string[];
}

export interface PortableSelfTestReport {
  readonly statusKind: string | null;
  readonly statusPathBytes: number[];
  readonly topologyRows: number;
  readonly topologyFirstParents: number;
  readonly refNames: number;
  readonly stashSubject: string | null;
  readonly stashBranch: string | null;
  readonly numstatInsertions: number | null;
  readonly patchHunks: number;
  readonly commitParents: number;
  readonly worktreeCount: number;
  readonly objectFormatLine: string | null;
  readonly operationMarker: string | null;
  readonly planArgv: {
    readonly status: readonly string[];
    readonly revList: readonly string[];
  };
  readonly error: string | null;
}

/**
 * The entry that runs inside the VM.
 *
 * It is written as a string rather than a file so the check has no build step of its
 * own, and it only uses `globalThis.__refyardPortable` to report — no console, which
 * is one of the globals the sandbox deliberately does not provide.
 */
const SELF_TEST_ENTRY = `
import {
  planStatus,
  planRevList,
  parseStatus,
  parseRevListTopology,
  parseForEachRef,
  parseNumstat,
  parsePatch,
  parseWorktreeList,
  parseCommitObject,
  parseReflog,
  operationFromMarkers,
  parseLayoutOutput,
  splitStashSubject,
  CatFileDecoder,
} from __CORE__;
// Fixture bytes arrive as plain numbers and are turned into typed arrays by the
// sandbox's own \`Uint8Array\`, so no host global (not even TextEncoder) is needed
// inside the VM and no object crosses a realm boundary.
const fixtureBytes = (name) => new Uint8Array(globalThis.__refyardFixtureData[name]);

function run() {
  const report = {
    statusKind: null,
    statusPathBytes: [],
    topologyRows: 0,
    topologyFirstParents: 0,
    refNames: 0,
    stashSubject: null,
    stashBranch: null,
    numstatInsertions: null,
    patchHunks: 0,
    commitParents: 0,
    worktreeCount: 0,
    objectFormatLine: null,
    operationMarker: null,
    planArgv: { status: [], revList: [] },
    error: null,
  };
  try {
    const status = parseStatus(fixtureBytes("statusAllRecordTypes"));
    const entry = status.records[0];
    report.statusKind = entry === undefined ? null : entry.kind;
    report.statusPathBytes = entry === undefined ? [] : Array.from(entry.path);

    const topology = parseRevListTopology(fixtureBytes("revListTopology"));
    report.topologyRows = topology.length;
    report.topologyFirstParents = topology[0] === undefined ? 0 : topology[0].parentOids.length;

    report.refNames = parseForEachRef(fixtureBytes("forEachRef")).length;

    const stashRecords = parseReflog(fixtureBytes("stashList"));
    const stashSubjectBytes = stashRecords[0] === undefined ? null : splitStashSubject(stashRecords[0].subjectBytes);
    report.stashSubject = stashSubjectBytes === null ? null : "present";
    report.stashBranch = stashSubjectBytes === null || stashSubjectBytes.branchBytes === null ? null : "present";

    const numstat = parseNumstat(fixtureBytes("numstatRename"));
    const firstStat = numstat[0];
    report.numstatInsertions = firstStat === undefined ? null : firstStat.insertions;

    const patch = parsePatch(fixtureBytes("patchText"));
    const file = patch.files[0];
    report.patchHunks = file === undefined || file.body.kind !== "text" ? 0 : file.body.hunks.length;

    const decoder = new CatFileDecoder();
    const entries = decoder.push(fixtureBytes("catFileCommit"));
    decoder.finish();
    const object = entries[0];
    if (object !== undefined && object.type === "commit") {
      const commit = parseCommitObject(object.body);
      report.commitParents = commit.parentOids.length;
    }

    report.worktreeCount = parseWorktreeList(fixtureBytes("worktreeList")).length;
    report.objectFormatLine = parseLayoutOutput(fixtureBytes("repositoryLayout"), {
      topLevelRequested: true,
    }).objectFormat;
    report.operationMarker = operationFromMarkers(["MERGE_HEAD"]);

    report.planArgv = {
      status: planStatus({ cwdHandle: "approved-1" }).argv,
      revList: planRevList({ cwdHandle: "approved-1" }, { tips: ["a".repeat(40)], maxCount: 10, skip: 0 }).argv,
    };
  } catch (error) {
    report.error = String(error && error.message ? error.message : error);
  }
  return report;
}

globalThis.__refyardPortable = run();
`;

/** Fixture bytes as plain number arrays, built outside the sandbox. */
function fixtureData(): Record<string, number[]> {
  const entries: Record<string, number[]> = {};
  for (const [name, fixture] of Object.entries(BYTE_FIXTURES)) {
    entries[name] = [...new TextEncoder().encode(fixture.bytes)];
  }
  return entries;
}

export async function runPortableSmoke(): Promise<PortableSmokeResult> {
  const result = await build({
    stdin: {
      // `JSON.stringify`, not the bare path: the placeholder sits in TypeScript
      // *source*, and a Windows path pasted into it is read as escape sequences
      // (`\U`, `\s`, `\d`), which is how the portable check failed on Windows with
      // `Could not resolve "C:Usersshenhdev\refyardpackagesgit-coresrcindex.ts"`.
      contents: SELF_TEST_ENTRY.replace(
        "__CORE__",
        JSON.stringify(join(repositoryRoot, "packages/git-core/src/index.ts")),
      ),
      resolveDir: repositoryRoot,
      loader: "ts",
      sourcefile: "portable-selftest.ts",
    },
    bundle: true,
    format: "iife",
    // `neutral` is the point: no platform shims, no Node built-ins, no `require`.
    platform: "neutral",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (output === undefined) {
    throw new Error("the neutral bundle produced no output");
  }
  const code = output.text;

  const forbiddenReferences = [
    "require(",
    "process.",
    "node:",
    "Buffer.",
    "TextDecoder",
    "TextEncoder",
    "setTimeout(",
  ].filter((needle) => code.includes(needle));

  // The sandbox holds fixture *data* and nothing else: no process, no Buffer, no
  // require, no console, no TextEncoder, no timers. Only the engine's own
  // intrinsics are reachable, which is what makes "no host dependency" measured
  // rather than asserted.
  const sandbox = createContext(
    Object.assign(Object.create(null), {
      __refyardFixtureData: fixtureData(),
    }),
  );
  const script = new Script(code, { filename: "refyard-portable-iife.js" });
  script.runInContext(sandbox, { timeout: 5_000 });
  const report = (sandbox as { __refyardPortable?: PortableSelfTestReport })
    .__refyardPortable;
  if (report === undefined) {
    throw new Error("the bundle ran but reported nothing");
  }
  return { bundleBytes: code.length, evaluated: report, forbiddenReferences };
}
