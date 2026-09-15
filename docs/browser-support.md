# Browser support

refyard serves a static SPA over loopback and talks to it with `fetch` and
`EventSource`. This page records what was actually exercised, what is expected to work,
and where a browser will refuse — with the recommendation being the same-origin setup
whenever a mechanism gets in the way, never a way around the mechanism.

## What was run

`pnpm test:e2e`, 2026-09-15, one worker, Playwright 1.63.0 pinned by `pnpm-lock.yaml`:
**90 passed, 0 failed (11.9 m)** — the same 30 specs per engine.

| Browser  | Engine version | Result                                                                                                             |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Chromium | 153.0.8010.12  | **Verified.** All 30 end-to-end specs, including the offline reload and the instance-change refusal.                |
| Firefox  | 155.0          | **Verified.** All 30.                                                                                              |
| WebKit   | 26.6           | **Verified.** All 30, after the two engine differences below were found and the case was made engine-independent.   |
| Safari, Chrome, Edge (installed) | — | **Unverified.** These are the engines above wearing a different version number and a different shell; nobody has run those builds. |
| Mobile browsers | —               | **Unverified**, and the layout is a desktop workbench, not a phone app.                                            |

### What running three engines found

Two of the three are WebKit-specific, and both were in the *test* rather than in the app —
which is the kind of thing that engine was added to find out:

- **`context.setOffline(true)` blocks navigations in WebKit.** `page.reload()` and
  `page.goto()` fail with `WebKit encountered an internal error`, and a page-initiated
  `location.reload()` is dropped outright: a marker set on `window` before the reload is
  still there afterwards and `performance.timeOrigin` has not moved. The earlier version of
  the offline-reload spec therefore asserted against the *old* document — the shell looked
  cached, the data looked stale, and nothing proved either. The case now stops the service
  process instead of emulating an outage at the browser, which is a plain reload every
  engine runs and is also the closer reproduction of "`refyard serve` exited, the tab is
  still open".
- **`page.waitForFunction("<string>")` is refused** in WebKit: the page's CSP has no
  `'unsafe-eval'`, so the string is not evaluated. The same expression passed to
  `page.evaluate` is fine, and the specs use that.

The third finding is not engine-specific, but the offline case is what surfaced it: with
the service gone, the repository-creation panel said **"not implemented in this build"** — a
claim about the build, made by a page that had received no capabilities at all. It now says
"the service has not reported its operations", and the e2e case asserts that wording, so the
two answers cannot collapse back into one.

## What the app needs

| API                              | Used for                                  | If missing                                                                                                                  |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fetch` with `Authorization`     | every API call                            | The app cannot pair or read. Nothing degrades gracefully.                                                                   |
| `EventSource` (SSE)              | live-update hints, stale-snapshot notices | Reads still work; the header says "no live updates". Nothing is lost — the app re-reads on every write and on window focus. |
| `sessionStorage`, `localStorage` | the session token, the service address    | The app runs unpaired and forgets the address on reload — the pairing URL still works.                                      |
| Service worker                   | offline app shell                         | Online use is unaffected; a reload with the service gone shows the browser's error page instead of the cached shell.        |
| `crypto.getRandomValues`         | client request ids                        | Not used for tokens; the host mints those.                                                                                  |

## Same-origin is the supported shape

The service serves the page it protects, so every request is same-origin, there is no
CORS preflight, no `Sec-Fetch-Site: cross-site` refusal, and no mixed content. That is
not an accident of packaging: the origin policy in the host refuses an `Origin` that is
not its own, refuses `null`, and refuses `Sec-Fetch-Site: cross-site` outright, so the
same-origin path is the only one this build can promise.

If a browser or an extension gets in the way, the answer is to make the request
same-origin, not to weaken a check:

| Symptom                                               | What is happening                                                                              | What to do                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_CONNECTION_REFUSED` on a `localhost` bookmark    | The service is not running, or it is on another port.                                          | Start it again, or open the pairing URL the terminal prints — the port there is the real one.                                                                                                                                |
| "The session is no longer valid" after a restart      | The service has a new instance id, so the old token is worthless.                              | Pair again with a fresh ticket (press `p` + Enter in the terminal).                                                                                                                                                          |
| Requests to `http://127.0.0.1` blocked by the browser | A public `https://` page cannot call loopback HTTP: Private Network Access, and mixed content. | Open the workbench from the service's own origin. The hosted-page-to-local-API shape is **not implemented** in this build, deliberately: it would need an explicit origin grant on the host and a documented trust decision. |
| "not connected (incompatible service)"                | The page and the service disagree about the API major.                                         | Update whichever is older. The page refuses rather than guessing at semantics.                                                                                                                                               |
| Event stream never connects                           | A proxy or extension is buffering `text/event-stream`.                                         | Use the page directly; the header shows "no live updates" and everything else still works.                                                                                                                                   |

## Offline behaviour

- The service worker caches **only** this build's own assets, keyed by build version.
  `/api/*` is never cached and never served from cache, for any method.
- While the browser reports offline, write controls refuse with a message and nothing is
  queued: a write is never deferred to a moment when the user is not looking, and it is
  never replayed after the connection returns.
- **A reload with the service gone is served from the worker's cache.** Every document is
  served `cache-control: no-store`, so a shell that arrives while the service is stopped
  can only have come from the worker. The reloaded page reports "no live updates" (the
  event stream's state), the repository list reports the failed read, no write control is
  offered, and nothing is queued — verified in all three engines.
- A page the *browser* knows is offline additionally appends "(offline)" to that badge,
  because `navigator.onLine` is a fact only the browser has.
- There is no background sync, no push, and no periodic work. A closed tab stops doing
  anything at all.

## Installing as an app

The manifest (`/manifest.webmanifest`) makes the shell installable, which pins the
origin and the port: an installed app always opens the same address, so a service on a
different port is a different app entry. The install does not start anything — refyard
runs as long as a terminal (or a process supervisor) keeps `refyard serve` alive, and
the installed window is only a view of it.
