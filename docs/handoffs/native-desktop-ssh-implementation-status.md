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

### Gates actually run (this workstream, as of D12 leftovers + D13, 2026-09-18)

| Command | Exit | Result |
| --- | --- | --- |
| `cargo test --workspace` | 0 | 539 passed / 0 failed / 20 ignored |
| `cargo test` in `apps/desktop/src-tauri` | 0 | 25 passed / 0 failed / 1 ignored |
| `cargo test -p refyard-http` | 0 | 22 unit + 10 gate + 2 two-boundaries passed |
| `pnpm exec vitest run tests/native` | 0 | 49 passed (release binary driven) |
| `cargo clippy --workspace --all-targets -- -D warnings` | 0 | clean |
| `cargo fmt --all -- --check` | 0 | clean |
| `pnpm native:verify` | 0 | app 12.6 MiB / CLI 4.16 MiB, system links only, no JS runtime |
| `pnpm native:bench` | 0 | ready 52ms, first status 44–49ms, history 144–154ms, idle RSS ~4.5MB (`docs/evidence/native-runtime.json`) |
| `cargo test -p refyard-host --test ssh_exec -- --ignored` (fixture up) | 0 | 14 passed (as of D11; not rerun since) |
| `pnpm desktop:build` | 0 | `Refyard.app`, 12.6 MiB installed (as of D11; app unchanged since) |
| `pnpm check` / `test:unit` / `test:integration` / `check:boundaries` / `check:contract` | 0 | 428 unit, 418 integration, 500 schema refs resolved — last full JS-suite pass D12; D13 added `tests/native` files only |
| `pnpm exec playwright test --project=chromium` | 0 | 56 passed — measured before D11 |

## 3. Remaining executable steps

### 3.1 D12 — the native HTTP entry — DONE (commit a1659b9 + the F05/F07 follow-up)

`crates/refyard-http` exists: the full route surface the browser client speaks, ticket→bearer
auth with exact Host/Origin checks, JSON 404 for unknown `/api`, repository grants, strict
queries/bodies, idempotent replays, SSE with `?since=` replay, and the static workbench with
per-build CSP hashing — served by `refyard-native serve` (API-only) and `open` (API + UI),
which print the JSON readiness line on stdout and the pairing URL on stderr. Evidence:
`docs/evidence/native-desktop-ssh/d-native-http-entry.md`, acceptance §9.6. The wire-level
SSE suite (`tests/native/http-events.test.ts`) and the two-boundary differential
(`crates/refyard-http/tests/two_boundaries.rs`) closed F05/F07 on 2026-09-18.

### 3.2 D13 — packaging, no-Node proof, budgets, shutdown — DONE (2026-09-18)

Both scripts exist and are wired (`pnpm native:verify` / `pnpm native:bench`); the record is
`docs/evidence/native-desktop-ssh/e-native-artifacts-shutdown.md` + acceptance §9.9, with raw
runs in `docs/evidence/native-runtime.json`. Scan green (app 12.6 MiB / CLI 4.16 MiB, system
links only); bench measured (ready 52ms, first status 44–49ms, history 144–154ms, idle RSS
~4.5MB, after work 4592 kB); missing-git exits 2 with diagnostics; missing-ssh leaves git
fully usable; SIGKILL-mid-write on the release binary recovers as unknown + blocked + ack
(and fixed the restart op-id seed bug); graceful SIGTERM keeps finished work finished.
Unmeasured leftovers: the windowed-app kill, the App with no Git, offline, SSH-child cleanup
and read cancellation at shutdown — named in the remaining-tasks file §2.

### 3.3 The D11 tail — DONE (2026-09-18)

- **An acknowledgement entry point in the UI — DONE.** `UncertainOutcomePanel` (git-ui) plus
  the controller flow and e2e (`tests/e2e/uncertain-outcome.spec.ts`, chromium+firefox) are in;
  E13 is PASS in acceptance §9.5, details in §9.10. The HTTP client no longer gates the ack on
  the host-extension probe. Only a human click-through inside the Tauri window remains
  unautomated (WKWebView has no WebDriver); `session_owner.rs` covers the command layer.
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
