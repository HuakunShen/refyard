# Native desktop + SSH — implementation status

Updated 2026-09-18 through the D-track's end (D11–D14), in the worktree
`/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh` on branch `feat/native-desktop-ssh`.
This is a handoff, not a completion notice: it says what was measured, on which machine, and
what the next executable steps are. Where something was not run, it says so instead of
implying it.

## 1. Where things are

|             |                                                                                                                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree    | `/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh` (branch `feat/native-desktop-ssh`)                                                                                                               |
| Commits     | … → `a6a3346` (D11) → `d9f1dd1` → `a1659b9` (D12) → `2b4bf2b` (D13) → `4df521b` (F05/F07) → `f725796` (E13 panel) → this update (D14)                                                                     |
| Desktop app | `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app` · executable sha256 `b3eb30a2104bc079ed2381dc5c6dfbdc62b171bd22407b7af2eaae696d986b99` · 12870336 bytes · 12.6 MiB installed · unsigned  |
| Native CLI  | `target/release/refyard-native` · sha256 `27b5a6b6c462ea7bc498f9f5e5aba08738af5865a347b76aba20588b9d811fc1` · 4360464 bytes (with the HTTP entry and journal seed fix)                                    |
| SSH fixture | `pnpm native:ssh:fixture -- start\|stop\|status`; state in `target/native-ssh-fixture/state.json`; container `refyard-native-ssh-fixture`, alias `refyard-ssh-fixture`                                    |
| Evidence    | `docs/evidence/native-desktop-ssh/{a-local-app,b-remote-repository,c-local-and-ssh-writes,ssh-config-discovery,d-native-http-entry,e-native-artifacts-shutdown}.md` + `docs/evidence/native-runtime.json` |
| Acceptance  | `docs/acceptance/2026-09-18-native-desktop-ssh.md` (§9 is the incremental record)                                                                                                                         |

Measured on: macOS 26.6 arm64, git 2.50.1 (Apple Git-155), OpenSSH_10.3p1. Remote: Alpine 3.20
container, git 2.45.4, OpenSSH 9.7p1. Rust 1.98, Node v26.8.2. **No Windows or Linux run has
been made**, for the app, the CLI, or the fixture.

## 2. Deliverable status

|                           | Status  | What that means                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** Local desktop       | PASS    | Window opens without a terminal or a backend, reads a local repository, no listener, no JS runtime in the process tree.                                                                                                                                                                                                                               |
| **B** Agentless SSH reads | PARTIAL | The real App reads a remote repository through the machine's own OpenSSH; credential ecosystem (1Password/agent), remote path browsing and pagination stress are not exercised.                                                                                                                                                                       |
| **C** Local + SSH writes  | PARTIAL | Stage, unstage and commit run through the window on both providers and are verified by the server's own Git. The uncertain-outcome acknowledgement panel exists and is e2e-proven (acceptance 9.5/9.10). Hook failure, connection loss, in-app crash/restart and cancel are not exercised in the window.                                              |
| **D** Native CLI / HTTP   | PARTIAL | All F01–F08 rows PASS: the wire-level SSE suite and the two-boundary differential closed F05/F07; F-rows evidence in `d-native-http-entry.md` + `two_boundaries.rs` + `http-events.test.ts`. Still PARTIAL as a deliverable because the hosted form is refused by construction (not implemented) and `/mcp`, `/openapi.json`, `/scalar` do not exist. |

### What a person can do today with these artifacts

Open `Refyard.app`, choose `This machine` or an SSH host from the launcher, open a repository,
read history/working copy/diff, stage, unstage, commit, and watch the history update; if a
previous crash left the repository blocked, the panel explains it and lifts the block after an
explicit confirmation. Run `refyard-native doctor`, or `serve`/`open` for the same workbench
over loopback HTTP with the browser clients. Nothing else: no fetch/pull/push, no discard, no
stash, no worktree management, no hosted form, no MCP/OpenAPI surface.

