# Security evidence — what was tested, and what that buys

This file records the security-relevant tests that exist, what each one prevents, and what has
**not** been done. It is not a security guarantee and it is not an audit: it is the list of
attacks that were constructed here against a loopback service on one developer machine, plus an
explicit list of the work nobody has done yet.

Last run: 2026-09-15, macOS 26.6 arm64, Node 26.8.2, Git 2.50.1 (Apple Git-155) — see
`release-matrix.md` for which platforms were _not_ exercised.

## The surface being defended

- The service listens on **loopback only by default** and authenticates **every** HTTP read,
  including `GET /api/v1/capabilities`. A browser page is assumed hostile until it has exchanged a
  single-use pairing ticket for an in-memory bearer. Hosted access is an explicit exact-origin
  allowlist on top of the same bearer and ticket checks; it is not a wildcard or cookie mode.
- The browser sends **intentions**, never commands. There is no wire field for `argv`, `cwd`, or
  `env`, and no route that runs Git on behalf of a raw string.
- Repository content is untrusted input: file names, patches, commit messages, and remote
  responses are bytes that must not become control characters in a terminal or markup in a page.
- Git's own safety features are the user's, not ours: hooks, signing configuration, filters, and
  SSH host verification stay in force, and no code path disables them to make something work.

## What is tested

### The protocol boundary — `tests/integration/auth.test.ts`, `tests/integration/http.test.ts`

| Case                                                                                                                                                | What it prevents                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| "refuses every API read without a bearer token"                                                                                                     | an unauthenticated page reading repository content                                      |
| "refuses a request from a different origin" / "refuses a null origin" / "refuses a request the browser marks as cross-site, even without an Origin" | a hostile page on another origin (or a `null`-origin frame) driving this service        |
| "still requires a bearer when no Origin header is present"                                                                                          | a non-browser client being treated as trusted                                           |
| "refuses a Host header that is not this service's authority" / "…that names a localhost port this service does not own"                             | DNS-rebinding style access through another name for the same port                       |
| "refuses a pairing ticket a second time"                                                                                                            | replay of the bootstrap ticket pasted from a URL                                        |
| "refuses a ticket presented from a different origin" / "refuses a ticket that this service never issued"                                            | a stolen or guessed ticket being exchanged elsewhere                                    |
| "refuses a forged bearer token"                                                                                                                     | a token that was not minted by this process                                             |
| "sends a content security policy that forbids remote script and framing"                                                                            | injected markup pulling in remote script                                                |
| "refuses a traversal path" / "refuses a NUL byte in the path" / "refuses an asset that is a symlink out of the bundle"                              | the static file route reading outside the built bundle                                  |
| "answers 404 for a missing asset instead of returning the shell"                                                                                    | an unknown path being answered with the app shell, which would hide broken asset wiring |

Ticket lifetime has its own suite (`tests/node/auth-ttl.test.ts`): the 60-second default expires
on time, a widened TTL is honoured, and a ticket is consumed whether or not the exchange succeeds.

### Payloads and repositories — `tests/security/negative.test.ts`

| Case                                                                   | What it prevents                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "refuses a branch name Git would read as an option"                    | `git branch -D` being spelled where a branch name was meant                                                                                                                                          |
| "refuses a remote URL that is a transport helper"                      | `ext::` (and friends) turning a "remote URL" into command execution                                                                                                                                  |
| "refuses a configured transport helper before fetching"                | repository-local Git config bypassing the UI URL validator and reaching a helper protocol                                                  |
| "refuses a hostile .gitmodules URL for reads and sync operations"       | repository-provided submodule config becoming an executable transport or sync target                                                   |
| "refuses a .gitmodules absolute path outside the approved root"         | a local submodule URL redirecting access outside the explicitly approved directory                                                   |
| "refuses a worktree destination that climbs out of the approved root"  | a worktree write landing outside the directory the user approved                                                                                                                                     |
| "refuses a destination that names the Git directory itself"            | writing into `.git` — hooks are code execution                                                                                                                                                       |
| "refuses an unknown path id instead of acting on some other path"      | an id from another service being interpreted as "the nearest path"                                                                                                                                   |
| "refuses raw argv smuggled next to a semantic operation"               | any wire field carrying a raw command; the request is refused, nothing runs, and the same body without those fields is accepted — so the refusal is caused by the fields, not by a malformed request |
| "refuses a pairing the contract does not allow, and says which"        | a union-level 400 that says "(root) Invalid input" and tells the caller nothing                                                                                                                      |
| "returns a control character in a path as JSON, never as a raw byte"   | a terminal escape in a file name reaching the user's terminal through the API                                                                                                                        |
| "sends a patch containing an escape sequence as JSON text"             | a file's contents becoming terminal control                                                                                                                                                          |
| "refuses a write with Git's diagnostic and leaves the lock file alone" | deleting or ignoring `.git/index.lock` to "make it work"                                                                                                                                             |
| "removes the lock by hand, then lets the next commit proceed"          | treating an external lock as service-owned while still proving recovery after explicit human removal                                  |
| "refuses oversized path selections and bodies without changing Git"    | request-size abuse allocating validation or queue state before bounds are applied                                                       |
| "refuses to start rather than attaching to the listener it found"      | a second instance attaching to a port another program already owns                                                                                                                                   |

### Managed workspace access — `tests/integration/managed-workspaces.test.ts`, `tests/e2e/workspace.spec.ts`

