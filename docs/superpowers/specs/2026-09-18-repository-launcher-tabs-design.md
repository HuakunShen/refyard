# Repository Launcher and Tabs Design

**Status:** Approved direction, ready for implementation
**Date:** 2026-09-18
**Product phase:** Local workbench entry flow

## Summary

The local workbench starts without requiring a repository path on the command line. `pnpm dev`
starts a local coordinator and the SvelteKit development UI; the first screen lets the user open a
local repository, clone one, or create one. Explicitly opened repositories appear in a Recent list.
The session can keep several approved repositories open as tabs and switches one active repository
at a time.

The browser never discovers the filesystem or sends raw Git commands. Open accepts a user-entered
absolute path through the authenticated local coordinator, which applies the existing repository
validation and explicit approval rules. Recent entries are records of explicit user actions, never
a parent-directory scan.

## Requirements

- `pnpm dev` provides a usable local launcher page without a preselected repository.
- Open, Clone, and Create are visible entry actions with validation and actionable errors.
- Recent repositories are searchable, explicitly recorded, and reopenable when still valid.
- A session can have multiple repository tabs; exactly one repository is active in the workbench.
- Opening, cloning, or creating a repository registers it through the existing authorization path.
- Closing a tab does not revoke a repository; revocation remains an explicit management action.
- Existing `refyard open <path>` and API-only `refyard serve --repo <path>...` remain compatible.
- Existing History filters, selection, mutations, and repository-specific query state reset on active
  repository changes.
- No filesystem scan, implicit parent-root widening, credential persistence, or raw path authority
  crosses the browser boundary.

## UX

The launcher uses three primary actions: Open, Clone, and Create. Open has an absolute path field
and a Recent list; the browser cannot safely return a local absolute path from a normal directory
picker, so the local coordinator remains the authority. Clone and Create reuse their existing
forms and return to the active workbench after success.

The top bar contains repository tabs with display name, branch/head summary, close action, and a
New Tab action. Tabs are session state; the recent list is durable service state. A repository tab
may be selected, closed, or reopened without revoking its grant.

## Architecture and API

The coordinator starts with zero repositories in development mode and exposes the existing
repository management capability. A new launcher/read DTO returns explicit recent repository
records with repository ID, display name/path, last-opened time, and availability/error state.
Open/reopen uses the existing register/approval flow. Clone and Create use existing mutation
requests and then register the resulting repository.

The web app owns `launcherState` and `openTabs` pure models. Query keys continue to include the
active repository ID, so switching tabs cannot reuse another repository's status/history cursor.
The active repository is the only one whose panels render data; tabs do not imply parallel Git
processes.

## Security and failure behavior

An invalid, missing, non-repository, unreadable, duplicate, or out-of-scope path returns the
existing typed problem and leaves tabs/recent entries unchanged. A repository replacement is
reported as unavailable until it is explicitly reopened and reauthorized. Recent paths are
display data; repository IDs and grants remain host-issued authority.

## Verification

Unit tests cover launcher/tab transitions, duplicate/open/close/reopen behavior, active-repository
query identity, and recent filtering. Integration tests cover zero-repository dev startup,
explicit open/register, clone/create registration, invalid paths, and revocation. Chromium covers
the launcher, recent reopen, clone/create entry actions, two tabs with switching, closing a tab,
and preserving the existing History surface after switching.
