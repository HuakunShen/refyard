# Native desktop + SSH — unfinished work (handoff for the next tool)

Written 2026-09-18 at commit `41cd874`; **updated through the D-track's end (D11–D14 complete,
see the acceptance document's §9 and the status document)**. This file is the "continue here"
list: what is **not** done, with enough detail to start without re-deriving it. The measured
state of everything already delivered is in `native-desktop-ssh-implementation-status.md` in
this directory — read that first, then `AGENTS.md`, then this file.

D00–D14 are complete. The next planned work is P01–P04 (read parity, network writes,
destructive workflows, distribution) — each gated on the artifacts staying runnable.

## 1. D12 — what is left of it

Done: the route table, ticket→bearer auth, exact Host/Origin, JSON 404 for unknown `/api`,
repository grants, strict queries/bodies, idempotent replays, SSE framing/replay, static
workbench with CSP inline-script hashing, `serve`/`open` with JSON readiness and
stderr-only pairing URLs. **F05 and F07 were closed on 2026-09-18** and are PASS in
acceptance §9.6: `tests/native/http-events.test.ts` subscribes over the wire and checks
the frame sequence against the contract schema; `crates/refyard-http/tests/two_boundaries.rs`
compares six reads and one submitted operation answer-for-answer between the HTTP route and
the direct `ApplicationService` call.

**Left:**

- **Hosted form** (`--allowed-origins` + password): refused by construction, not
  implemented. If it is ever wanted, it needs a second factor and a re-read of the
  reference `auth.ts`.

The original D12 notes are kept below for the reference file pointers they carry.

**Goal (original):** `refyard-native serve` (API only) and `refyard-native open` (API + the static UI),
backed by the same `ApplicationService` the desktop window uses. Both commands currently
exist in `crates/refyard-cli` and **refuse by name**; `crates/refyard-http` does not exist.

**Files the plan names:** `crates/refyard-http/{Cargo.toml,src/{lib,router,auth,events,assets}.rs}`;
add `serve`/`open` to `crates/refyard-cli/src`; tests `tests/native/{http-contract,http-security}.test.ts`;
root script entries. Commit message when done: `feat(cli): expose the native service without a desktop runtime`.

**Route surface** — replicate exactly; the SPA does not negotiate. The authoritative list is
what `packages/git-client/src/client.ts`, `mutations.ts` and `events.ts` send (read them for
the exact query-parameter and body field names — lines ~205–400 of client.ts):

```
POST /api/v1/session/exchange            one-shot bootstrap ticket → in-memory bearer
GET  /api/v1/capabilities
GET  /api/v1/repositories                POST /api/v1/repositories/register | /revoke
GET  /api/v1/filesystem/entries
GET  /api/v1/status  /history  /refs  /diff  /worktrees  /submodules  /stashes
POST /api/v1/previews
POST /api/v1/operations                  GET /api/v1/operations[?operationId= | ?limit=]
POST /api/v1/operations/cancel
GET  /api/v1/events                      SSE, ?since= for replay
GET  /api/v1/health                      (confirm path/shape in client.ts)
```

**Security rules to copy, not reinvent** — the reference implementation is
`packages/host-node/src/http/`: `auth.ts` (ticket → bearer, single use, TTL), `origins.ts`
(exact `Host`/`Origin` comparison), `server.ts` (loopback bind only), `json.ts` (problem →
status mapping), `events.ts` (SSE framing), `assets.ts` (SPA fallback, precompressed
`.gz`/`.br`, cache headers), `csp.ts`, `scope-policy.ts`. **These files have not been read in
detail yet** — read them before writing the Rust equivalents. The rules they encode, as the
plan states them: loopback only; every read authenticated including `capabilities`; `Host` and
`Origin` compared exactly, no wildcard CORS; the bootstrap ticket single-use and short-lived;
unknown `/api` paths answer JSON 404 and never fall through to the SPA; the SSE bearer travels
in a header, never in the URL; the ticket never appears in ordinary logs.

**Plan-specific requirements:** the native CLI must not depend on Tauri; the desktop crate
keeps **not** linking `refyard-http` (desktop binds no socket by default — verify after
wiring); SSH-host discovery over HTTP is **off unless explicitly enabled** on the CLI, and a
peer/remote website must not be able to enumerate all SSH hosts; `open` serves the same-origin
static UI from the `apps/web` build (see `apps/cli/src/web-root.ts` and
`scripts/build-desktop.ts` for where that build lands), `serve` is API-only.

