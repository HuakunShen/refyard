# Releasing

Refyard separates verification from publication. `ci.yml` tests the repository; the
tag-triggered `.github/workflows/publish.yml` is the only workflow allowed to publish the
API-only npm package.

## Release identity

- **Package:** `refyard` from `packages/npm-dist`.
- **Current published version:** `0.1.1`.
- **Next release prepared by this checkout:** `0.1.2`.
- **License:** GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).
- **Repository:** `https://github.com/HuakunShen/refyard`.
- **Package contents:** the API-only Node CLI; the static PWA is deployed separately from
  `apps/web` and is never included in the npm tarball.

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

## Local release gates

Run these commands from a clean checkout of the revision to release. Use `CI=1` in a non-TTY
environment so pnpm does not ask before recreating its modules directory:

```sh
CI=1 pnpm install --frozen-lockfile
CI=1 pnpm check
CI=1 pnpm check:boundaries
CI=1 pnpm check:contract
CI=1 pnpm test:unit
CI=1 pnpm test:integration
CI=1 pnpm test:pack
CI=1 pnpm test:portable
CI=1 pnpm build:release
CI=1 pnpm pack:smoke
CI=1 pnpm --dir apps/web exec wrangler deploy --dry-run
```

The full browser and compatibility gates remain part of the repository release checklist:

```sh
CI=1 pnpm test:e2e
CI=1 pnpm test:compat
```

`pnpm build:release` stages `packages/npm-dist/dist` and records the source revision in
`dist/build-info.json`; `pnpm pack:smoke` verifies the staged package rather than a fresh rebuild
at publish time.

## CI publication

The publisher runs only for a tag matching `v*`:

```sh
git tag -a v0.1.2 -m "refyard v0.1.2"
git push origin v0.1.2
```

Before `npm publish`, `.github/workflows/publish.yml` performs the static, unit, integration,
portability, package, build, and installed-tarball gates, then checks:

```text
GITHUB_REF_NAME == "v" + packages/npm-dist/package.json.version
```

The final step runs `npm publish` with `working-directory: packages/npm-dist`. There is no manual
publish command and no npm token to rotate. The `publish` GitHub environment is intentionally a
release-control point: configure any required approval there before creating a tag.

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
npm exec --yes --package refyard@0.1.2 -- refyard doctor --json
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

- The npm package does not ship or serve the UI.
- The Cloudflare Worker does not run Git or receive repository contents.
- The Node host is loopback-only by default and authenticates reads as well as writes.
- Hosted access requires an exact origin allowlist and environment-only
  `REFYARD_HOSTED_PASSWORD`.
- Platform/browser rows marked unverified in `docs/evidence/release-matrix.md` remain unverified
  until their named environment is actually exercised.
