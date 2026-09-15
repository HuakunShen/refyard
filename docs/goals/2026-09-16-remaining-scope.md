# Goal — close the remaining scope: forms 2–4, the deferred tasks, and the defects the platform runs found

> Written 2026-09-16. The standalone V1 has shipped (published 0.1.0 and 0.1.1, CI green on both
> runners). Everything that was deferred *because* V1 had not shipped is now unblocked, and this
> round is the one that finishes them.

## Where this comes from

Three sources, each with its own authority, and nothing here invents scope:

1. **The delivered design package** (`references/ai-chat/2026-09-14/`) — T01–T15 are delivered;
   **T16 (Xross), T17 (Kunkun), T18 (native-host evaluation)** are not, and the package says they
   come after the standalone V1. It also names output files the plan requires that were never
   written (`integrations/xross/*`, `integrations/kunkun/*`, `docs/research/native-host-evaluation.md`).
2. **`docs/product/north-star.md`**, whose decision table is approved and *ahead of the code*. Four
   usage forms are supported targets and **form 1 is the only one shipped**; the HTTP layer is
   decided to move to **Hono with `hono-openapi` + Scalar**, with **MCP read tools** via `@hono/mcp`.
   The north star is also where form 2's shape is written down in detail — an approval flow, never a
   scan, never a wider default.
3. **This repository's own evidence**, from the platform runs and the API probes of the last two
   days: defects that are open, rules the code breaks, and rows that say "unverified" for a reason
   that can now be removed.
4. **The owner's deployment direction in this round:** the browser UI is a Cloudflare Worker
   static/PWA deployment; the CLI is a backend API process only. The Worker never receives Git
   authority, and a hosted browser reaches a CLI only through an explicitly configured secure
   endpoint and exact origin allowlist.

## What "done" means

A form is done when it has **its own evidence**, not when the code exists (north star §9). So:

| Form / item | Today | Done means |
| --- | --- | --- |
| Form 1 — one repository, loopback, paired | **shipped** (0.1.1) | unchanged; every change below must keep it |
| **Form 2 — managed workspaces (many repositories)** | not shipped | a user adds a repository from the UI or the CLI, the grant grows **by approval only**, each addition is journaled, revocation exists, and the UI never invents a repository |
| Form 3 — hosted UI | not shipped | opt-in, password-gated, origin-allowlisted; **never the first place a mutation appears**. Needs the owner's go-ahead to ship, and says so |
| Form 4 — native host | not started | an evidence-backed decision, or an equally evidence-backed "stay on Node". **No implementation without explicit approval** |
| **Cloudflare UI deployment** | not shipped | the built static SPA and PWA assets deploy through a versioned Cloudflare Worker; the CLI serves no UI, and API access from the Worker is TLS- and exact-origin-gated |
| T16 Xross | absent — and **partially buildable**: Xross today has authenticated remote exec (`xross.exec.v1`) and a real, e2e-proven port forward (`xross.tunnel.v1`), but no app definition, so "the installed refyard version" and `dependencyMissing` have nothing to read | the launch rides an exec call held open for the session, the ticket comes back on that authorized stream, and the browser reaches the service through the peer's forward. A dependency report says what the peer's refusal actually means, and the README names the concept Xross does not have |
| T17 Kunkun | absent — and **partially supported**: a manifest, a privileged backend process and a real permission model exist, but there is no credential broker and no way to point a view at an external URL | `integrations/kunkun/` owns the refyard session inside its own backend process, mounts the existing components against a kkrpc channel, and surfaces a `Permission denied` refusal unchanged. Reusing the UI means swapping its connection seam and replacing SSE with kkrpc streaming |
| Security work the security doc names as missing | listed, not done | hostile-remote, credential-prompt, hostile-hook and limit-abuse cases exist and are named in `docs/evidence/security.md` |
| Windows in CI | manual runs only | a `windows-latest` job runs the same gates, so the platform rows stop depending on one machine's afternoon |
| WebKit on Linux | blocked on one apt package | blocked becomes verified, or stays named as blocked with the command that would end it |

## What this round will not do

- **No second engine, no native host, no Electron/Tauri/Wails** (AGENTS §1).
- **No widening of an approved root** to make multi-repository convenient: form 2 is an approval
  flow, not a broader default (north star §9).
- **No weakening of the origin/auth rules** for the hosted form: an allowlist and a password, or it
  does not ship.
- **No Git backend in Cloudflare:** the Worker only serves the static SPA/PWA and never receives
  repository paths, Git credentials, bearer tokens, or raw command authority.
- **No rewriting T01–T15.** The existing suites are the guard for every change here; a task that
  cannot keep them green stops and reports.
- **Nothing is published automatically.** Publication stays the owner's step (`docs/releasing.md`).

## Rules this round inherits (unchanged)

Every AGENTS.md rule still applies: failing test first and proven to fail for the right reason;
isolated temporary repositories for anything that writes Git state; no `--no-verify`, no lock
deletion, no `git clean`, no global-config rewriting; unknown results reported as unknown and never
retried; evidence files updated in the same commit as the behaviour they describe; and
"code written" is never "tested".

## Acceptance for the round as a whole

1. Every task in `docs/plans/0005-refyard-v2-remaining-scope.md` is either **done with its
   evidence** or **named as not done with the reason**.
2. `pnpm check`, `check:boundaries`, `check:contract`, `test:unit`, `test:integration`, `test:pack`,
   `test:portable`, `test:e2e`, `pack:smoke`, `bench:runtime` all pass on the revision that ends it.
3. `docs/evidence/release-matrix.md` says the truth about every row, including the ones that stay
   unverified.
4. Form 2 has its own evidence file, because it changes a security-relevant default: what was
   approved, by whom, when it is journaled, and what refuses.
