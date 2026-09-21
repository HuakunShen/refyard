---
title: Desktop app
description: The native Tauri app — what ships, what it runs, and how it updates.
---

The desktop app is the headline form: a native window whose host is Rust, running your
machine's `git` directly. Nothing about it routes through localhost HTTP — the UI talks to
the host over Tauri's IPC, and the SPA is compiled into the binary.

- **No JavaScript runtime ships with it.** A verification step in the build fails if one
  ever appears in the bundle.
- **No listener opens.** There is no loopback port to reach, so nothing else on the machine
  can talk to it.
- **Repositories are approved explicitly.** A path is opened because you opened it, and the
  approved roots are visible and revocable in the app.
- **SSH uses your OpenSSH**, so hosts, aliases, jump hosts and host-key verification all come
  from `~/.ssh/config` — the remote machine installs nothing.

## Updates

Settings → Check for updates reads the release feed, verifies the artifact's minisign
signature, installs it in place and offers to restart. An update is never installed without
that request, and a signature that does not verify stops it.

## Where its files are

| Path                                             | What it holds                     |
| ------------------------------------------------ | --------------------------------- |
| `~/Library/Application Support/refyard` (macOS)   | Approved roots, settings, journal |
| `~/Library/WebKit/dev.refyard.desktop` (macOS)    | The webview's own storage         |

`brew uninstall --zap --cask refyard` removes both.
