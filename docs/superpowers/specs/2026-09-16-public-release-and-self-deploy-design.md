# Public release and self-deploy design

**Date:** 2026-09-16  
**Status:** Approved direction; implementation follows after this spec review  
**Repository:** `HuakunShen/refyard`

## Intent

Make Refyard understandable and reproducible as a public project without changing its
trust boundary: Git remains on the machine that owns the repository, the npm package is
published by a narrowly authorized GitHub Actions workflow, and the browser UI can be
deployed to each user's own Cloudflare account.

The screenshot supplied with the request is treated as configuration reference only. The
repository is the source of truth for workflow names and package metadata.

## Decisions

- The GitHub repository becomes public: `HuakunShen/refyard`.
- The repository and publishable package use GNU Affero General Public License v3.0,
  represented in package metadata as `AGPL-3.0-only`.
- `ci.yml` remains the verification workflow and does not publish.
- A new `.github/workflows/publish.yml` is the only publication workflow.
- npm's current `latest` is `0.1.1`; the first CI release from this change is `0.1.2`.
- npm publication uses the existing Trusted Publisher tuple: GitHub Actions, repository
  `HuakunShen/refyard`, workflow filename `publish.yml`, and environment `publish`.
- No npm token is added to GitHub, the repository, or the package.
- Cloudflare hosts the static PWA/UI only. It never receives Git contents, repository
  paths, bearer tokens, hosted passwords, or a general-purpose Git/API proxy.
- The default UI/API flow remains local or operator-owned HTTPS; any future remote data
  synchronization is a separate explicit opt-in feature.

## Release workflow

`.github/workflows/publish.yml` runs on Git tags matching `v*`. Its publish job:

1. checks out the tagged revision on a GitHub-hosted Ubuntu runner;
2. installs the pinned pnpm and Node versions;
3. installs the frozen lockfile;
4. runs the release build and package smoke test;
5. verifies that the tag is exactly `v` plus the staged package version;
6. runs `npm publish` from `packages/npm-dist` with OIDC enabled by
   `permissions: id-token: write` and `environment: publish`.

The workflow does not use `workflow_call`, a reusable publisher, `NPM_TOKEN`, or a
second workflow that could make npm's Trusted Publisher filename ambiguous. A tag for a
previously published version fails before `npm publish`; published npm versions are
immutable.

## Cloudflare self-deploy

The repository remains a pnpm monorepo, so the one-click entry point is a root-level
Workers configuration and deploy script. The root entry delegates the web build to
`apps/web`, points Workers Static Assets at `apps/web/build`, and bundles the existing
asset-only Worker. The existing `apps/web` configuration remains usable for the
maintainer's direct deploy command; the root entry is the public self-deploy adapter.

README embeds Cloudflare's official button:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/HuakunShen/refyard)
```

The README must say plainly that this deploys the UI to the user's account, not the Node
Git host. The user supplies the API endpoint and exact allowed origin when they choose to
connect a backend. An empty API-origin configuration remains fail-closed.

## README and demo evidence

The README receives a compact product header, links, and badges for:

- npm latest version;
- npm monthly downloads;
- GitHub Actions verification;
- GitHub repository license;
- Cloudflare self-deployment.

The visual demo uses the public `~/Dev/others/vscode` checkout because its local history
contains approximately 19,359 merge commits. Refyard opens that repository read-only,
the captured history graph is stored as `docs/assets/vscode-history.png`, and the README
labels it as a demo fixture rather than project data. No third-party source is copied into
Refyard.

The README also includes a short trust model:

```text
your repository + your git + your Node host
                │ authenticated JSON/SSE
                ▼
        your browser / your Cloudflare UI
```

It explicitly distinguishes the public UI Worker from the machine-facing API and states
that the Worker cannot reach loopback without an operator-owned HTTPS tunnel.

## Security and privacy constraints

- Keep exact-origin checks and bearer authentication in the Node host.
- Keep the Worker API refusal and restrictive CSP, including per-document bootstrap
  hashes; never solve a render problem with `unsafe-inline` or a wildcard `connect-src`.
- Do not add telemetry, Git uploads, analytics, a remote repository scanner, or a hidden
  fallback API while improving the README or deployment flow.
- Keep secrets out of package metadata, README examples, workflow arguments, and logs.
- Keep the npm workflow's permissions at `contents: read` and `id-token: write` unless a
  later release feature has an independently approved need.
- Keep the package's published files limited by the existing packaging gates; source
  screenshots and documentation do not enter the npm tarball.

## Implementation files

Expected changes are limited to the release/public-surface boundary:

- `.github/workflows/publish.yml`;
- `LICENSE`;
- root `package.json` and root Workers configuration/deploy entry;
- `packages/npm-dist/package.json` and its README metadata;
- `README.md` and `docs/releasing.md`;
- `docs/assets/vscode-history.png`;
- focused workflow/configuration tests and any generated metadata required by existing
  repository checks.

`ci.yml`, Git Core, the public GitService contract, and the Worker data boundary are not
rewritten as part of this work.

## Verification and external release sequence

Local verification must include the affected package/config gates, the full existing
release checks where practical, a clean package inspection, and a Wrangler dry run. The
demo must be opened in the real browser and the README image must be visually inspected.

External state changes happen only after local proof:

1. push the reviewed commits;
2. make `HuakunShen/refyard` public;
3. verify the npm Trusted Publisher fields and enable direct publish for `publish.yml`;
4. push `v0.1.2` to trigger the publish workflow;
5. inspect the GitHub run and verify `npm view refyard version` and provenance.

The public-repository change and tag push are operator-authorized release actions, not
local test steps. If GitHub or npm authentication is missing, the workflow stops for the
owner to authenticate rather than accepting credentials through the agent.

## Acceptance criteria

- A fresh public checkout can run the existing CI workflow without a hidden local file.
- `publish.yml` exactly matches the npm Trusted Publisher filename and environment.
- A successful tag run publishes only the tag's package version and uses OIDC, with no
  npm token secret.
- The Cloudflare button starts a deployment from the public repository's root and
  produces only the static UI Worker.
- The README shows a real, readable VS Code history graph and the badges resolve to the
  intended package, workflow, repository, and deployment entry.
- The README and code make the no-upload-by-default boundary easy to audit.
- Unverified facts (such as a live Cloudflare deployment in another account or the final
  GitHub Actions run) are reported separately from local verification.
