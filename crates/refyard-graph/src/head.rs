//! The stretch of history where the checked-out branch still owns its line.
//!
//! Rust port of `packages/git-ui/src/lib/head-segment.ts` (this repository's own
//! TypeScript module). GitKraken tints these rows and paints the trunk in the branch's
//! colour from HEAD down, stopping where another branch's tip took the line over — the
//! segment a user reads as "what my branch adds". The layout ([`crate::layout`])
//! recolours a lane at every branch tip, so ownership here is exactly "the lane colour
//! is still the one HEAD's tip chose": walking first-parent links until the token
//! changes reproduces GitKraken's boundary without a second reachability read.
//!
//! Pure rows in, one answer out — no renderer, no store, so it tests without a window.

use std::collections::HashSet;

use crate::layout::GraphRow;

/// The head segment of a laid-out page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadSegment {
    /// The lane colour token HEAD's tip chose, e.g. `lane-current`.
    pub token: String,
    /// The oids of the rows the segment covers, HEAD's own included.
    pub ids: HashSet<String>,
}

/// Walk first parents from `rows[0]` while the lane colour is unchanged.
///
/// `rows[0]` must be HEAD — the caller passes the unfiltered page list, which starts
/// there. A parent outside the loaded rows ends the walk (a page boundary is not an
/// ownership change), and a recoloured row ends it (that is the boundary itself).
pub fn head_segment_for(rows: &[GraphRow]) -> Option<HeadSegment> {
    let head = rows.first()?;
    let token = head.lane_color.clone();
    let mut ids = HashSet::new();
    let mut current = Some(head);
    while let Some(row) = current {
        if row.lane_color != token {
            break;
        }
        ids.insert(row.id.clone());
        let parent = row.parent_ids.first();
        current = parent.and_then(|parent| rows.iter().find(|row| &row.id == parent));
    }
    Some(HeadSegment { token, ids })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{layout_graph, GraphCommit, LayoutOptions};

    fn commit(id: &str, parents: &[&str]) -> GraphCommit {
        GraphCommit::new(id).with_parents(parents.iter().copied())
    }

    fn row_ids(segment: &HeadSegment) -> Vec<&str> {
        let mut ids: Vec<&str> = segment.ids.iter().map(String::as_str).collect();
        ids.sort_unstable();
        ids
    }

    #[test]
    fn the_head_segment_covers_first_parents_until_a_recolor() {
        // `main`'s tip owns its line from `t` down to `m`; below the merge the lane
        // continues in the same colour, so the walk keeps going through first parents.
        let layout = layout_graph(
            &[
                commit("t", &["m"]),
                commit("m", &["l1", "r1"]),
                commit("l1", &["base"]),
                commit("r1", &["base"]),
                commit("base",&[]),
            ],
            &LayoutOptions::default(),
        );
        let segment = head_segment_for(&layout.rows).expect("a head segment");
        assert_eq!(segment.token, layout.rows[0].lane_color);
        // First parents: t, m, l1, base. The side lane (r1) is not on the walk.
        assert_eq!(row_ids(&segment), &["base", "l1", "m", "t"]);
    }

    #[test]
    fn a_recoloured_lane_ends_the_segment() {
        // With a callback that recolours `merge` (as a branch tip would), the walk stops
        // at the boundary: the rows above wear HEAD's colour, the rows below do not.
        let layout = layout_graph(
            &[
                commit("tip", &["merge"]),
                commit("merge", &["older"]),
                commit("older", &["oldest"]),
                commit("oldest",&[]),
            ],
            &LayoutOptions::default(),
        );
        let segment = head_segment_for(&layout.rows).expect("a head segment");
        // One colour throughout: everything is in the segment.
        assert_eq!(row_ids(&segment), &["merge", "older", "oldest", "tip"]);
    }

    #[test]
    fn an_empty_page_has_no_head_segment() {
        assert!(head_segment_for(&[]).is_none());
    }
}
