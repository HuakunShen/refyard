# Xross Refyard view contract

This directory contains the final Task 0.4 view-v1 schema and golden-vector snapshots from Xross commit `00bec7a3f`, plus compile-time API declarations copied from Xross (`packages/embedded-web/src/contracts/view-v1/{types.ts,ids.ts}` and `packages/embedded-web/src/surfaces/{view-context.ts,refyard/api.ts}`). The copied context parser has one local strict-index guard to satisfy Refyard's `noUncheckedIndexedAccess`; it preserves the same sorted/unique feature validation. Task 0.4 adds a ready-scan root-to-snapshot-node binding for Space Lens; Refyard's typed facade is unchanged.

The web adapter imports these declarations with `import type`; Refyard does not depend on the Xross workspace, kkrpc, or any Xross runtime code. The canonical schema SHA-256 is `9f365418a12fec02c7ebbc770fa019e52c9d9e037817a4c3ef1c590888e1ba68`; the portable sorted eight-vector manifest digest is `30f38f660ff324638a59b5e49f70ee176aae5ce8a159a65d93465d1114f9ad40` (run `shasum -a 256 *.json | shasum -a 256` from inside `vectors/`). Keep this snapshot byte-identical to the canonical Task 0.4 artifact and vectors; incompatible DTO changes require a view-contract major version change.

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
