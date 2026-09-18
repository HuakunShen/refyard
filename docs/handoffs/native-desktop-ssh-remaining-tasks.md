# Native desktop + SSH — unfinished work (handoff for the next tool)

Written 2026-09-18 at commit `41cd874` (branch `feat/native-desktop-ssh`, worktree
`/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh`, tree clean). This file is the
"continue here" list: what is **not** done, with enough detail to start without re-deriving
it. The measured state of everything already delivered is in
`native-desktop-ssh-implementation-status.md` in this directory — read that first, then
`AGENTS.md`, then this file.

Nothing below has been started. Do not redo what §2 of the status document records as done.

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
- offline (network cut) local-repo operation — not exercised;
- owned SSH child cleanup at shutdown; in-flight read cancellation at shutdown.

## 3. D11 tail — the acknowledgement entry point

`acknowledgeUncertainOperation` exists in `packages/backend-tauri` and is tested at the
command level (`acknowledging_an_uncertain_operation_is_reachable_and_refuses_what_it_should`
in `apps/desktop/src-tauri/tests/session_owner.rs`), but **nothing in `packages/git-ui` calls
it**: a blocked repository has no in-app way out. Build the surface: surface the block
(there is a `blocked_repositories` on the service), explain it, require an explicit
confirmation, call the adapter method, show that the outcome stays `unknown`.
This is E13's user-facing half and the reason E13 is PARTIAL in the acceptance record.

`tests/e2e/native-mutations.spec.ts` from the plan **cannot** be a browser test on macOS —
WKWebView has no usable WebDriver, so Playwright cannot drive the Tauri window. The substitute
already in place is `session_owner.rs` (production command bodies with a window label). Do not
write a fake spec to tick the box; if a spec is written at all, it can only drive the
Node-service web app.

## 4. D14 tail

- Acceptance F rows (F01–F08, native HTTP entry) — blocked on D12.
- `README.md` and `docs/installation.md` still describe only the Node CLI; add the app and
  `refyard-native`.
- One full pass of the existing suite (`pnpm check`, `test:unit`, `test:integration`,
  `test:e2e`, `pnpm build`) with exit codes recorded into acceptance §9; last full JS-suite
  run predates D11 (which changed no TypeScript).

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
cargo test --workspace                    # 494 + 7, no fixture needed
cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1   # needs the fixture
(cd apps/desktop/src-tauri && cargo test) # 24 desktop tests
pnpm desktop:build                        # Refyard.app
pnpm native:ssh:fixture -- stop
```

As of this handoff the fixture container `refyard-native-ssh-fixture` is still **running**
(left up deliberately; stop it if the machine needs quiet). `main` is an ancestor of this
branch — no merge pending.
