#!/usr/bin/env bun
/**
 * `bun scripts/container-gates.ts` — run the release gates on Linux, in a container.
 *
 * The release matrix says which gate ran on which platform, and a row that says "not run" is
 * a row nobody has exercised. This runs the commands the root script contract names, in a
 * container image, against a copy of this working tree.
 *
 * The rules it follows:
 *
 * - **The repository is mounted read-only**, and the container works on a copy under its own
 *   home directory. Nothing this script does can reach the developer's tree, and the copy
 *   excludes `node_modules` and every build artifact — the container installs its own
 *   dependencies from the lockfile and builds everything it tests. The Git directory travels,
 *   because `bench:runtime` stamps the revision its numbers belong to and refuses without one.
 * - **It runs as a non-root user**, which is a product requirement rather than a preference:
 *   `refyard serve` refuses to run as root, because Git hooks and filters would then execute
 *   with root privileges. The first container run was five red tests in `cli.test.ts` for
 *   exactly that reason.
 * - **Every step runs, even after one fails**, because "which gates fail on this platform" is
 *   the answer this script exists to produce. Each step's output goes to a log in the
 *   container, the tails of the failures are printed, and the exit status is non-zero if any
 *   step failed.
 *
 * A gate that fails here is a finding, not a nuisance: it is reported with its output, and the
 * matrix says which gate failed on which image.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The image the plan names: Node 26, plus whatever Git that image carries. */
const DEFAULT_IMAGE = "node:26-bookworm";

/**
 * The account the steps run as.
 *
 * Every Node image ships a `node` user with a writable home directory; the alternative is a
 * container whose only user is root, and a product that refuses to start.
 */
const DEFAULT_USER = "node";

/**
 * The gates, in the order they run.
 *
 * `build:release` is in the list because two of the others refuse to run without it:
 * `pack:smoke` and `bench:runtime` both fail closed when the artifact is missing or stale —
 * which is the property that makes their numbers evidence rather than decoration, and it fired
 * for real the first time this ran: `bench:runtime` refused because a source file was newer
 * than the staged CLI.
 */
const DEFAULT_GATES: readonly string[] = [
  "check",
  "check:boundaries",
  "check:contract",
  "test:unit",
  "test:integration",
  "test:pack",
  "test:portable",
  "build:release",
  "pack:smoke",
  "bench:runtime",
];

interface StepResult {
  readonly gate: string;
  readonly code: number;
  readonly seconds: number;
}

interface Options {
  readonly image: string;
  readonly gates: readonly string[];
  readonly keep: boolean;
  /** Lines of a failing step's log to print, per step. */
  readonly tail: number;
  readonly user: string;
  /**
   * Raw commands to run after the dependencies are installed, in order.
   *
   * The gate list is the release contract; this is the escape hatch for a measurement that is
   * not one of its scripts — `refyard doctor --json` against the image's own Git, or a single
   * integration file rather than the whole suite.
   */
  readonly exec: readonly string[];
  /** Print every step's log tail, not only the failures: some runs exist for the output. */
  readonly printAll: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let image = DEFAULT_IMAGE;
  let gates: readonly string[] = DEFAULT_GATES;
  let keep = false;
  let tail = 40;
  let user = DEFAULT_USER;
  const exec: string[] = [];
  let printAll = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--image") {
      image = argv[index + 1] ?? image;
      index += 1;
      continue;
    }
    if (flag === "--gates") {
      gates = (argv[index + 1] ?? "")
        .split(",")
        .map((gate) => gate.trim())
        .filter((gate) => gate.length > 0);
      index += 1;
      continue;
    }
    if (flag === "--exec") {
      exec.push(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (flag === "--user") {
      user = argv[index + 1] ?? user;
      index += 1;
      continue;
    }
    if (flag === "--tail") {
      tail = Number.parseInt(argv[index + 1] ?? "40", 10);
      index += 1;
      continue;
    }
    if (flag === "--keep") {
      keep = true;
      continue;
    }
    if (flag === "--print-all") {
      printAll = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      console.log(
        'usage: bun scripts/container-gates.ts [--image <tag>] [--gates a,b,c] [--exec "cmd"] [--keep] [--print-all] [--tail n] [--user name]',
      );
      process.exit(0);
    }
    throw new Error(`unknown flag: ${flag}`);
  }
  return { image, gates, keep, printAll, tail, user, exec };
}

interface Step {
  readonly label: string;
  readonly command: string;
}

/** The steps the container runs: the package scripts first, then any raw commands. */
function stepsOf(options: Options): readonly Step[] {
  return [
    ...options.gates.map((gate) => ({
      label: gate,
      command: `pnpm run ${gate}`,
    })),
    ...options.exec.map((command, index) => ({
      label: `exec:${index + 1}`,
      command,
    })),
  ];
}

/**
 * The script the container runs.
 *
 * One string rather than a file so the command that produced the evidence is exactly what the
 * log shows. The step list travels base64-encoded: a command contains quotes, pipes and `$`,
 * and re-deriving shell quoting for each one is how a harness ends up testing its own escaping.
 */
