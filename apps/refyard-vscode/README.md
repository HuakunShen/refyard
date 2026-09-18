# Refyard for VS Code

The Refyard workbench inside VS Code, for the repository you have open: working copy
(status, diffs), history with the graph, and — landing next — staging and commits.

The extension spawns the local `refyard-native` service (`--machine --port 0`), spends
its single-use machine ticket, and drives every call from the extension host; the webview
panel renders the same `@refyard/git-ui` components the desktop app embeds and never sees
a token.

## Build

```sh
pnpm install
pnpm --dir apps/refyard-vscode compile
npx -y @vscode/vsce package --no-dependencies -o refyard-0.1.0.vsix
```

`refyard.cliPath` (default `refyard-native` on PATH) names the CLI; the first `app-v*`
release ships it (Homebrew cask in `packaging/homebrew/`).
