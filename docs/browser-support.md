# Browser support

refyard serves a static SPA over loopback and talks to it with `fetch` and
`EventSource`. This page records what was actually exercised, what is expected to work,
and where a browser will refuse — with the recommendation being the same-origin setup
whenever a mechanism gets in the way, never a way around the mechanism.

## What was run

| Browser                          | Version                              | Result                                                                                        |
| -------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Chromium (Playwright)            | the build pinned in `pnpm-lock.yaml` | **Verified.** All 25 end-to-end specs run here, including offline reload and instance change. |
| Firefox, WebKit                  | —                                    | **Unverified.** No run has happened on these engines. Playwright can run them; nobody has.    |
| Safari, Chrome, Edge (installed) | —                                    | **Unverified.** The app is plain SPA + `fetch` + `EventSource`; nothing here claims it works. |
| Mobile browsers                  | —                                    | **Unverified**, and the layout is a desktop workbench, not a phone app.                       |

The service worker, pairing flow, event stream, keyboard reprint (`p` + Enter) and the
write panels are all covered by specs that run against the shipped bundle in this one
engine. A browser that passes nothing else should be treated as untested, not as broken.

## What the app needs

| API                              | Used for                                  | If missing                                                                                                                  |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fetch` with `Authorization`     | every API call                            | The app cannot pair or read. Nothing degrades gracefully.                                                                   |
| `EventSource` (SSE)              | live-update hints, stale-snapshot notices | Reads still work; the header says "no live updates". Nothing is lost — the app re-reads on every write and on window focus. |
| `sessionStorage`, `localStorage` | the session token, the service address    | The app runs unpaired and forgets the address on reload — the pairing URL still works.                                      |
| Service worker                   | offline app shell                         | Online use is unaffected; a reload while offline shows the browser's error page instead of "not connected".                 |
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
- A reload while offline shows the cached shell and the state "not connected (offline)".
- There is no background sync, no push, and no periodic work. A closed tab stops doing
  anything at all.

## Installing as an app

The manifest (`/manifest.webmanifest`) makes the shell installable, which pins the
origin and the port: an installed app always opens the same address, so a service on a
different port is a different app entry. The install does not start anything — refyard
runs as long as a terminal (or a process supervisor) keeps `refyard serve` alive, and
the installed window is only a view of it.
