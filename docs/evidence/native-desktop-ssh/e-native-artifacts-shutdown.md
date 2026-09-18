# Deliverable E — artifacts, budgets, and shutdown (D13)

D12 built the native HTTP entry. This task proves the _release artifacts_ are what they
claim: no JavaScript runtime anywhere in the bundle, system links only, within the size
budgets, fast enough to feel instant, and honest about what a killed or gracefully
stopped process leaves behind.

## 1. Artifact scan (`pnpm native:verify`)

`scripts/verify-native-artifacts.ts` walks the built `.app` and the release CLI. Mach-O
files are found by magic (not by extension), linked libraries are read with `otool -L`,
and the embedded frontend is scanned for engine markers (`V8_Fatal`, `Bun.build`,
`deno_core`, …). Svelte frontend JS inside the executable is expected — the scanner
looks for a _runtime_, not for scripts.

Measured 2026-09-18, this worktree:

```
app:  apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app
      13,254,656 bytes installed (12.6 MiB, budget ≤ 30 MiB)
      executable 12,869,856 bytes · 1 Mach-O · links system frameworks only
      compressed (ditto -c -k zip, not a signed distribution artifact):
        3,585,815 bytes · sha256 8351b33ffa39a65d61597f1fed7eeb5490a0dc4e06e5f4f0379ba63a788dd112
cli:  target/release/refyard-native
      4,360,464 bytes (4.16 MiB, budget ≤ 20 MiB)
      sha256 27b5a6b6c462ea7bc498f9f5e5aba08738af5865a347b76aba20588b9d811fc1
      links 2 system libraries (libSystem, libiconv)
verdict: no JavaScript runtime, no backend bundle, system links only, within budget
```

The CLI hash differs from the D12 record because D13 fixed the operation-id seed (§3);
the app is unchanged by that fix.

## 2. Runtime measurements (`pnpm native:bench`)

`scripts/measure-native-runtime.ts` spawns the release CLI with a minimal `PATH` (git and
ssh symlinked into a scratch bin directory; no JavaScript runtime on it), a fixture
repository from `tests/support/repo.ts`, three times, and prints every run. The desktop
app's figure is launch-to-registered only (`lsappinfo`); window-ready latency needs UI
automation and is not scripted. Raw runs live in `docs/evidence/native-runtime.json`.

```
run 1: ready 52ms · first status 44ms · history 144ms · idle rss 4496 kB · after work 4592 kB
run 2: ready 52ms · first status 49ms · history 154ms · idle rss 4512 kB · after work 4592 kB
run 3: ready 52ms · first status 49ms · history 152ms · idle rss 4464 kB · after work 4592 kB
app:   registered 66ms after spawn
```

`after work` = RSS after dirtying the worktree and running status + unstaged diff. The
CLI has no WebView, so there is no shared-page double counting to caveat; the desktop
app's RSS is _not_ claimed here.

## 3. Killed mid-write (SIGKILL, the worst case)

`tests/native/http-shutdown.test.ts` accepts a stage against the release binary, kills
the process with SIGKILL at the moment it is journalled, restarts against the same
private state directory, and asserts:

- the operation comes back `unknown`/`needsAttention` — never silently `succeeded`;
- the repository's next write is refused (not queued, not `202`);
- acknowledgement is a person's three acts: `confirmed: false` → 400; a snapshot id the
  service never minted → 404; the fresh status snapshot with `confirmed: true` → 200,
  leaving the outcome `unknown` (never rewritten);
- only then does the next write get `202`.

The first restart exposed a real bug this task fixes: the restarted process re-minted
`op_1` and collided with the journalled record (`429 ResourceBusy`). The operation-id
counter now seeds itself from the journal (`next_operation_seed` reads the largest
`op_<base36>` suffix any durable record already uses), with unit tests
(`crates/refyard-host/src/jobs/mod.rs::seed_tests`).

## 4. Stopped gracefully (SIGTERM)

The second case in the same file: a stage that _finishes_, then a polite stop.

- the process exits `0`;
- while stopped, the port answers nothing — a fetch to the old URL is refused, a stopped
  service is not a half-serving one;
- after restart on the same state, the finished operation is still `succeeded` (graceful
  shutdown never turns finished work `unknown`), and the repository writes again with no
  acknowledgement ceremony.

Not exercised in this round, named rather than glossed: owned SSH child processes during
shutdown (the shutdown fixture is local-only), and in-flight _read_ cancellation on
close (the graceful drain answers fast enough that no read was observable mid-flight).

## 5. Missing tools are diagnostics, not white screens

Probed against the release binary with an environment containing nothing but `HOME`,
`TMPDIR` and a `PATH`:

| environment       | command                 | result                                                                                                                                            |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| no git, no ssh    | `refyard-native doctor` | exit 2; prints `git: not usable`, `ssh: not found; remote repositories are unavailable`, notes naming both                                        |
| no git, no ssh    | `refyard-native serve`  | exit 2; `refyard: git was not found on PATH`                                                                                                      |
| git only (no ssh) | `refyard-native doctor` | exit 0; git 2.50.1 usable, baseline met, all seven reads and all three operations listed, ssh refused by note — **missing ssh only disables ssh** |

Offline (machine disconnected from the network) was **not** exercised this round: it
needs the network interface cut on the machine the tests run on, which was not done.
The structural expectation — the listener binds `127.0.0.1` and local-repository reads
and writes never leave the machine — is not a measurement and is not recorded as one.

## 6. Gates run for this task (exit status)

```
cargo fmt --all -- --check                                    exit 0
cargo clippy --workspace --all-targets -- -D warnings         exit 0
cargo test --workspace                                        537 passed / 0 failed / 20 ignored
cargo test (apps/desktop/src-tauri)                           25 passed / 0 failed / 1 ignored
pnpm exec vitest run tests/native                             46 passed (4 files)
pnpm native:verify                                            verdict green (§1)
pnpm native:bench                                             measured (§2)
```
