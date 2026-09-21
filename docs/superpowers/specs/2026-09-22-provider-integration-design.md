# Provider integration — opt-in connections to Git forges, read-only first

> Status: design, from the user's 2026-09-22 direction: a complete app needs forge
> integration like GitKraken's (GitHub, GitLab, Bitbucket, Gitea) — at minimum showing
> issues and pull requests, lighter than GitKraken, growing over time. This spec is the
> authority for that workstream; `docs/product/north-star.md` §8 carries the product-shape
> decision.

## 1. What this is, and what it is not

Refyard gains an **opt-in provider axis**: a user explicitly connects Refyard to a forge
account, and the host then performs **read-only** REST calls against that forge's API to
show repository facts the Git protocol cannot provide — open pull requests first, issues
and PR↔branch/commit association next.

It is **not** a general HTTP client, not a credential manager for Git push/pull (Git
keeps using the host machine's own credential helpers), not write access (no comments,
reviews, merges), and not a place where a token ever reaches the browser, the journal, a
log line, or a Git command. "Lighter than GitKraken" is a scoping decision, not a
milestone on the way to cloning it.

## 2. Auth reality per provider (verified 2026-09-22)

| Provider | Device flow (RFC 8628) | P-path |
| --- | --- | --- |
| GitHub | Yes — client_id only, no secret (OAuth App setting) | **P1** — PAT first, device flow later |
| GitLab | No — officially unsupported (issue #332682) | P4 — PKCE auth-code or PAT |
| Gitea | No — unimplemented (issue #27309) | P4 — scoped PAT (`read:issue`, `read:repository`) |
| Bitbucket | — | P4+ — PAT / app password |

PAT is therefore the smallest common denominator and needs no app registration by
anyone; Refyard has no domain or org yet. P1 ships the PAT path for GitHub; the device
flow lands in P3 once the owner registers an OAuth App (its client_id is public by
convention — `gh` CLI ships one). GitKraken's own self-hosted support is PAT-based,
which is the precedent that this is a first-class path, not a fallback.

## 3. Security rules (the invariant spine, applied to a new capability class)

Outbound network plus stored credentials is a genuinely new capability class; these rules
rank above convenience and are checked by tests, not intent:

1. **The token never enters the browser.** Provider REST calls happen in the host. The
   browser sends intentions ("list open PRs for this repository"); the host resolves the
   repository's own remote, derives the forge coordinates, and calls out. No
   `api.github.com` in CSP, no token in `localStorage`/`sessionStorage`, no token in any
   response payload (a test asserts the token substring appears nowhere in any response).
2. **Storage follows the private-state discipline.** Tokens live in the host's state root
   (`provider/github.json`), written `mode 0600` inside a `0700` directory, following the
   `createAccessJournal` pattern. Keychain upgrade is a later, separate decision.
3. **Connection is explicit, journaled, revocable.** Connect and disconnect are user
   acts under a dedicated `provider:manage` scope, recorded in the journal; the token
   bytes are never recorded. Disconnect deletes the stored record.
4. **Capability honesty.** A host without the provider module omits it from
   `capabilities.providers`, and the UI then does not render any provider surface — the
   panel is absent, not an empty shell. The Rust desktop host does not have provider
   support in P1 and reports nothing; nothing pretends.
5. **Outbound URL discipline.** Request URLs are built from a fixed API base plus
   owner/repo parsed from the repository's own remote by the shared pure parser; user
   input never fills a URL path unchecked. The client speaks only to the configured
   provider base (`https://api.github.com` by default).
6. **Read-only, rate-limit-honest.** P1 sends only GETs. A rate-limited or refused
   response is reported as itself (`rateLimited`, `refused`), never retried blindly, and
   cached reads are labeled with their age.
7. **No provider call from a mutation path.** Provider reads are a separate service
   surface; a Git mutation never blocks on, or triggers, a network call.

## 4. Architecture (P1, exact places)

```
Browser: PullRequestsPanel (git-ui) — rendered only when capabilities.providers
         includes "github"; connect flow lives in the panel and Settings → Connections.
      │  intentions over the existing authenticated boundary (git-client methods)
packages/git-service:   ProviderService interface on BackendSession (HTTP adapter only in P1)
packages/git-client:    providerConnection / connectProvider / disconnectProvider /
                        providerPullRequests — same schema-validated fetch as every read
packages/git-contract:  provider schemas (connection status, connect/disconnect requests,
                        pull-request DTOs) + CONTRACT_SCHEMAS registration
packages/git-provider:  NEW. src/remotes.ts — pure remote-URL → {provider, owner, repo}
                        parsing (the single source; git-ui's avatars.ts re-uses it);
                        src/github/rest.ts — fetch-injected REST client, Zod-validated
                        responses, injectable base URL (the test seam)
packages/host-node:     src/provider/store.ts — token file, 0600, in-memory cache;
                        src/provider/manager.ts — connect (validate via GET /user),
                        disconnect, status, journal entries; scope-policy + routes:
                        GET  /api/v1/provider/connection        (repository:read)
                        POST /api/v1/provider/github/connect     (provider:manage)
                        POST /api/v1/provider/disconnect         (provider:manage)
                        GET  /api/v1/provider/pull-requests      (repository:read)
```

- Which repository a PR list belongs to is resolved **host-side**: the host reads the
  repository's remotes (raw, as it already does for redaction), parses them with
  `git-provider/remotes`, and prefers `origin`. No GitHub remote is a reported problem
  (`noProviderRemote`), not an empty list.
- Listing requests share a small host-side TTL cache (~60 s) keyed by repository; a
  refresh button and the PR panel's own actions bypass staleness. Provider reads are
  **not** added to background polling.
- `capabilitiesResponseSchema` gains an additive `providers: string[]` field; the CLI
  assembles `["github"]` from the modules actually wired in. The Rust host's existing
  capabilities output stays valid (field is optional).
- Desktop (Rust/Tauri): untouched in P1. `BackendSession` gains an optional
  `provider?: ProviderService`; only `backend-http` supplies it. The Tauri adapter does
  not implement it, and the capability gate keeps the panel hidden there.

## 5. Phases

- **P1 (this plan):** GitHub PAT connect/disconnect/status, host-side REST client,
  open-PR panel, capability gating, tests against a local stub upstream.
- **P2:** issues list; PR↔branch markers on ref pills and PR↔commit association in the
  commit panel; PR detail link-out.
- **P3:** GitHub OAuth device flow (owner registers the OAuth App), account display,
  connection management page, disconnect-also-revokes guidance.
- **P4:** GitLab and Gitea (PAT; GitLab PKCE auth-code where a loopback callback is
  acceptable), Bitbucket last. Each provider is a module behind the same
  `ProviderService`; no cross-provider abstraction is invented until the second
  provider exists.

## 6. Acceptance

`docs/acceptance/2026-09-22-provider-integration.md` carries the matrix. P1 evidence is
stub-based (a local `node:http` upstream standing in for `api.github.com`); the real
api.github.com path is exercised manually by the owner and marked as such — an
unverified claim about GitHub's live API must not appear as PASS.