### Gates actually run (this workstream, as of D12 leftovers + D13, 2026-09-18)

| Command                                                                                 | Exit | Result                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `cargo test --workspace`                                                                | 0    | 539 passed / 0 failed / 20 ignored                                                                                     |
| `cargo test` in `apps/desktop/src-tauri`                                                | 0    | 25 passed / 0 failed / 1 ignored                                                                                       |
| `cargo test -p refyard-http`                                                            | 0    | 22 unit + 10 gate + 2 two-boundaries passed                                                                            |
| `pnpm exec vitest run tests/native`                                                     | 0    | 49 passed (release binary driven)                                                                                      |
| `cargo clippy --workspace --all-targets -- -D warnings`                                 | 0    | clean                                                                                                                  |
| `cargo fmt --all -- --check`                                                            | 0    | clean                                                                                                                  |
| `pnpm native:verify`                                                                    | 0    | app 12.6 MiB / CLI 4.16 MiB, system links only, no JS runtime                                                          |
| `pnpm native:bench`                                                                     | 0    | ready 52ms, first status 44–49ms, history 144–154ms, idle RSS ~4.5MB (`docs/evidence/native-runtime.json`)             |
| `cargo test -p refyard-host --test ssh_exec -- --ignored` (fixture up)                  | 0    | 14 passed (as of D11; not rerun since)                                                                                 |
| `pnpm desktop:build`                                                                    | 0    | `Refyard.app`, 12.6 MiB installed (as of D11; app unchanged since)                                                     |
| `pnpm check` / `test:unit` / `test:integration` / `check:boundaries` / `check:contract` | 0    | 428 unit, 418 integration, 500 schema refs resolved — last full JS-suite pass D12; D13 added `tests/native` files only |
| `pnpm exec playwright test --project=chromium`                                          | 0    | 56 passed — measured before D11                                                                                        |

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

### 3.4 D14 — closing the round

- `README.md` and `docs/installation.md` now document the native app and `refyard-native`
  (built from source, macOS arm64 measured; not part of the npm tarball).
- Full-suite pass recorded in acceptance §9.3: `pnpm check`, `test:unit` (428),
  `test:integration` (467, including the 49 native vitest), `cargo test --workspace` (539),
  desktop (25), `pnpm test:e2e` (chromium project clean; firefox+webkit carry two pre-existing
  context-menu failures reproduced on the committed tree without this round's changes).

### 3.5 E14 crash/restart demonstrated in the running App — DONE (2026-09-19)

The last host-level-only row is now exercised end to end in the real Tauri window: a commit
killed with SIGKILL inside its pre-commit hook window, an app restart, a refused write with the
UncertainOutcomePanel listing `op_5`, checkbox-gated acknowledgement, and a successful stage
afterwards. Journal on disk shows `op_5` staying `unknown` with `acknowledgedAtMs` recorded
(ack records confirmation, never rewrites the outcome) and `git log` showing the killed commit
never landed. Fixture, transcript, and the honest iteration notes (one earlier kill landed
after the hook — same unknown semantics either way) are in acceptance §9.12. The native folder
picker + drag-drop round is §9.11 (commit 47eb4d3).

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
- **E06/E11/E12** (hook failure, connection loss, cancel) are covered at the host level but
  not demonstrated in the running App; **E14** (crash/restart) now is — acceptance §9.12 drives
  the real macOS App through kill-9 mid-commit (10s pre-commit hook fixture), restart, blocked
  writes, panel acknowledgement, and a successful post-ack stage.
- **App exit orphans in-flight SSH children** (measured, acceptance §9.13): Cmd+Q and SIGTERM
  both leave hung `ssh` processes behind (bounded by their own OpenSSH timers). In-process
  cancellation is fine; the missing piece is an exit-path cancellation hop. Fix planned, not
  written.

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
