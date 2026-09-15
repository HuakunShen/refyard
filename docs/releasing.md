# Releasing

Everything the person publishing has to decide, everything already done, and the exact commands.
Written for the first publish, which is a manual step by design: the tarball that reaches the
registry is the one whose checks ran, not a rebuild on a release machine.

## What is already in place

- **The publishable package is `packages/npm-dist`.** `pnpm build:release` copies the CLI bundle,
  its `bin` entry and the built SPA into it; nothing in it is hand-written except its manifest.
- **Its manifest declares no dependencies, no install scripts, no workspace references**, and
  `pnpm pack:smoke` fails the build if it ever does — a package with a postinstall script is a
  package that runs code on someone's machine at install time.
- **The tarball is checked before it is published**: `pnpm test:pack` (contents and manifest rules)
  and `pnpm pack:smoke`, which installs the tarball through `npm exec` in a temporary directory
  with an isolated `HOME` and cache, then drives the installed CLI: `doctor`, `serve --json`, the
  packaged UI, the authenticated API, a busy port, tarball contents.
- **A dry run was measured on 2026-09-15** from the staged package at revision `ab1d5fb`:

  ```
  npm notice name: refyard          npm notice package size:  2.2 MB
  npm notice version: 0.0.0         npm notice unpacked size: 5.2 MB
  npm notice total files: 191       npm notice shasum: 6a9a4e468ad5037022ae56c81a7da868cda1db72
  ```

  `npm publish --dry-run` prints what would be uploaded and contacts nothing. What it does *not*
  prove is the step after it — the real `npm publish` — which stays the publisher's.

## Decisions that are not mine to make

| Decision    | Where                                | State today                                                                                                                        |
| ----------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Name        | `packages/npm-dist/package.json`     | `refyard`. Checked against the registry on 2026-09-15: **unclaimed** (`404`). Publishing claims it, permanently, for this account. |
| Version     | same                                 | `0.0.0`, a placeholder. `0.1.0` is the conventional first release; a published version can never be reused or edited.              |
| License     | same                                 | `UNLICENSED`. On a public package that means "no license granted" — legal to publish, and a decision nobody else can make.        |
| Description | same                                 | Reads "Not published; install from a locally built tarball." — true until the moment it is published, then it is the registry text. |
| Public      | the publish command                  | `refyard` is unscoped, so a plain `npm publish` publishes it **publicly**. `npm publish --access restricted` refuses rather than silently restricting nothing. |

Two mechanical facts: `"private": true` must be removed from that manifest or `npm publish` refuses
(it is `true` today, deliberately, so no accident can publish it), and the repository is
`UNLICENSED` and will be pushed to a **private** GitHub repository — a published npm package whose
source is private is ordinary, but it is worth saying out loud in the release notes.

## The commands

```sh
# 1. Build and check, from a clean checkout of the revision being released.
pnpm install --frozen-lockfile
pnpm check && pnpm check:boundaries && pnpm check:contract
pnpm test:unit && pnpm test:integration && pnpm test:pack && pnpm test:portable
pnpm build:release
pnpm pack:smoke

# 2. Edit packages/npm-dist/package.json: name, version, license, description, and remove
#    "private": true.

# 3. Dry run — prints the file list, sizes and integrity hash without contacting the registry.
cd packages/npm-dist && npm publish --dry-run

# 4. Publish. `--otp` if the account has 2FA (it should).
cd packages/npm-dist && npm publish --otp <code>

# 5. Verify what is actually in the registry, then install it from the registry in a scratch
#    directory and run it there — not from this checkout.
npm view refyard version dist.integrity dist.tarball
cd "$(mktemp -d)" && npm exec --yes --package refyard@<version> -- refyard doctor --json
```

Step 5's `npm exec` fetches the published package. That is the one place in this project where a
package named `refyard` may be run from a registry, and only after this manifest has been published
by the account that owns the name: before that, the name is somebody else's to take, which is
exactly why every other test uses locally built tarballs.

## Release notes, at minimum

- The version, the Node major (`engines: >=26 <27`), and the `git` functional baseline (2.43;
  `fetch`/`pull` additionally need 2.41+ porcelain and are reported per probe by `refyard doctor`).
- What the release does **not** do, in the words the evidence file uses: no hosted origin, no
  terminal, no plugin host, and the write operations listed in `GET /api/v1/capabilities` are the
  complete set.
- The verification status of the platforms it will run on — `docs/evidence/release-matrix.md` and
  `docs/evidence/linux-and-windows.md` are the source, including the rows that say *unverified*.
- That the service is loopback-only and authenticated, and that it runs the machine's own `git`
  (hooks, filters and credential helpers included) against approved directories.

## After the first publish

- A published version is immutable: a mistake is fixed by publishing the next version, never by
  editing or unpublishing (unpublishing is possible within 72 hours and is the kind of thing that
  breaks somebody's lockfile).
- The `packageManager` pin (`pnpm@11.25.0`) and `.nvmrc` (Node 26.8.2) are the toolchain the
  release was tested with; a publish from a different toolchain should say so.
- `.github/workflows/ci.yml` runs the same gate list on `ubuntu-latest` and `macos-latest`. It has
  not run yet at the time of writing; a release whose CI never ran should say that too.
