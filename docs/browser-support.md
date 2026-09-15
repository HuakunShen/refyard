# Browser support

refyard serves a static SPA over loopback and talks to it with `fetch` and
`EventSource`. This page records what was actually exercised, what is expected to work,
and where a browser will refuse — with the recommendation being the same-origin setup
whenever a mechanism gets in the way, never a way around the mechanism.

## What was run

`pnpm test:e2e`, 2026-09-15, one worker, Playwright 1.63.0 pinned by `pnpm-lock.yaml`:
**90 passed, 0 failed (11.9 m)** — the same 30 specs per engine.

| Browser                          | Engine version | Result                                                                                                                             |
| -------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Chromium                         | 153.0.8010.12  | **Verified.** All 30 end-to-end specs, including the offline reload and the instance-change refusal.                               |
| Firefox                          | 155.0          | **Verified.** All 30.                                                                                                              |
| WebKit                           | 26.6           | **Verified.** All 30, after the two engine differences below were found and the case was made engine-independent.                  |
| Safari, Chrome, Edge (installed) | —              | **Unverified.** These are the engines above wearing a different version number and a different shell; nobody has run those builds. |
| Mobile browsers                  | —              | **Unverified**, and the layout is a desktop workbench, not a phone app.                                                            |

### What running three engines found

Two of the three are WebKit-specific, and both were in the _test_ rather than in the app —
which is the kind of thing that engine was added to find out:

- **`context.setOffline(true)` blocks navigations in WebKit.** `page.reload()` and
  `page.goto()` fail with `WebKit encountered an internal error`, and a page-initiated
  `location.reload()` is dropped outright: a marker set on `window` before the reload is
  still there afterwards and `performance.timeOrigin` has not moved. The earlier version of
  the offline-reload spec therefore asserted against the _old_ document — the shell looked
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

### One failure that is not explained yet

The clone case in `workspace.spec.ts` has failed twice, in two different engines, always the
same case and never reproducibly. Both runs are **89 passed, 1 failed**; the same case passes
alone in seconds, and the 90 of 90 runs on either side of them include that case. Neither is
counted as a browser defect, and neither is written off: they are the same open question, and
they failed the same way.

- **Firefox** (`workspace.spec.ts:86`, "clones a local bare remote and shows what Git said when
  it refuses"). `Error: locator.fill: Test timeout of 60000ms exceeded`, waiting for
  `getByTestId('repository-remote-url')` at line 99 — the line after the spec clicked
  `repository-mode-clone` and filled the destination. The page snapshot at the timeout shows
  the panel with its capabilities already loaded ("35 write operations"), every read failing
  with `NetworkError when attempting to fetch resource`, and **no clone form**.
- **WebKit** (the same case, under Node 22.23.2). The snapshot shows the panel still in
  **"Create new"** mode with its Retry buttons, capabilities loaded, and again no clone form.
  Alone in WebKit: 2 passed in 14.4 s.

A **third** run of the 90 — the full gate list on Node 22.23.2 — failed one case as well, and
that one says only "one case": the runner that drove the gates printed a summary line instead of
the log, so the failure was thrown away with it. The same revision re-ran immediately afterwards
and came back **90 passed in 10.6 m**, on the harness this revision ships. It is recorded because
a failure that cannot be described is still a failure, and because it is the reason the harness
keeps its output now.

In both described occurrences, the mode toggle had been clicked and the form it reveals was not
there when the spec looked. Two candidates, and they are testable rather than mysterious:

- **The service went away.** The harness kept the service's stderr only until readiness and
  then dropped it, so a crash or a refused connection mid-spec was invisible — which is exactly
  why the Firefox occurrence could not be explained. It now prints the service's output (both
  streams, last 4 KB each) when its test fails, and still prints stderr if the service exits
  before the spec stopped it.
- **The panel remounted and reset its own mode.** `<RepositoryPanel>` is mounted behind
  `{#if writesAllowed}` (`apps/web/src/routes/+page.svelte:1776`) and keeps the mode it is in
  as component state (`packages/git-ui/src/components/RepositoryPanel.svelte:83`, `$state`,
  not a prop). `writesAllowed` is derived from the capabilities read, so if that read resolves
  after the first paint the panel is created, destroyed and created again — and the second
  instance starts in `init`. A reader of the app, not just of the spec, sees that as: choose
  "Clone", and a moment later the choice is back to "Create new". That is a small real defect
  in the panel's lifecycle, in files owned by the UI work; nothing there was changed for this
  note, and it is written down so the next occurrence — and the UI pass — starts from the
  evidence instead of the symptom.

The two are not mutually exclusive: a page whose reads are all failing with `NetworkError` has
answered the capabilities read with a failure, which is one more way for `writesAllowed` to
change under the panel.

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
- A page the _browser_ knows is offline additionally appends "(offline)" to that badge,
  because `navigator.onLine` is a fact only the browser has.
- There is no background sync, no push, and no periodic work. A closed tab stops doing
  anything at all.

## Installing as an app

The manifest (`/manifest.webmanifest`) makes the shell installable, which pins the
origin and the port: an installed app always opens the same address, so a service on a
different port is a different app entry. The install does not start anything — refyard
runs as long as a terminal (or a process supervisor) keeps `refyard serve` alive, and
the installed window is only a view of it.
