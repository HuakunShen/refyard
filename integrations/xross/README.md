# Xross Refyard view contract

This directory contains the final Task 0.3 view-v1 schema and golden-vector snapshots from Xross commit `9310f2b83b29deba515320d5a158025ad00a8e57`, plus compile-time API declarations copied from Xross (`packages/embedded-web/src/contracts/view-v1/{types.ts,ids.ts}` and `packages/embedded-web/src/surfaces/{view-context.ts,refyard/api.ts}`). The copied context parser has one local strict-index guard to satisfy Refyard's `noUncheckedIndexedAccess`; it preserves the same sorted/unique feature validation.

The web adapter imports these declarations with `import type`; Refyard does not depend on the Xross workspace, kkrpc, or any Xross runtime code. The canonical schema SHA-256 is `178cc0f93a27439a59f106db01e164a4d65d0b09051523f6e41dc005a6989059`; the sorted eight-vector manifest digest is `589b1fba2b90f639c8c21fae436f946aafa4c05b90c6a55ec5ec9f09a20ef728`. Keep this snapshot byte-identical to the canonical Task 0.3 artifact and vectors; incompatible DTO changes require a view-contract major version change.

## Earlier exec-and-forward adapter

The earlier adapter launched an already-installed Refyard CLI on an explicitly selected peer
repository through Xross's authorized `xross.exec.v1` stream, waited for the API-only readiness
object, and opened an authorized TCP forward to the service's remote loopback port. The exec stream
was held for the browser session; closing the returned handle closed the forward before the exec.
Its fixed command was:

```text
refyard serve --json --no-open --repo <selected-peer-path> --ui-origin <exact-https-origin>
```

That adapter did not install software, accept arbitrary shell input, widen a peer grant, or copy
Xross's Rust/protobuf implementation. Its `selectLaunchOutcome` reported `ready`,
`dependencyMissing`, or `permissionDenied`, always with `installAutomatically: false`.
The pure policy and fake-transport lifecycle tests proved the fixed argv, readiness parsing,
loopback target, API-origin rewrite, and cleanup order, not a real Xross launch: no authorized
peer, `shell-allow` entry for Refyard, or `egress-allow` entry was available in that session.

The browser-visible API endpoint also had to preserve Refyard's Host/Origin checks. A raw forward
to a different local port changed the HTTP Host header; production wiring required the same port
or an operator-owned HTTPS/tunnel proxy preserving the expected authority. The adapter did not
weaken that check. This historical path is not a fallback for the new `/xross/` view.
