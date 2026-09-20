# GitKraken commit-graph interaction notes (2026-09-20)

Recorded live from GitKraken 12.5.0 on macOS (repo `kunkun-services`) with computer
use: right-click menus on four different targets, the column-settings gear, the
column resize handles, and hover behaviour. Screenshots referenced below were
captured during that session. This is a record of what another client does —
not evidence that Refyard is correct; each borrowed behaviour needs its own test.

## 1. The graph is a table with named columns

Header row (always visible, does not scroll away): `BRANCH / TAG · GRAPH ·
COMMIT MESSAGE · AUTHOR · COMMIT DATE / TIME · SHA`, plus a gear at the far
right whose tooltip is "Column settings".

- Column edges have resize handles that live **only in the header band** (the
  accessibility tree exposes each as "Resize Panel", header-height only); rows
  never resize. Dragging a handle widens the column to the left of it; the
  commit-message column absorbs the remainder (it is the flexible one).
- The gear opens "Column settings": one checkbox per column (Branch / Tag,
  Graph, Commit message, Author, Date / Time, Sha — all currently checked),
  then a separator, then "Compact Graph Column" and "Smart Branch Visibility",
  then another separator, then "Reset columns to default layout" and "Reset
  columns to compact layout".
- A tooltip labels the gear; hidden columns simply disappear from the table.

## 2. Right-click target decides the menu

Four menus were captured; the item sets genuinely differ per target.

### 2a. Plain commit (no ref on it)

1. Checkout this commit
2. Create worktree from this commit
   —
3. Create branch here
4. Cherry pick commit
5. Reset v2 onto this commit
6. Reset v2 to this commit ▸
7. Revert commit
   —
8. Recompose commit with AI (Preview) / Recompose 98 children of 6981fe with AI
   (Preview) / Interactive rebase 98 children of 6981fe
9. Edit commit message
10. Drop commit
11. Move commit up / Move commit down
    —
12. Copy commit sha
13. Copy link to this commit on remote: origin
14. Create patch from commit
15. Share commit as Cloud Patch
    —
16. Compare commit against working directory
    —
17. Create tag here / Create annotated tag here

(The menu was taller than the window; anything below "Create annotated tag
here" was not captured.)

### 2b. Checked-out branch tip `v2` (user-supplied screenshot)

Pull (fast-forward if possible) / Push / Set Upstream — Checkout ▸ — Create
worktree from ▸ — Create branch here / Reset v2 to this commit ▸ / Edit commit
message / Revert commit — AI / Drop commit / Move commit down — Start a pull
request… / Explain Branch Changes (Preview) — Apply patch / Rename v2 / Delete
v2 / Delete origin/v2 / Delete v2 and origin/v2 — Copy branch name / Copy
commit sha / Copy link to branch… / Copy link to this commit on remote… /
Create patch from commit / Share commit as Cloud Patch — Pin to Left ▸ / Solo ▸
— Compare commit against working directory — Create tag here / Create
annotated tag here.

### 2c. Non-checked-out local branch `dev` (sits on a worktree)

1. Pull (fast-forward if possible) / Push / Set Upstream
   —
2. Merge dev into v2 / Rebase v2 onto dev / Interactive Rebase v2 onto dev
   —
3. Checkout ▸ / Open worktree from dev
   —
4. Create worktree from ▸
   —
5. Create branch here / Cherry pick commit / Reset v2 to this commit ▸ /
   Revert commit
   —
6. Start a pull request to origin/dev from origin/v2 / Explain Branch Changes
   —
7. Rename dev / Remove this worktree / Remove worktree and delete branch /
   Delete origin/dev / Remove worktree and delete dev and origin/dev
   —
8. Copy branch name / Copy commit sha / Copy link to branch: origin/dev / Copy
   link to this commit on remote: origin / Create patch from commit / Share
   commit as Cloud Patch
   —
9. Pin to Left ▸ / Solo ▸
   —
10. Compare commit against working directory
    —
11. Create tag here / Create annotated tag here

### 2d. Remote branch label `origin/rm-supabase` (local tracking twin exists)

Same skeleton as 2c, but: "Merge rm-supabase into v2 / Rebase v2 onto
rm-supabase", no "Open worktree", delete section reads "Rename rm-supabase /
Delete rm-supabase / Delete origin/rm-supabase / Delete rm-supabase and
origin/rm-supabase", and copy link says `origin/rm-supabase`.

### Common shape across menus

- Remote sync first (Pull/Push/Set Upstream) when the target has an upstream.
- Then history rewrites and navigation (merge/rebase/checkout), then ref
  creation, then destructive items, then a copy section, then view pinning,
  then tag creation last.
- Menus mix per-target verbs with the underlying commit's verbs; the branch
  name is interpolated into labels ("Rename dev", "Merge dev into v2"), and
  the merge/rebase direction is phrased relative to the checked-out branch.

## 3. Smaller behaviours worth borrowing

- **Row hover pins branch labels**: hovering a row in the middle of a branch
  shows that branch's label at the hovered row (the label appears twice — once
  at the tip, once at the hover position). This is the "Smart Branch
  Visibility" companion.
