# Xross integration

This adapter launches an already-installed Refyard CLI on an explicitly selected peer
repository through Xross's authorized `xross.exec.v1` stream, waits for the API-only readiness
object, and opens an authorized TCP forward to the service's remote loopback port. The exec stream
is held for the browser session; closing the returned handle closes the forward before the exec.

The adapter does not install software, accept arbitrary shell input, widen a peer grant, or copy
Xross's Rust/protobuf implementation. Its command is fixed to:

```text
refyard serve --json --no-open --repo <selected-peer-path> --ui-origin <exact-https-origin>
```

`selectLaunchOutcome` reports `ready`, `dependencyMissing`, or `permissionDenied`, and every
outcome has `installAutomatically: false`. Xross does not currently provide an app manifest or a
dependency broker, so a missing executable or refused exec is described as the peer not providing
the installed Refyard/runtime; it is not an instruction to download anything.

## Current verification boundary

The adapter's pure policy and fake-transport lifecycle tests pass. They prove the fixed argv,
readiness parsing, loopback target, API-origin rewrite and cleanup order. They do not prove a real
Xross launch: the adapter was read against Xross revision `97925a3f74cf2b95b21389cd7db1c2dcca94d2e7`,
but no authorized peer, `shell-allow` entry for Refyard, or `egress-allow` entry was available in
this session.

The browser-visible API endpoint must also preserve the Refyard service's Host/Origin checks. A raw
forward to a different local port changes the HTTP Host header; production wiring must either use
the same port or an operator-owned HTTPS/tunnel proxy that preserves the expected authority. The
adapter does not weaken that check.
