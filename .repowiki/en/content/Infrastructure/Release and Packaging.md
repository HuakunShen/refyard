# Release and Packaging

**Updated: 2026-10-03** — added the DeepSeek Harness plugin publish line; page created 2026-09-23
with homebrew + domain changes from 2026-09-22/23 commits.

## Desktop releases

- Tag-triggered pipeline `.github/workflows/release.yml` publishes to [GitHub Releases](https://github.com/HuakunShen/refyard/releases/latest):

| Platform | Artifacts |
| --- | --- |
| macOS (Apple Silicon) | `Refyard_<version>_aarch64.dmg` |
| macOS (Intel) | `Refyard_<version>_x64.dmg` |
| Linux x64 / arm64 | `.deb` and `.AppImage` |
| Windows x64 | NSIS `.exe` |

- Every artifact is **minisign-signed**; each release carries `latest.json` for the updater.
- macOS binaries are **ad-hoc signed only** (no Apple Developer ID yet) — documented as a known limitation in the README.

## Homebrew (updated 2026-09-22/23)

- Cask: `packaging/homebrew/Casks/refyard.rb` — bumped to **v0.2.0** (`fa9eca9`).
- `ccdc82c` — corrected the **tap install path** in docs.
- `9ccc2e3` — **allow default cask upgrades** (the earlier cask blocked `brew upgrade` for the un-tapped case).

## npm

- `.github/workflows/publish.yml` + `packages/npm-dist` staging (T13); badges in README track npm version/downloads. AGENTS.md still forbids publishing under remote integration tests — local tarballs only.
- **Version:** `refyard@0.2.0` in `packages/npm-dist`.

### DeepSeek Harness plugin (`dsh-plugin-refyard`)

A second npm line, added 2026-10-03: one tag push builds the plugin bundle and publishes it from
`integrations/dsh`. It is deliberately its own workflow and its own tag namespace.

| | CLI/service line | Harness plugin line | Desktop line |
| --- | --- | --- | --- |
| Workflow | `publish.yml` | `dsh-plugin.yml` | `release.yml` |
| Tag | `v*` | `plugin-v*` | `app-v*` |
| Publishes | `refyard` (npm) | `dsh-plugin-refyard` (npm) | GitHub Release artifacts |
| Version read from | `packages/npm-dist/package.json` | `integrations/dsh/package.json` | `tauri.conf.json` |

- **Build:** `pnpm build:dsh` (`scripts/build-dsh-plugin.ts`) produces the host half
  (`dist/host.js`), the client half (`dist/client.js`) and the embedded SPA (`dist/web/`); the
  manifest's `files` carries those plus `locale/`, `icon.svg`, `cordis.patch.yml` and `README.md`.
- **The tag is checked against the manifest before anything is built**, and `npm publish` builds
  through the manifest's own `prepublishOnly`, so the published bytes come from the same command a
  local publish runs rather than a second CI-only recipe.
- **Auth is npm trusted publishing (OIDC)** with `environment: npm` and `id-token: write` — no
  `NPM_TOKEN` secret. npm matches the workflow's OIDC claim against the package's *Trusted
  Publisher* settings, which is also what produces the public `--provenance` attestation
  (npm >= 11.5.1 required, so the publish step upgrades npm first).
- **Consequence worth knowing:** trusted publisher settings live in the package's settings on
  npmjs.com, so a package that does not exist yet cannot be published this way. The **first**
  version of a new plugin has to be published by hand (interactively, with 2FA); every later
  release is a `plugin-v*` tag. The same applies to the connection's "Allow npm publish" switch:
  until it is on, npm answers `403 OIDC permission denied for this action`.

## Domains

| Domain | Served by | Declared in |
| --- | --- | --- |
| `docs.refyard.huakun.tech` | GitHub Pages | `apps/docs/public/CNAME` + `docs.yml` |
| `refyard.huakun.tech` | Cloudflare | `wrangler.jsonc` (`aa81258`) |

## Workflows

`ci.yml` (checks/tests), `docs.yml` (Pages), `publish.yml` (npm), `dsh-plugin.yml` (Harness plugin
npm line), `release.yml` (desktop artifacts).

## Related pages

- `Services/Documentation Site.md`
- `Services/DeepSeek Harness Plugin.md` — what the plugin bundle contains
- `Infrastructure/Testing and Safety.md` — the gates a release implies
