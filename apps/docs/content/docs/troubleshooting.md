---
title: Troubleshooting
description: The handful of things that actually go wrong, and what each message means.
---

## "Pairing failed"

The ticket was already spent, or it expired. Tickets are single-use with a 60-second default
lifetime (`--ticket-ttl` raises it). Ask the running service for a fresh URL:

```sh
refyard pair
```

or press `p` on the terminal that is serving.

## The page says "no live updates"

The event stream is not connected. The data on screen is the last read that succeeded. This
is the normal state when the service has exited: the shell stays usable, reads report what
failed, and **no write is queued to replay later** — reload after starting the service again.

## "that session is not valid: it expired, or this service restarted"

Sessions belong to one service process. Restarting `refyard serve` invalidates them, and the
tab must pair again with a fresh ticket (`refyard pair`).

## A port is busy

The default 9595 is a preference, not a promise: if it is taken, another free port is chosen
and printed. If you passed `--port` explicitly and it is busy, the command refuses rather
than silently moving.

## An operation says "unknown"

Git had side effects the service could not establish — usually a write interrupted mid-flight.
The service blocks the next dependent write on purpose. Look at the repository with your own
`git` to see the true state before continuing; the operation is never retried automatically.

## The desktop app will not open on macOS

Gatekeeper quarantine on an ad-hoc signed build. See
[Install](/install/#desktop-app) — `xattr -cr /Applications/Refyard.app` clears it
once.

## Doctor says the environment is unusable

```sh
refyard doctor --json
```

reports the missing piece (usually a `git` that is not on `PATH`, or a version too old for
the operations the service implements). Exit code `2` is that answer.
