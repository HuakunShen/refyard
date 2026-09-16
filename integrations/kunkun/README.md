# Kunkun integration

The manifest in `package.json` declares one `custom-view` command and one backend entry point.
The backend process owns the Refyard `GitClient` and bearer session, then exposes the public
GitService plus mutation client through the stable `kkrpc/streaming` `expose` API. The view uses
`wrap` and receives injected `git`, `mutations` and `watchEvents` services; it has no direct HTTP,
localhost, ticket or token path.

The backend must inject a `GitClient` whose `fetch` and in-memory token provider were created in
that backend process. It must not expose `exchangeTicket` to the renderer. `watchEvents` is the
replacement for the standalone browser SSE stream and is intentionally an injected async iterable
so the backend can own reconnection and session shutdown.

## Version and verification boundary

The adapter was built against Kunkun revision `a12620cc709d06bda6cecc15fa35cadbf243cd94` and
the vendored/published kkrpc package at fixed version `2.0.0`. The manifest and real kkrpc memory
channel tests pass against the Refyard service; they prove the public status call and that a
`Permission denied` error crosses unchanged.

The out-of-tree installation path, custom-view loading from `integrations/kunkun`, and a real
Electron Kunkun window are unverified. Kunkun's host can spawn the declared backend and inject its
channel, but this repository does not claim to have installed or launched that extension here.
