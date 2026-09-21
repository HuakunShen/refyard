---
title: What Refyard will not do
description: The safety rules, stated as promises you can hold the product to.
---

These are not aspirations; they are the rules the implementation is tested against.

## It will not move your repository

There is no upload, no sync and no hosted copy. Refyard reads and writes the repository where
it is, with your `git`. The only network request the UI makes on its own is for GitHub
profile pictures, which you can turn off.

## It will not widen access quietly

- Loopback by default, with exact `Origin`/`Host` checks.
- Every request authenticated, reads included.
- Pairing tickets are single-use and minted only on trusted local channels: the `p` keystroke
  on the serving terminal, or `refyard pair` over a same-user-only control socket. No HTTP
  route mints one.
- A hosted origin is an explicit, exact allowlist entry — never a wildcard, never a default.

## It will not touch more than you asked for

- **Discard** restores tracked files to the index only. Never `git clean`, never untracked or
  ignored files, never a symlink or submodule.
- **Bulk actions** pre-check every path; one unsupported path refuses the whole batch rather
  than half-applying it.
- **Destructive operations** (discard, worktree removal, stash drop/pop, branch delete)
  require explicit confirmation and take a recovery backup first. If the backup fails, the
  operation does not run.
- **Previews bind content**: a confirmation is valid only for the fingerprint it was shown
  for. If the file changed, the operation is stale and must be re-confirmed.

## It will not lie about an outcome

- An uncertain result is reported as **unknown** — never as success, never auto-retried, and
  dependent writes stop until it is resolved.
- Capabilities are reported honestly: anything a build does not implement is absent from its
  capability list rather than faked. A read-only service says it is read-only.
- Nothing in this documentation is a measured number unless it was measured; where a platform
  or version was not exercised, it is named as unverified.

## It will not weaken your Git configuration

No `--no-verify`, no disabled hooks, no `commit.gpgSign=false`, no rewritten global config,
no deleted lock files, and no disabled SSH host-key verification — not even to make a test
pass.
