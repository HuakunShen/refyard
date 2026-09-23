# Release and Packaging

**Updated: 2026-09-23** — page created; homebrew + domain changes from 2026-09-22/23 commits.

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

## Domains

| Domain | Served by | Declared in |
| --- | --- | --- |
| `docs.refyard.huakun.tech` | GitHub Pages | `apps/docs/public/CNAME` + `docs.yml` |
| `refyard.huakun.tech` | Cloudflare | `wrangler.jsonc` (`aa81258`) |

## Workflows

`ci.yml` (checks/tests), `docs.yml` (Pages), `publish.yml` (npm), `release.yml` (desktop artifacts).

## Related pages

- `Services/Documentation Site.md`
- `Infrastructure/Testing and Safety.md` — the gates a release implies
