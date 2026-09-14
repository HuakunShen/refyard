# simple-git and lazygit — host, command, and integration-harness findings

Research note for Refyard `packages/host-node` (process adapter, queue, env hygiene), `packages/git-core`
(planners/parsers) and `tests/integration`. Two reference projects were inspected in full where it matters:

- **simple-git** — the closest existing thing to a Node Git host: `child_process.spawn`, a task queue, and a
  plugin-pipeline argv guard.
- **lazygit** — a production TUI that runs the system `git` for _everything_ and has the most mature
  end-to-end harness for real repositories in this reference set.

Neither project is a design target to copy. They are evidence about which practices survive contact with
real repositories, and which ones Refyard's rules already forbid.

## Status block

| Item                              | Value                                                                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository A                      | `/Volumes/Portable2TB/ExtDev/others/git-js` (symlinked as `references/open-source/git-js`)                                                                                                                                       |
| `git -C …/git-js rev-parse HEAD`  | `c427fbad33f1f2b11341f1cf852eedecbb106400`                                                                                                                                                                                       |
| License A                         | MIT (`LICENSE`)                                                                                                                                                                                                                  |
| Package layout note               | The published package source is **`simple-git/src`** at the repository root, _not_ `packages/simple-git/src`. `packages/` holds sibling published packages (`argv-parser`, `args-pathspec`, `test-utils`, consumer smoke tests). |
| Repository B                      | `/Volumes/Portable2TB/ExtDev/others/lazygit` (symlinked as `references/open-source/lazygit`)                                                                                                                                     |
| `git -C …/lazygit rev-parse HEAD` | `bea025f5b7abbefe306a252826f1ccb2482baa00`                                                                                                                                                                                       |
| License B                         | MIT (`LICENSE`)                                                                                                                                                                                                                  |
| Working trees                     | both clean, no local modifications                                                                                                                                                                                               |

### Files read — A (simple-git), line counts from `wc -l`

| File                                                                           | Lines | Contents                                        |
| ------------------------------------------------------------------------------ | ----- | ----------------------------------------------- |
| `simple-git/src/lib/runners/git-executor-chain.ts`                             | 289   | spawn, Buffer collection, error handling, kill  |
| `simple-git/src/lib/runners/git-executor.ts`                                   | 26    | executor ↔ chain wiring                         |
| `simple-git/src/lib/runners/scheduler.ts`                                      | 61    | global concurrency limiter                      |
| `simple-git/src/lib/runners/tasks-pending-queue.ts`                            | 86    | in-flight task bookkeeping, fatal purge         |
| `simple-git/src/lib/plugins/block-unsafe-operations-plugin.ts`                 | 22    | the unsafe-action gate (`spawn.args`)           |
| `simple-git/src/lib/plugins/timout-plugin.ts`                                  | 44    | inactivity timeout                              |
| `simple-git/src/lib/plugins/abort-plugin.ts`                                   | 41    | `AbortSignal` → kill                            |
| `simple-git/src/lib/plugins/spawn-options-plugin.ts`                           | 16    | allowed spawn option passthrough                |
| `simple-git/src/lib/plugins/suffix-paths.plugin.ts`                            | 35    | rewrites pathspecs so they sit after `--`       |
| `simple-git/src/lib/tasks/status.ts`                                           | 24    | argv for `git status`                           |
| `simple-git/src/lib/responses/StatusSummary.ts`                                | 200   | porcelain v1 parser                             |
| `simple-git/src/lib/utils/git-output-streams.ts`                               | 12    | `Buffer` → utf8                                 |
| `simple-git/src/lib/utils/simple-git-options.ts`                               | 23    | defaults (`binary`, `maxConcurrentProcesses`)   |
| `simple-git/src/lib/git-factory.ts`                                            | 96    | plugin registration order                       |
| `simple-git/src/git.js`                                                        | ~600  | `env()`, `customBinary()`, constructor          |
| `packages/argv-parser/src/vulnerabilities/vulnerability-check.ts`              | 10    | entry point                                     |
| `packages/argv-parser/src/vulnerabilities/detect-vulnerable-config-writes.ts`  | 70    | blocked config keys                             |
| `packages/argv-parser/src/vulnerabilities/detect-vulnerable-flags.ts`          | 48    | blocked flags                                   |
| `packages/argv-parser/src/vulnerabilities/vulnerability.types.ts`              | 145   | the 22 category flags                           |
| `packages/argv-parser/src/env/parse-env.ts`                                    | 85    | blocked env vars + `GIT_CONFIG_COUNT` injection |
| `packages/argv-parser/test/attack-vectors.spec.ts`                             | —     | attack corpus                                   |
| `packages/test-utils/src/create-test-context.ts`                               | 94    | temp-dir test context                           |
| `simple-git/test/unit/__fixtures__/{create-fixture,status,child-processes}.ts` | —     | unit fixtures                                   |
| `simple-git/test/unit/__mocks__/mock-child-process.ts`                         | 155   | `child_process` jest mock                       |
| `simple-git/test/integration/plugin.unsafe.spec.ts`                            | 203   | real-git proof that unsafe actions are blocked  |
| `docs/PLUGIN-UNSAFE-ACTIONS.md`                                                | 513   | the unsafe-action catalogue                     |

### Files read — B (lazygit)

| File                                               | Lines | Contents                                                    |
| -------------------------------------------------- | ----- | ----------------------------------------------------------- |
| `pkg/commands/oscommands/cmd_obj.go`               | 252   | `CmdObj` fluent flags, credential strategy                  |
| `pkg/commands/oscommands/cmd_obj_builder.go`       | 134   | `ICmdObjBuilder`, arg-vector vs shell construction, quoting |
| `pkg/commands/oscommands/cmd_obj_runner.go`        | 503   | run/stream/pipe, kill, credential detection                 |
| `pkg/commands/git_cmd_obj_builder.go`              | 48    | git-specific env var on every command                       |
| `pkg/commands/git_commands/git_command_builder.go` | 147   | `GitCommandBuilder` (`Arg`/`Config`/`Dir`/`ToArgv`)         |
| `pkg/commands/git_commands/working_tree.go`        | 615   | stage/unstage/discard argv                                  |
| `pkg/commands/git_commands/stash.go`               | 218   | stash push/pop/apply/drop/store argv                        |
| `pkg/commands/git_commands/worktree.go`            | 74    | worktree add/remove/detach                                  |
| `pkg/commands/git_commands/submodule.go`           | 377   | submodule init/update/conflict gitlinks                     |
| `pkg/commands/git_commands/file_loader.go`         | 232   | `git status --porcelain -z` + `diff --numstat -z`           |
| `pkg/commands/git_commands/status.go`              | 156   | in-progress state from `.git` files, refs snapshot          |
| `pkg/commands/models/file.go`                      | 164   | `XY` → semantic booleans                                    |
| `pkg/integration/components/runner.go`             | 304   | harness entry, fixture, child process                       |
| `pkg/integration/components/env.go`                | 70    | environment allowlist                                       |
| `pkg/integration/components/shell.go`              | 525   | repo fixture DSL                                            |
| `pkg/integration/components/test.go`               | 250   | test structure, git-version gates                           |
| `pkg/integration/components/git.go`                | 65    | assertions on git state by running git                      |
| `pkg/integration/components/view_driver.go`        | 676   | `Lines`/`Contains`/`IsSelected` matchers                    |
| `pkg/integration/components/paths.go`              | 46    | per-test directory layout                                   |
| `pkg/integration/tests/**`                         | —     | workflow fixtures used below                                |
| `pkg/integration/README.md`                        | 104   | harness contract                                            |

Searches performed: `grep -rn "GIT_TERMINAL_PROMPT|GIT_ASKPASS|GIT_CONFIG|GIT_DIR|GIT_INDEX_FILE"`
over git-js sources (only `DEBUG` and a temp-dir read matched — see A2); `grep -rn "porcelain"` over
lazygit `pkg/` (three call sites, all v1 — see B3); `grep -rn "ExitError|ExitCode"` over lazygit `pkg/`
(no exit-code classification outside `git config` lookup).

---

# Part A — simple-git

## A1. How it spawns Git

One spawn site, in `simple-git/src/lib/runners/git-executor-chain.ts`:

```ts
// git-executor-chain.ts:168-186
private async gitResponse<R>(task, command, args, outputHandler, logger) {
   const outputLogger = logger.sibling('output');
   const spawnOptions: SpawnOptions = this._plugins.exec(
      'spawn.options',
      {
         cwd: this.cwd,
         env: this.env,
         windowsHide: true,
      },
      pluginContext(task, task.commands)
   );
   ...
   const spawned = spawn(command, args, spawnOptions);
```

`spawnOptionsPlugin` deliberately narrows what a user may inject, to `uid`/`gid` only:

```ts
// spawn-options-plugin.ts:5-16
export function spawnOptionsPlugin(spawnOptions: Partial<SpawnOptions>): SimpleGitPlugin<'spawn.options'> {
   const options = pick(spawnOptions, ['uid', 'gid']);
   ...
}
```

**Collection is byte-first, but the default task format is not.** stdout/stderr are accumulated as raw
`Buffer[]` and joined with `Buffer.concat`:

```ts
// git-executor-chain.ts:186-219
return new Promise((done) => {
   const stdOut: Buffer[] = [];
   const stdErr: Buffer[] = [];

   logger.info(`%s %o`, command, args);
   logger('%O', spawnOptions);

   let rejection = this._beforeSpawn(task, args);
   if (rejection) {
      return done({ stdOut, stdErr, exitCode: 9901, rejection });
   }
   ...
   spawned.stdout!.on('data', onDataReceived(stdOut, 'stdOut', logger, outputLogger.step('stdOut')));
   spawned.stderr!.on('data', onDataReceived(stdErr, 'stdErr', logger, outputLogger.step('stdErr')));
   spawned.on('error', onErrorReceived(stdErr, logger));
```

but the hand-off to the parser decodes first unless the task opted into `format: 'buffer'`:

```ts
// git-executor-chain.ts:100-104
if (isBufferTask(task)) {
  return callTaskParser(task.parser, outputStreams);
}

return callTaskParser(task.parser, outputStreams.asStrings());
```

```ts
// git-output-streams.ts:9-11
asStrings(): GitOutputStreams<string> {
   return new GitOutputStreams(this.stdOut.toString('utf8'), this.stdErr.toString('utf8'));
}
```

Non-zero exits are not exceptions: the exit code, both Buffers and any plugin `rejection` are handed to
the `task.error` plugin, and only then raised as `GitError`. A _spawn_ failure (`ENOENT`) is funnelled into
stderr as text (`onErrorReceived` pushes `Buffer.from(String(err.stack), 'ascii')`).

**The exit code is not the contract.** `exitCode: 9901` is the library's own synthetic code for a
pre-spawn rejection, so a task that sees `9901` knows nothing ran.

Observed directly relevant to Refyard: for string tasks the whole pipeline is
`bytes → utf8 string → split on NUL → trim`. That is precisely the decode-first design Refyard's
`AGENTS.md` forbids, and it is visible in their own status parser (see A5).

## A2. Git binary and environment

Defaults are in `simple-git/src/lib/utils/simple-git-options.ts`:

```ts
// simple-git-options.ts:3-8
const defaultOptions: Omit<SimpleGitOptions, "baseDir"> = {
  binary: "git",
  maxConcurrentProcesses: 5,
  config: [],
  trimmed: false,
};
```

- **Binary**: the literal string `git`. There is no PATH lookup in the library; resolution is whatever
  `spawn` does with `PATH`. It is replaceable via `simpleGit({ binary })` or `customBinary()`, which
  reconfigures a plugin (`git.js`, `Git.prototype.customBinary`).
- **Environment**: by default `env` is `undefined`, so the child **inherits the entire `process.env`**:

  ```ts
  // simple-git/src/lib/types/index.ts:41
  export type GitExecutorEnv = NodeJS.ProcessEnv | undefined;
  ```

  ```ts
  // git.js — "either supply both a name and value as strings or a single object to
  // entirely replace the current environment variables"
  Git.prototype.env = function (name, value) {
    if (arguments.length === 1 && typeof name === "object") {
      this._executor.env = name;
    } else {
      (this._executor.env = this._executor.env || {})[name] = value;
    }
    return this;
  };
  ```

- **`-c` options**: `config: []` in the defaults feeds `commandConfigPrefixingPlugin(config.config)`,
  registered _before_ the unsafe-actions plugin but evaluated by the same guard (see A4).
- **What it does not do**: an exhaustive grep of git-js sources for `GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`,
  `GIT_CONFIG`, `GIT_DIR`, `GIT_INDEX_FILE` matches only `process.env.DEBUG` in `git-logger.ts` and
  `process.env.TMPDIR` in `test-utils`. simple-git **never sets `GIT_TERMINAL_PROMPT=0`**, never clears
  `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`, and never pins `LC_ALL`/`LANG`. A credential prompt is
  prevented only because ask-pass _configuration_ is blocked (A4) — if the user's own global git config
  names a helper, the child may still block on a terminal prompt. It also relies on the ambient locale, so
  any English-message parsing in a consumer would be fragile.

