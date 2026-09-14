# Reference projects

Cloned copies of other people's Git clients, kept for study. They live outside this
repository — `~/Dev/others/<name>` — and are symlinked into
`references/open-source/<name>` so a search rooted at this project can find them.
`references/` is untracked; this document is the record of what is there and what
may be done with it.

Cloned as shallow, default-branch checkouts on 2026-09-14 (VS Code additionally
sparse-checked out to its SCM history code).

## Licence tiers

**Green — may be read and, with attribution and the licence notice preserved,
adapted.** These are MIT (or MIT/Apache-2), and a borrowed algorithm must name the
file it came from.

| Project               | Path                                    | Licence | What it is                                                        |
| --------------------- | --------------------------------------- | ------- | ----------------------------------------------------------------- |
| SourceGit             | `references/open-source/sourcegit`      | MIT     | C#/Avalonia Git GUI that wraps the system Git CLI                 |
| Lazygit               | `references/open-source/lazygit`        | MIT     | Go TUI, all Git work through the CLI, strong integration tests    |
| VS Code               | `references/open-source/vscode`         | MIT     | `src/vs/workbench/contrib/scm` — commit-graph lane layout and SVG |
| simple-git (`git-js`) | `references/open-source/git-js`         | MIT     | TypeScript wrapper that spawns Git; unsafe-action protection      |
| GitUI                 | `references/open-source/gitui`          | MIT     | Rust; async Git layer over libgit2                                |
| isomorphic-git        | `references/open-source/isomorphic-git` | MIT     | Pure-JS Git with injected filesystem/transport ports              |

**Yellow — read for ideas, never copy code.** Their licences forbid copying into
this project, so they are consulted for architecture, information layout and
interaction design only. Every finding drawn from them must be written as prose in
`docs/research/`, never as adapted source.

| Project   | Path                               | Licence                    | Why it is only a reference                                                                            |
| --------- | ---------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Gitron    | `references/open-source/gitron`    | PolyForm Noncommercial 1.0 | Non-commercial restriction; architecture is close to ours (Svelte 5 + shared core + HTTP server mode) |
| GitButler | `references/open-source/gitbutler` | Fair Source (non-compete)  | Cannot be used to build a competing product                                                           |
| GitUp     | not cloned                         | GPLv3                      | Copyleft; graph UX ideas only                                                                         |

## Which one to read for what

| Question                                                     | Read                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| How to turn an operation into `git` argv                     | `sourcegit/src/Commands/*.cs`, `lazygit/pkg/commands`                          |
| How to parse `status`/`diff`/`for-each-ref` output           | `sourcegit/src/Commands`, `git-js/packages/simple-git/src/lib/responses`       |
| Commit-graph lane algorithm and SVG geometry                 | `vscode/src/vs/workbench/contrib/scm/browser/scmHistory.ts`                    |
| Process execution, environment hygiene, kill/timeout         | `git-js/packages/simple-git/src/lib/exec`, `lazygit/pkg/commands/oscommands`   |
| Which config/env can execute a program (threat model)        | `git-js/docs/PLUGIN-UNSAFE-ACTIONS.md` and its implementation                  |
| Worktree, submodule, stash workflows and their preconditions | `sourcegit/src/Commands/{Worktree,Submodule,Stash}.cs`, `lazygit/pkg/commands` |
| Testing against a real Git repository                        | `lazygit/pkg/integration`, `git-js/test/`                                      |
| Error and conflict state detection                           | `lazygit/pkg/commands` (`status`, `rebase`, `cherry-pick` state files)         |
| Pane layout, file list, diff rendering, density, theming     | `gitron` and `gitbutler` (ideas only)                                          |

Findings from each research pass live in `docs/research/2026-09-14-*.md`, each with
a status block naming the commit that was read, so a later reader can tell how old
a conclusion is.

## Rules

1. Before implementing something a reference project already solved, read that
   section of this table first and cite the file you consulted in the commit
   message or the research note.
2. Never copy from a yellow-tier project. If an idea is good, restate it in prose
   and implement it from the description.
3. When adapting green-tier code, keep a header comment naming the source file and
   licence, and leave the behaviour recognisably theirs.
4. A reference reading is evidence of _what works elsewhere_, never evidence that
   this implementation is correct. Nothing here replaces a test against real Git.