function containerScript(options: Options): string {
  const steps = Buffer.from(
    // A trailing newline is not cosmetic: the shell's `read` fails on a last line without
    // one and the loop skips it, so the final step would silently never run.
    `${stepsOf(options)
      .map((step) => `${step.label}\t${step.command}`)
      .join("\n")}\n`,
    "utf8",
  ).toString("base64");
  return `
set -u
work="$HOME/refyard-work"
mkdir -p "$work" || exit 90

echo "container: $(id -un) ($(id -u)), $(node -v), $(git --version), $(uname -s -m)"
echo "copying the tree into $work (the mount stays read-only)"
tar -C /src \\
  --exclude=./node_modules \\
  --exclude=./.refyard-dev \\
  --exclude=./.turbo \\
  --exclude=./test-results \\
  --exclude=./playwright-report \\
  --exclude='./apps/*/build' \\
  --exclude='./apps/*/.svelte-kit' \\
  --exclude='./packages/*/dist' \\
  --exclude='./packages/npm-dist/dist' \\
  -cf - . | tar -C "$work" -xf - || exit 90
cd "$work" || exit 90

echo "installing the toolchain the root scripts name"
# Into the user's own prefix: the image's global prefix is root-owned, and running as the
# image's own non-root account is what keeps 'refyard serve' from refusing to start at all.
npm install --global --prefix "$HOME/.local" pnpm@11.25.0 bun@1.4.0 >/tmp/toolchain.log 2>&1 || {
  tail -20 /tmp/toolchain.log
  exit 91
}
export PATH="$HOME/.local/bin:$PATH"
echo "pnpm $(pnpm --version), bun $(bun --version)"

echo "installing dependencies from the lockfile"
pnpm install --frozen-lockfile >/tmp/install.log 2>&1 || {
  tail -40 /tmp/install.log
  exit 92
}

printf '%s' '${steps}' | base64 -d >/tmp/steps.tsv

grep '^FAILED_STEP' /tmp/failed 2>/dev/null || true
: >/tmp/failed
while IFS=$'\\t' read -r label command; do
  [ -n "$label" ] || continue
  log="/tmp/step-\${label//[^A-Za-z0-9]/_}.log"
  start=$(date +%s)
  # </dev/null: a command that reads stdin would otherwise consume the rest of the step
  # list and silently end the run — which is how the first version of this loop skipped
  # its second step, and why the missing-step report below exists.
  bash -lc "$command" </dev/null >"$log" 2>&1
  code=$?
  seconds=$(( $(date +%s) - start ))
  echo "STEP_RESULT {\\"gate\\":\\"$label\\",\\"code\\":$code,\\"seconds\\":$seconds}"
  if [ "$code" -ne 0 ]; then
    echo "$label" >>/tmp/failed
  fi
done </tmp/steps.tsv

if [ -s /tmp/failed ]; then
  echo "===== output of the steps that failed ====="
  while read -r label; do
    log="/tmp/step-\${label//[^A-Za-z0-9]/_}.log"
    echo "----- $label -----"
    tail -${options.tail} "$log"
  done </tmp/failed
fi

if [ '${options.printAll ? "yes" : "no"}' = "yes" ]; then
  echo "===== output of every step ====="
  while IFS=$'\t' read -r label command; do
    [ -n "$label" ] || continue
    log="/tmp/step-\${label//[^A-Za-z0-9]/_}.log"
    echo "----- $label -----"
    tail -${options.tail} "$log"
  done </tmp/steps.tsv
fi
exit 0
`.trim();
}

async function runContainer(options: Options): Promise<readonly StepResult[]> {
  const args = [
    "run",
    ...(options.keep ? [] : ["--rm"]),
    "--name",
    `refyard-gates-${process.pid}`,
    "-v",
    `${REPO_ROOT}:/src:ro`,
    "--user",
    options.user,
    options.image,
    "bash",
    "-lc",
    containerScript(options),
  ];
  console.log(`docker run ${options.keep ? "" : "--rm "}${options.image} …`);

  const results: StepResult[] = [];
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let pending = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const marker = /^STEP_RESULT (\{.*\})$/.exec(line.trim());
        if (marker !== null && marker[1] !== undefined) {
          results.push(JSON.parse(marker[1]) as StepResult);
        }
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(
          `the container exited with ${code} before the steps finished`,
        );
      }
      resolvePromise();
    });
  });
  return results;
}

const options = parseArgs(process.argv.slice(2));
const steps = stepsOf(options);
const results = await runContainer(options);

const missing = steps
  .map((step) => step.label)
  .filter((label) => !results.some((result) => result.gate === label));
const failed = results.filter((result) => result.code !== 0);

console.log("\n=== container step summary ===");
console.log(`image: ${options.image}`);
for (const result of results) {
  console.log(
    `${result.code === 0 ? "pass" : "FAIL"}  ${result.gate.padEnd(20)} ${String(result.seconds).padStart(5)}s  exit ${result.code}`,
  );
}
if (missing.length > 0) {
  console.log(`no result for: ${missing.join(", ")}`);
}
if (failed.length > 0 || missing.length > 0) {
  console.error(
    `\n${failed.length} step(s) failed, ${missing.length} did not run. That is a finding: report the step, the image and its output.`,
  );
  process.exit(1);
}
console.log(
  `\nall ${results.length} steps passed on ${options.image} (container)`,
);