For comparison, lazygit does the opposite on both counts (B1: `LANG=C`, `LC_ALL=C`, `LC_MESSAGES=C` before
parsing prompts) and more aggressively suppresses locks (`GIT_OPTIONAL_LOCKS=0` on every command).

## A3. Concurrency, queueing, timeouts, kill

**Two layers.** A per-call-site promise chain, and a global scheduler.

```ts
// git-executor-chain.ts:45-53
public chain() {
   return this;
}

public push<R>(task: SimpleGitTask<R>): Promise<R> {
   this._queue.push(task);

   return (this._chain = this._chain.then(() => this.attemptTask(task)));
}
```

`GitExecutor.chain()` returns a **new** `GitExecutorChain` per call, so independent call sites are not
serialised against each other; only `await`-chained calls on one chain are. Cross-cutting serialisation is
the scheduler's job:

```ts
// scheduler.ts:24-51
export class Scheduler {
   private pending: ScheduledTask[] = [];
   private running: ScheduledTask[] = [];

   constructor(private concurrency = 2) { ... }

   private schedule() {
      if (!this.pending.length || this.running.length >= this.concurrency) { ...; return; }
      const task = append(this.running, this.pending.shift()!);
      task.done(() => {
         remove(this.running, task);
         this.schedule();
      });
   }
```

The scheduler is constructed once per `Git` instance with `maxConcurrentProcesses` (default **5**;
`Scheduler`'s own default of 2 is dead for the public factory path, which always passes the option —
`git.js:52-55`). `TasksPendingQueue` keeps a `Map` of in-flight tasks for logging, and `fatal()` purges the
whole queue so "any as-yet un-started tasks run through this executor will not be attempted".

**Timeout is an inactivity timeout, not a deadline.** `timeoutPlugin` re-arms a timer on every stdout/stderr
`data` event:

```ts
// timout-plugin.ts:14-40
function wait() {
   timeout && clearTimeout(timeout);
   timeout = setTimeout(kill, block);
}
...
stdOut && context.spawned.stdout?.on('data', wait);
stdErr && context.spawned.stderr?.on('data', wait);
context.spawned.on('exit', stop);
context.spawned.on('close', stop);

wait();
```

**Kill is a single `SIGINT` to the direct child. There is no process-tree kill, no `detached: true`, no
process group, and no `SIGKILL` escalation:**

```ts
// git-executor-chain.ts:239-246
kill(reason: Error) {
   if (spawned.killed) {
      return;
   }

   rejection = reason;
   spawned.kill('SIGINT');
},
```

`AbortSignal` support (`abort-plugin.ts`) routes through the same `context.kill`. Practical consequence:
a `git` that has spawned `ssh`/`git-remote-https` children can outlive the kill — Refyard must do better
(detached process group + kill the group, then escalate), because our cancellation is user-visible.

## A4. The unsafe-actions protection

Entry point — a `spawn.args` plugin, so it runs on the final argv, after config prefixing, before spawn:

```ts
// block-unsafe-operations-plugin.ts:7-22
export function blockUnsafeOperationsPlugin(
  options: SimpleGitPluginConfig["unsafe"] = {},
): SimpleGitPlugin<"spawn.args"> {
  return {
    type: "spawn.args",
    action(args, { env }) {
      for (const vulnerability of vulnerabilityCheck(args, env)) {
        if (options[vulnerability.category] !== true) {
          throw new GitPluginError(undefined, "unsafe", vulnerability.message);
        }
      }

      return args;
    },
  };
}
```

```ts
// packages/argv-parser/src/vulnerabilities/vulnerability-check.ts:8-10
export function vulnerabilityCheck(
  tokens: readonly string[],
  env: Record<string, unknown>,
) {
  return [
    ...parseArgv(...tokens).vulnerabilities,
    ...parseEnv(env).vulnerabilities,
  ];
}
```

**Mechanism: real argv/config/env parsing, not substring scanning.** `parseArgv` tokenises first
(`src/args/parse-argv.ts`, `src/tokens/*`), separates global flags from the task, extracts inline `-c`
values and `--flag=value`, and the vulnerability pass then applies regexes to _parsed config keys_ and
_parsed flag names_:

```ts
// detect-vulnerable-config-writes.ts:17-37
function preventConfigBuilder(
  config: string | RegExp,
  category: VulnerabilityCategory,
  message = String(config),
) {
  const regex =
    typeof config === "string"
      ? new RegExp(`\\s*${config.toLowerCase()}`)
      : config;

  return function preventCommand(key: string): Vulnerability | void {
    if (regex.test(key)) {
      return {
        category,
        message: `Configuring ${message} is not permitted without enabling ${category}`,
      };
    }
  };
}

function preventExpandedConfigBuilder(
  config: string,
  category: VulnerabilityCategory,
) {
  const regex = new RegExp(
    `\\s*${config.toLowerCase().replace(/\./g, "(\..+)?.")}`,
  );
  return preventConfigBuilder(regex, category, config);
}
```

Two details worth stealing: the leading `\s*` in every regex tolerates the `builtin.`/vendor prefixes git
allows on config keys, and `preventExpandedConfigBuilder` turns `credential.helper` into
`credential(\..+)?.helper` so that `credential.https://host.helper` is caught too. Keys are lowercased
before matching, so key case cannot be used to evade the check.

### Every blocked config key (verbatim from `detect-vulnerable-config-writes.ts:39-70`)

| Config key (as written in the blocklist)                       | Category that unlocks it      | Why it is dangerous                            |
| -------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `alias`                                                        | `allowUnsafeAlias`            | `alias.x=!cmd` runs a shell command            |
| `core.askPass`                                                 | `allowUnsafeAskPass`          | password prompt is an arbitrary binary         |
| `core.editor`                                                  | `allowUnsafeEditor`           | arbitrary binary on commit/rebase              |
| `core.fsmonitor`                                               | `allowUnsafeFsMonitor`        | runs in the background on almost every command |
| `core.gitProxy`                                                | `allowUnsafeGitProxy`         | proxy binary for `git://`                      |
| `core.hooksPath`                                               | `allowUnsafeHooksPath`        | arbitrary hooks run on commit/merge            |
| `core.pager`                                                   | `allowUnsafePager`            | pager binary on any paged output               |
| `core.sshCommand`                                              | `allowUnsafeSshCommand`       | replaces the SSH transport binary              |
| `credential.helper` (expanded)                                 | `allowUnsafeCredentialHelper` | external credential binary                     |
| `diff.command` (expanded)                                      | `allowUnsafeDiffExternal`     | per-driver diff binary                         |
| `diff.external`                                                | `allowUnsafeDiffExternal`     | global external diff binary                    |
| `difftool.cmd` (expanded)                                      | `allowUnsafeDiffExternal`     | difftool command                               |
| `diff.textconv` (expanded)                                     | `allowUnsafeDiffTextConv`     | per-driver content converter                   |
| `filter.clean` / `filter.process` / `filter.smudge` (expanded) | `allowUnsafeFilter`           | content filters run on add/checkout            |
| `gpg.program`                                                  | `allowUnsafeGpgProgram`       | signing binary                                 |
| `include.path`                                                 | `allowUnsafeInclude`          | loads an arbitrary config file                 |
| `init.templateDir`                                             | `allowUnsafeTemplateDir`      | plants hooks/config into new repos             |
| `pager.` (expanded)                                            | `allowUnsafePager`            | per-command pager                              |
| `merge.driver` (expanded)                                      | `allowUnsafeMergeDriver`      | custom merge binary                            |
| `mergetool.path` / `mergetool.cmd` (expanded)                  | `allowUnsafeMergeDriver`      | mergetool binary                               |
| `protocol.allow` (expanded)                                    | `allowUnsafeProtocolOverride` | re-enables `ext::`/`fd::` remote helpers       |
| `remote.receivepack` / `remote.uploadpack` (expanded)          | `allowUnsafePack`             | custom pack binaries per remote                |
| `uploadpack.packObjectsHook`                                   | `allowUnsafePack`             | pack hook binary                               |
| `sequence.editor`                                              | `allowUnsafeEditor`           | interactive-rebase todo editor                 |
| `submodule.update` (expanded)                                  | `allowUnsafeSubmodule`        | a `!`-prefixed strategy is a shell command     |
| `url.insteadOf` (expanded)                                     | `allowUnsafeUrlRewrite`       | silently redirects remotes/credentials         |

### Every blocked flag (`detect-vulnerable-flags.ts:37-48`)

```ts
const preventUnsafeFlags = [
  preventFlagBuilder(
    null,
    /--(upload|receive)-pack/,
    "allowUnsafePack",
    "--upload-pack or --receive-pack",
  ),
  preventFlagBuilder("clone", /^-\w*u/, "allowUnsafePack"),
  preventFlagBuilder("clone", "--u", "allowUnsafePack"),
  preventFlagBuilder("push", "--exec", "allowUnsafePack"),
  preventFlagBuilder(null, "--template", "allowUnsafeTemplateDir"),
];
```

The `clone` short-option regex is deliberately fuzzy (`/^-\w*u/`) because of CVE-2022-25860: `-u` can be
written `-4u`, `-vu`, `-qu`, … The integration spec enumerates that matrix explicitly
(`test/integration/plugin.unsafe.spec.ts:96-154`) and asserts both that the payload _can_ fire when the
guards are disabled and that `isPwned()` stays `false` when they are on — i.e. the test proves the hole is
real before proving it is closed.

### Every blocked environment variable (`parse-env.ts:5-25`)

| Env var (matched lowercased)                                                      | Category                    |
| --------------------------------------------------------------------------------- | --------------------------- |
| `EDITOR`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`                                     | `allowUnsafeEditor`         |
| `GIT_ASKPASS`, `SSH_ASKPASS`                                                      | `allowUnsafeAskPass`        |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `GIT_CONFIG`, `GIT_EXEC_PATH`, `PREFIX` | `allowUnsafeConfigPaths`    |
| `GIT_CONFIG_COUNT`, `GIT_CONFIG_PARAMETERS`                                       | `allowUnsafeConfigEnvCount` |
| `GIT_EXTERNAL_DIFF`                                                               | `allowUnsafeDiffExternal`   |
| `GIT_PAGER`, `PAGER`                                                              | `allowUnsafePager`          |
| `GIT_PROXY_COMMAND`                                                               | `allowUnsafeGitProxy`       |
| `GIT_TEMPLATE_DIR`                                                                | `allowUnsafeTemplateDir`    |
| `GIT_SSH`, `GIT_SSH_COMMAND`                                                      | `allowUnsafeSshCommand`     |

plus the injection path that a naive implementation would miss — `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/
`GIT_CONFIG_VALUE_n` values are parsed and run through the same config-key blocklist:

```ts
// parse-env.ts:31-52
function* collectConfigByCount(env: GitEnv): Generator<ConfigWrite> {
  const count = parseInt(env.git_config_count ?? "0", 10);
  for (let index = 0; index < count; index++) {
    const key = env[`git_config_key_${index}`];
    const value = env[`git_config_value_${index}`];
    if (key !== undefined) {
      yield { key: key.toLowerCase().trim(), value, scope: "env" };
    }
  }
}
```

Note the design: **22 opt-in booleans**, one per category, threaded from `simpleGit({ unsafe: {...} })`.
The library's own docstring sets the expectation correctly (`docs/PLUGIN-UNSAFE-ACTIONS.md:10-12`):
"These blocks are a safety net, not a substitute for input validation."

**Where this is weak, and Refyard must be stricter.** Everything here guards _the values passed through the
library_. It does not defend against a malicious **repository**: a `.git/config` with `core.hooksPath`, a
`.gitmodules` `update = !cmd`, or a `filter.<driver>.clean` documented in `.gitattributes` executes on
ordinary commands without any argv or env containing the hostile string. simple-git also leaves
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY` and `GIT_ALTERNATE_OBJECT_DIRECTORIES`
untouched, and never sets `GIT_TERMINAL_PROMPT=0`. Refyard's ban on `credential.helper`, `core.sshCommand`
and `GIT_*` is a superset in intent; the _implementation_ lesson is: block on parsed structure with
lowercased keys and widened drivers, enumerate the env family rather than exact names, and let a test
demonstrate the exploit firing before it demonstrates the block.

## A5. `git status --porcelain` parsing

The argv is fixed and the caller cannot override the framing flags:

```ts
// tasks/status.ts:5-15
const ignoredOptions = ["--null", "-z"];

