---
title: Settings and appearance
description: Theme, accent, wallpaper, row density, author photos, updates, and where each preference is stored.
---

Open Settings with the gear in the top strip, or with `⌘,` / `Ctrl+,`.

| Setting              | What it changes                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| Theme                | Dark, Light or System. The window paints the right colour on the first frame.   |
| Accent colour        | The accent used by selection, focus rings and primary buttons.                  |
| Workbench background | A solid canvas or a preset wallpaper, with optional frosted glass behind panels. |
| Row density          | Compact (28px), Comfortable (36px) or Roomy (44px) history rows.                |
| Author photos        | GitHub profile pictures in the history list and on graph nodes. On by default.  |
| Updates              | Desktop only: check on startup, and install an offered version on request.      |

## Author photos

A commit identifies its author by email, and the only honest mapping from an email to a
GitHub account without calling an API is GitHub's own noreply convention:

```
1234567+octocat@users.noreply.github.com  →  https://github.com/octocat.png
octocat@users.noreply.github.com          →  https://github.com/octocat.png
```

Authors whose commits do not use that convention get a coloured initials avatar instead. No
repository contents are sent anywhere for this, and the pictures are loaded lazily — only
the avatars for rows you actually see are fetched. Turning the setting off stops the
requests entirely.

## Where preferences live

Preferences (theme, accent, density, photos, the last address) are stored in the browser's
`localStorage` and outlive the tab. The session token is different: it is kept in
`sessionStorage` only, because it is a credential for one service process and must not
outlive it.

## Updates

The desktop app reads the release feed, verifies the minisign signature of the artifact, and
installs only when you ask it to. It never downloads and installs silently in the
background, and a failed signature check stops the update.
