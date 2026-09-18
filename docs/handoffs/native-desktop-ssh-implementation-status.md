# Native desktop + SSH — implementation status

Written 2026-09-18 at commit `d9f1dd1`, in the worktree
`/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh` on branch `feat/native-desktop-ssh`.
This is a handoff, not a completion notice: it says what was measured, on which machine, and
what the next executable steps are. Where something was not run, it says so instead of
implying it.

## 1. Where things are

| | |
| --- | --- |
| Worktree | `/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh` (branch `feat/native-desktop-ssh`) |
| Commits | `73a1ff0` → `88832cb` → `004539c` → `761a83c` → `93ee1e0` → `a6a3346` (D11) → `d9f1dd1` (CLI) |
| Desktop app | `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app` · executable sha256 `df903851b7143f68867e4165407ccf9ce15e7fe274f9bcce7b7cd707ec614860` · 12869856 bytes · 12.6 MiB installed · unsigned |
| Native CLI | `target/release/refyard-native` · sha256 `21c1a23aae6a82c4c6fc97458d9e9b677a0eedd0691c6e2f8563aec7dcdade03` · 4304496 bytes (with the HTTP entry; the doctor-only build was 1525712) |
| SSH fixture | `pnpm native:ssh:fixture -- start\|stop\|status`; state in `target/native-ssh-fixture/state.json`; container `refyard-native-ssh-fixture`, alias `refyard-ssh-fixture` |
| Evidence | `docs/evidence/native-desktop-ssh/{a-local-app,b-remote-repository,c-local-and-ssh-writes,ssh-config-discovery}.md` |
| Acceptance | `docs/acceptance/2026-09-18-native-desktop-ssh.md` (§9 is the incremental record) |

Measured on: macOS 26.6 arm64, git 2.50.1 (Apple Git-155), OpenSSH_10.3p1. Remote: Alpine 3.20
container, git 2.45.4, OpenSSH 9.7p1. Rust 1.98, Node v26.8.2. **No Windows or Linux run has
been made**, for the app, the CLI, or the fixture.

## 2. Deliverable status

| | Status | What that means |
| --- | --- | --- |
| **A** Local desktop | PASS | Window opens without a terminal or a backend, reads a local repository, no listener, no JS runtime in the process tree. |
| **B** Agentless SSH reads | PARTIAL | The real App reads a remote repository through the machine's own OpenSSH; credential ecosystem (1Password/agent), remote path browsing and pagination stress are not exercised. |
| **C** Local + SSH writes | PARTIAL | Stage, unstage and commit run through the window on both providers and are verified by the server's own Git. Hook failure, connection loss, crash/restart and cancel are not exercised in the app; the acknowledgement flow has no UI entry point. |
| **D** Native CLI / HTTP | PARTIAL | `refyard-native doctor`/`serve`/`open` implemented and measured: ticket→bearer pairing, exact Host/Origin, JSON 404 for unknown `/api`, repository grants, idempotent replays, the built workbench served with a hashed-inline-script CSP. SSE over the wire and a side-by-side two-boundary comparison are not exercised (acceptance 9.6/9.7). Evidence: `d-native-http-entry.md`. |

### What a person can do today with these artifacts

Open `Refyard.app`, choose `This machine` or an SSH host from the launcher, open a repository,
read history/working copy/diff, stage, unstage, commit, and watch the history update. Run
`refyard-native doctor` to see what the machine can do. Nothing else: no fetch/pull/push, no
discard, no stash, no worktree management, no HTTP API, no terminal.

### Gates actually run (this workstream)

| Command | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace` | 0 | 494 passed / 0 failed / 20 ignored |
| `cargo test` in `apps/desktop/src-tauri` | 0 | 24 passed |
| `cargo test -p refyard-native` | 0 | 9 passed |
| `cargo test -p refyard-http` | 0 | 22 unit + 10 gate passed |
| `pnpm exec vitest run tests/native` | 0 | 44 passed (release binary driven) |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | clean |
| `cargo fmt --all -- --check` | 0 | clean |
| `cargo test -p refyard-host --test ssh_exec -- --ignored` (fixture up) | 0 | 14 passed |
| `pnpm desktop:build` | 0 | `Refyard.app`, 12.6 MiB installed |
| `cargo build -p refyard-native --release` | 0 | 1525712 bytes |
| `pnpm check` / `test:unit` / `test:integration` / `check:boundaries` / `check:contract` | 0 | 428 unit, 418 integration, 500 schema refs resolved — measured before D11, which changed no TypeScript |
| `pnpm exec playwright test --project=chromium` | 0 | 56 passed — measured before D11 |

## 3. Remaining executable steps

### 3.1 D12 — the native HTTP entry (the largest gap)

`serve` (API only) and `open` (API plus the static UI) in `crates/refyard-http`, wired from
`crates/refyard-cli/src/{serve,open}.rs`. Both commands currently refuse; the crate does not
exist.

The route surface is already enumerated by the browser client
(`packages/git-client/src/client.ts`, `mutations.ts`, `events.ts`) and must be replicated
exactly, because the SPA does not negotiate:

```
POST /api/v1/session/exchange            ticket → bearer
GET  /api/v1/capabilities
GET  /api/v1/repositories                POST /api/v1/repositories/register
                                         POST /api/v1/repositories/revoke
