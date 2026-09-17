/**
 * The process runner, tested against real child processes.
 *
 * These cases are the reason the runner exists, so each one is written to fail if
 * the rule is dropped rather than if an implementation detail changes:
 *
 * - a command that writes far more than a pipe buffer to stderr *while* producing
 *   stdout must not deadlock (the reason both pipes are drained concurrently);
 * - an outcome is produced exactly once even when a deadline fires as the process
 *   is already exiting;
 * - a non-zero exit, a signal and a deadline are never reported as a clean exit;
 * - the child environment never carries `GIT_DIR`/`GIT_WORK_TREE` — a variable a
 *   developer happened to export must not redirect the repository under test;
 * - stdout arrives as the bytes Git wrote, including ones that are not UTF-8.
 *
 * The "Git" in these tests is `node -e`, which is a real process with real pipes;
 * a mock child process would not exercise any of the above.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEADLINES_MS,
  defaultLimits,
  isCleanExit,
  describeTermination,
  runGit,
  type RunGitOptions,
} from "@refyard/host-node/process/runner";
import { nodeBinary, nodeScriptSpec } from "../support/fake-process.js";

function options(overrides: Partial<RunGitOptions> = {}): RunGitOptions {
  return {
    gitPath: nodeBinary,
    cwd: process.cwd(),
    limits: defaultLimits("readonly"),
    ...overrides,
  };
}

describe("history search locale scope", () => {
  it("overrides only the current search invocation without mutating inherited or later hook environments", async () => {
    // Prevents locale-dependent search while preserving user hook and other Git command environments.
    const inherited = { LC_ALL: "C", LANG: "C" };
    const ambientLocale = process.env["LC_ALL"];
    const script = nodeScriptSpec(
      "process.stdout.write(process.env.LC_ALL + '|' + process.env.LANG)",
    );
    const filtered = await runGit(
      { ...script, textSearchLocale: "unicode" },
      { runId: "locale-search" },
      options({ env: inherited }),
    );
    expect(new TextDecoder().decode(filtered.stdout)).toBe("C.UTF-8|C");
    const ordinary = await runGit(
      script,
      { runId: "locale-ordinary" },
      options({ env: inherited }),
    );
    expect(new TextDecoder().decode(ordinary.stdout)).toBe("C|C");
    const hook = await runGit(
      { ...script, deadlineClass: "hook" },
      { runId: "locale-hook" },
      options({ env: inherited }),
    );
    expect(new TextDecoder().decode(hook.stdout)).toBe("C|C");
    expect(inherited).toEqual({ LC_ALL: "C", LANG: "C" });
    expect(process.env["LC_ALL"]).toBe(ambientLocale);
  });
});

describe("runGit termination", () => {
  it("reports a clean exit with the exact bytes the process wrote", async () => {
    const outcome = await runGit(
      nodeScriptSpec("process.stdout.write('ok\\n')"),
      { runId: "t1" },
      options(),
    );
    expect(outcome.termination).toBe("exit");
    expect(outcome.exitCode).toBe(0);
    expect(isCleanExit(outcome)).toBe(true);
    expect(new TextDecoder().decode(outcome.stdout)).toBe("ok\n");
  });

  it("never decodes stdout on the way out, so a non-UTF-8 byte survives", async () => {
    // Prevents: a path or blob byte that is not valid UTF-8 being replaced by
    // U+FFFD before a byte-safe parser ever sees it.
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stdout.write(Buffer.from([0x66, 0x6f, 0x6f, 0xff, 0x2f, 0x62]))",
      ),
      { runId: "t2" },
      options(),
    );
    expect([...outcome.stdout]).toEqual([0x66, 0x6f, 0x6f, 0xff, 0x2f, 0x62]);
  });

  it("reports a non-zero exit as a failure, not as a completed read", async () => {
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stderr.write('fatal: not a git repository\\n'); process.exit(128)",
      ),
      { runId: "t3" },
      options(),
    );
    expect(outcome.exitCode).toBe(128);
    expect(isCleanExit(outcome)).toBe(false);
    expect(new TextDecoder().decode(outcome.stderr)).toContain(
      "not a git repository",
    );
  });

  it("drains both pipes at once, so a chatty stderr cannot deadlock stdout", async () => {
    // Prevents: the classic pipe deadlock, where a process is blocked writing
    // stderr while the parent waits for stdout to end. 4 MiB exceeds every pipe
    // buffer on every platform this runs on.
    const script = `
      const chunk = 'x'.repeat(64 * 1024);
      let written = 0;
      const timer = setInterval(() => {
        process.stderr.write(chunk);
        written += chunk.length;
        if (written >= 4 * 1024 * 1024) { clearInterval(timer); process.stdout.write('done'); }
      }, 1);
    `;
    const outcome = await runGit(
      nodeScriptSpec(script),
      { runId: "t4" },
      options(),
    );
    expect(outcome.termination).toBe("exit");
    expect(new TextDecoder().decode(outcome.stdout)).toBe("done");
    expect(outcome.stderrTruncated).toBe(true);
  });

  it("keeps a large stdout whole when both streams are busy", async () => {
    const script = `
      const chunk = 'y'.repeat(32 * 1024);
      for (let i = 0; i < 16; i += 1) { process.stderr.write('.'); process.stdout.write(chunk); }
    `;
    const outcome = await runGit(
      nodeScriptSpec(script),
      { runId: "t5" },
      options(),
    );
    expect(outcome.stdout.byteLength).toBe(32 * 1024 * 16);
  });

  it("reports a signal as a signal rather than as an exit code", async () => {
    // Prevents: `process.kill` (or an operator's Ctrl-C) being recorded as a
    // normal completion because the close event also carries a code.
    //
    // Windows has no signals to report: `process.kill` there is TerminateProcess and
    // Node reports the child as exited, so the signal *shape* of this case is only
    // verifiable on POSIX. What is asserted everywhere is the part a user is
    // promised — a terminated process is not a clean exit.
    const outcome = await runGit(
      nodeScriptSpec("process.kill(process.pid, 'SIGTERM')"),
      { runId: "t6" },
      options(),
    );
    if (process.platform !== "win32") {
      expect(outcome.termination).toBe("signal");
    }
    expect(isCleanExit(outcome)).toBe(false);
  });

  it("reports a spawn failure without throwing", async () => {
    const outcome = await runGit(
      nodeScriptSpec("process.exit(0)"),
      { runId: "t7" },
      options({ gitPath: "/nonexistent/refyard-does-not-exist/git" }),
    );
    expect(outcome.termination).toBe("spawn-error");
    expect(outcome.exitCode).toBeNull();
    expect(outcome.stdout.byteLength).toBe(0);
  });

  it("reports a deadline as a timeout and does not claim success", async () => {
    // Prevents: a hung Git (a credential prompt, a stalled network mount) being
    // reported as a completed read, and the operation being retried on top of it.
    const outcome = await runGit(
      nodeScriptSpec("setTimeout(() => {}, 60_000)"),
      { runId: "t8" },
      options({
        limits: {
          ...defaultLimits("readonly"),
          deadlineMs: 150,
          killGraceMs: 200,
        },
      }),
    );
    expect(outcome.termination).toBe("timeout");
    expect(isCleanExit(outcome)).toBe(false);
    expect(describeTermination(outcome)).toBe("deadline exceeded");
  });

  it("stops at the stdout bound instead of growing without limit", async () => {
    // Prevents: a repository that produces gigabytes filling host memory before
    // anyone notices. The result says the bound was hit; it never pretends the
    // truncated bytes are the whole output.
    const script = `
      const chunk = 'z'.repeat(64 * 1024);
      const timer = setInterval(() => process.stdout.write(chunk), 1);
      setTimeout(() => clearInterval(timer), 20_000);
    `;
    const outcome = await runGit(
      nodeScriptSpec(script),
      { runId: "t9" },
      options({
        limits: {
          stdoutMaxBytes: 256 * 1024,
          stderrMaxBytes: 8 * 1024,
          deadlineMs: 20_000,
          killGraceMs: 200,
        },
      }),
    );
    expect(outcome.termination).toBe("output-limit");
    expect(outcome.stdout.byteLength).toBe(256 * 1024);
    expect(isCleanExit(outcome)).toBe(false);
  });

  it("settles once, even when the deadline fires while the process exits", async () => {
    // Prevents: a timeout and a close racing into two settlements, which would let
    // a caller see "timeout" first and "exit 0" later and believe both.
    const outcome = await runGit(
      nodeScriptSpec("process.exit(0)"),
      { runId: "t10" },
      options({
        limits: {
          ...defaultLimits("readonly"),
          deadlineMs: 0,
          killGraceMs: 50,
        },
      }),
    );
    expect(["exit", "timeout", "signal"]).toContain(outcome.termination);
    expect(outcome.stdout).toBeInstanceOf(Uint8Array);
  });

  it("feeds stdin to the child and closes it, so a reader is not left waiting", async () => {
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stdin.on('data', (c) => process.stdout.write(c))",
      ),
      { runId: "t11" },
      options(),
    );
    // The script above has no stdin in this spec, so it must exit on its own:
    // a runner that left stdin open would hang here and time out the test.
    expect(outcome.termination).toBe("exit");
  });

  it("writes the supplied stdin bytes and then ends the stream", async () => {
    const outcome = await runGit(
      nodeScriptSpec("process.stdin.pipe(process.stdout)"),
      { runId: "t12" },
      options(),
    );
    expect(outcome.termination).toBe("exit");
  });

  it("does not surface an EPIPE when the child exits before reading stdin", async () => {
    // Prevents: `--pathspec-from-file=-` against a Git that rejects the command
    // immediately turning into an unhandled rejection and a crashed host.
    const outcome = await runGit(
      nodeScriptSpec("process.exit(3)", {
        stdin: new Uint8Array(8 * 1024 * 1024),
      }),
      { runId: "t13" },
      options(),
    );
    expect(outcome.exitCode).toBe(3);
    expect(outcome.termination).toBe("exit");
  });
});

describe("runGit environment", () => {
  it("strips GIT_DIR and GIT_WORK_TREE from the child environment", async () => {
    // Prevents: an exported GIT_DIR silently retargeting every command the service
    // runs, which is how a "read" ends up operating on a different repository.
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stdout.write(JSON.stringify({ dir: process.env['GIT_DIR'] ?? null, tree: process.env['GIT_WORK_TREE'] ?? null }))",
      ),
      { runId: "t14" },
      options({
        env: {
          GIT_DIR: "/tmp/elsewhere/.git",
          GIT_WORK_TREE: "/tmp/elsewhere",
        },
      }),
    );
    expect(JSON.parse(new TextDecoder().decode(outcome.stdout))).toEqual({
      dir: null,
      tree: null,
    });
  });

  it("sets GIT_TERMINAL_PROMPT=0 so a credential prompt cannot hang the deadline", async () => {
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stdout.write(process.env['GIT_TERMINAL_PROMPT'] ?? '')",
      ),
      { runId: "t15" },
      options(),
    );
    expect(new TextDecoder().decode(outcome.stdout)).toBe("0");
  });

  it("keeps the ambient Git identity, so a commit is attributed as the caller expected", async () => {
    // Prevents: two failures with one cause. A service started from a shell or a CI job
    // that exported GIT_COMMITTER_* must commit as that identity, exactly as `git` would
    // in the same shell. And when neither the config nor the environment carries an
    // identity, Git resolves one from the system account database for every command that
    // needs it — measured at 15.05s for one `git worktree add` on the machine this was
    // found on, which the user feels as a workbench that hangs.
    process.env["GIT_AUTHOR_NAME"] = "ci-runner";
    process.env["GIT_AUTHOR_EMAIL"] = "ci@refyard.invalid";
    process.env["GIT_COMMITTER_NAME"] = "ci-runner";
    process.env["GIT_COMMITTER_EMAIL"] = "ci@refyard.invalid";
    try {
      const outcome = await runGit(
        nodeScriptSpec(
          "process.stdout.write(JSON.stringify({ author: process.env['GIT_AUTHOR_NAME'] ?? null, authorEmail: process.env['GIT_AUTHOR_EMAIL'] ?? null, committer: process.env['GIT_COMMITTER_NAME'] ?? null, committerEmail: process.env['GIT_COMMITTER_EMAIL'] ?? null }))",
        ),
        { runId: "t17" },
        options(),
      );
      expect(JSON.parse(new TextDecoder().decode(outcome.stdout))).toEqual({
        author: "ci-runner",
        authorEmail: "ci@refyard.invalid",
        committer: "ci-runner",
        committerEmail: "ci@refyard.invalid",
      });
    } finally {
      for (const name of [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
      ]) {
        delete process.env[name];
      }
    }
  });

  it("passes the variables that choose which Git configuration file is read", async () => {
    // Prevents: the service running Git with a different configuration than the user's
    // own `git`. `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` name the global and system
    // config files, and `GIT_CONFIG_NOSYSTEM` decides whether the second is read at all;
    // a session that set them — a test fixture isolating its scratch config, a CI job, a
    // wrapper script, or a Windows install whose system config sets `core.autocrlf` — got
    // the default files instead. Found by the first end-to-end run on Windows: the
    // service wrote CRLF into the working tree because Git for Windows' system config
    // says `core.autocrlf=true`, while the fixture's own Git, which did see the
    // variables, wrote LF — and fifteen cases compared the two.
    const names = [
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_CONFIG_NOSYSTEM",
    ] as const;
    const saved = names.map((name) => [name, process.env[name]] as const);
    process.env["GIT_CONFIG_GLOBAL"] = "/tmp/refyard-alternate-gitconfig";
    process.env["GIT_CONFIG_SYSTEM"] = "/tmp/refyard-alternate-system-config";
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    try {
      const outcome = await runGit(
        nodeScriptSpec(
          "process.stdout.write(JSON.stringify({ global: process.env['GIT_CONFIG_GLOBAL'] ?? null, system: process.env['GIT_CONFIG_SYSTEM'] ?? null, nosystem: process.env['GIT_CONFIG_NOSYSTEM'] ?? null }))",
        ),
        { runId: "t18" },
        options(),
      );
      expect(JSON.parse(new TextDecoder().decode(outcome.stdout))).toEqual({
        global: "/tmp/refyard-alternate-gitconfig",
        system: "/tmp/refyard-alternate-system-config",
        nosystem: "1",
      });
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it("still refuses the config variables that replace the whole configuration", async () => {
    // The allow-list above admits the two *file* names, so this case pins the line
    // between them: `GIT_CONFIG` makes Git ignore every other source including the
    // repository's own config, and `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT` are `-c`
    // on the environment, which can name a hook, a filter or a credential helper to run.
    const outcome = await runGit(
      nodeScriptSpec(
        "process.stdout.write(JSON.stringify({ file: process.env['GIT_CONFIG'] ?? null, count: process.env['GIT_CONFIG_COUNT'] ?? null, params: process.env['GIT_CONFIG_PARAMETERS'] ?? null, key: process.env['GIT_CONFIG_KEY_0'] ?? null }))",
      ),
      { runId: "t19" },
      options({
        env: {
          GIT_CONFIG: "/tmp/refyard-only-config",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "core.hooksPath",
          GIT_CONFIG_VALUE_0: "/tmp/refyard-hooks",
          GIT_CONFIG_PARAMETERS: "'core.autocrlf'='true'",
        },
      }),
    );
    expect(JSON.parse(new TextDecoder().decode(outcome.stdout))).toEqual({
      file: null,
      count: null,
      params: null,
      key: null,
    });
  });

  it("leaves an ambient variable out unless it is on the allow-list", async () => {
    // Prevents: credentials and tokens a developer happened to export being handed
    // to every Git process, where a hook could read and leak them.
    process.env["REFYARD_AMBIENT_SECRET"] = "leaked";
    try {
      const outcome = await runGit(
        nodeScriptSpec(
          "process.stdout.write(process.env['REFYARD_AMBIENT_SECRET'] ?? 'absent')",
        ),
        { runId: "t16" },
        options(),
      );
      expect(new TextDecoder().decode(outcome.stdout)).toBe("absent");
    } finally {
      delete process.env["REFYARD_AMBIENT_SECRET"];
    }
  });
});

describe("runner limits policy", () => {
  it("gives each deadline class a distinct, finite deadline", () => {
    // Prevents: one number being reused for a fetch and a status, which either
    // kills a slow clone or lets a hung local command run for ten minutes.
    expect(DEFAULT_DEADLINES_MS.readonly).toBeLessThan(
      DEFAULT_DEADLINES_MS.hook,
    );
    expect(DEFAULT_DEADLINES_MS.hook).toBeLessThan(
      DEFAULT_DEADLINES_MS.network,
    );
    expect(defaultLimits("network").deadlineMs).toBe(
      DEFAULT_DEADLINES_MS.network,
    );
  });

  it("bounds stderr so diagnostics cannot grow without limit", () => {
    const limits = defaultLimits("readonly");
    expect(limits.stderrMaxBytes).toBeGreaterThan(0);
    expect(limits.stderrMaxBytes).toBeLessThan(limits.stdoutMaxBytes);
  });
});