| Case | What it prevents |
| --- | --- |
| "approves exact paths, revokes access, and preserves the audit after restart" | a browser inventing a repository, silently widening a root, retaining access after revocation, or losing the access record on restart |
| "approves and revokes a repository from the managed-access panel" | a UI changing the live grant without a visible approval action, or presenting a revoked row as still available |

These cases run against isolated temporary repositories on the current macOS machine. They do not
prove multi-user isolation, a hostile remote server, or a deployed tunnel.

### Separate static Worker and hosted API boundary — `tests/web-host/static-worker.test.ts`, `tests/integration/auth.test.ts`

The Cloudflare Worker has no Git binding, API proxy, bearer secret, or mutation route. Its tests
exercise the built-asset boundary: normal asset delegation, restrictive headers, SPA-compatible
asset handling, JSON 404 for `/api/*`, and refusal of non-GET asset methods. The service tests
exercise the complementary boundary: an exact configured UI origin can preflight, exchange a
single-use ticket, and read with its bearer; an unlisted origin receives no CORS grant and is
refused. `--api-origin` only changes the browser-visible address in the pairing URL; it does not
change where the Node listener binds or bypass authentication.

### Bounds and refusals elsewhere in the suite

- **Approved roots**: handle resolution refuses relative escapes, handles whose directory became a
  symlink into another root, roots outside their declared parent, and unknown handles
  (`tests/node/paths.test.ts`).
- **Preview tokens**: "is refused when a previewed file changed after the preview" and "refuses a
  preview token that was already used" — content is bound to the request, and status markers alone
  are not treated as proof that nothing changed (`tests/integration/staging.test.ts`).
- **Containment**: "runs one writer per repository and queues the next" — one writer per common Git
  directory inside the service, which does not claim to lock out an external terminal or IDE
  (`tests/integration/concurrency.test.ts`).
- **Restart and recovery**: "marks an operation left running as unknown and blocks its repository" —
  a process killed mid-operation leaves a repository blocked until a human resolves it, and the
  block is cleared only explicitly (`tests/integration/restart.test.ts`).
- **Offline shell**: "reloads from the cached shell while offline, and says it is not connected" and
  "refuses a write while offline and never replays it after reconnecting" — the page does not
  pretend to have data offline, and no queued write is sent later (`tests/e2e/offline.spec.ts`).
- **Repository-supplied hooks and prompt controls**: the staging integration case installs a failing
  `pre-commit` hook and proves the head remains unchanged; the runner unit case proves every Git
  process receives `GIT_TERMINAL_PROMPT=0` (`tests/integration/staging.test.ts`,
  `tests/node/runner.test.ts`). A real credential helper or SSH server remains unverified.

## Invariants held in code, checked by tests or by construction

- **The environment a Git process gets is built by the host, never from a request**: it is an
  allow-list of the service's own variables, and `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
  `GIT_OBJECT_DIRECTORY`, `GIT_CONFIG*`, `GIT_EXTERNAL_DIFF` and the trace switches are removed
  afterwards — structurally, so not even a test can put one back. The commit identity
  (`GIT_AUTHOR_*`, `GIT_COMMITTER_*`) is inherited, because it is the caller's and cannot make Git
  run anything (`tests/node/runner.test.ts`).
- No `--no-verify` anywhere; hooks run. The only exception is the doctor's throwaway probe commit in
  a private temporary repository (`packages/host-node/src/process/doctor.ts`), which is a fixture,
  not the user's repository.
- Global Git configuration is never written, and the doctor's probes pass identity and signing
  settings per invocation (`-c …`) instead.
- Lock files are never deleted, force operations are never issued, and SSH host verification is
  never disabled.
- Bulk actions pre-check every path: one unrepresentable path rejects the whole batch before
  anything is written.
- Unknown outcomes are reported as unknown; mutations are never auto-retried.
- The CSP never adds `unsafe-inline` or `unsafe-eval` (`tests/node/csp.test.ts` includes "never
  introduces 'unsafe-inline' into script-src").

## What has **not** been done

Stated plainly, because a release page must not imply otherwise:

| Not done                                                                   | Consequence                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No third-party security review, audit, or penetration test                 | every claim above rests on tests written by the same authors as the code                                      |
| No fuzzing or property testing over parsers beyond the unit cases          | a malformed Git output that no hand-written case covers is unverified                                         |
| No adversarial run on Windows or Linux                                     | the negative cases ran on macOS only                                                                          |
| No browser other than Chromium                                             | origin/CSP/service-worker behavior in Firefox, WebKit, and mobile browsers is unverified                      |
| No hostile-remote testing (malicious servers, huge/odd protocol responses) | remote error handling is exercised with local path remotes and crafted failures, not a real adversary         |
| No multi-user deployment model                                             | the trust model still assumes one OS user on one machine                                                   |
| No deployed hosted UI or tunnel                                            | the static Worker configuration and exact-origin runtime path are locally dry-run/tested, but no Cloudflare account, domain, or tunnel was used here |
| No credential or SSH-agent testing                                         | hooks, signing and host verification were deliberately left untouched; that also means they are untested here |
| No resource-exhaustion campaign                                            | request bodies, job counts, and read sizes are bounded in the contract, but no sustained load was applied     |

Threat-model scope, restated: refyard runs on the user's machine, with the user's privileges, against
repositories the user approved. It does not defend the user's machine from the user, and it does not
claim to be a sandbox for hostile repositories.