**CLI flags to mirror** from `apps/cli/src/{args,serve,browser,pairing-reprint}.ts`:
`--port` (an explicitly busy port is refused; `--port 0` picks a free one for tests; a taken
default means choose another free one and say which), `--no-open`, `--ticket-ttl`. On startup
print a **JSON readiness line** on stdout for a supervising parent: the bound URL, the ticket
policy (single-use, TTL), and the service instance id. This is the ready-line/pairing-URL ABI
already agreed for parent processes; a single-use ticket is consumed by the auto-opened
browser, which is why `--no-open` exists for handed-off URLs.

**Implementation guidance** (decisions already weighed, not mandates):

- Use a real HTTP stack, not hand-rolled HTTP/1.1 — auth-sensitive header parsing is exactly
  where a hand-rolled server fails. `axum` on the existing `tokio` is the natural choice; it
  is a new crates.io dependency (network was available this session; Docker pulls worked).
  Budget headroom is fine: the CLI is 1.45 MiB of a 20 MiB budget.
- `serve`/`open` construct the service the way `apps/desktop/src-tauri/src/lib.rs` does
  (`LocalGit::discover` → `ApplicationServiceConfig` → `with_ssh_config_file` when
  `REFYARD_SSH_CONFIG` names an absolute file → `with_state_root(default_state_root(...))` →
  `with_writes()`), sharing `crates/refyard-host/src/state_root.rs`.
- Router-level Rust tests need no sockets: an `axum::Router` is a tower `Service`; issue
  in-memory requests for the RED list. The vitest suites spawn the real release binary and
  drive the real socket.
- Differential DTO check: drive the spawned binary with `@refyard/git-client`'s
  `GitServiceClient` and validate every response against the `@refyard/git-contract` Zod
  schemas; separately, a Rust test compares HTTP answers against direct
  `ApplicationService`-method answers for the same fixture repo. The Node oracle pattern to
  copy is `crates/refyard-host/tests/fixture_driver.rs`.

**RED list (write these tests first):** unauthenticated read refused; wrong `Origin` refused;
wrong `Host` refused; a ticket is usable exactly once; an unknown `/api` path is a JSON 404
and never the SPA; a repository on a target the session was not granted is refused.

**Verification:** `cargo build -p refyard-cli --release && pnpm exec vitest run tests/native/http-contract.test.ts tests/native/http-security.test.ts`, plus the gates in §"Gates" of the status document.

## 2. D13 — packaging, no-Node proof, budgets, shutdown — DONE (2026-09-18, commit follows this file's update)

`scripts/verify-native-artifacts.ts` and `scripts/measure-native-runtime.ts` exist, wired as
`pnpm native:verify` / `pnpm native:bench`. Evidence:
`docs/evidence/native-desktop-ssh/e-native-artifacts-shutdown.md` and acceptance §9.9.

Delivered: artifact scan green (app 12.6 MiB ≤ 30 MiB, CLI 4.16 MiB ≤ 20 MiB, Mach-O by
magic, `otool -L` system-only, engine markers, no Svelte false positive); minimal-PATH bench
(ready 52ms, first status 44–49ms, history 144–154ms, idle RSS ~4.5MB, after status+diff
4592 kB, app registered 66ms; `docs/evidence/native-runtime.json`); missing-git diagnostics
(`doctor` and `serve` exit 2 with notes); missing-ssh-only (git fully usable, exit 0);
SIGKILL-mid-write on the release binary — unknown + blocked write + the three-act
acknowledgement + `202` after (exposed and fixed the restart operation-id seed bug,
`next_operation_seed` in `crates/refyard-host/src/jobs/mod.rs`); graceful SIGTERM — exit 0,
port answers nothing while stopped, finished work stays `succeeded` after restart.

**Still open from this task's checklist (do not mark done):**

- the **windowed app** killed mid-write (the CLI/HTTP proof is done; the app-level kill is not);
- the App's own behaviour with no Git on PATH;
- offline local-repo operation — **measured 2026-09-19, acceptance §9.15**: the app ran
  entirely inside a `sandbox-exec -n no-network` sandbox (enforcement proven: DNS fails
  inside, works outside; the app process holds zero network sockets) and the full loop —
  open, reads, stage, commit — worked, landing `b603b9d` on disk. No network disconnection
  of the machine needed;
- updater (user item 2) — **implemented 2026-09-19 per release spec §4**: keys generated
  (public key committed in `tauri.conf.json`), plugins wired, Settings "Check for
  updates" + opt-in startup check live in the app, end-to-end check against the real
  GitHub feed measured (honest 404 until the first release exists). Remaining: the owner
  sets `TAURI_SIGNING_PRIVATE_KEY`(+`_PASSWORD`) secrets and pushes `app-v0.1.0`; the
  release then produces `latest.json` and a real update can be consumed.
