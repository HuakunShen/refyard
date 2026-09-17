# Native desktop baseline — 2026-09-18 (D00)

What was true before any native code was written, measured on the machine that will run the
acceptance tests. This is a receipt for the starting point, not a result claim about the native
work; every native cell in `docs/acceptance/2026-09-18-native-desktop-ssh.md` starts as NOT RUN.

## Repository and worktree

| Item                                        | Value                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Canonical repository                        | `/Volumes/Portable2TB/ExtDev/refyard`                                                                     |
| Baseline commit (main)                      | `ded64b15c773de9bb7c00d766f59ae8b0431a3c9`                                                                |
| Docs commit (plan/specs/acceptance/handoff) | `ba7032167cbc7e8e723fa8ba4c2cd310aebbc0a6`                                                                |
| Worktree for this workstream                | `/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh`                                                  |
| Branch                                      | `feat/native-desktop-ssh` (created from `ba70321`)                                                        |
| Uncommitted work protected                  | The four plan documents were committed to `main` before the branch was cut, so the worktree starts clean. |

`git worktree list` at D00 (all four trees, so a later reader can tell them apart):

```
/Volumes/Portable2TB/ExtDev/refyard                       ba70321 [main]
/private/tmp/refyard-history-search-20260917              3a029e1 [codex/history-search-filters]
/Volumes/Portable2TB/ExtDev/refyard-git-client-direction  169d41f [feat/git-client-direction]
/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh    ba70321 [feat/native-desktop-ssh]
```

## Toolchain actually installed

| Tool         | Version                               | Notes                                                                     |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------- |
| macOS        | 26.6 (build 25G5065a), arm64          | The only desktop platform that can be accepted in this round.             |
| Rust / Cargo | 1.98.0 (2026-08-18 / 2026-08-05)      | Matches the plan's `rust-version = "1.98"`.                               |
| Node         | v26.8.2                               | Build/test only.                                                          |
| pnpm         | 11.25.0                               |                                                                           |
| bun          | 1.4.2                                 | Dev scripts only.                                                         |
| git          | 2.50.1 (Apple Git-155)                | The fixture byte corpus was captured against this version.                |
| OpenSSH      | OpenSSH_10.3p1, LibreSSL 3.3.6        | Client used for the SSH provider.                                         |
| Xcode        | 26.6 (17F113)                         | Needed for the Tauri/WebView build.                                       |
| Docker       | 29.4.0 (server 29.4.0, running)       | Fixture path for the Linux SSH server; podman 5.3.1 also present.         |
| Network      | crates.io index 200, npm registry 200 | Dependencies can be fetched; not a statement about the fixture container. |

Not installed at baseline: the Tauri CLI (`cargo tauri` is absent, `npx tauri` cannot resolve).
It will be added as a pinned dev dependency of the desktop package rather than a global tool.

## Existing checks, before the native work

Run in `/Volumes/Portable2TB/ExtDev/refyard-native-desktop-ssh` at `ba70321`. Raw output:
`/tmp/d00-baseline-results.txt` (session-local; counts and exit codes are copied here).

| Command                 | Exit | Wall time | Result                                                                                                     |
| ----------------------- | ---- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm check:boundaries` | 0    | 1 s       | 3 portable packages, 55 source files — no host dependencies; 113 test/script files import packages by name |
| `pnpm check:contract`   | 0    | 0 s       | artifacts match the schemas; every `$ref` resolves (462 named schemas)                                     |
| `pnpm test:unit`        | 0    | 18 s      | 40 files / 353 tests passed                                                                                |
| `pnpm test:integration` | 0    | 65 s      | 31 files / 413 tests passed                                                                                |
| `pnpm build:web`        | 0    | 8 s       | vite 8.3.0 build wrote `apps/web/build/200.html` (2731 bytes) plus `.br`/`.gz`                             |

These five pass on the baseline, so any later failure is caused by native work and can be
attributed. Nothing here is a claim about the native app, which does not exist yet.

## Contract and deployment state

- `packages/git-contract/src/version.ts` is `API_MAJOR = 1`, `CONTRACT_VERSION = "1.1.0"`. The
  native workstream bumps the additive revision to `1.2.0` while keeping the major at 1
  (D01); a legacy Node service reporting 1.1.0 must still be readable by the new UI.
- The Cloudflare build is still the static SPA: `apps/web/svelte.config.js` uses
  `adapter-static` with `fallback: "200.html"`, `strict: true`, `precompress: true`; root
  `wrangler.jsonc` serves `./apps/web/build` with `run_worker_first` and
  `not_found_handling: "single-page-application"`. Nothing in this workstream may turn that
  build into a server-rendered one.
- The Node CLI, loopback HTTP service and their tests are the regression target for the whole
  native workstream (acceptance A08).

## Scope of this revision, and what it does not authorize

`AGENTS.md` §0 and `docs/product/north-star.md` §6 now record the 2026-09-18 direction: Rust +
Tauri 2 native desktop, agentless SSH through the host's OpenSSH, no Node/Bun/Deno in the
shipped desktop product, no localhost HTTP bridge for the native adapter. The safety rules in
`AGENTS.md` §2 — isolated fixtures, preview fingerprints, unknown-is-a-result, no
`--no-verify`, no auto-retry of mutations, no fabricated evidence — are unchanged and apply to
the Rust code exactly as they apply to the Node code.

Explicitly not decided here, and still open: Windows desktop, Windows-over-SSH targets,
Password/keyboard-interactive SSH authentication, actual 1Password agent acceptance, and any
Cloudflare deployment change.
