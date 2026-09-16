# Browser support

Refyard's browser surface is a static SPA/PWA, deployed independently from the API. It talks to
the authenticated Node service with `fetch` and `EventSource`. This page records what was actually
exercised, what is expected to work, and where a browser will refuse — with the recommendation
being an explicit secure origin configuration whenever a mechanism gets in the way, never a way
around the mechanism.

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

### The former clone-form flake is fixed

The clone case in `workspace.spec.ts` failed twice, in two different engines, always the same
case and never reproducibly. Both runs were **89 passed, 1 failed**; the same case passed alone
in seconds, and the 90 of 90 runs on either side included that case. The historical failures
remain recorded below, but the lifecycle cause is now fixed and covered by a regression.

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
there when the spec looked. The service-output candidate remains useful for future failures; the
panel lifecycle candidate has been reproduced and fixed:

- **The service went away.** The harness kept the service's stderr only until readiness and
  then dropped it, so a crash or a refused connection mid-spec was invisible — which is exactly
  why the Firefox occurrence could not be explained. It now prints the service's output (both
  streams, last 4 KB each) when its test fails, and still prints stderr if the service exits
  before the spec stopped it.
- **The panel remounted and reset its own mode.** This was the lifecycle cause: the panel was
  mounted behind `{#if writesAllowed}` and kept its mode as component state. It is fixed by
  keeping `<RepositoryPanel>` mounted for a paired session and passing `disabled` while the
  browser is offline. The selected mode and typed values now survive the transient signal. The
  new regression case failed against the old implementation with `aria-pressed="false"` and
  passed on the fixed build.

The two are not mutually exclusive: a page whose reads are all failing with `NetworkError` has
answered the capabilities read with a failure, which is one more way for `writesAllowed` to
change under the panel.

### Background read failures do not erase armed actions

The stash panel now keeps its last successful rows mounted while a background stash read is
pending or failed. An already armed destructive confirmation stays visible, while the confirm
button is disabled until the read is healthy again; the error is shown alongside the stale rows.
The failure-injected case in `tests/e2e/stash.spec.ts` passes in Chromium, Firefox and WebKit,
so a transient API outage cannot make a user's first confirmation click disappear.

## What the app needs

| API                              | Used for                                  | If missing                                                                                                                  |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fetch` with `Authorization`     | every API call                            | The app cannot pair or read. Nothing degrades gracefully.                                                                   |
| `EventSource` (SSE)              | live-update hints, stale-snapshot notices | Reads still work; the header says "no live updates". Nothing is lost — the app re-reads on every write and on window focus. |
| `sessionStorage`, `localStorage` | the session token, the service address    | The app runs unpaired and forgets the address on reload — the pairing URL still works.                                      |
| Service worker                   | offline app shell                         | Online use is unaffected; a reload with the service gone shows the browser's error page instead of the cached shell.        |
| `crypto.getRandomValues`         | client request ids                        | Not used for tokens; the host mints those.                                                                                  |

## Same-origin and hosted shapes

The default local shape is same-origin: a separate static asset server (or a local preview) hosts
the page, and the CLI API stays on loopback. There is no CORS preflight and no mixed content. The
host refuses an `Origin` that is not its own, refuses `null`, and refuses `Sec-Fetch-Site:
cross-site` unless the operator has explicitly configured an exact hosted origin.

The Cloudflare shape is opt-in and still keeps the trust boundaries separate. The Worker serves
only the static PWA; it cannot reach a user's loopback by itself. A remote browser therefore needs
an operator-owned HTTPS tunnel to the CLI and a pairing URL containing the tunnel's browser-visible
`--api-origin`. The CLI must receive the exact Worker origin in `--allow-origin` and `--ui-origin`.
The API remains bearer- and ticket-authenticated; non-loopback pairing additionally requires the
environment-only `REFYARD_HOSTED_PASSWORD`, and no cookie or Worker secret is used for the Git
session. A live Cloudflare account, domain, and tunnel were not exercised by this repository run.

If a browser or an extension gets in the way, the answer is to make the request
same-origin, not to weaken a check:

| Symptom                                               | What is happening                                                                              | What to do                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_CONNECTION_REFUSED` on a `localhost` bookmark    | The service is not running, or it is on another port.                                          | Start it again, or open the pairing URL the terminal prints — the port there is the real one.                                                                                                                                |
| "The session is no longer valid" after a restart      | The service has a new instance id, so the old token is worthless.                              | Pair again with a fresh ticket (press `p` + Enter in the terminal).                                                                                                                                                          |
| Requests to `http://127.0.0.1` blocked by the browser | A public `https://` page cannot call another machine's loopback HTTP: Private Network Access and mixed content. | Configure an operator-owned HTTPS tunnel and pass its exact URL as `--api-origin`; pass the Worker origin to `--allow-origin` and `--ui-origin`. |
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
