# Documentation Site

**Updated: 2026-09-23** — page created; covers the docs-site move to its own domain (2026-09-22/23).

`apps/docs` is the **published documentation site**: a static Fumadocs-on-Astro build.

## Deployment

- Published via `.github/workflows/docs.yml` to **GitHub Pages** on the custom domain **docs.refyard.huakun.tech** (CNAME file in `apps/docs/public/CNAME` + Pages settings).
- **Build-time only** — never a product runtime, and **never a release gate**.
- The main product domain `refyard.huakun.tech` is declared in `wrangler.jsonc` (`aa81258`).

## Recent changes

| Commit | Change |
| --- | --- |
| `0b8e62c` | publish the docs site to GitHub Pages on docs.refyard.huakun.tech |
| `ece256c` | **fix:** apply the theme class before first paint and after every router swap (no theme flash) |
| `14df295` | show the workbench screenshot on the landing page |
| `ccdc82c` | correct the tap install path in the install docs |

## Content pages touched recently

`content/docs/index.mdx`, `first-session.md`, `forms/local.md`, `install.md`, `troubleshooting.md`; screenshots `workbench-dark.png`, `commit-detail-dark.png`, `pull-requests-dark.png`.

## Related pages

- `Infrastructure/Release and Packaging.md` — domains and workflows
- `Services/Workbench UI and Sessions.md` — the theme the site must not flash