GET  /api/v1/filesystem/entries
GET  /api/v1/status   /history   /refs   /diff   /worktrees   /submodules   /stashes
POST /api/v1/previews
POST /api/v1/operations                  GET /api/v1/operations[?operationId=|?limit=]
POST /api/v1/operations/cancel
GET  /api/v1/events                      SSE, `?since=` for replay
```

Rules to carry over from `packages/host-node/src/http/` rather than reinvent: loopback bind
only; every read authenticated, including `capabilities`; `Host` and `Origin` compared exactly
(no wildcard CORS); the bootstrap ticket single-use and short-lived, exchanged for an in-memory
bearer; unknown `/api` paths answer JSON 404 and never fall through to the SPA; SSE carries the
bearer in a header, not in the URL. The readiness line the CLI prints for a supervising parent
is the JSON one already agreed for parent processes (URL + ticket policy), and the ticket must
not appear in ordinary logs.

Then: `tests/native/http-contract.test.ts` and `tests/native/http-security.test.ts` (vitest,
driving the built binary, the RED list in the plan's D12), plus a differential check that the
same fixture answers the same DTOs through the HTTP adapter and through the Tauri boundary —
`crates/refyard-host/tests/fixture_driver.rs` already exists for the Node oracle and is the
pattern to follow.

### 3.2 D13 — packaging, no-Node proof, budgets, shutdown

- `scripts/verify-native-artifacts.ts`: walk the `.app` and the CLI, fail on a bundled
  `node`/`bun`/`deno` binary, a JS backend bundle or VM, Electron; the frontend's own JS must
  not be a false positive.
- Launch both artifacts with a minimal `PATH` (git and ssh present, no JS runtime) against the
  fixture; record the process tree.
- Missing-Git and missing-SSH behaviour: `refyard-native doctor` already answers both with a
  diagnosis and exit 2 (§4 below has the transcript); the App's own behaviour without Git is
  still unmeasured.
- `scripts/measure-native-runtime.ts`: startup → ready, first status, history latency (≥3 runs),
  idle memory, memory after a large diff. State the WebView's shared processes and do not
  invent a PSS. Measured so far: installed app 12.6 MiB, CLI 1525712 bytes — nothing else.
- Shutdown: cancel in-flight reads, queued mutations, running mutation → confirmed or recorded
  unknown, owned SSH children cleaned up, the user's own terminal connections untouched.
  A kill-mid-write on the *windowed* app is the specific test that would exercise the durable
  journal end to end; today only the host-level tests and a SIGTERM startup check exist.

### 3.3 The D11 tail

- **An acknowledgement entry point in the UI.** `acknowledgeUncertainOperation` exists in the
  adapter and is tested at the command level, but nothing in `packages/git-ui` calls it, so a
  blocked repository currently has no in-app way out. This is E13's user-facing half.
- `tests/e2e/native-mutations.spec.ts` cannot be written as a browser test on macOS: WKWebView
  has no usable WebDriver, so a Tauri window cannot be driven by Playwright. The substitute is
  `apps/desktop/src-tauri/tests/session_owner.rs`, which calls the production command bodies
  with a window label; that is what D11 used, and it is why the E rows are marked PARTIAL
  rather than PASS.

### 3.4 D14 tail

- The acceptance matrix's F rows (F01–F08, the native HTTP entry) need D12 to exist.
- `README.md` and `docs/installation.md` still describe the Node CLI only; neither mentions
  `Refyard.app` or `refyard-native`.
- The full existing suite should be re-run once at the end (`pnpm check`, `test:unit`,
  `test:integration`, `test:e2e`, `pnpm build`) in one pass, with the exit codes recorded in §9.

## 4. Known gaps, named

- **No remote untracked-file diff.** The remote read path shows modified and staged files; an
  untracked file's contents cannot be fetched remotely yet (A/B boundary, carried from B).
- **`previews` cannot be named in `ReadKind`.** The contract's read list has no `previews`
  member, and the Node host does not list it either, so a client gating on capabilities cannot
  discover it; the method works when asked.
- **Manual alias creation is refused by name.** A host may only be chosen from what the SSH
  configuration declares; typing a hostname that no `Host` line declares is refused.
- **`truncated` is overloaded.** It means "the host limited this listing" in the contract but
  was rendered as "the diff is incomplete"; the wording was fixed (`004539c`), the contract
  overload was named and not changed.
- **Remote commit times read as "in the future"** when the server's clock is UTC and the reader
  is UTC+8. Cosmetic; unfixed.
- **Only macOS arm64 has been run**, for every artifact and every gate.
- **Credential ecosystem** (1Password, ssh-agent, passphrase prompts) is untested: the fixture
  uses a generated key with `BatchMode=yes`.
- **E06/E11/E12/E14** (hook failure, connection loss, crash/restart, cancel) are covered at the
  host level but not demonstrated in the running App; **E08/E09/E15** (snapshot staleness,
  unsupported paths, unimplemented destructive buttons) are covered by tests only.

## 5. Resuming

```sh
cd /Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh
pnpm native:ssh:fixture -- start          # the SSH fixture, prints its ephemeral port
cargo test --workspace                    # 494 + 7 + 24, no fixture needed
cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1
pnpm desktop:build                        # Refyard.app
pnpm native:ssh:fixture -- stop
```

The next task is D12. Its first failing test is the plan's own RED list: an unauthenticated
read must be refused, a wrong `Origin` or `Host` must be refused, a ticket must be usable
exactly once, an unknown `/api` path must be a JSON 404 and not the SPA, and a repository on a
target the session was not granted must be refused.
