# Evidence — desktop command line (`refyard <dir>`) on this machine

Date: 2026-11-01, 01:03–01:16 (+08:00). macOS (darwin, arm64), Node 26.8.2, rustc 1.98.
Bundle: `apps/desktop/src-tauri/target/release/bundle/macos/Refyard.app`, version 0.3.1,
installed to `/Applications/Refyard.app` (the previous bundle is at
`/tmp/refyard-app-backup-011317`).

This file records what was actually run and printed. Rows in
`docs/acceptance/2026-10-31-desktop-cli.md` cite it. Nothing here is a reconstruction: each
block is command output as captured during the run, and the parts that could not be measured
(GUI capture, because the Cua authorization was revoked mid-session) are named as missing
rather than filled in.

## Suite results

```
$ pnpm check                 → exit 0   (13 tasks; 0 svelte-check errors, 2 pre-existing CommitList a11y warnings)
$ pnpm check:contract        → exit 0   (593 named schemas)
$ pnpm check:boundaries      → exit 0   (3 portable packages, 69 source files)
$ pnpm test:unit             → 62 files, 638 tests passed
$ cargo test --workspace     → exit 0   (39 suites)
$ cargo test (desktop crate) → exit 0   (lib 13, launch_channel 2, session_owner 25, terminal 3, 1 pre-existing ignored)
$ cargo test -p refyard-launcher → 13 passed
```

## Build

```
$ pnpm desktop:build
   stage-launcher: building refyard-launcher for aarch64-apple-darwin
   Bundling Refyard.app (.../bundle/macos/Refyard.app)
   Error A public key has been found, but no private key. Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.
   exit 1
```

The `.app` is produced before the updater-signing step fails; the failure is the local
missing-key limitation, not a bundling error.

```
$ ls -l .../Refyard.app/Contents/MacOS/
-rwxr-xr-x  18632640  Nov  1 01:10  refyard-desktop
-rwxr-xr-x    484176  Nov  1 00:22  refyard-launcher
```

## Install

```
$ ditto <built Refyard.app> /Applications/Refyard.app
$ /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Refyard.app/Contents/Info.plist
0.3.1

$ ln -sfn /Applications/Refyard.app/Contents/MacOS/refyard-launcher ~/.local/bin/refyard
$ which refyard
/Users/hk/.local/bin/refyard
$ refyard --version
refyard 0.1.0
$ refyard /definitely/not/here
refyard: cannot open /definitely/not/here (No such file or directory (os error 2)); pass a directory that exists
exit=1
```

`~/.local/bin` was already on this machine's `PATH`, so no `export PATH=…` line applies here.
The link was created by hand with the same target the Settings button writes; the button
itself was not clicked (see "Not measured").

## Cold start — `refyard .`

```
$ cd /Volumes/Portable2TB/ExtDev/refyard && refyard .
launcher exit=0            # returned to the prompt immediately
$ pgrep -fl refyard-desktop
24885 /Applications/Refyard.app/Contents/MacOS/refyard-desktop /Volumes/Portable2TB/ExtDev/refyard
```

The window's own session store, read from the WebView's `localStorage`
(`~/Library/WebKit/tech.huakun.refyard/.../LocalStorage/localstorage.sqlite3`, key
`refyard.session.tabs`, UTF-16LE):

```json
{
  "tabs": [
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/refyard",
      "targetId": "tgt_local",
      "active": true
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/space-lens",
      "targetId": "tgt_local"
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/ListenFlow",
      "targetId": "tgt_local"
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/kunkun-v2.1",
      "targetId": "tgt_local"
    }
  ],
  "savedAt": "2026-10-31T17:13:48.948Z"
}
```

`savedAt` is the moment `refyard .` ran, and the named directory is the active tab — the
launch reached the page and was registered through `registerRepository` with a local target,
which is what A10 asks for.

## Warm start — a second `refyard <dir>` into the running window

```
$ cd /tmp && refyard /Volumes/Portable2TB/ExtDev/xross-dev
launcher exit=0
$ pgrep -fl refyard-desktop | wc -l
1
```

```json
{
  "tabs": [
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/refyard",
      "targetId": "tgt_local"
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/space-lens",
      "targetId": "tgt_local"
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/xross-dev",
      "targetId": "tgt_local",
      "active": true
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/ListenFlow",
      "targetId": "tgt_local"
    },
    {
      "displayPath": "/Volumes/Portable2TB/ExtDev/kunkun-v2.1",
      "targetId": "tgt_local"
    }
  ],
  "savedAt": "2026-10-31T17:16:21.516Z"
}
```

A directory that was not open before became a new, active tab in the _same_ process — the
single-instance forward. A second warm launch of an already open directory (`space-lens`,
01:14:49) activated its tab instead of adding a duplicate.

## Not measured

- The Settings → **Command line** click, and the message it renders. Cua driver authorization
  was suspended (`authorization_suspended: revoke-all`) before the click, so no screenshot or
  click-through exists. The crate tests cover the install's filesystem behaviour; the adapter
  test covers the invoke and the response schema; the page wiring is type-checked.
- Any window screenshot of the launched tab or of a refusal banner — same suspension, so the
  tab's existence above is read from the app's own persisted session, not from a picture.
- Windows, Linux, and non-arm64 macOS bundles.
