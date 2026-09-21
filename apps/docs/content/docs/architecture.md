---
title: Architecture in one page
description: Two interfaces, one contract, and the rule that keeps intentions from becoming command lines.
---

```
Browser / desktop webview / VS Code webview
      │  GitService: JSON DTO + authenticated transport (HTTP+SSE, or Tauri IPC)
Host: auth, scope, jobs, journal, lifecycle
      │  trusted Git core: planners / parsers / workflows
      │  GitHostPort: commands, approved I/O, text codec, cancellation
Adapters: process, filesystem, clock, crypto, private state
      │
your machine's git → your repository, your credentials, your hooks
```

## Two interfaces, never mixed

- **`GitService`** is the public, closed-semantic JSON API for UIs. It is the only thing a
  browser or webview may call.
- **`GitHostPort`** is the private, scope-bound capability used only by trusted core inside
  the host.

The browser sends Git *intentions*; only trusted core turns an intention into argv. Raw
arguments, a working directory, a shell or environment variables never cross the boundary —
there is no `runGit(args, cwd)` to reach.

## One contract, several hosts

The public contract is defined once, in TypeScript with Zod, and exported as JSON Schema. The
native host projects that same schema into Rust types, so the two hosts cannot drift into
"almost the same" DTOs. Responses are validated against the checked-in schema on both sides.

## Byte-safe reading

Git's output is read as bytes and unframed by format — NUL framing, `cat-file --batch` length
headers — never decoded to a string and split on newlines. Object IDs are validated against
the repository's detected object format rather than assuming 40 hex characters.

## The graph is computed apart from the pixels

`@refyard/git-graph` decides where lanes are and nothing else; a geometry module turns that
into the segments an SVG draws. That split is what makes "the graph looks right but drifts
one pixel per row against real data" a testable bug instead of a visual one.

## One writer, and it says so

Inside a service, writes to a repository are queued: one writer per common Git directory. The
queue never claims to lock out an external IDE, terminal or agent — the repository is yours,
and another process may change it at any moment. That is why reads are re-checked and
previews bind content.
