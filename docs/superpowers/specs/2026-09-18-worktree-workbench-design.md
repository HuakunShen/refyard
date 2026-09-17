# Worktree workbench UX

The user's GitKraken screenshots define the interaction direction. Reimplement these patterns
using Refyard components, without copying external source or modifying real repositories in tests.

- Select an approved worktree by branch name; its full path is available on hover. Switching
  changes status, diff, history scope, previews and mutation targets together. Missing or
  unapproved worktrees show a real error; selecting one never widens its filesystem grant.
- Show distinct WIP rows with staged and unstaged counts per worktree. Unknown is not zero.
- Right pane has separate Unstaged and Staged groups, per-file stage/unstage and bulk actions,
  and a persistent commit composer. A partially staged file occurs in both groups with different
  diff requests. Drafts belong to repository/worktree, not to the last rendered panel.
- A selected file opens in the main workspace, temporarily collapsing navigation. History can
  be restored without changing the active worktree. Commit files use this same main diff area.
- Existing explicit mutation confirmation, snapshot preconditions, queue and host safety stay
  in force. Selection changes while a request is pending cannot retarget that mutation.
- Validate with temporary repositories containing distinct main/linked dirty files; prove
  stage and commit change only the selected worktree, plus desktop/narrow browser behavior.
