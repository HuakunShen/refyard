---
title: Browser on loopback
description: The `refyard open` form — an authenticated local origin serving the same workbench.
---

`refyard open` starts a service that serves both the API and the workbench UI from one
loopback origin. It is the form that needs no installation beyond Node, and it is what
`npx refyard` gives you.

What that service promises:

- **Loopback only.** It binds `127.0.0.1` and checks the `Origin` and `Host` headers
  exactly; a cross-site request is refused even when it carries no `Origin` at all.
- **Every request is authenticated**, reads included — a repository listing is not public
  just because it is local.
- **Pairing tickets are single-use** and minted only on trusted local channels (the `p`
  keystroke, or `refyard pair`), never over HTTP.
- **The token lives in `sessionStorage`**, so closing the tab ends it, and a service restart
  invalidates it.
- **A service worker caches the shell**, so a tab that is already open keeps working — and
  keeps saying what failed — after the service exits. It never queues a write to replay later.

The same static build is deployable elsewhere; see
[Hosted UI and Cloudflare](/forms/hosted/).
