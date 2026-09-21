---
title: Hosted UI and Cloudflare
description: Serving the workbench UI from somewhere other than loopback, without weakening the default.
---

The UI is a static build, so it can be served from any static host — Cloudflare Pages, S3, a
company web server. That does not move your repositories anywhere: the UI still talks to a
service running on your machine (or on a machine you control), and the service still refuses
origins it was not told about.

## Deploying the UI

```sh
pnpm deploy:web
```

Or use the **Deploy to Cloudflare** button in the repository README. A deployment belongs to
your own Cloudflare account.

## Allowing a hosted origin

A hosted UI is opt-in and explicit on the service side:

```sh
REFYARD_HOSTED_PASSWORD='…' refyard serve --repo ~/code/app \
  --allow-origin https://refyard.example.com \
  --ui-origin https://refyard.example.com \
  --api-origin https://machine.example.com
```

- `--allow-origin` is an exact origin, never a wildcard.
- The hosted password is environment-only: never an argument, never in a URL, never logged.
- The browser exchanges the password for a session; the password itself is not stored.
- Without `--allow-origin`, the loopback checks are unchanged and a hosted page cannot call
  the service at all.

<Callout type="warn" title="Exposing a service to a network is your decision, not a default">
Refyard does not ship a public mode. If you put a service behind a tunnel or reverse proxy,
authentication, TLS and access control on that path are yours to provide — the product only
promises the loopback form out of the box.
</Callout>
