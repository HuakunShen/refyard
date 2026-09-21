---
title: Panels, worktrees and SSH
description: Branches, remotes, tags, stashes, submodules, linked worktrees, and repositories on another machine.
---

## Panels

| Panel      | What it offers                                                                       |
| ---------- | ------------------------------------------------------------------------------------ |
| Branches   | Local branches with ahead/behind counts; checkout, create, rename, delete, upstream.  |
| Remotes    | Configured remotes, fetch, fast-forward-only pull, push, and remote branch listings.  |
| Tags       | Annotated and lightweight tags; create, push, delete.                                 |
| Stashes    | Stash the working copy; apply, pop or drop an entry.                                  |
| Worktrees  | Add a linked worktree, lock or unlock it, and remove one — see below.                 |
| Submodules | The submodule list with its recorded and checked-out commits.                         |

## Worktrees

A linked worktree gets its own working copy on its own branch, which is what makes it useful
and what makes it dangerous: two checkouts of one repository can hold two different states.
Refyard shows each worktree as its own WIP context and refuses to remove one whose
preconditions cannot be verified. Removing a worktree is a confirmed, backed-up operation —
a backup failure means it does not run.

## Repositories over SSH

The desktop app can open a repository on another machine **without installing anything
there**. It uses the host machine's own OpenSSH and your `~/.ssh/config`:

- Hosts come from the machine's SSH configuration; aliases, ports and jump hosts included.
- Host-key verification is never disabled.
- Key bytes, passphrases and raw command arguments never cross the UI boundary — the browser
  and the webview send intentions, and the host builds the command.
- The remote side needs `git` and nothing else.

<Callout type="warn" title="Unknown means unknown">
If a remote command's outcome cannot be established — the connection dropped mid-write, for
example — the result is reported as unknown rather than guessed, and dependent writes stop.
</Callout>
