# Deliverable A — the local desktop application, run for real

The first real `.app`: built from the same SPA the browser gets, launched without a terminal,
reading a local repository through the Rust host over Tauri IPC. Everything below was produced by
running it; nothing is projected from a test.

The application was built from the tree committed as
`feat(web): inject backend adapters and ship the local native workbench`, whose parents are
`docs(evidence): record the native desktop host and what it does not yet do` and
`feat(native): serve the local repository picker from the native host`.

## The artifact

| Fact | Value |
|---|---|
| Build command | `pnpm desktop:build` (`bun scripts/build-desktop.ts`: SPA into `apps/web/build-desktop`, then Tauri) |
| Bundle | `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app` |
| Installed bytes | 12 MiB (walked, not `stat` on the directory) |
| Executable SHA-256 | `5ebf4a4e5cfde20105552640f98d53bbb7c0fccfc3e01331c096d8df33a26000` |
| Signed | no |

## Two launches

**A Finder-equivalent launch.** `open .../Refyard.app` — no terminal, no backend started first, no
Node executable configured anywhere. Host pid 50268, window "Refyard" 1360×900. The window rendered
the launcher, not a blank page.

**A minimal-environment launch.** The binary run directly with nothing but system paths:

```
env -i PATH=/usr/bin:/bin HOME="$HOME" TMPDIR=/tmp LANG=C \
  apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app/Contents/MacOS/refyard-desktop
```

`ps eww` on the resulting host (pid 87198) reports exactly `PATH=/usr/bin:/bin`, `HOME=/Users/hk`,
`TMPDIR=/tmp`. On that PATH `git` resolves to `/usr/bin/git` — and `node`, `bun` and `deno` do not
exist at all. The same repository opened and rendered in that instance.

## What the window showed

Read through the accessibility API rather than from an image (see the screenshot note below), after
opening `/private/tmp/refyard-app-fixture/repo` through the launcher's Browse dialog:

```
tab:        repo · main · "read-only build" · "live updates"
navigation: Repositories 1 · Working Copy 3 · Refs 1

History
  Refresh · Search commit messages · Filters · Clear
  publish the version constant   main   Refyard Fixture   7b127fe0
  add a farewell helper                 Refyard Fixture   603a10a0
  add the greeting helper               Refyard Fixture   9e9b6cbf
  End of the loaded history

Working Copy
  /private/tmp/refyard-app-fixture/repo · main · 3 changed
  Unstaged Files 2
    .M README.md
    ?? notes.txt  untracked
  Staged Files 1
    A. src/name.ts
  Commit     1 staged path
    [Commit message]  [Commit] [Amend…]   (all disabled)
```

The repository's own state, for comparison:

```
$ git status --short          $ git log --oneline
 M README.md                  7b127fe publish the version constant
A  src/name.ts                603a10a add a farewell helper
?? notes.txt                  9e9b6cb add the greeting helper
```

The object names, the author, the relative times and every status marker match. The Browse dialog
that produced the path is itself a native read: it listed `/Users/hk` (197 entries, `.nvm` offered
with **Open** because it carries a `.git` marker), and at the repository it listed only `src` —
files and `.git` excluded, exactly as the picker read is specified.

## Process and network facts

- **No socket, and no listener.** `lsof -nP -a -p 50268 -i` is empty, as is
  `lsof -nP -a -p 50268 -iTCP -sTCP:LISTEN`. The host talks to its WebView over Tauri IPC; there is
  no localhost HTTP listener to find.
- **The process tree** is the host plus the system's WebKit XPC services (GPU, Networking,
  WebContent — reparented to launchd, as macOS does). No Node, Bun, Deno, Electron, sidecar or
  bundled runtime appears anywhere in it.
- **Git runs as a child of the host.** Sampling the host's children every 50 ms for ten seconds
  caught 24 distinct `git` PIDs, each seen exactly once — transient processes being reaped, not a
  leak. Reads are the machine's own Git, spawned per command.
- **Shutdown leaves nothing.** After quitting, no `refyard-desktop` process remains. Other
  `refyard`-named processes on this machine belong to the main worktree's development servers
  (`bun .refyard-dev/cli.mjs serve …`), not to the app.

## What this does not cover

- **No screenshot file is stored, and that is a limitation of this environment rather than a
  choice.** `screencapture` cannot capture from this shell — it fails with
  `could not create image from display`, because the process has no macOS Screen Recording
  permission — so the window is recorded above as its accessibility transcription and the visual
  state was confirmed through the automation host's own capture, which cannot write a file here.
  Persisting a real screenshot needs a permission this environment does not have.
- **The worktree selector renders empty.** The host reports no `worktrees` read, so the panel has
  nothing to offer — and its empty state does not distinguish "this host cannot list worktrees"
  from "this repository has no linked worktrees". No error is shown, but the silence is a gap.
- **Nothing was written.** Stage, Unstage, Commit and Amend are all disabled because the host
  advertises no operations; that is the intended behaviour for this milestone, and it means no
  write path has been exercised at all.
- **Only macOS arm64**, unsigned, and only with this machine's Git (2.50.1, Apple Git-155). The
  Windows and Linux bundles do not exist yet.
- **Not exercised here:** HTTP mode's behaviour against a *native* build is unchanged by design
  (the registry picks HTTP when no Tauri marker is present) and its tests pass, but the browser
  suite was run against the served build, not against this bundle.

## Which acceptance rows this evidence speaks to

| Row | What this record shows |
|---|---|
| A01 | Launched from `open` with no terminal and no backend; the window rendered the workbench |
| A02 | The same repository rendered in an instance whose PATH is `/usr/bin:/bin`, verified from the process environment |
| A03 | The bundle contains one executable, `Info.plist` and an icon; `otool -L` lists system frameworks only — no JavaScript engine is linked, and no runtime is bundled |
| A04 | The process tree contains the host and the system's WebView services, plus transient `git` children; nothing else |
| A05 | The host process holds no socket and no listener; every read in the window came over the IPC |
| A07 | The desktop bundle is built from `apps/web` by `scripts/build-desktop.ts`; no desktop copy of the pages exists |
| A08 | The served build still builds and its suite passes: `pnpm build:web` writes `build/200.html`, `pnpm test:unit` 409 passed, `pnpm exec vitest run tests/adapters` 38 passed, `pnpm check` clean |

Rows this record does not speak to are left unsaid rather than assumed: A06 needs the standalone CLI
(it does not exist yet), and the write-path rows need the milestones that follow.
