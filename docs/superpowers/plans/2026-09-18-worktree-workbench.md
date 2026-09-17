# Worktree workbench implementation

**Goal:** Deliver the screenshot-directed worktree/WIP, staging and full-main-diff interaction.
**Spec:** ../specs/2026-09-18-worktree-workbench-design.md
**Execution:** User-requested Luna max agents with parent integration and verification.

- [x] Context: extend selection with worktree and diff side, clear obsolete path handles on
      switch, key all per-worktree queries and capture mutation target before awaiting previews.
      Tests: selection transitions and mixed-index diffs.
- [x] Working copy: reusable `WorkingCopyPanel`, accurate XY groups, per-path actions, bulk
      actions, controlled commit draft. Tests: untracked/MM/ignored/conflict grouping.
- [x] Navigation: clickable worktree rows, full-path hover, WIP summary rows.
- [x] Composition: center history/main diff modes, right working-copy or commit details/files;
      retain resizable panes and keyboard accessibility. Worktree-aware tabs and isolated drafts.
- [x] Proof: rebuild static SPA and CLI bundle before Playwright; isolated main/linked worktree
      test for selection, stage/unstage, commit and diff layout; static and focused regression gates.
- [x] Record actual results and commit only task files. No push or deployment.

## Verification notes

- `pnpm check`: exit 0; Svelte checks report 0 errors and 0 warnings.
- `pnpm check:boundaries` and `pnpm check:contract`: exit 0.
- `pnpm test:unit`: exit 0, 43 files / 364 tests. After final selection changes, the
  five focused files passed again: 23 tests.
- Static SPA rebuilt with `pnpm build:web`, then locally bundled with
  `bun scripts/bundle-cli.ts` for real browser testing. Both exited 0.
- Chromium broad regression: 45/49 initially passed. Findings were missing launcher
  connectivity errors and three obsolete layout selectors; these were fixed and require
  the targeted rerun below.
- Worktree switching/staging/commit isolation, MM diff and external edits, independent
  drafts, worktree tabs and keyboard resize passed in Chromium, Firefox and WebKit
  (9 cases). The additional home-relative reopening test exposed duplicate registration;
  the client now resolves the host path and reuses an existing registration.
- Browser writes use only isolated fixture repositories. macOS was exercised; Windows
  and Linux were not. No push, publication or deployment is part of this task.

## Manual use

Run `pnpm dev`, open a repository, then select its worktree from Working Copy or Worktrees.
Right-click a worktree to open it in another tab. Click a changed file in either the
Unstaged or Staged group to open the main diff, and use Back to history (or Escape) to
return. Drag either sidebar divider to change its width. Commit drafts are kept separately
for each repository/worktree while the page remains open.

### Final reruns

- Home-relative repository reopening: 3/3 passed across Chromium, Firefox, WebKit
  after the duplicate-registration fix (exit 0).
- Chromium targeted regressions: 5/5 passed for offline cached reload, commit main diff,
  repository create, clone and managed approval/revocation (exit 0).
- Final type check, boundary/contract checks, formatting and diff whitespace check: exit 0.
- Commit: `feat(web): build worktree-centered git workbench`.