- **WIP row**: the graph has a dedicated `// WIP` row with a dashed circle and
  a pencil + change count at the top when the working copy is dirty.
- Hover on a sidebar branch shows the working directory path as a tooltip.
- The header AUTHOR column carries a filter funnel; the table header doubles
  as the toolbar row (Undo/Redo/Pull/Push/Branch/Stash/Pop/Terminal sit above
  it).

## 4. What Refyard takes from this (and what it cannot yet)

Refyard's service implements a fixed set of operations; capability honesty
rules out menu items whose operation does not exist. Adopted in this round:

- Table columns with header-band resize handles, hideable columns via a
  settings gear, reset — widths persisted per browser.
- Commit-row menu: Create Branch Here…, Create Tag Here…, Copy SHA (existing,
  kept), plus Copy Message. "Create worktree from this commit" is dropped for
  now — `createWorktree` needs a destination path the menu cannot ask for
  (WorktreePanel owns that flow).
- Ref-label menus on the BRANCH / TAG column, per ref kind: local branch →
  Switch, Merge into Current, Delete…, Copy Branch Name; remote branch → Copy
  Branch Name; tag → Delete Tag…, Copy Tag Name; each item only when its
  operation kind is in `capabilities`.
- Right-click anywhere on a row (graph lanes included) opens the commit menu,
  and the WebView default menu ("Reload") is suppressed app-wide outside text
  fields, which is what made right-click look like "refresh + highlight" in
  the desktop app.

Deliberately not adopted yet: revert/cherry-pick/reset/drop/rebase/squash
(no operations), AI actions, PR creation, Pin/Solo, commit drag, the WIP row,
per-column sort/filter, rename-from-graph (BranchPanel owns rename; it needs
an inline text field the graph menu does not have).

## 5. Round two — the graph drawing itself (same day, 20:00)

The user called the graph's _drawing_ the remaining gap. Rendering our layout
and GitKraken's over the same repositories (`~/Dev/kunkun-services`, which
GitKraken had open, and `~/Dev/others/drizzle-orm` — ~385 merges per 100
first-parent commits) showed four concrete differences:

1. **The trunk was grey.** `lane-1` — the first palette entry and everything's
   default — was a neutral in both themes, so the most important line in the
   graph looked like a rendering artefact. GitKraken paints the checked-out
   branch a signature accent. Fixed: `lane-current` (a blue accent, light and
   dark variants) applied through `colorForRef`, and the palette's grey
   replaced with a violet.
2. **Line colour followed refs, not branches.** The layout recoloured a lane
   every time a commit on it carried a ref, so the `origin/v2` twin sitting
   one commit below `v2` flipped the trunk to that hash's colour mid-line.
   Fixed in `layout.ts`: a lane's colour is decided once, when the lane opens
   at its branch's tip, and refs met along the way never recolor it.
   `laneColorFor` (app side) maps the checked-out branch to `lane-current` and
   every other branch to a hue hashed from its name, ignoring tags.
3. **Branch lanes opened at the right edge.** Every merge sent its branch's
   lane to the far right, sweeping a long flat curve across the whole graph.
   GitKraken opens the new lane directly beside the lane it branches from.
   Fixed in `layout.ts` (splice at the parent lane's index + 1). The cost: a
   surviving lane can now shift sideways across one row, so `rowGeometry`
   matches a row's input and output lanes **by id, not by index** — index
   matching would have drawn the shift as a merge into that row's commit.
4. **The working copy was not in the graph.** GitKraken pins a `// WIP` row —
   dashed circle, pencil, change count, the branch label — above history.
   Fixed: a WIP row between the table header and the scroll area, shown when
   the active worktree is dirty, clicking it hands back to the working copy.

Also borrowed: absolute `YYYY-MM-DD HH:mm` stamps in the date column (a
column of "3 minutes ago" cannot be scanned for "when"), the signature shown
as an icon instead of a text badge on every row, 2px strokes with 4.5px dots,
and Up/Down arrow navigation of the selection with scroll-into-view.

Left for later, recorded so the next round does not re-derive it: author
avatars inside first-parent dots (needs an avatar story — GitKraken's look,
not reproducible honestly with initials at 9px), hover-pinning of branch
labels to arbitrary rows (Smart Branch Visibility), horizontal scrolling when
the user widens fixed columns past the panel, and a compact-rows density
toggle.
