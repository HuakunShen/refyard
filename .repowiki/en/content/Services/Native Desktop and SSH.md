# Native Desktop and SSH

**Created: 2026-09-23** — initial wiki bootstrap.

The native form is a **closed decision** (2026-09-18): Rust + Tauri 2, reusing the same Svelte components through a `BackendAdapter`. Do not re-open the framework selection.

## Shape

- `apps/desktop` — Tauri 2 package; reuses `apps/web`'s Svelte build, **no forked pages**; only `packages/backend-tauri` may import `@tauri-apps/api`.
- `crates/refyard-contract | core | host | http | cli` — Rust DTO projection of the checked-in JSON Schema, pure parsers/planners (no host APIs), execution providers + registry + jobs + journal + GitService, optional Axum adapter, and the `refyard-native` doctor/open/serve CLI.
- One root Cargo workspace, `resolver = "2"`, default members = headless crates so a CLI build never needs a WebView. The crate the native host links **must not** depend on the HTTP adapter.
- **No JS runtime in the product.** Build-time JS (pnpm/Vite/Vitest/SvelteKit) stays allowed; `pnpm native:verify` fails if a runtime shows up in the bundle.

## SSH

- Uses the **host machine's own OpenSSH** against the user's own `ssh_config`; hosts are chosen from `~/.ssh/config`.
- The remote installs nothing. No key bytes, passphrases, or raw argv cross the browser or plugin boundary.
- Host-key verification is preserved — never disabled to make a test pass.

## Execution status

- Plan: `docs/superpowers/plans/2026-09-18-native-desktop-ssh.md` — tasks **D00…D14** (local App, SSH reads, stage/unstage/commit, native CLI + acceptance) then **P01…P05** for full parity.
- Acceptance matrix: `docs/acceptance/2026-09-18-native-desktop-ssh.md` — every cell PASS / PARTIAL / BLOCKED / NOT RUN; BLOCKED is never written as PASS.
- Evidence: `docs/evidence/native-desktop-ssh/` plus `native-baseline`, `native-desktop-host`, `native-read-slice`.
- Recent: native zoom shortcuts enabled (`4da2d7a`, 2026-09-22).

## Related pages

- `Architecture/Architecture.md` — native scope revision §0
- `Infrastructure/Release and Packaging.md` — how the app is shipped
