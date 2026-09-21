---
title: History and the graph
description: Reading the commit graph, the ref labels, and the filters that narrow a large history.
---

The history is a table with named columns — Branch / Tag, Graph, Commit message, Author,
Date / Time and Sha — and every column resizes, hides or reorders from the header. Dragging
a column wider pushes its neighbours outward and, past the panel's edge, scrolls the table
horizontally: widening one column never silently resizes another.

## The graph

Lanes are laid out by the repository's own topology, not by the refs you happen to have: a
merge opens its branch's lane directly beside the lane it branched from, and a lane keeps
its colour from the moment it opens until it ends. Commit nodes draw the author's GitHub
photo where one is known and a coloured dot otherwise; a label's colour matches the lane it
names, and a short line joins the label to its node.

**Row density** (Settings → Appearance) sets how much room each row gets: Compact for the
most commits per screen, Comfortable as the default, Roomy for GitKraken-like spacing. Lane
spacing, node size and line weight scale with it.

The Graph column is compressible rather than fixed: narrow it and the lanes squeeze into
whatever width you leave, down to a legibility floor, and past that the column clips.

## The `// WIP` row

A dashed node sits above the first commit whenever the active worktree has uncommitted
changes. Clicking it hands the selection back to the working copy.

## Search and filters

The filter bar searches commit messages, authors, paths and refs, alone or combined, and
narrows the graph to the matching history. Filters that cannot be combined are rejected
instead of quietly returning the wrong set. Clearing the filters restores the full graph.

## Selecting a commit

Click anywhere in a row — graph, author, date or sha — to select that commit; the detail
panel follows. `↑`/`↓` move the selection through the list and scroll it into view.

## Right-click

What you right-click decides the menu: a row with a branch label offers the branch actions
(checkout, merge, delete, copy name), a row with a tag offers the tag actions, and a plain
commit offers commit actions (create a branch or tag here, copy the sha, copy the message).