export function statusTask(customArgs: string[]): StringTask<StatusResult> {
  const commands = [
    "status",
    "--porcelain",
    "-b",
    "-u",
    "--null",
    ...customArgs.filter((arg) => !ignoredOptions.includes(arg)),
  ];

  return {
    format: "utf-8",
    commands,
    parser(text: string) {
      return parseStatusSummary(text);
    },
  };
}
```

So: **porcelain v1, NUL-framed, with `-b` (branch header) and `-u` (all untracked)**. Because the task
format is `'utf-8'`, the parser receives an already-decoded string and can only split on NUL:

```ts
// responses/StatusSummary.ts:156-175
export const parseStatusSummary = function (text: string): StatusResult {
  const lines = text.split(NULL);
  const status = new StatusSummary();

  for (let i = 0, l = lines.length; i < l;) {
    let line = lines[i++].trim();

    if (!line) {
      continue;
    }

    if (line.charAt(0) === PorcelainFileStatus.RENAMED) {
      line += NULL + (lines[i++] || "");
    }

    splitLine(status, line);
  }

  return status;
};
```

**Renames**: v1 with `-z` emits the two paths as two NUL-separated tokens, target first. The parser rejoins
them with a NUL and splits on it:

```ts
// responses/StatusSummary.ts:40-47
function renamedFile(line: string) {
  const [to, from] = line.split(NULL);

  return {
    from: from || to,
    to,
  };
}
```

The `from: from || to` fallback exists for a malformed `R  file.ext` line with no second token (there is a
unit test named exactly "Handles malformatted rename"). The trim behaviour is inconsistent as a direct
consequence of decoding first: the target path is trimmed because `line` was trimmed before the NUL was
appended, while the source path is only affected by the trailing trim of the reassembled string, so a
source path with leading whitespace survives intact and a target path with leading whitespace does not.

**Classification** is a 2-character dispatch table rather than a chain of string ops:

```ts
// responses/StatusSummary.ts:177-199
function splitLine(result: StatusResult, lineStr: string) {
  const trimmed = lineStr.trim();
  switch (" ") {
    case trimmed.charAt(2):
      return data(trimmed.charAt(0), trimmed.charAt(1), trimmed.slice(3));
    case trimmed.charAt(1):
      return data(
        PorcelainFileStatus.NONE,
        trimmed.charAt(0),
        trimmed.slice(2),
      );
    default:
      return;
  }

  function data(index: string, workingDir: string, path: string) {
    const raw = `${index}${workingDir}`;
    const handler = parsers.get(raw);

    if (handler) {
      handler(result, path);
    }

    if (raw !== "##" && raw !== "!!") {
      result.files.push(new FileStatusSummary(path, index, workingDir));
    }
  }
}
```

The `switch (' ')` shape handles the ambiguous case where a _path_ begins with a space (decoded v1 output
puts exactly one space between `XY` and the path, but `trim()` collapses leading spaces on paths).
Conflicts are generated combinatorially:

```ts
// responses/StatusSummary.ts:112-123
...conflicts(PorcelainFileStatus.ADDED, PorcelainFileStatus.ADDED, PorcelainFileStatus.UNMERGED),
...conflicts(PorcelainFileStatus.DELETED, PorcelainFileStatus.DELETED, PorcelainFileStatus.UNMERGED),
...conflicts(PorcelainFileStatus.UNMERGED,
   PorcelainFileStatus.ADDED, PorcelainFileStatus.DELETED, PorcelainFileStatus.UNMERGED),
```

so all eight unmerged states (`AA DD AU UA UD DU UU` plus the `AU`/`UA` forms) land in `conflicted`.
The `##` branch header is parsed with five regexes for `ahead N`, `behind N`, current, tracking and
`\(no branch\)` (detached).

Submodules are **not** distinguished: a gitlink is just an `XY` pair on a path. lazygit _does_ distinguish
them (`pkg/commands/models/file.go`, and it special-cases dirty-only submodules as unstageable), which is
the better model for a workbench UI.

Tests are fixture-driven with typed factories:

