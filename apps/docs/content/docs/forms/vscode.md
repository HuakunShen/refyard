---
title: VS Code extension
description: The workbench inside a VS Code webview, driven by a supervised CLI.
---

The extension embeds the same workbench UI in a webview and supervises a `refyard` process
for it:

- The extension starts the CLI in machine mode, reads the readiness JSON from stdout and the
  single-use pairing URL from stderr — the same supervisor protocol any parent process can
  use.
- The webview pairs once with that ticket; the ticket is spent and never stored.
- The extension's version and the CLI's version are checked against each other, and a
  mismatch is reported rather than hidden.

The `.vsix` is attached to each desktop release, so the extension version always matches the
release it came from.

```sh
code --install-extension refyard-<version>.vsix
```
