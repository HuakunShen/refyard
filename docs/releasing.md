# Releasing

Refyard separates verification from publication. `ci.yml` tests the repository; the
tag-triggered `.github/workflows/publish.yml` is the only workflow allowed to publish the
self-contained npm package.

## Release identity

- **Package:** `refyard` from `packages/npm-dist`.
- **Published so far:** npm `0.1.1` (the owner published `0.1.0` and `0.1.1` by hand);
  desktop app `0.1.2`, with the matching cask in `HuakunShen/homebrew-tap`.
- **Prepared by this checkout:** `0.2.0`, for both the npm package and the desktop app.
  The npm package version lives in `packages/npm-dist/package.json`; the desktop version
  lives in `apps/desktop/src-tauri/tauri.conf.json` (and is mirrored in that crate's
  `Cargo.toml`/`Cargo.lock` and `apps/desktop/package.json`). The tag names are `v0.2.0`
  for npm and `app-v0.2.0` for the desktop app.
- **License:** GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).
- **Repository:** `https://github.com/HuakunShen/refyard`.
- **Package contents:** the Node Git service plus the same static PWA under `dist/web` for the
  default local workbench. `apps/web` can additionally deploy that UI to Cloudflare.

The package manifest contains no dependencies, install scripts, or workspace references. The
release build carries its runtime code in the bundle, and `pnpm pack:smoke` installs the actual
tarball in an isolated temporary environment before publication.

Published npm versions are immutable. A release mistake is corrected with a new version; the
same version must never be republished.

## npm Trusted Publisher setup

Configure the package on npmjs.com before pushing the first release tag. In the package's
Trusted Publisher form choose:

| Field                | Value                        |
| -------------------- | ---------------------------- |
| Publisher            | GitHub Actions               |
| Organization or user | `HuakunShen`                 |
| Repository           | `refyard`                    |
| Workflow filename    | `publish.yml`                |
| Environment name     | `publish`                    |
| Allowed action       | enable **Allow npm publish** |

The workflow filename is the filename only, not `.github/workflows/publish.yml`. All fields are
case-sensitive. The workflow grants `id-token: write` and uses a GitHub-hosted runner; it does
not read `NPM_TOKEN` or `NODE_AUTH_TOKEN`. npm Trusted Publishing uses short-lived OIDC
credentials and automatically creates provenance for a public package from a public repository.
See the [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).

**This configuration has never been exercised.** Only `app-v*` tags exist on `origin`, so
`publish.yml` has never run, and `0.1.0`/`0.1.1` reached the registry through a manual
`npm publish`. If the publisher form above is not filled in for the `refyard` package, the
tag-triggered run fails at the last step (the provenance/OIDC exchange) while every gate
before it passes; the fallback is to publish by hand from a checkout of the tag:

```sh
cd packages/npm-dist && npm publish   # with the owner's own npm credentials
```

Confirm the setup before relying on the tag path: after pushing `v0.2.0`, watch the run, and
treat a red `Publish with npm Trusted Publishing` step as "publish manually", not as a reason
to move the tag.

## Local release gates

Run these commands from a clean checkout of the revision to release. Use `CI=1` in a non-TTY
environment so pnpm does not ask before recreating its modules directory:

```sh
CI=1 pnpm install --frozen-lockfile
CI=1 cargo build --release          # tests/native drives target/release/refyard-native
CI=1 pnpm check
CI=1 pnpm check:boundaries
CI=1 pnpm check:contract
CI=1 pnpm test:unit
CI=1 pnpm test:integration
CI=1 pnpm test:pack
CI=1 pnpm test:portable
CI=1 cargo test --workspace
CI=1 pnpm build:release
CI=1 pnpm pack:smoke
CI=1 pnpm --dir apps/web exec wrangler deploy --dry-run
```

The full browser and compatibility gates remain part of the repository release checklist:

```sh
CI=1 pnpm test:e2e
CI=1 pnpm test:compat
```

Two rows of that checklist cannot be completed on every machine, and a release report must say
which: the compat suite's Firefox project needs a Firefox that can create its profile (on this
workstation it exits with `Could not find profile folder` and the three Firefox cases are
NOT RUN), and `tests/e2e/offline.spec.ts:92` fails for a reason that predates 0.2.0 — the
assertion looks for a brand string that the post-reload launcher state no longer renders
(reproduced identically against a build of `f933d2f`). Neither gate is part of the publish or
release workflows.

