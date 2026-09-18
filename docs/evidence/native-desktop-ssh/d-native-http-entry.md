# Deliverable D (first half) — the native HTTP entry

Reads were deliverable B, writes deliverable C. This is D12: the same application service
the desktop window serves over Tauri, spoken over loopback HTTP by `refyard-native serve`
(API-only) and `refyard-native open` (API plus the built workbench). The desktop build
links none of this: adding the HTTP crate changed no desktop file, and the window still
binds no socket.

Artifact: `target/release/refyard-native`

```
sha256: 21c1a23aae6a82c4c6fc97458d9e9b677a0eedd0691c6e2f8563aec7dcdade03
bytes:  4304496 (4.1 MiB installed, against the ≤20 MiB budget)
links:  libSystem + libiconv only; no JavaScript runtime, no WebView
```

## 1. The security boundary, as measured

Every rule below is a test that fails if the rule regresses — Rust-side in
`crates/refyard-http/tests/http_gate.rs` (10 cases over the real socket with a real
fixture repository), wire-side in `tests/native/http-security.test.ts` (10 cases driving
the release binary), contract-side in `tests/native/http-contract.test.ts` (the browser's
own `createGitClient`/`createMutationClient` against the native service, every answer
validated by the contract's Zod schemas; 24 cases together with the security suite).

| rule | evidence |
| --- | --- |
| every read authenticated, `capabilities` included | 401 `Unauthenticated` without a bearer — Rust + vitest |
| `Host` compared exactly against this instance's authority | `attacker.example` refused 403 before auth — Rust + vitest (`node:http` sets the header `fetch` refuses to) |
| `Origin`, when present, matched exactly; `null` refused | `https://evil.example` and `null` both 403 — Rust + vitest |
| absent Origin not trusted: `Sec-Fetch-Site: cross-site` refused | Rust unit (`origins.rs`) |
| ticket single-use, short-lived, constant-time compare | second exchange 401 — Rust + vitest; expiry/prune/caps — Rust unit |
| ticket bound to origin and instance; gate refuses before the exchange | wrong-origin request 403 with the ticket *surviving* — Rust |
| non-loopback origins never paired | `pairing_url` refuses `https://…`, LAN, IPv6-ULA — Rust unit |
| unknown `/api` path: authenticate, then JSON 404, never the SPA | Rust + vitest; implemented reads absent from `capabilities` 404 the same way (`stashes`) |
| repository grants: a session reaches only what it was granted | second session reads the first session's repository → 403 — Rust; ungranted id over the wire → 403 — vitest |
| strict queries and bodies | unknown query parameter (`includeIgnored`) → 400; unknown JSON keys rejected by the shared `deny_unknown_fields` types |
| idempotency across the wire | byte-identical replay → 200 `duplicate` with the original record — vitest |

Two deliberate divergences from the reference host, both recorded rather than silently
"fixed": the status route rejects `includeIgnored` exactly as the deployed schema does
(the browser client can send it; the reference host rejects it too), and the hosted form
(non-loopback origins with a password) does not exist here — `pairing_url` refuses any
non-loopback origin, so there is nothing for a password to protect.

`serve` and `open` print a JSON readiness line on stdout **while the process runs** —
service instance, port, URL, ticket policy (`ticketSingleUse: true`, TTL) — and the
pairing URL goes to stderr in machine mode, so a log cannot mistake a ticket for data.
An explicitly named busy port is refused; the default port falling busy takes a free one
and says so. Ctrl+C/SIGTERM stop accepting first, then drain.

## 2. The workbench over `open`

Measured against the real `apps/web/build`:

```
GET /some/workbench/route → 200 text/html; charset=utf-8
  content-security-policy: default-src 'self'; script-src 'self' 'sha256-GlYZcWeqiQtBl6aCzPIjaJTjxQ0Gc4QR4ZMHnsJTd5I=';
    style-src 'self' 'unsafe-inline'; ... frame-ancestors 'none' ...
GET /_app/missing.js      → 404 {"problem":{"code":"NotFound","message":"no file at /_app/missing.js",...
```

A route-shaped path falls back to the pre-rendered shell; an asset-shaped miss stays a
JSON 404. The CSP carries the SHA-256 of the build's one inline script, hashed at serve
time — the page boots, and an injected second inline script would not.

## 3. A write through the native HTTP entry, end to end

`tests/native/http-contract.test.ts` drives the whole loop with the browser's own client
and judges the result with Git itself:

pair → `capabilities` → `repositories` → `status` → edit `a.txt` → `status` →
`previews` (fingerprint `sha256`) → submit `stagePaths` → 202 → poll `succeeded` →
index shows `M` → submit `commit` → poll `succeeded` → `git log -1 --format=%s` in the
fixture reads `committed from the contract suite`.

## 4. What this deliverable does not cover

- **SSE over the socket.** The events route is implemented and its framing, replay and
  gap behaviour are unit-tested in Rust, but no test subscribes over the wire yet —
  F05 is marked accordingly.
- **The hosted form** (external origins, passwords) — refused by construction, above.
- **`/mcp`, `/openapi.json`, `/scalar`** — the reference host's tooling routes; absent
  here, answered by the static 404. Not claimed anywhere.
- **Cross-platform.** Only macOS arm64 has run, as everywhere else in this workstream.
- **A fixture lesson worth keeping:** the contract suite's first runs hung in
  `git commit` inside `ident_default_email` — the fixture had no Git identity, and the
  host strips Git environment overrides on purpose, so `git` went looking for a hostname
  to build a default email from (a minutes-long mDNS walk). The fixture now configures
  identity in its global config, the way a person's machine is actually configured. The
  host's allow-list behaved as designed.