- ~~owned SSH child cleanup at shutdown; in-flight read cancellation at shutdown~~ —
  **measured 2026-09-19, acceptance §9.13**: in-process kill-and-reap holds (superseded or
  cancelled reads die and are reaped promptly), but **both app exit paths orphan in-flight
  ssh children** — Cmd+Q leaves them (Tauri exit never drops the Tokio runtime, so
  `kill_on_drop` never fires) and SIGTERM kills the process with no handler at all. The
  orphans live bounded lives on their own OpenSSH timers (ConnectTimeout 15s; ServerAlive
  bounds post-auth at ~30s+) and then exit. Follow-up task: install a SIGTERM/SIGINT
  handler plus a Tauri exit hook that trips a service-level cancellation wired into the
  reads' existing `cancel` slot — the kill-and-reap machinery exists; only the exit hop
  is missing. Not yet done; do not mark clean.

## 3. D11 tail — the acknowledgement entry point — DONE (2026-09-18)

`UncertainOutcomePanel` (git-ui, plain props) plus the controller flow in
`apps/web/src/lib/workbench/mutations.svelte.ts` and an e2e spec
(`tests/e2e/uncertain-outcome.spec.ts`, chromium+firefox; webkit skipped with reason)
are in — see acceptance §9.5 (E13 now PASS) and §9.10. Along the way the HTTP client's
`acknowledgeUncertainOperation` stopped requiring the host-extension probe (the ack is a
_service_ route that exists on the native HTTP host, which has no host routes); see
§9.10. Still named, not done: a human click-through _inside_ the Tauri window
(WKWebView has no WebDriver; `session_owner.rs` covers the command layer).

`tests/e2e/native-mutations.spec.ts` from the plan **cannot** be a browser test on macOS —
WKWebView has no usable WebDriver, so a Tauri window cannot be driven by Playwright. The substitute
already in place is `session_owner.rs` (production command bodies with a window label). Do not
write a fake spec to tick the box; if a spec is written at all, it can only drive the
Node-service web app — which `uncertain-outcome.spec.ts` now does.

## 4. D14 — DONE (2026-09-18)

Acceptance §9 records every deliverable verdict, every gate with exit codes, and every not-run
cell with its reason. `README.md` and `docs/installation.md` document the native app and CLI.
Full-suite pass: `pnpm check` 0 · `test:unit` 428 · `test:integration` 467 (incl. 49 native)
· `cargo test --workspace` 539/0/20 · desktop 25/0/1 · `pnpm build` 0 · chromium e2e 58/0 ·
`pnpm native:verify` green · `pnpm native:bench` measured. The two firefox/webkit
context-menu failures named below were fixed 2026-09-19 (2c7dd73): the commit menu test
died at `grantPermissions` because Firefox rejects `clipboard-read`; ref creation stays
cross-engine, the clipboard assertion moved to a chromium-only test with the reason in its
skip. Full-engine e2e is now green: chromium 60/0, firefox+webkit 116 passed / 6 skipped
(all skips documented in-spec).

## 5. Known gaps carried (named, unfixed)

Remote untracked-file diff not readable; `previews` absent from `ReadKind` (undiscoverable via
capabilities); manually typed hostnames refused (only declared SSH-config aliases); the
contract's `truncated` overload; remote commit times render "in the future" (UTC server vs
UTC+8 reader); **only macOS arm64 has been run anywhere**; credential ecosystem
(1Password/agent/passphrase) untested — fixture uses a generated key with `BatchMode=yes`;
E06/E11/E12/E14 covered at host level only, E08/E09/E15 test-only. The user keeps Linux
(`ssh ufo`) and Windows (`ssh rog16-windows`) verification machines for the cross-platform
rows — ask before using them.

## 6. Resuming

```sh
cd /Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh
pnpm native:ssh:fixture -- start          # SSH fixture; state in target/native-ssh-fixture/state.json
cargo test --workspace                    # 539 passed, no fixture needed
cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1   # needs the fixture
(cd apps/desktop/src-tauri && cargo test) # 25 desktop tests
pnpm desktop:build                        # Refyard.app
pnpm native:ssh:fixture -- stop
pnpm native:verify                        # artifact scan (app + CLI)
pnpm native:bench                         # runtime measurements -> docs/evidence/native-runtime.json
pnpm build:web && bun scripts/bundle-cli.ts   # rebuild before e2e: the e2e serves .refyard-dev/web
```

As of this handoff the fixture container `refyard-native-ssh-fixture` is still **running**
(left up deliberately; stop it if the machine needs quiet). `main` is an ancestor of this
branch — no merge pending.
