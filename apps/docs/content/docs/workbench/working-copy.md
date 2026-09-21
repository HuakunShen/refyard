---
title: Working copy and commits
description: Stage, unstage, discard, stash and commit — and the preconditions each of those checks first.
---

The working copy panel groups the repository's paths the way `git status` does — staged,
unstaged and untracked — with a per-file diff beside the list. Bulk actions pre-check every
path first: if one path cannot be represented or is a symlink, submodule or special type,
the whole batch is refused before anything is written, so an action never half-applies.

## Everyday writes

| Action          | Notes                                                                |
| --------------- | -------------------------------------------------------------------- |
| Stage / unstage | One path or the whole group.                                         |
| Commit          | Message required; hooks run as they always do.                        |
| Amend           | Replaces the last commit; the message can be kept.                    |
| Stash / pop     | Stashes are listed in the Stashes panel with apply, pop and drop.     |
| Discard         | Restores **tracked** paths to the index — see below.                  |

## Discard is narrower than it sounds

Discarding restores tracked working-tree files **to the index**, never to `HEAD`. Untracked
and ignored files are never touched, and `git clean` is never run. Before writing, Refyard
takes a recovery backup of what is about to be lost; if the backup fails, the discard does
not run.

A discard is confirmed against a preview token that binds the path's content fingerprint to
the request. If the file changed between the preview and the confirmation, the operation is
stale and must be re-confirmed — `git status` markers alone are not proof that content is
unchanged.

## When the outcome is unknown

Git can have side effects even when the result cannot be established — a commit interrupted
mid-write, for example. Refyard reports that as **unknown**, refuses to retry a mutation,
blocks the next dependent write, and shows what it could and could not determine. An
uncertain result is never labelled succeeded.

## Hooks, signing and filters

Refyard never passes `--no-verify`, never turns signing off, and never rewrites your Git
configuration. If a commit fails because a hook rejected it, that is the hook's answer and
the panel shows it.