`pnpm build:release` stages `packages/npm-dist/dist` and records the source revision in
`dist/build-info.json`; `pnpm pack:smoke` verifies the staged package rather than a fresh rebuild
at publish time.

## CI publication

The publisher runs only for a tag matching `v*`:

```sh
git tag -a v0.2.0 -m "refyard v0.2.0"
git push origin v0.2.0
```

Before `npm publish`, `.github/workflows/publish.yml` performs the static, unit, integration,
portability, package, build, and installed-tarball gates, then checks:

```text
GITHUB_REF_NAME == "v" + packages/npm-dist/package.json.version
```

The integration gate drives the real `refyard-native` binary, which the workflow builds with
`cargo build --release` first: without it the gate fails on `tests/native` before reaching
`npm publish` (every run before that step existed was red for this reason).

The final step runs `npm publish` with `working-directory: packages/npm-dist`. There is no manual
publish command and no npm token to rotate. The `publish` GitHub environment is intentionally a
release-control point: configure any required approval there before creating a tag.

## Desktop app release

The desktop app is a second release line with its own tag prefix, `.github/workflows/release.yml`:

```sh
git tag -a app-v0.2.0 -m "Refyard desktop v0.2.0"
git push origin app-v0.2.0
```

The tag carries the version; the artifacts come from `apps/desktop/src-tauri/tauri.conf.json`,
which must already read `0.2.0` (`tauri-action` fills `tagName: app-v__VERSION__` from it). The
workflow's gate job runs `pnpm check`, `pnpm test:unit` and `cargo test --workspace`, then builds
five targets (macOS aarch64/x64, Ubuntu x64/arm64, Windows x64 NSIS) and attaches the `.vsix`.

Each platform job publishes to the same GitHub release, and `latest.json` plus its minisign
signature are what the in-app updater reads. Signing uses `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repository secrets.

Verify the release feed and then fill the cask:

```sh
gh release view app-v0.2.0 --json assets --jq '.assets[].name'
curl -sL https://github.com/HuakunShen/refyard/releases/download/app-v0.2.0/latest.json
shasum -a 256 <(curl -sL https://github.com/HuakunShen/refyard/releases/download/app-v0.2.0/Refyard_0.2.0_aarch64.dmg)
shasum -a 256 <(curl -sL https://github.com/HuakunShen/refyard/releases/download/app-v0.2.0/Refyard_0.2.0_x64.dmg)
```

`packaging/homebrew/Casks/refyard.rb` in this repository is the source of truth for the cask;
`0.2.0` and the two digests above go into it, and the same file is pushed to
`HuakunShen/homebrew-tap` as `Casks/refyard.rb` (the owner's action — this repository never
pushes). Then verify the install path end to end:

```sh
brew audit --cask refyard
brew install --cask HuakunShen/refyard/refyard
```

The app updates itself from the release feed, so a machine already running 0.1.x will offer
0.2.0 through Settings → Check for updates without Homebrew.

## Verify the published artifact

After the GitHub Actions run succeeds, verify the registry metadata and provenance:

```sh
npm view refyard version dist.integrity dist.tarball
npm view refyard --json | rg 'version|repository|license|dist'
```

Then install the published version in a scratch directory, never from this checkout:

```sh
release_tmp="$(mktemp -d)"
cd "${release_tmp}"
npm exec --yes --package refyard@0.2.0 -- refyard doctor --json
```

This check exercises the package that reached the registry. Do not run an unverified remote
package named `refyard` before the owner has published this repository's package; the name is
registry-owned and the repository's local tests use only locally built tarballs before that point.

## Cloudflare UI deployment

The Cloudflare Worker is a separate static/PWA artifact. It has no Git authority, API proxy,
repository path, bearer token, hosted password, or upload route. Maintainers can deploy it with:

```sh
pnpm deploy:web
```

The public README also exposes an official Deploy to Cloudflare button. A user's deployment
belongs to that user's Cloudflare account; it is not a deployment of this maintainer account and
does not move Git contents to a central Refyard server. The UI can connect to a backend only when
the user supplies an operator-owned HTTPS endpoint and exact allowed origin.

## What the release does not promise

- The npm package serves its bundled UI only on the loopback local-workbench path; `serve` remains API-only.
- The Cloudflare Worker does not run Git or receive repository contents.
- The Node host is loopback-only by default and authenticates reads as well as writes.
- Hosted access requires an exact origin allowlist and environment-only
  `REFYARD_HOSTED_PASSWORD`.
- Platform/browser rows marked unverified in `docs/evidence/release-matrix.md` remain unverified
  until their named environment is actually exercised.