```ts
// simple-git/test/unit/__fixtures__/responses/status.ts:4-35
export function stagedRenamed(
  from = "from.ext",
  to = "to.ext",
  workingDir = " ",
) {
  return `R${workingDir} ${to}${NULL}${from}`;
}

export function statusResponse(
  branch = "main",
  ...files: Array<string | (() => string)>
) {
  const stdOut: string[] = [
    `## ${branch}`,
    ...files.map((file) => (typeof file === "function" ? file() : file)),
  ];

  return createFixture(stdOut.join(NULL), "");
}
```

and one representative parse assertion:

```ts
// simple-git/test/unit/status.spec.ts:429-456
it("Report all types of merge conflict statuses", () => {
  const statusSummary = parseStatusSummary(
    statusResponse(
      "branch",
      "UU package.json",
      "DD src/git.js",
      "DU src/index.js",
      "UD src/newfile.js",
      "AU test.js",
      "UA test",
      "AA test-foo.js",
    ).stdOut,
  );

  expect(statusSummary).toEqual(
    like({
      conflicted: [
        "package.json",
        "src/git.js",
        "src/index.js",
        "src/newfile.js",
        "test.js",
        "test",
        "test-foo.js",
      ],
    }),
  );
});
```

There are also two integration-level facts worth noting for our own test design: `status` tests cover
pathspecs (`status(['--', 'clean-dir'])`) and UTF-8 paths (`😀 file.ext`), and a dedicated
`test/integration/concurrent-commands.spec.ts` asserts that queueing preserves _ordering per directory_
across two interleaved call sites — the same property Refyard's one-writer-per-common-dir queue must hold.

## A6. What its tests look like

**Three tiers.**

1. **Pure parser unit tests** (`simple-git/test/unit/*.spec.ts`) with no process at all — fixtures are typed
   factories that emit the exact byte framing (`__fixtures__/create-fixture.ts` produces
   `{stdOut, stdErr, parserArgs}`; `__fixtures__/responses/status.ts` builds NUL-joined porcelain).
2. **Command-shape unit tests** with `child_process` mocked. The mock records the argv/env of every spawn
   and exposes helpers to drive events:

   ```ts
   // test/unit/__mocks__/mock-child-process.ts:105-151
   export const mockChildProcessModule = (function mockChildProcessModule() {
      const children: MockChildProcess[] = [];
      return {
         spawn: jest.fn((...args: ChildProcessConstructor) => addChild(new MockChildProcessImpl(args))),
         $allCommands() { return children.map((child) => child.$args); },
         $mostRecent() { return children[children.length - 1]; },
         ...
      };
   })();
   jest.mock('child_process', () => mockChildProcessModule);
   afterEach(() => { mockChildProcessModule.$reset(); });
   ```

   with `closeWithSuccess`/`closeWithError` helpers that emit `data`, `exit` then `close`, and a
   `assertExecutedCommands(...)` that asserts on the argv array. This is how they test that `status()`
   really produces `['status','--porcelain','-b','-u','--null']` and that `-z` cannot be smuggled in by a
   caller. That is a pattern Refyard should copy for `git-core` planners: assert argv, cheaply, without git.

3. **Integration tests against real git** (`simple-git/test/integration/`). The context helper is thin:

   ```ts
   // packages/test-utils/src/create-test-context.ts:39-56
   mkdtemp(): Promise<string> {
      return new Promise((done, fail) => {
         mkdtemp(join(process.env.TMPDIR || tmpdir(), 'simple-git-test-'), (err, path) => {
            err ? fail(err) : done(path);
         });
      });
   },
   ...
   export async function createTestContext(): Promise<SimpleGitTestContext> {
      const root = await io.mkdtemp();
      const context: SimpleGitTestContext = {
         path(...segments) { return join(root, ...segments); },
         async dir(...paths) { ... return await io.mkdir(context.path(...paths)); },
         async file(path, content = `File content ${path}`) { ... },
         async files(...paths) { for (const path of paths) await context.file(path); },
         get root() { return root; },
         get rootResolvedPath() { return realpathSync(context.root); },
         get git() { return simpleGit(root); },
      };
      return context;
   }
   ```

   **Isolation is weaker than Refyard's rule.** It creates a temp directory per test and uses it as
   `baseDir`, but does **not** set `HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, or `GIT_CONFIG_NOSYSTEM`,
   and has no network guard. This is confirmed by the absence of any jest `setupFiles`, `globalSetup`, or
   `setupFilesAfterEnv` entry (`simple-git/jest.config.js` declares only `roots`, coverage thresholds and
   `testMatch`), and by `grep -rn "GIT_CONFIG|HOME|setupFiles"` returning no match anywhere in
   `simple-git/scripts` or `packages/test-utils`. Tests therefore run against the developer's real global
   git config and real `HOME` — which is exactly how `plugin.unsafe.spec.ts` can be written at all (it
   relies on `git init` working without identity setup, and on the developer's git not having a hostile
   global config). Refyard's rule to point `HOME`, `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at scratch
   files is the correction, and it should be _asserted_, not merely set. Setup is composed from helpers (`setUpInit`, `setUpFilesAdded`, `setUpIgnored`,
   `setUpConflicted` in `packages/test-utils/src/setup/`):

   ```ts
   // test/integration/status.spec.ts:12-33
   beforeEach(async () => (context = await createTestContext()));
   beforeEach(async () => {
     await setUpInit(context);
     await context.file(["clean-dir", "clean"]);
     await context.file(["dirty-dir", "dirty"]);
     await setUpFilesAdded(
       context,
       ["alpha", "beta"],
       ["alpha", "beta", "./clean-dir"],
     );
   });

   it("detects renamed files", async () => {
     await context.git.raw("mv", "alpha", "gamma");
     const status = await context.git.status();
     expect(status).toEqual(
       like({
         files: [
           like({ path: "gamma", from: "alpha" }),
           like({ path: "dirty-dir/dirty" }),
         ],
         renamed: [{ from: "alpha", to: "gamma" }],
       }),
     );
   });
   ```

   `like()` is a partial-match helper, so a test asserts the fields it cares about without pinning every
   field of a large status object.

   The security suite is the model to imitate: it asserts the **absence of a side effect** (a file at
   `pwn/touched` never appears), not merely that a promise rejected.

---

# Part B — lazygit

## B1. How commands are defined

Four layers, each with one job.

**(1) An argument-vector builder that knows where git's global options go.**

```go
// pkg/commands/git_commands/git_command_builder.go:26-56, 66-72, 114-116
func NewGitCmd(command string) *GitCommandBuilder {
	return &GitCommandBuilder{args: []string{command}}
}

func (self *GitCommandBuilder) Arg(args ...string) *GitCommandBuilder {
	self.args = append(self.args, args...)
	return self
}

func (self *GitCommandBuilder) ArgIf(condition bool, ifTrue ...string) *GitCommandBuilder { ... }
func (self *GitCommandBuilder) ArgIfElse(condition bool, ifTrue string, ifFalse string) *GitCommandBuilder { ... }

func (self *GitCommandBuilder) Config(value string) *GitCommandBuilder {
	// config settings come before the command
	self.args = append([]string{"-c", value}, self.args...)
	return self
}

// the -C arg will make git do a `cd` to the directory before doing anything else
func (self *GitCommandBuilder) Dir(path string) *GitCommandBuilder {
	self.args = append([]string{"-C", path}, self.args...)
	return self
}

func (self *GitCommandBuilder) ToArgv() []string {
	return append([]string{"git"}, self.args...)
}
```

There are also `Worktree(path)` → `--work-tree` and `GitDir(path)` → `--git-dir`, each prepending so the
final order is always `<git-dir>/<work-tree>/<config>/<command>`. The `ToArgv()` shape means **the argv is a
value you can assert on in a unit test** — `git_command_builder_test.go` does exactly that. Refyard's core
planners should have the same property.

**(2) The command object: a fluent description of _how_ to run, not _what_.**

```go
// pkg/commands/oscommands/cmd_obj.go:12-40
// A command object is a general way to represent a command to be run on the
// command line.
type CmdObj struct {
	cmd *exec.Cmd

	runner ICmdObjRunner

	// see DontLog()
	dontLog bool

	// see StreamOutput()
	streamOutput bool

	// see SuppressOutputUnlessError()
	suppressOutputUnlessError bool

	// see UsePty()
	usePty bool

	// see IgnoreEmptyError()
	ignoreEmptyError bool

	// if set to true, it means we might be asked to enter a username/password by this command.
	credentialStrategy CredentialStrategy
	task               gocui.Task

	// can be set so that we don't run certain commands simultaneously
	mutex *deadlock.Mutex
}
```

Four execution modes are selected by those flags, and the choice between them is the whole
"interruptable vs background" story:

| Mode                           | Method                                                                  | Collection                                                    | Used for                                           |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| Buffered                       | `Run()` / `RunWithOutput()` / `RunWithOutputs()`                        | `CombinedOutput()` or separate `bytes.Buffer`s                | every read query and most writes                   |
| Streamed                       | `StreamOutput()` (+ optional `SuppressOutputUnlessError()`)             | tee'd into the command-log panel                              | long-running user-visible work (fetch/push)        |
| Streamed + PTY                 | `UsePty()`, `PromptOnCredentialRequest()` / `FailOnCredentialRequest()` | tee'd, with credential-prompt scanning                        | anything that can ask for a password               |
| Line-streamed, _interruptable_ | `RunAndProcessLines(onLine)`                                            | `bufio.Scanner` over stdout; closing the pipe kills the child | progress parsing where a callback can request stop |

```go
// cmd_obj_runner.go:149-199 (abridged)
func (self *cmdObjRunner) RunAndProcessLines(cmdObj *CmdObj, onLine func(line string) (bool, error)) error {
	...
	stdoutPipe, err := cmd.StdoutPipe()
	scanner := bufio.NewScanner(stdoutPipe)
	scanner.Split(utils.ScanLinesAndTruncateWhenLongerThanBuffer(bufio.MaxScanTokenSize))
	if err := cmd.Start(); err != nil { return err }

	for scanner.Scan() {
		line := scanner.Text()
		stop, err := onLine(line)
		if err != nil { stdoutPipe.Close(); return err }
		if stop {
			stdoutPipe.Close() // close the pipe so that the called process terminates
			break
		}
	}
	...
	_ = cmd.Wait()
```

**Kill mechanism is pipe/PTY closure, not signals.** There is no `SIGTERM` escalation anywhere; the child is
expected to notice EOF. The `FAIL` credential strategy uses the same trick to break a hang: returning a nil
channel from the prompt callback closes the PTY (`runAndDetectCredentialRequest`, `cmd_obj_runner.go:380-388`).

**"Background" is a task-manager concept, not a command flag.** For the UI to know when it is safe to
switch repositories, every piece of work is a `gocui.Task`:

```go
// pkg/gocui/task.go:20-38
type TaskImpl struct {
	id        int
	busy      bool
	onDone    func()
	withMutex func(func())
	// Background tasks don't count towards the program being "busy" for the
	// purpose of deciding whether a repo switch is safe (see
	// TaskManager.hasBusyForegroundTaskExcept). Two kinds of work are tagged
	// this way: the ongoing background routines (auto-fetch, files refresh,
	// external-change detection) and the refreshes they trigger, whose model
	// writes are already guarded against a concurrent repo switch by the repo
	// generation; and view-buffer content rendering, which only paints a view
	// and so is harmless to leave running across a switch. What stays
	// foreground is lazygit driving a git operation and applying its results
	// to the model — exactly the work a repo switch must not run underneath.
	background bool
}
```

And the same foreground/background split decides lock suppression on the status command (B3): a _foreground_
refresh is the one command that opts back into optional locks so git's stat-cache is persisted; background
refreshes keep `GIT_OPTIONAL_LOCKS=0` so they never contend for `index.lock`. The applicable idea for
Refyard: classify each job as foreground-mutating vs background-refresh **in one place** and derive
`GIT_OPTIONAL_LOCKS`, the queue lane, and the "is the service busy" answer from that single classification.

**(3) A git-specific builder that stamps an env var onto every command.**

```go
// pkg/commands/git_cmd_obj_builder.go:18-44
// We disable git's optional locks on every command by default so that our git
// invocations never contend for index.lock. See git_commands.OptionalLocksEnvVar
// for the full rationale. Individual commands that do want the lock (currently
// only the foreground files refresh) opt back in via CmdObj.RemoveEnvVar.
var defaultEnvVar = git_commands.OptionalLocksEnvVar + "=0"

func (self *gitCmdObjBuilder) New(args []string) *oscommands.CmdObj {
	return self.innerBuilder.New(args).AddEnvVars(defaultEnvVar)
}
```

with the counterpart:

```go
// cmd_obj.go:94-105
// RemoveEnvVar removes every occurrence of the named environment variable from
// the command's environment. It's the counterpart to AddEnvVars, used to opt a
// single command out of a variable that the builder sets on every command by
// default.
func (self *CmdObj) RemoveEnvVar(name string) *CmdObj {
	prefix := name + "="
	self.cmd.Env = lo.Filter(self.cmd.Env, func(envVar string, _ int) bool {
		return !strings.HasPrefix(envVar, prefix)
	})
	return self
}
```

**Environment hygiene, exactly as lazygit does it:**

| Variable                        | Value                                                            | Where                                              |
| ------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `GIT_OPTIONAL_LOCKS`            | `0` on **every** git command                                     | `git_cmd_obj_builder.go:22,39`                     |
| `GIT_OPTIONAL_LOCKS`            | _removed_ (i.e. git's default) for the foreground status refresh | `file_loader.go:189-197`                           |
| `LANG`, `LC_ALL`, `LC_MESSAGES` | `C` — only on commands whose output is parsed for prompts        | `cmd_obj_runner.go:352-353`                        |
| `PWD`                           | set to the worktree path, _unresolved_, to preserve symlinks     | `components/runner.go:220-226`                     |
| `GIT_CONFIG_GLOBAL`             | test global config file                                          | `components/runner.go:261`, `components/env.go:62` |
| `HOME`                          | test dir (for git ≤ 2.31 that ignores `GIT_CONFIG_GLOBAL`)       | `components/env.go:58`                             |
| `GIT_CONFIG_NOGLOBAL`           | declared constant (legacy path)                                  | `components/env.go:24-26`                          |
| `GH_TELEMETRY`                  | `disabled` (stops `gh` writing state into the worktree)          | `components/env.go:64-67`                          |

Note what lazygit does _not_ clear: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`. It relies on `os.Chdir`
into the worktree (`git.go:70-73`) and on `-C`/`--git-dir` in argv instead. Refyard's scope-bound port
should clear those explicitly rather than inherit them.

**(4) The runner enforces one mutex per shared resource and derives errors from output.**

```go
// cmd_obj_runner.go:32-48
func (self *cmdObjRunner) Run(cmdObj *CmdObj) error {
	if cmdObj.Mutex() != nil {
		cmdObj.Mutex().Lock()
		defer cmdObj.Mutex().Unlock()
	}
	...
```

```go
// cmd_obj_runner.go:205-216
func sanitisedCommandOutput(output []byte, err error) (string, error) {
	outputString := string(output)
	if err != nil {
		// errors like 'exit status 1' are not very useful so we'll create an error
		// from the combined output
		if outputString == "" {
			return "", utils.WrapError(err)
		}
		return outputString, errors.New(outputString)
	}
	return outputString, nil
}
```

The `WithMutex` pattern is the direct analogue of Refyard's "one writer per common Git directory": a
`*deadlock.Mutex` is attached to each command that touches a shared resource, and every runner entry point
honours it. Note the error value carries the **raw git output as the message** — no attempt to classify it.

**(5) One more planner detail worth stealing verbatim** — batching to respect platform argv limits:

```go
// git_command_builder.go:122-147
// runGitCmdOnPaths runs `git <subcommand> -- <paths...>`, splitting into
// multiple calls if needed to stay under the OS command-line length limit.
// Windows CreateProcess has a ~32 KB limit; we use 30 KB as a safe threshold.
func runGitCmdOnPaths(subcommand string, paths []string, cmd oscommands.ICmdObjBuilder) error {
	const maxArgBytes = 30_000
	...
```

## B2. Three hard workflows, with exact argv and ordering

### (a) Stage / unstage paths — `pkg/commands/git_commands/working_tree.go:40-85`

```go
func (self *WorkingTreeCommands) StageFile(path string) error {
	return self.StageFiles([]string{path}, nil)
}

func (self *WorkingTreeCommands) StageFiles(paths []string, extraArgs []string) error {
	cmdArgs := NewGitCmd("add").
		Arg(extraArgs...).
		Arg("--").
		Arg(paths...).
		ToArgv()

	return self.cmd.New(cmdArgs).Run()
}

// StageAll stages all files
func (self *WorkingTreeCommands) StageAll(onlyTrackedFiles bool) error {
	cmdArgs := NewGitCmd("add").
		ArgIfElse(onlyTrackedFiles, "-u", "-A").
		ToArgv()

	return self.cmd.New(cmdArgs).Run()
}

func (self *WorkingTreeCommands) UnstageAll() error {
	return self.cmd.New(NewGitCmd("reset").ToArgv()).Run()
}

// UnStageFile unstages a file
// we accept an array of filenames for the cases where a file has been renamed i.e.
// we accept the current name and the previous name
func (self *WorkingTreeCommands) UnStageFile(paths []string, tracked bool) error {
	if tracked {
		return self.UnstageTrackedFiles(paths)
	}
	return self.UnstageUntrackedFiles(paths)
}

func (self *WorkingTreeCommands) UnstageTrackedFiles(paths []string) error {
	return self.cmd.New(NewGitCmd("reset").Arg("HEAD", "--").Arg(paths...).ToArgv()).Run()
}

func (self *WorkingTreeCommands) UnstageUntrackedFiles(paths []string) error {
	return self.cmd.New(NewGitCmd("rm").Arg("--cached", "--force", "--").Arg(paths...).ToArgv()).Run()
}
```

Four facts worth carrying into Refyard's planner:

1. Every path-taking command ends `-- paths...` so a path named `-f` or `--cached` cannot become an option.
2. **Renames are passed as two paths** (`current name and the previous name`) — unstage must name both or
   the rename pair is not fully unstaged. `pkg/gui/controllers/files_controller.go:672-685`
   (`unstageFilteredFiles`) and `models.File.Names()` encode this.
3. Unstaging an untracked-but-staged file is **not** `reset HEAD`; it is `rm --cached --force`, because
   `reset` cannot unstage a path with no HEAD entry. Refyard needs this same distinction for
   `Added`-style files.
4. Staging selects a _different command per state_ rather than a universal one: `add -u` for tracked-only
   bulk staging vs `add -A`. The decision of "which files are stageable" lives in
   `files_controller.go:508-560` and is explicitly symmetric — the toggle inspects
   `filterNodesHaveUnstagedChanges` and, when the only apparent unstaged change is a _dirty submodule_
   (a no-op for the parent repo), falls through to unstaging instead. `stagingWouldBeNoOp` →
   `submodule.AnyHaveStageableChanges` runs `git submodule status -- <paths>` and looks for a leading `+`.
5. Refusals are pre-checks, not post-hoc error reading:

   ```go
   // files_controller.go:516-521
   // if any files within have inline merge conflicts we can't stage or unstage,
   // or it'll end up with those >>>>>> lines actually staged
   if node.GetHasInlineMergeConflicts() {
      return errors.New(self.c.Tr.ErrStageDirWithInlineMergeConflicts)
   }
   ```

### (b) Stash pop / apply — `pkg/commands/git_commands/stash.go` + `pkg/gui/controllers/stash_controller.go:137-166`

```go
func (self *StashCommands) Pop(index int) error {
	cmdArgs := NewGitCmd("stash").Arg("pop", fmt.Sprintf("refs/stash@{%d}", index)).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

func (self *StashCommands) Apply(index int) error {
	cmdArgs := NewGitCmd("stash").Arg("apply", fmt.Sprintf("refs/stash@{%d}", index)).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

func (self *StashCommands) Drop(index int) error {
	cmdArgs := NewGitCmd("stash").Arg("drop", fmt.Sprintf("refs/stash@{%d}", index)).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}
```

Ordering and conflict handling, as it actually happens:

1. **Always address the stash by full ref** (`refs/stash@{N}`), never by bare index `N` — the underlying
   `git stash pop N` accepts the bare form but the ref form is unambiguous and survives
   `stash list` reordering.
2. `handleStashPop` runs `Pop`, then **unconditionally refreshes before checking the error** and only then
   propagates it:

   ```go
   // stash_controller.go:138-155
   pop := func() error {
      self.c.LogAction(self.c.Tr.Actions.PopStash)
      self.c.LogCommand(fmt.Sprintf(self.c.Tr.Log.PoppingStash, stashEntry.Hash), false)
      err := self.c.Git().Stash.Pop(stashEntry.Index)
      self.postStashRefresh()
      if err != nil {
         return err
      }
      if self.c.UserConfig().Gui.SwitchToFilesAfterStashPop {
         self.c.Context().Push(self.c.Contexts().Files, types.OnFocusOpts{})
      }
      return nil
   }
   ```

   This matters: `git stash pop` on a conflicting pop **exits non-zero while leaving the stash entry in
   place and conflicts in the worktree**. The UI must re-read state on both paths. Refyard has the same
   obligation and a stronger one (its rules require reporting such a result as _unknown/conflicted_, never
   as `succeeded`, and never auto-retrying).

3. **Dropping is never implicit.** `Pop` failing leaves the entry; `Pop` succeeding removes it. There is no
   "drop then apply" anywhere — the reverse (apply, then drop on success) is not used either.
4. **`pop` is guarded by a confirmation** (`SkipStashWarning` config), i.e. it is treated as a destructive
   step. `drop` iterates **in descending index order** so earlier indices stay valid mid-loop:

   ```go
   // stash_controller.go:169-181
   for i := len(stashEntries) - 1; i >= 0; i-- {
      ...
      err := self.c.Git().Stash.Drop(stashEntries[i].Index)
      self.c.Refresh(...)
      if err != nil { return err }
   }
   ```

5. Stash _creation_ variants are a small matrix, each a distinct argv: `stash push -m <msg>` (all),
   `stash push --include-untracked -m <msg>`, `stash push --keep-index -m <msg>`, and `stash push --staged
-m <msg>` on git ≥ 2.35 with a documented, buggy fallback chain for older git
   (`stash --keep-index` → `push` → `apply refs/stash@{1}` → pipe `stash show -p` into `apply -R` →
   `drop refs/stash@{1}` → clean up `AD` entries). The version gate is explicit
   (`self.version.IsAtLeast(2, 35, 0)`), and the fallback's known bugs are documented in comments rather
   than hidden.

### (c) Worktree and submodule operations

Worktree — `pkg/commands/git_commands/worktree.go:32-55`:

```go
func (self *WorktreeCommands) New(opts NewWorktreeOpts) error {
	if opts.Detach && opts.Branch != "" {
		panic("cannot specify branch when detaching")
	}

	cmdArgs := NewGitCmd("worktree").Arg("add").
		ArgIf(opts.Detach, "--detach").
		ArgIf(opts.Branch != "", "-b", opts.Branch).
		Arg(opts.Path, opts.Base)

	return self.cmd.New(cmdArgs.ToArgv()).Run()
}

func (self *WorktreeCommands) Delete(worktreePath string, force bool) error {
	cmdArgs := NewGitCmd("worktree").Arg("remove").ArgIf(force, "-f").Arg(worktreePath).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

func (self *WorktreeCommands) Detach(worktreePath string) error {
	cmdArgs := NewGitCmd("checkout").Arg("--detach").GitDir(filepath.Join(worktreePath, ".git")).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}
```

`worktree remove` is `-f`-gated exactly like Refyard's `removeWorktree` confirmation rule, and there is a
pre-check helper the UI uses to avoid the "branch already checked out" failure:

```go
// worktree.go:67-74
func CheckedOutByOtherWorktree(branch *models.Branch, worktrees []*models.Worktree) bool {
	worktree, ok := WorktreeForBranch(branch, worktrees)
	if !ok { return false }
	return !worktree.IsCurrent
}
```

Submodule — `pkg/commands/git_commands/submodule.go`. The relevant argv:

```go
// submodule.go:196-214
func (self *SubmoduleCommands) Reset(submodule *models.SubmoduleConfig) error {
	parentDir := ""
	if submodule.ParentModule != nil { parentDir = submodule.ParentModule.FullPath() }
	cmdArgs := NewGitCmd("submodule").
		Arg("update", "--init", "--force", "--", submodule.Path).
		DirIf(parentDir != "", parentDir).
		ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

func (self *SubmoduleCommands) UpdateAll() error {
	// not doing an --init here because the user probably doesn't want that
	cmdArgs := NewGitCmd("submodule").Arg("update", "--force").ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

// submodule.go:320-332
func (self *SubmoduleCommands) Init(path string) error {
	cmdArgs := NewGitCmd("submodule").Arg("init", "--", path).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}

func (self *SubmoduleCommands) Update(path string) error {
	cmdArgs := NewGitCmd("submodule").Arg("update", "--init", "--", path).ToArgv()
	return self.cmd.New(cmdArgs).Run()
}
```

Three submodule facts that matter for a workbench:

1. **A dirty-only submodule cannot be staged from the superproject.** The check is
   `git submodule status -- <paths>` and a leading `+` means "checked-out commit differs from the index,
   i.e. there is a commit change to stage" (`submodule.go:90-112`). Untracked/dirty content is not
   stageable — the UI must say so rather than fail.
2. **`git checkout --ours/--theirs` is a no-op on gitlinks.** Conflict resolution must resolve _inside_
   the submodule and then stage the gitlink:

   ```go
   // submodule.go:159-166
   // CheckoutConflictCommit resolves a submodule conflict by checking the submodule
   // out at the given commit. `git checkout --ours/--theirs` is a no-op on
   // gitlinks, so we check out the chosen commit in the submodule itself; the
   // caller then stages the submodule to record the resolution.
   func (self *SubmoduleCommands) CheckoutConflictCommit(path string, sha string) error {
   	cmdArgs := NewGitCmd("checkout").Dir(path).Arg(sha).ToArgv()
   	return self.cmd.New(cmdArgs).Run()
   }
   ```

   The three gitlink commits come from the index, parsed positionally and byte-framed:

   ```go
   // submodule.go:118-144 (abridged)
   cmdArgs := NewGitCmd("ls-files").Arg("-u", "-z", "--", path).ToArgv()
   ...
   // Each NUL-terminated entry looks like "<mode> <sha> <stage>\t<path>".
   for _, entry := range strings.Split(output, "\x00") {
   	// fields are split on the tab and the spaces, so the leading three are
   	// always mode, sha, stage regardless of what the path contains.
   	fields := strings.Fields(entry)
   	if len(fields) < 3 { continue }
   	switch fields[2] {
   	case "1": base = fields[1]
   	case "2": ours = fields[1]
   	case "3": theirs = fields[1]
   	}
   }
   ```

   Note `strings.Fields` on the _whole_ entry: it works because the path is the last tab-separated field
   and cannot inject whole-token fields before `stage`. Refyard's parser equivalent (`ls-files -u -z`) can
   be stricter, but the "separate the fixed-width index fields from the path by tab, never by space"
   insight is the right one.

3. **Submodule reset is a stash-then-update sequence, not a `git clean`** (`ResetSubmodules` →
   per-submodule `stash --include-untracked` inside the submodule dir, then `submodule update --force`),
   and `Stash` deliberately swallows the error when the submodule path does not exist yet
   (`submodule.go:180-194`: "if the path does not exist then it hasn't yet been initialized so we'll
   swallow the error because the intention here is to have no dirty worktree state").

## B3. How it parses `git status`

**Porcelain v1 with `-z`, and nothing else.** An exhaustive `grep -rn "porcelain" pkg/` finds three call
sites: `file_loader.go:180` (status), `worktree_loader.go:28` (`worktree list --porcelain`) and a comment.
There is **no porcelain v2 usage anywhere in the repository**.

```go
// pkg/commands/git_commands/file_loader.go:177-232
func (self *FileLoader) gitStatus(opts GitStatusOptions) ([]FileStatus, error) {
	cmdArgs := NewGitCmd("status").
		Arg(opts.UntrackedFilesArg).
		Arg("--porcelain").
		Arg("-z").
		ArgIfElse(
			opts.NoRenames,
			"--no-renames",
			fmt.Sprintf("--find-renames=%d%%", self.UserConfig().Git.RenameSimilarityThreshold),
		).
		ToArgv()

	cmdObj := self.cmd.New(cmdArgs).DontLog()
	if !opts.Background {
		// Every git command suppresses optional locks by default (see
		// OptionalLocksEnvVar). A foreground refresh is the one exception: we let
		// it take the lock so it persists git's refreshed stat-cache, which keeps
		// subsequent status calls fast. Background refreshes leave it suppressed so
		// they can't contend for index.lock.
		cmdObj.RemoveEnvVar(OptionalLocksEnvVar)
	}

	statusLines, _, err := cmdObj.RunWithOutputs()
	if err != nil {
		return []FileStatus{}, err
	}

	splitLines := strings.Split(statusLines, "\x00")
	response := []FileStatus{}

	for i := 0; i < len(splitLines); i++ {
		original := splitLines[i]

		if len(original) < 3 {
			continue
		}

		status := FileStatus{
			StatusString: original,
			Change:       original[:2],
			Path:         original[3:],
			PreviousPath: "",
		}

		if strings.HasPrefix(status.Change, "R") || strings.HasPrefix(status.Change, "C") {
			// if a line starts with 'R' (rename) or 'C' (copy) then the next line is the original file.
			status.PreviousPath = splitLines[i+1]
			status.StatusString = fmt.Sprintf("%s %s -> %s", status.Change, status.PreviousPath, status.Path)
			i++
		}

		response = append(response, status)
	}

	return response, nil
}
```

Observations:

- **`-z` NUL framing, `-u` configurable via `--untracked-files=<all|normal|no>`, rename detection explicitly
  parameterised** (`--find-renames=<N>%`, or `--no-renames` when the caller wants the rename split into a
  delete + add pair — used by `BeforeAndAfterFileForRename` to discover both halves of a rename).
- Paths are taken by **index arithmetic**, not by tokenising: `Change = original[:2]`,
  `Path = original[3:]`. It assumes exactly one space separator, which is what `-z` guarantees; unlike
  simple-git it never trims the path. The remaining weakness is that `strings.Split` on `\x00` happens on a
  **decoded Go `string`**, so a path with a byte sequence that is not valid UTF-8 survives (Go strings are
  byte sequences, not validated UTF-8), but a NUL byte inside a path cannot occur. Refyard should still
  work on bytes and unframe before decoding, but this is materially better than simple-git's
  `text.split(NULL)` + `.trim()`.
- **Renames and copies are handled identically** (`R` and `C`), with the previous path consumed from the
  next NUL token and the loop index advanced. Unmerged files need no special casing here because `XY`
  itself encodes them; there is no `X`/`Y`-specific branch in the loader at all.
- **Warnings are tolerated in-band**: `GetStatusFiles` skips any entry whose raw string begins with
  `warning` and logs it (`file_loader.go:70-74`) rather than failing the refresh. Git can emit warnings on
  stderr while still succeeding, and lazygit treats that as "no data, but not fatal".
- **Submodule knowledge is layered on afterwards, from the filesystem, not from status.** Worktree
  directories are detected by comparing absolute paths against `linkedWorktreePaths(...)` and the file is
  marked `IsWorktree` with the trailing slash stripped (`file_loader.go:91-109`). Submodule detection uses
  the parsed `.gitmodules` (`submodule.go:30-88`, a line-oriented parser for `[submodule "name"]`,
  `path =`, `url =` that recurses into nested submodules).
- **Line counts are a separate `-z` call**, not `status --porcelain=v2`:

  ```go
  // file_loader.go:167-175
  func (self *FileLoader) gitDiffNumStat() (string, error) {
  	return self.cmd.New(
  		NewGitCmd("diff").Arg("--numstat").Arg("-z").Arg("HEAD").ToArgv(),
  	).DontLog().RunWithOutput()
  }
  ```

  and the parser splits on `\x00`, then on `\t`, requiring exactly 3 fields
  (`file_loader.go:125-148`). This is worth noting as a caution: `--numstat -z` renames emit a **length-only
  field** in some forms, and a strict "3 tab fields" split silently drops entries it cannot read rather
  than corrupting them (the `continue`s). Silent-drop is at least fail-safe.

**Semantic flags, not strings**, are the model:

```go
// pkg/commands/models/file.go:145-163
// shortStatus is something like '??' or 'A '
func deriveStatusFields(shortStatus string) StatusFields {
	stagedChange := shortStatus[0:1]
	unstagedChange := shortStatus[1:2]
	tracked := !lo.Contains([]string{"??", "A ", "AM"}, shortStatus)
	hasStagedChanges := !lo.Contains([]string{" ", "U", "?"}, stagedChange)
	hasInlineMergeConflicts := lo.Contains([]string{"UU", "AA"}, shortStatus)
	hasMergeConflicts := hasInlineMergeConflicts || lo.Contains([]string{"DD", "AU", "UA", "UD", "DU"}, shortStatus)

	return StatusFields{
		HasStagedChanges:        hasStagedChanges,
		HasUnstagedChanges:      unstagedChange != " ",
		Tracked:                 tracked,
		Deleted:                 unstagedChange == "D" || stagedChange == "D",
		Added:                   unstagedChange == "A" || !tracked,
		HasMergeConflicts:       hasMergeConflicts,
		HasInlineMergeConflicts: hasInlineMergeConflicts,
		ShortStatus:             shortStatus,
	}
}
```

The distinction between **`HasMergeConflicts`** (any of `UU AA DD AU UA UD DU` — the file is an unresolved
index conflict) and **`HasInlineMergeConflicts`** (`UU`/`AA` only — the working-tree file actually contains
`<<<<<<<` markers) is the useful one: the first drives UI state, the second drives "can this be staged?"
and "is it safe to render as a conflict-resolvable file?". Refyard's status DTO should expose both.

## B4. `no changes` vs `failed`, and needs-attention states

**There is no exit-code classification.** `grep -rn "ExitError|ExitCode"` over `pkg/` finds only
`git_config/get_key.go:43` (checking whether a config key exists) and the Windows PTY wrapper. Everything
else flows through `sanitisedCommandOutput`, which turns a non-zero exit into `errors.New(<combined
output>)` and a zero exit into a plain string. The consequences:

- **"No changes" is a successful command with empty output.** `git status --porcelain -z` produces `""`;
  the loader splits it, gets one empty token, skips it (`len(original) < 3`) and returns an empty slice.
  `GetStatusFiles` then logs any error and returns whatever it parsed — a failed status yields an empty
  file list, and the _caller_ decides (the refresh helper reports the error separately from the model).
- **"Failed" is a non-nil error whose message is git's own output.** Callers do string matching only as a
  last resort, and when they do it is deliberate and narrow — e.g. submodule deletion:

  ```go
  // submodule.go:233-247
  if err := self.cmd.New(NewGitCmd("submodule").Arg("deinit", "--force", "--", submodule.Path).ToArgv()).Run(); err != nil {
     if !strings.Contains(err.Error(), "did not match any file(s) known to git") {
        return err
     }
     // … fall back to removing the section from .gitmodules and local config
  }
  ```

  This is the one place an English message is matched, it is wrapped in a comment explaining the case, and
  it falls back to a _safe_ alternative rather than guessing.

- **`IgnoreEmptyError()`** exists for the third case: a streamed command that exits non-zero with _no_
  output is treated as success (`cmd_obj_runner.go:295-297`), which is how "git printed nothing and exited
  non-zero" is not turned into a spurious error for streaming commands.

**Needs-attention states are read from files in the git directory, never from messages.**
`pkg/commands/git_commands/status.go`:

```go
// status.go:38-49
func (self *StatusCommands) IsInRebase() (bool, error) {
	exists, err := self.os.FileExists(filepath.Join(self.repoPaths.WorktreeGitDirPath(), "rebase-merge"))
	if err == nil && exists {
		return true, nil
	}
	return self.os.FileExists(filepath.Join(self.repoPaths.WorktreeGitDirPath(), "rebase-apply"))
}

// IsInMergeState states whether we are still mid-merge
func (self *StatusCommands) IsInMergeState() (bool, error) {
	return self.os.FileExists(filepath.Join(self.repoPaths.WorktreeGitDirPath(), "MERGE_HEAD"))
}

func (self *StatusCommands) IsInCherryPick() (bool, error) { ... CHERRY_PICK_HEAD ... }

func (self *StatusCommands) IsInRevert() (bool, error) {
	return self.os.FileExists(filepath.Join(self.repoPaths.WorktreeGitDirPath(), "REVERT_HEAD"))
}
```

The full set of sentinel files and directories used: `rebase-merge/`, `rebase-apply/`, `MERGE_HEAD`,
`CHERRY_PICK_HEAD`, `REVERT_HEAD`, plus `rebase-merge/head-name` (which branch is being rebased) and
`rebase-merge/stopped-sha`. Two details are worth copying:

- **`WorktreeGitDirPath()` vs `RepoGitDirPath()`** — in a linked worktree the sentinel files live in the
  _worktree's_ git dir, not the common dir. Getting this wrong makes rebase detection silently fail for
  every worktree.
- **`CHERRY_PICK_HEAD` is ambiguous during a rebase** and the code documents exactly why:

  ```go
  // status.go:56-63
  // Sometimes, CHERRY_PICK_HEAD is present during rebases even if no
  // cherry-pick is in progress. I suppose this is because rebase used to be
  // implemented as a series of cherry-picks ... The way to tell if this is the
  // case is to check for the presence of the stopped-sha file, which records the
  // sha of the last pick that was executed before the rebase stopped, and seeing
  // if the sha in that file is the same as the one in CHERRY_PICK_HEAD.
  ```

  with a prefix comparison because `CHERRY_PICK_HEAD` holds a full OID and `stopped-sha` an abbreviated one
  (`status.go:73-80`). **Abbreviated-vs-full OID comparison is a real hazard** and Refyard's rule to
  validate OIDs against the detected object format is the right answer; the generalisable lesson is that a
  sentinel file's mere existence can be ambiguous and needs a corroborating read.

**Ref state is fingerprinted, not re-derived.** `RefsSnapshot()` concatenates
`git for-each-ref --format=%(objectname) %(refname) refs/heads` with a HEAD fingerprint and compares
snapshots byte-for-byte to decide whether anything moved (used by the background poller). The HEAD
fingerprint reads `.git/HEAD` directly for speed, but **detects the reftable backend** and falls back to
`symbolic-ref`/`rev-parse` when it sees the stub:

```go
// status.go:123-137
headPath := filepath.Join(self.repoPaths.WorktreeGitDirPath(), "HEAD")
if content, err := afero.ReadFile(self.Fs, headPath); err == nil {
	head := strings.TrimSpace(string(content))
	if head != "" && head != "ref: refs/heads/.invalid" {
		return head, nil
	}
}

// symbolic-ref gives the branch when HEAD is attached and fails when it's
// detached, in which case rev-parse gives the commit HEAD points at.
```

Two lessons: a cheap filesystem read is acceptable **only** with a documented detection of the backend that
breaks it, and comparing a whole-repo fingerprint is a legitimate way to answer "did anything change?"
without parsing every ref.

**Finally, conflicts are detected in file content, not just status.** `HasInlineMergeConflicts` (from `UU`/`AA`)
gates opening the merge-conflict view, and the view itself re-reads the file and asks whether it has
conflict markers before rendering them as resolvable (`merge_conflicts_helper.go:20-40`,
`ctx.GetState().NoConflicts()`). So even with an authoritative porcelain classification, lazygit
**re-verifies against the content** before offering conflict resolution — the same instinct as Refyard's
preview-token rule that "`git status` markers alone are not proof of unchanged content".

## B5. The integration test harness

Read `pkg/integration/README.md` first; it is the contract. Summary of the architecture:

```
pkg/integration/
  README.md                  the contract: what a test is, how to run, tips
  types/types.go             IntegrationTest and GuiDriver interfaces
  components/
    test.go                  IntegrationTest struct + NewIntegrationTest(args); git-version gates; INPUT_DELAY
    runner.go                RunTests(): builds the binary, per-test dir, launches the child, retries
    paths.go                 directory layout inside test/_results/<test name>
    shell.go                 the repo fixture DSL (all setup is shell/git commands)
    env.go                   the environment allowlist (isolation)
    test_driver.go           key/mouse driving + Wait
    view_driver.go           view assertions (Lines/TopLines/ContainsLines/SelectedLine/Title/Content)
    text_matcher.go          Contains / Equals / Matches / matchers with .IsSelected()
    git.go                   assertions about repository state by running git
    popup.go, menu_driver.go, prompt_driver.go, confirmation_driver.go, alert_driver.go
    assertion_helper.go      fail() → gui.Fail()
  tests/<area>/<name>.go     one file per test, one area per directory
  tests/test_list.go         auto-generated registry
  clients/{cli.go,tui.go,go_test.go}
  clients/injector/main.go   the binary that runs exactly one test and exits non-zero on failure
  tests/demo/                tests reused as documentation recordings
```

**Anatomy of a test** — the whole test is a declarative value:

```go
// pkg/integration/components/test.go:26-42
type IntegrationTest struct {
	name         string
	description  string
	extraCmdArgs []string
	extraEnvVars map[string]string
	skip         bool
	setupRepo    func(shell *Shell)
	setupConfig  func(config *config.AppConfig)
	run          func(
		testDriver *TestDriver,
		keys config.KeybindingConfig,
	)
	gitVersion GitVersionRestriction
	width      int
	height     int
	isDemo     bool
}
```

Three parts, in order, and each has a clear owner:

1. **`setupRepo func(shell *Shell)`** — the fixture, built entirely from real git commands in the temp repo.
2. **`setupConfig func(config *config.AppConfig)`** — config mutations (e.g. `ShowFileTree = false`).
3. **`run func(t *TestDriver, keys …)`** — a script of user actions plus assertions, using _symbolic_ key
   names from the app's own keybinding config, so a rebinding or a default change does not silently
   invalidate tests.

**Deterministic repository fixtures** come from the `Shell` DSL (`components/shell.go`), which is a fluent
wrapper over `exec.Command` with a fixed `Dir` and a fixed `Env`. A representative fixture:

```go
// pkg/integration/tests/submodule/stage.go:15-27
SetupRepo: func(shell *Shell) {
	shell.EmptyCommit("first commit")
	shell.CloneIntoSubmodule("my_submodule_name", "my_submodule_path")
	shell.GitAddAll()
	shell.Commit("add submodule")

	// Give the submodule a new commit, which is a change that the parent
	// repo can stage, as well as some dirty working-tree content, which
	// the parent repo can never stage. This is what gets us a "MM" status
	// once the new commit is staged.
	shell.RunCommand([]string{"git", "-C", "my_submodule_path", "commit", "--allow-empty", "-m", "submodule commit"})
	shell.CreateFile("my_submodule_path/dirty_file", "dirty content")
},
```

Determinism devices visible in the DSL, all of which Refyard needs for its own fixtures:

- `Init()` is `git -c init.defaultBranch=master init` — the initial branch is pinned, never inherited.
- `EmptyCommitDaysAgo`, `EmptyCommitWithDate` set `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` explicitly.
- `SetAuthor` uses `git config --local user.name/user.email`, so identity is per-repo, never global.
- `NewBranch`, `Checkout`, `Merge("--commit --no-ff")`, `Stash`, `AddWorktree`, `CloneIntoRemote` (a bare
  clone into `../<name>` used as a local "remote"), `CloneIntoSubmodule`, `StartBisect`, `SetConfig`
  (`git config --local`) — the DSL covers the state space that would otherwise be ad-hoc shell.
- `RunShellCommand` exists but is used sparingly; `RunCommand([]string{...})` (argv, no shell) is the norm.
- `CopyHelpFile` copies fixtures from the repo's `test/files/` directory into the test repo with permissions
  preserved — that is how pre-commit hooks and other executables get into a fixture.

**Isolation is an allowlist, and it is the part Refyard should copy most literally:**

```go
// pkg/integration/components/env.go:34-69
// Tests will inherit these environment variables from the host environment, rather
// than the test runner deciding the values itself.
// All other environment variables present in the host environment will be ignored.
// Having such a minimal list ensures that lazygit behaves the same across different test environments.
var hostEnvironmentAllowlist = [...]string{
	PATH,
	TERM,
}

func allowedHostEnvironment() []string {
	env := []string{}
	for _, envVar := range hostEnvironmentAllowlist {
		env = append(env, fmt.Sprintf("%s=%s", envVar, os.Getenv(envVar)))
	}
	return env
}

func NewTestEnvironment(rootDir string) []string {
	env := allowedHostEnvironment()

	// Set $HOME to control the global git config location for git
	// versions <= 2.31.8
	env = append(env, fmt.Sprintf("%s=%s", HOME, testPath(rootDir)))

	// $GIT_CONFIG_GLOBAL controls global git config location for git
	// versions >= 2.32.0
	env = append(env, fmt.Sprintf("%s=%s", GIT_CONFIG_GLOBAL_ENV_VAR, globalGitConfigPath(rootDir)))

	// Disable gh telemetry. It was enabled by default in gh 2.91.0, and
	// this would cause gh config files to be left in the working tree
	// (e.g. `test/.local/state/gh/device-id`).
	env = append(env, "GH_TELEMETRY=disabled")

	return env
}
```

Two variables survive from the host (`PATH`, `TERM`); **`HOME` is redirected** and `GIT_CONFIG_GLOBAL`
points at `test/global_git_config` — with `HOME` kept specifically because git ≤ 2.31 ignores
`GIT_CONFIG_GLOBAL`. Every one of the three asserts an exact directory, so a test cannot read or write the
developer's real `~/.gitconfig`. Refyard's `tests/support/repo.ts` should assert the same three
(`HOME`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`) rather than only setting them — lazygit also sets
`GIT_CONFIG_SYSTEM`? No: it does not; it sets `HOME` and `GIT_CONFIG_GLOBAL` only. Refyard's rule already
requires pointing `GIT_CONFIG_SYSTEM` at a scratch file too, which covers system config that lazygit leaves
ambient — a necessary addition, not a criticism.

The same filtered environment is used for **both** the fixture shell and the process under test
(`runner.go:154-166` for setup, `runner.go:219` `NewWithEnviron(cmdArgs, NewTestEnvironment(rootDir))` for
the app), which is what makes "the repo the fixture built" and "the repo the app sees" the same repo.

**Per-test directory layout** (`components/paths.go`):

```go
// when a test first runs, it's situated in a repo called 'repo' within this
// directory. In its setup step, the test is allowed to create other repos
// alongside the 'repo' repo in this directory, for example, creating remotes
// or repos to add as submodules.
func (self Paths) Actual() string     { return filepath.Join(self.root, "actual") }
func (self Paths) ActualRepo() string { return filepath.Join(self.Actual(), "repo") }
func (self Paths) Config() string     { return filepath.Join(self.root, "used_config") }
```

so `test/_results/<test name>/actual/repo` is the repo under test, siblings under `actual/` are remotes and
submodule origins, and `used_config/` is a copy of `test/default_test_config` (a template config
directory) rather than a generated one. **The result tree is left on disk for post-mortem inspection** —
`README.md:54`: "The resultant repo will be stored in `test/_results`, so if you're not sure what went
wrong you can go there and inspect the repo."

**Running** (`components/runner.go`): `RunTests` builds the app once into a temp path
(`/tmp/lazygit/test_lazygit`, optionally `-race`, `-gcflags=all=-N -l` for debugging, `-cover`), gets the
git version once (tests can be gated on it), then per test:

```go
// runner.go:50-70 (abridged)
for _, test := range args.Tests {
	args.TestWrapper(test, func() error {
		paths := NewPaths(filepath.Join(testDir, test.Name()))

		for i := range args.MaxAttempts {
			err := runTest(test, args, paths, projectRootDir, gitVersion)
			if err != nil {
				if i == args.MaxAttempts-1 {
					return err
				}
				args.Logf("retrying test %s", test.Name())
			} else {
				break
			}
		}
		return nil
	})
}
```

Note **bounded automatic retries of the whole test** (`MaxAttempts`) — a pragmatic acknowledgement that
these tests touch a real filesystem, and crucially each retry re-runs `prepareTestDir`, which
`deleteAndRecreateEmptyDir`s the test directory. That is the safe form of retry: it never retries a single
command inside a possibly-dirty repo.

**How assertions work.** Two entirely different kinds, deliberately:

1. **UI assertions** through the view driver, which reads the rendered view buffer, never an internal model:

   ```go
   // components/view_driver.go:61-70
   // asserts that the view has lines matching the given matchers. One matcher must be passed for each line.
   // If you only care about the top n lines, use the TopLines method instead.
   // If you only care about a subset of lines, use the ContainsLines method.
   func (self *ViewDriver) Lines(matchers ...*TextMatcher) *ViewDriver {
      self.validateMatchersPassed(matchers)
      self.LineCount(EqualsInt(len(matchers)))
      return self.assertLines(0, matchers...)
   }
   ```

   with `Contains`/`Equals`/`Matches` matchers and an `.IsSelected()` modifier, so an assertion reads like
   the screen:

   ```go
   // pkg/integration/tests/submodule/stage.go:29-38
   t.Views().Files().Focus().
      Lines(
         Equals(" M my_submodule_path (submodule)").IsSelected(),
      ).
      // Staging the submodule stages the new commit, but the dirty
      // content remains unstaged, leaving us at "MM".
      PressPrimaryAction().
      Lines(
         Equals("MM my_submodule_path (submodule)").IsSelected(),
      ).
   ```

   `Lines` asserts the _complete_ list including count, so a test cannot pass while an unexpected extra row
   appears — a deliberate anti-weak-assertion choice. `TopLines`/`ContainsLines` are the opt-outs.

2. **Repository-state assertions** by re-running git and comparing stdout:

   ```go
   // components/git.go:16-49
   func (self *Git) CurrentBranchName(expectedName string) *Git {
      return self.assert([]string{"git", "rev-parse", "--abbrev-ref", "HEAD"}, expectedName)
   }

   func (self *Git) assert(cmdArgs []string, expected string) *Git {
      self.expect(cmdArgs, func(output string) (bool, string) {
         return output == expected, fmt.Sprintf("Expected current branch name to be '%s', but got '%s'", expected, output)
      })
      return self
   }

   func (self *Git) expect(cmdArgs []string, condition func(string) (bool, string)) *Git {
      self.assertWithRetries(func() (bool, string) {
         output, err := self.shell.runCommandWithOutput(cmdArgs)
         …
         actual := strings.TrimSpace(output)
         return condition(actual)
      })
      return self
   }
   ```

   This is the exact shape of "assert on resulting repo state" that Refyard wants: run the **same system git
   binary** against the fixture repo after the operation and assert on its stdout. `TrimSpace` on both
   sides, and a predicate form for cases where equality is wrong (e.g. `RemoteTagDeleted` asserts
   `len(output) == 0` with a message).

**Busy-state synchronisation** is handled by the app, not by sleeps: the test framework only proceeds once
no foreground task is busy (the `gocui.Task` machinery in B1). `assertWithRetries` still exists but its
comment records that it is no longer needed: "We no longer assert with retries now that lazygit tells us
when it's no longer busy. But I'm keeping the function in case we want to re-introduce it later." For
Refyard the analogue is an authenticated SSE `idle`/`journal` signal rather than a polling helper.

**A `shell` handle is available _during_ the run step** (`test.go:179-201` constructs `NewShell(pwd, …)`
and hands it to `NewTestDriver`), so a test can create an external change mid-session to prove the app
notices it — e.g. editing a file from another process while the workbench is open. That is the single most
valuable capability for testing a Git workbench, and it should be an explicit part of Refyard's harness
design.

**Modes.** `just e2e` (headless, what CI runs), `just e2e <name>` (one test), `just e2e-cli [--slow] <name>`
(visible UI, `INPUT_DELAY` ms between keypresses), `just e2e-tui` (browse and run), `--sandbox` (run the
setup, then hand the driver to the human), `--debug` (wait for a debugger; combined with
`-gcflags=all=-N -l`). A test can be `Skip`-ped and can declare `Width`/`Height` to force headless
dimensions. Test names are derived from file paths (`testNameFromCurrentFilePath` →
`TestNameFromFilePath`), with a `unitTestDescription` sentinel (`"test test"`) so the same value can be
constructed from a Go unit test without a real file path — a small trick worth copying for Refyard if any
harness object is ever built outside the runner.

---

# Lessons Refyard will apply

## Environment hygiene (host-node process adapter)

1. **Build the child environment from an allowlist, never by inheriting `process.env`.** Two host variables
   are candidates (`PATH` — and for us nothing else; lazygit keeps `TERM` only because it is a TUI).
   simple-git passes the entire `process.env` by default and only _blocks_ a fixed set of names; that is
   strictly weaker than an allowlist and is the single largest gap in its model.
2. **Set `GIT_TERMINAL_PROMPT=0` on every invocation** and never inherit it. Neither project does this.
   Without it a `fetch`/`clone`/`push` whose credentials are missing blocks on a prompt; with it, git fails
   fast and we report a clean error. Refyard has no terminal, so a blocked prompt is a hang, not a UI state.
3. **Clear, do not merely block**: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
   `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE`, `GIT_CEILING_DIRECTORIES`,
   `GIT_DISCOVERY_ACROSS_FILESYSTEM`. `-C <repo>` plus `cwd` is how we select a repository; an inherited
   `GIT_DIR` silently retargets it. Set them to `undefined` in the spawn env rather than deleting keys from
   `process.env` (never mutate `process.env`).
4. **Pin the config surface**: `HOME` (or the platform equivalent) to a service-private directory,
   `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` to service-private files, `GIT_CONFIG_NOSYSTEM` as defence
   in depth, and `GIT_ATTR_NOSYSTEM=1` so no system attributes can introduce a filter driver.
5. **Pin the locale on any command whose output is read**: `LC_ALL=C`, `LANG=C`, `LC_MESSAGES=C`, so error
   and status text is stable. This is a _test/observability_ measure, not permission to parse English — our
   parsers use porcelain/`-z` formats. lazygit does this only for credential-prompt commands
   (`cmd_obj_runner.go:352-353`); doing it everywhere is cheaper and removes a whole class of flakiness.
6. **`GIT_OPTIONAL_LOCKS=0` by default, opted out per command, exactly as lazygit does it**
   (`git_cmd_obj_builder.go:22,39` + `file_loader.go:189-197`). This is the single best operational idea in
   this document: it makes background reads contention-free with the user's own terminal, at the cost of a
   stat-cache write, and one foreground command opts back in. Model it as one classification on the job
   ("foreground refresh" vs "background read"), and derive the env var from that.
7. **Never set `EDITOR`/`GIT_EDITOR`/`GIT_SEQUENCE_EDITOR`, `core.editor`, `sequence.editor`,
   `core.askPass`, `core.sshCommand`, `credential.helper`, `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_SSH*`,
   `GIT_PROXY_COMMAND`, `GIT_EXTERNAL_DIFF`, `GIT_TEMPLATE_DIR`, `GIT_EXEC_PATH`, `PREFIX`, or the
   `GIT_CONFIG_COUNT` family.** These are the exact variables simple-git blocks; we can be simpler and
   _never accept them as input_, which removes the need for an opt-in flag matrix. Commits are made with
   `-F -`/`-m` and `-c` only for values we generate; never `--no-verify`, never `commit.gpgSign=false`.
8. **`git -c` values must be a closed set generated by core planners**, and the planner must reject any key
   outside that set — not "warn", reject. simple-git's 22 `allowUnsafe*` booleans are the wrong shape for
   Refyard: we do not want a supported way to enable `credential.helper` from a browser request.

## Unsafe-action blocking (core planners + host guard)

9. **Block on parsed structure, with keys lowercased and driver segments widened.** Take
   `detect-vulnerable-config-writes.ts` as the pattern: `\s*` prefix to survive
   `builtin.`/vendor-prefixed keys, and `credential(\..+)?.helper` so `credential.<url>.helper` cannot slip
   through. String `.includes()` scanning is what gets this wrong.
10. **Enumerate the whole env family, not exact names**: `GIT_SSH` _and_ `GIT_SSH_COMMAND`, `GIT_PAGER` _and_
    `PAGER`, `EDITOR` _and_ `GIT_EDITOR` _and_ `GIT_SEQUENCE_EDITOR`. Also treat any unknown `GIT_*` as
    hostile by default (deny-by-prefix), which neither project does.
11. **Cover the injection forms that bypass the obvious path**: `GIT_CONFIG_COUNT` +
    `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` (parsed by simple-git — `parse-env.ts:31-41`), `--upload-pack=…`
    _and_ its short form in any clustered spelling (`clone -4u`, `-vu`, `-qu` — CVE-2022-25860, guarded by
    the deliberately fuzzy `/^-\w*u/` and proved by a test matrix), `push --exec`, `--template`, and
    inline `-c` appearing **before or after** the subcommand (simple-git tests both positions explicitly,
    `plugin.unsafe.spec.ts:175-189`).
12. **Guard the repository as well as the request.** Neither project protects against a hostile checked-out
    repo: `core.hooksPath` in `.git/config`, `submodule.<name>.update = !cmd` in `.git/config`,
    `filter.<driver>.clean` reachable from a _committed_ `.gitattributes`, `core.fsmonitor` in the repo
    config. Refyard's scope boundary should additionally decide, per repository, whether hooks/filters are
    trusted, and record the decision in the journal. Blocking argv/env is necessary and not sufficient.
13. **Test the exploit before the block.** The strongest pattern in this entire research note is
    `plugin.unsafe.spec.ts:96-154`: for every spelling of `clone -u`, assert that the payload _does_ create
    `pwn/touched` when `allowUnsafePack` is on, and that it does _not_ when the guards are active. Refyard's
    security tests should prove each guard is load-bearing, and assert on the **absence of the side
    effect**, not on the shape of the rejection.

## Command/planner shape (git-core)

14. **Planners return argv values that unit tests assert on directly.** `GitCommandBuilder.ToArgv()` plus a
    mock that records spawns is exactly the `packages/git-core` planner test that Refyard needs: assert the
    argv for `getStatus`, `discardTrackedPaths`, `removeWorktree`, without spawning anything.
15. **Global options are prepended by construction, never concatenated by callers** (`Config`/`Dir`/
    `GitDir`/`Worktree` all `append([]string{...}, args...)`). Make the planner API incapable of emitting
    `git <sub> -C <dir>`, and incapable of emitting a path-taking command without a trailing `--`.
16. **Path-taking argv always ends `-- <paths...>`** (both projects do this consistently). Paths are never
    interpolated into a shell string; Refyard additionally refuses paths that cannot be represented as
    bytes, per the discard rule.
17. **Batch long path lists against a byte budget** (`runGitCmdOnPaths`, 30 KB threshold). Our bulk
    discard/stage planners should split rather than rely on the OS argv limit, and the split must be
    all-paths-pre-checked-before-any-write, per the bulk-action rule.
18. **Renames need both paths** for unstage and for diff. `UnStageFile(paths []string, tracked bool)` exists
    precisely because a rename is two paths; `ShowFileDiff(..., previousPath, ...)` passes both so git can
    detect the rename. Model a renamed entry as `{ path, previousPath }` everywhere, never as a single
    string.
19. **Unstaging an added-but-uncommitted path is `rm --cached --force --`, not `reset HEAD --`.** This is a
    real correctness detail from `working_tree.go:79-85`.
20. **Resolve submodule conflicts inside the submodule** (`git -C <sub> checkout <oid>` then stage the
    gitlink) — `git checkout --ours/--theirs` is a no-op on gitlinks. Read the three stages with
    `git ls-files -u -z -- <path>` and never assume all three exist.
21. **Detect "cannot be staged" before running the command**: `git submodule status -- <paths>` with a `+`
    prefix means the gitlink moved; a dirty-only submodule is not stageable from the parent, and the
    operation should be refused with a typed reason rather than attempted.

## Parser shapes

22. **Porcelain v1 `-z` is the proven baseline; v2 is not required.** lazygit has zero porcelain-v2 usage in
    a mature, git-version-diverse codebase, and its v1 handling of renames (`R`/`C` consumes the next NUL
    token) and of unmerged `XY` codes is complete. If Refyard adopts v2 for submodule/OID richness, keep the
    framing discipline identical and treat v2 as an addition, not a replacement, since v1 `-z` is what older
    gits implement most consistently.
23. **Unframe before decoding; parse by index arithmetic on the byte slice.** Both parsers split on NUL
    _after_ decoding to a string (simple-git utf8, lazygit a Go string). Refyard's rule (bytes → unframe by
    format → decode each field) is stricter and should be enforced by a fixture containing a path with
    invalid-UTF-8 bytes and a leading space, which would break both reference implementations.
24. **Model status as semantic booleans, and separate the two conflict notions**:
    `hasMergeConflicts` (`UU AA DD AU UA UD DU`) vs `hasInlineMergeConflicts` (`UU AA`) vs
    `hasStagedChanges`/`hasUnstagedChanges`/`tracked`/`added`/`deleted`, derived in **one** function from
    `XY` (`models/file.go:145-163`). Do not scatter `shortStatus == "UU"` checks through the UI.
25. **Tolerate in-band warnings**: skip and log a status entry whose raw bytes begin with `warning` instead
    of failing the parse (`file_loader.go:70-74`). Corollary: never let a parse failure present as "no
    changes" — the loader returns `[]` with an error, and the caller must distinguish the two.
26. **Never parse English.** Errors carry git's raw output for humans; control flow uses exit status, sentinel
    files, and porcelain formats. Where a message must be matched (lazygit's one case,
    `submodule.go:237`), it is a narrow `Contains` with a comment, and the fallback is a safe alternative.
27. **Sentinel-file state detection, with the common-dir/worktree-gitdir distinction**:
    `rebase-merge/`, `rebase-apply/`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`; read them from the
    **worktree's** git dir. Handle the `CHERRY_PICK_HEAD`-during-rebase ambiguity by corroborating with
    `rebase-merge/stopped-sha`, and compare OIDs by prefix only after validating them against the detected
    object format (lazygit compares a full OID against an abbreviated one with `HasPrefix`; Refyard's
    object-format rule implies resolving to a full OID where possible).
28. **Do not read `.git/HEAD` naively**: detect the reftable backend (whose `HEAD` is a fixed stub
    `ref: refs/heads/.invalid`) and fall back to `symbolic-ref` then `rev-parse` (`status.go:123-145`).
29. **Prefer a whole-repo fingerprint over enumerating refs** when the question is "did anything change?":
    `git for-each-ref --format=%(objectname) %(refname) refs/heads` + a HEAD marker, compared byte-for-byte
    (`status.go:90-109`). Cheap, and it catches reattach-on-rebase which a commit hash alone misses.

## Process control (host-node)

30. **Kill the process group, not the child, and escalate.** simple-git sends one `SIGINT` to the direct child
    and gives up (`git-executor-chain.ts:239-246`); lazygit closes a pipe and relies on EOF — neither
    survives a git that has spawned `ssh`/`git-remote-https`. Spawn with `detached: true`, kill `-pid`,
    escalate `SIGTERM` → `SIGKILL` after a bounded grace period, and record in the journal that the outcome
    of a cancelled mutation is **unknown** (never `succeeded`, never auto-retried).
31. **A timeout must be an inactivity timeout, not only a wall-clock deadline.** simple-git's
    `timeoutPlugin` re-arms on every stdout/stderr chunk, which is the right primary signal for a Git
    command that legitimately produces progress output; combine it with an absolute ceiling, which simple-git
    lacks. On timeout, the same unknown-outcome rule applies.
32. **Serialise per resource with an explicit handle, not by convention.** lazygit attaches a mutex to the
    command (`CmdObj.WithMutex`) and every runner entry point honours it. Refyard's single-writer rule for a
    common Git dir should be the same shape: a mutex keyed by common dir, acquired by the queue, with
    `GIT_OPTIONAL_LOCKS=0` as the complementary measure for reads. Extend the mutex to _linked worktrees_,
    which share the common dir — the place lazygit's per-command lock model is at its weakest.
33. **Do not inherit "the exit code is the contract".** Both projects build errors out of output. Our DTOs
    must carry `{ exitCode, stdout(bytes), stderr(bytes), outcome: succeeded|failed|unknown }` and never
    let a null parser result imply success.

## Integration-test harness design (what to emulate)

34. **A test is a declarative value with three parts**: `{ setupRepo(fixture), setupConfig(overrides),
run(script) }` (`components/test.go:26-42`). Refyard's `tests/integration/` should have one file per
    workflow with those three exported pieces and a registry, not a 400-line imperative `it()`.
35. **A fluent repository-fixture DSL over the real git binary** (`components/shell.go`), with the
    determinism devices built in: pinned initial branch (`-c init.defaultBranch=`), per-repo
    `user.name`/`user.email`, explicit `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, and helpers for the state that
    is tedious to produce (local bare "remotes", submodules, worktrees, a merge in progress, N commits).
    Everything is argv, not shell strings, and every helper fails the test on unexpected non-zero exit.
36. **A filtered child environment for both the fixture and the process under test** — allowlist (`PATH`),
    `HOME` redirected into the test directory, `GIT_CONFIG_GLOBAL` pointing at a per-run scratch file, and
    (added for Refyard) `GIT_CONFIG_SYSTEM` and `GIT_CONFIG_NOSYSTEM=1`. Assert the three paths, don't just
    set them. This is the same discipline as lazygit's `NewTestEnvironment` and is stronger than
    simple-git's temp-dir-only context, which runs against the developer's global config.
37. **A per-test directory with a documented layout** (`root/actual/repo` + sibling repos + `used_config`),
    recreated empty before every attempt, and **left on disk after failure** for post-mortem. Report the
    path in the failure message.
38. **Assert on resulting repository state by re-running the same system git** and comparing stdout, with a
    trimmed comparison and a predicate escape hatch (`components/git.go`). Examples to write first:
    `HEAD` subject, `status --porcelain -z` byte-for-byte, `stash list`, `worktree list --porcelain`,
    `ls-files -u` for conflicts.
39. **Assert on the rendered view with complete-list semantics.** `Lines(...)` asserts count _and_ content so
    a stray row fails the test; `TopLines`/`ContainsLines` are explicit opt-outs. The UI analogue for
    Refyard is asserting the full serialised status DTO (or the full DOM list) rather than "contains one
    row".
40. **Two assertion families, never mixed**: screen state and repository state. Keep them in separate
    helpers so it is obvious which one a failing test exercised.
41. **Synchronise on an explicit idle signal from the app, not on sleeps or polling helpers.** lazygit
    retired `assertWithRetries` in favour of the app reporting when it is not busy
    (`assertion_helper.go:18-25`). Refyard's authenticated SSE journal gives us the same thing for free; the
    harness should wait on `journal → idle`, and any wait should have a bounded timeout that fails loudly.
42. **Hand the fixture shell to the test driver so a test can mutate the repo out-of-band mid-session**
    (`test.go:179-201`). This is how we prove the workbench notices external changes — a first-class
    requirement for Refyard and something simple-git's harness cannot express at all.
43. **Gate on capabilities, not version strings**: lazygit gates tests on the parsed git version
    (`GitVersionRestriction` with `AtLeast`/`Before`/`Includes`, `test.go:71-117`) and records
    skip-because-unsupported rather than failing. Refyard should extend this to the detected _object format_
    (SHA-1 vs SHA-256) and to `capabilities`, so an unimplemented operation is never reported as supported
    and never faked with a `202`.
44. **Retry the whole test with a fresh fixture, never an individual command** (`runner.go:56-66`). Bounded,
    reported in the log, and safe because `prepareTestDir` deletes and recreates the directory.
45. **Raw git output is a first-class artifact of a failure.** lazygit's command-log panel and
    `DontLog()`/`ShouldLog()` distinction (`cmd_obj.go:118-133` — log mutations, do not log reads) is the
    same information Refyard's journal needs: the browser should be able to show exactly which argv ran and
    what came back, for reads and writes, without a debug build.

## Parser/test fixtures

46. **Typed fixture factories that emit exact byte framing** (`__fixtures__/create-fixture.ts`,
    `__fixtures__/responses/status.ts`: `stagedRenamed(from, to, workingDir)` → `R<wd> <to>\0<from>`).
    Refyard fixtures should be factories that produce `Uint8Array`, including hostile cases: rename pairs,
    a path with a leading space, a path with invalid UTF-8 bytes, a path with a newline, `DD`/`AU`/`UA`
    unmerged states, a submodule gitlink, and an empty repo with `## No commits yet on main`.
47. **A `child_process`/`Bun.spawn`-style recorder for planner tests** driven by explicit event emission
    (`closeWithSuccess`, `closeWithError`, `writeToStdOut`, `writeToStdErr`, `$allCommands()`,
    `assertExecutedCommands(...)`), so success/failure/timeout paths are exercised without a real process
    and argv assertions are cheap (`__mocks__/mock-child-process.ts`).
48. **Partial-match assertions for large DTOs** (`like({...})` in the integration tests,
    `expect(actual).toEqual(like({...}))`) so a test states the fields it cares about and is not broken by
    unrelated additions.

## Not applicable

The following were observed and deliberately **not** carried over, with the reason.

- **`--no-verify` on any command.** lazygit uses it (`stash.go:112-118`,
  `commit --no-verify -m "[lazygit] stashing unstaged changes"`). Refyard's rules forbid it: user hooks are
  preserved. The workflow that needed it (stash only unstaged changes on git < 2.35) is out of scope until
  proven necessary, and `stash push --staged` on a modern git makes it unnecessary.
- **`git clean`.** lazygit's `RemoveUntrackedFiles` → `git clean -fd` and `ResetAndClean` → submodule reset
  - `reset --hard` + `clean -fd`. Refyard's discard never touches untracked or ignored files and never runs
    `git clean`.
- **PTY allocation, credential prompting, and English prompt-scanning.** `UsePty`, the `PROMPT`/`FAIL`
  credential strategies, and the eight regexes matching `Password:`/`Enter passphrase for key '…':`
  (`cmd_obj_runner.go:410-452`) exist because lazygit is an interactive terminal app with no other way to
  ask for a password. Refyard has a browser and a loopback API; credentials belong to the machine's own git
  and SSH configuration, and `GIT_TERMINAL_PROMPT=0` converts a would-be prompt into a clean failure.
  Disabling host-key verification, as the PTY path implies, is explicitly forbidden.
- **Streaming command output into a UI panel, progress bars, PTY resizing, mouse handling, view-buffer
  matchers, keybinding symbolic names, i18n string tables, theme/layout code, the `gocui` Task manager as
  a _UI_ concept, and the whole `pkg/integration/components/*_driver.go` set** (popup/menu/prompt/
  confirmation/alert/search drivers, `click(x, y)`, `INPUT_DELAY`, demo recordings, `just e2e-tui`,
  sandbox mode, waiting for a debugger). All of this is TUI-specific. The _transferable_ parts are the idle
  signal (our SSE journal), the "complete list" assertion semantics (our status DTO), and the two-family
  assertion split.
- **`os.Chdir` as the repository selector.** lazygit chdirs into the worktree once
  (`git.go:70-73`) and relies on process-global state, then uses relative paths like
  `../../../../../files/`. Refyard's port is scope-bound: `cwd` is a parameter of the spawn call, never
  process state, and no relative-path constants.
- **Config-directory templating and a per-test config directory** (`test/default_test_config` copied to
  `used_config`, `--use-config-dir=`) — a TUI application-config concept. Refyard's equivalent is a
  service-private git config file, which is covered in the environment rules above.
- **Reading `.gitmodules` with a hand-rolled `[submodule "name"]` line parser**
  (`submodule.go:30-88`). It is a reasonable TUI shortcut but Refyard should prefer
  `git config --file .gitmodules --get-regexp` or an existing planner, and must handle quoted/escaped
  values that the regex approach mishandles.
- **`strings.Fields` on index entries** (`submodule.go:129`) works because of a tab-delimited layout, but
  Refyard parses `ls-files -u -z` by unframing NUL and splitting only on the tab, keeping the path as raw
  bytes.
- **Small defects that should not be imitated.** `Scheduler`'s constructor default `concurrency = 2` is
  dead on every real path, because `git.js` always passes `maxConcurrentProcesses`; a reader can easily
  conclude the limit is 2. The `spawn.before` plugin hook fires **twice** per spawn — once via
  `_beforeSpawn(task, args)` at `git-executor-chain.ts:193` and once as a direct
  `this._plugins.exec('spawn.before', ...)` at `:203` — and `_beforeSpawn` reads a different `kill`
  callback than the inline call, so which rejection wins depends on ordering; a plugin author cannot rely
  on the hook running once. `spawnOptionsPlugin` narrows user input to `uid`/`gid` and leaves them
  effectively untested. `suffixPathsPlugin` is registered unconditionally in `gitInstanceFactory` with no
  configuration switch even though it rewrites the argv of every task. None of these are patterns; they are
  debt that a smaller, explicitly-specified port should not reproduce.
