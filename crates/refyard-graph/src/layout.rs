//! Host-free commit DAG lane layout with stable parallel tracks.
//!
//! Rust port of `packages/git-graph/src/layout.ts` and `pages.ts` (this repository's own
//! TypeScript package; same algorithm, same pinned properties). A live track keeps its
//! horizontal slot until it converges; only a newly opened track can reuse a hole.
//! Continuation carries the slots across pages, so loading history cannot move a
//! surviving branch. Additional parents already on screen join their existing track.
//! Lane positions are required here — the TypeScript layer's legacy `position ?? index`
//! fallback does not exist because this crate is the only producer of its own input.

use std::collections::HashSet;
use std::sync::OnceLock;

/// An opaque lane colour token. The meaning of `lane-3` belongs to the renderer.
pub type LaneColor = String;

/// One commit of a topology: parents in Git's order, first parent first. `ref_names`
/// exist for colour selection only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphCommit {
    pub id: String,
    pub parent_ids: Vec<String>,
    pub ref_names: Vec<String>,
}

impl GraphCommit {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            parent_ids: Vec::new(),
            ref_names: Vec::new(),
        }
    }

    pub fn with_parents<I: IntoIterator<Item = S>, S: Into<String>>(
        mut self,
        parents: I,
    ) -> Self {
        self.parent_ids = parents.into_iter().map(Into::into).collect();
        self
    }

    pub fn with_refs<I: IntoIterator<Item = S>, S: Into<String>>(mut self, refs: I) -> Self {
        self.ref_names = refs.into_iter().map(Into::into).collect();
        self
    }
}

/// One live track entering or leaving a row. Closed tracks leave reusable slots.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaneRef {
    /// The commit this lane is waiting for.
    pub id: String,
    pub color: LaneColor,
    /// Stable horizontal slot.
    pub position: usize,
}

impl LaneRef {
    pub fn new(id: impl Into<String>, color: impl Into<String>, position: usize) -> Self {
        Self {
            id: id.into(),
            color: color.into(),
            position,
        }
    }
}

/// One laid-out row: where the circle sits and which lanes entered and left.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphRow {
    pub id: String,
    pub parent_ids: Vec<String>,
    pub ref_names: Vec<String>,
    /// Where this commit's circle is drawn.
    pub lane_index: usize,
    pub lane_color: LaneColor,
    /// Lanes entering this row, from the row above.
    pub input_lanes: Vec<LaneRef>,
    /// Lanes leaving this row, towards the row below.
    pub output_lanes: Vec<LaneRef>,
    pub is_merge: bool,
    pub is_root: bool,
}

/// The result of laying out one page: rows plus the lanes to hand to the next page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayoutResult {
    pub rows: Vec<GraphRow>,
    /// The lanes to pass as `continuation` for the next page.
    pub continuation: Vec<LaneRef>,
    /// Highest lane index used, so a renderer can size its canvas.
    pub lane_count: usize,
}

/// The result of laying out several pages as one continuous graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PagesLayoutResult {
    pub rows: Vec<GraphRow>,
    /// Highest lane index used across all pages, for sizing one column.
    pub lane_count: usize,
}

/// The colour a commit's own ref implies, when it has one. Returning `None` means
/// "inherit or pick from the palette", which is what keeps a branch's colour stable
/// along its lane: inheritance is the common case, and only new lanes draw a fresh
/// colour.
pub type ColorForRef<'a> = &'a dyn Fn(&GraphCommit) -> Option<LaneColor>;

/// Optional inputs to [`layout_graph`] / [`layout_pages`]. `Default` produces the
/// default palette, no ref colouring and an empty continuation.
#[derive(Clone, Default)]
pub struct LayoutOptions<'a> {
    /// Lane colours, in order. At least one; the cursor cycles through them.
    pub palette: Option<&'a [LaneColor]>,
    pub color_for_ref: Option<ColorForRef<'a>>,
    /// Colour for a commit with no ref and no lane to inherit from.
    pub default_color: Option<LaneColor>,
    /// Lanes entering the first row: the previous page's `continuation`, so page two
    /// lines up with page one instead of restarting at zero.
    pub continuation: Vec<LaneRef>,
}

/// The default eight-colour palette (`lane-1` … `lane-8`), shared with the web renderer.
pub fn default_palette() -> &'static [LaneColor] {
    static PALETTE: OnceLock<Vec<LaneColor>> = OnceLock::new();
    PALETTE.get_or_init(|| (1..=8).map(|n| format!("lane-{n}")).collect())
}

/// Lay out one page of commits.
///
/// Total and deterministic: the same input always produces the same output, and an
/// unknown parent (one that has not been loaded) is kept as a lane rather than dropped,
/// so pagination cannot silently cut a line.
pub fn layout_graph<'o>(
    commits: &[GraphCommit],
    options: &LayoutOptions<'o>,
) -> LayoutResult {
    let palette: &'o [LaneColor] = match options.palette {
        Some(palette) => palette,
        None => default_palette(),
    };
    let default_color: LaneColor = options
        .default_color
        .clone()
        .unwrap_or_else(|| palette.first().cloned().unwrap_or_else(|| "lane-1".into()));
    let mut previous_out: Vec<LaneRef> = options.continuation.clone();
    let mut lane_count = previous_out
        .iter()
        .map(|lane| lane.position + 1)
        .max()
        .unwrap_or(0);
    let mut rows = Vec::with_capacity(commits.len());

    for commit in commits {
        let input_lanes = previous_out.clone();
        let awaited = input_lanes
            .iter()
            .find(|lane| lane.id == commit.id)
            .cloned();
        let mut occupied: HashSet<usize> = input_lanes.iter().map(|lane| lane.position).collect();
        let mut free_slot = || {
            let mut position = 0usize;
            while occupied.contains(&position) {
                position += 1;
            }
            occupied.insert(position);
            position
        };
        let lane_index = match &awaited {
            Some(lane) => lane.position,
            None => free_slot(),
        };
        // Only a local or remote branch tip may recolor its lane; a tag alone never does.
        let tip_color = if commit.ref_names.iter().any(|name| {
            name.starts_with("refs/heads/") || name.starts_with("refs/remotes/")
        }) {
            options.color_for_ref.and_then(|color_for_ref| color_for_ref(commit))
        } else {
            None
        };
        let lane_color = tip_color
            .or_else(|| awaited.as_ref().map(|lane| lane.color.clone()))
            .or_else(|| options.color_for_ref.and_then(|f| f(commit)))
            .unwrap_or_else(|| {
                palette
                    .get(lane_index % palette.len())
                    .cloned()
                    .unwrap_or_else(|| default_color.clone())
            });

        // Removing converging tracks does not compact the surviving slots.
        let mut output_lanes: Vec<LaneRef> = input_lanes
            .iter()
            .filter(|lane| lane.id != commit.id)
            .cloned()
            .collect();
        if let Some(first_parent) = commit.parent_ids.first() {
            output_lanes.push(LaneRef {
                id: first_parent.clone(),
                color: lane_color.clone(),
                position: lane_index,
            });
        }
        for parent_id in commit.parent_ids.iter().skip(1) {
            // A second parent that already has a live track joins it instead of opening
            // a duplicate.
            if output_lanes.iter().any(|lane| &lane.id == parent_id) {
                continue;
            }
            let position = free_slot();
            output_lanes.push(LaneRef {
                id: parent_id.clone(),
                color: palette
                    .get(position % palette.len())
                    .cloned()
                    .unwrap_or_else(|| default_color.clone()),
                position,
            });
        }
        output_lanes.sort_by_key(|lane| lane.position);

        lane_count = lane_count.max(lane_index + 1);
        for lane in &output_lanes {
            lane_count = lane_count.max(lane.position + 1);
        }
        rows.push(GraphRow {
            id: commit.id.clone(),
            parent_ids: commit.parent_ids.clone(),
            ref_names: commit.ref_names.clone(),
            lane_index,
            lane_color,
            is_merge: commit.parent_ids.len() > 1,
            is_root: commit.parent_ids.is_empty(),
            input_lanes,
            output_lanes: output_lanes.clone(),
        });
        previous_out = output_lanes;
    }

    LayoutResult {
        rows,
        continuation: previous_out,
        lane_count,
    }
}

/// Lay out several pages of history as one continuous graph.
///
/// The host serves history in pages bound to the tips they started with, so a client
/// that follows a repository's history receives *pages*, not one list. A page boundary
/// is invisible in the result: `layout_pages(&[a, b])` and `layout_graph(a ++ b)` produce
/// identical rows, which is the property the tests pin down.
pub fn layout_pages(pages: &[&[GraphCommit]], options: &LayoutOptions<'_>) -> PagesLayoutResult {
    let mut rows = Vec::new();
    let mut continuation: Vec<LaneRef> = options.continuation.clone();
    let mut lane_count = 0usize;

    for page in pages {
        let page_options = LayoutOptions {
            palette: options.palette,
            color_for_ref: options.color_for_ref,
            default_color: options.default_color.clone(),
            continuation,
        };
        let layout = layout_graph(page, &page_options);
        rows.extend(layout.rows);
        lane_count = lane_count.max(layout.lane_count);
        continuation = layout.continuation;
    }

    PagesLayoutResult { rows, lane_count }
}

/// A stable colour choice for a ref, from the palette.
///
/// It colours refs — not lanes and not branches — because that is what a user reads: the
/// same ref keeps the same colour across pages, and a commit with no ref inherits its
/// lane's colour instead of being given a new one on every render.
pub fn ref_color_for(ref_names: &[LaneColor], palette: &[LaneColor]) -> Option<LaneColor> {
    if ref_names.is_empty() || palette.is_empty() {
        return None;
    }
    // Sorted and prefix-stripped so `refs/heads/main` and `main` agree. The TypeScript
    // default sort compares UTF-16 code units; reproduce that ordering exactly.
    let mut sorted: Vec<&str> = ref_names.iter().map(String::as_str).collect();
    sorted.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let key = sorted.first()?;
    let normalized = strip_ref_namespace(key);
    let mut hash: i32 = 0;
    for unit in normalized.encode_utf16() {
        hash = hash.wrapping_mul(31).wrapping_add(i32::from(unit));
    }
    palette
        .get(hash.unsigned_abs() as usize % palette.len())
        .cloned()
}

/// Strip exactly one `refs/(heads|remotes|tags)/` prefix, as the TypeScript regex did.
fn strip_ref_namespace(name: &str) -> &str {
    let Some(rest) = name.strip_prefix("refs/") else {
        return name;
    };
    for prefix in ["heads/", "remotes/", "tags/"] {
        if let Some(stripped) = rest.strip_prefix(prefix) {
            return stripped;
        }
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commit(id: &str, parents: &[&str], refs: &[&str]) -> GraphCommit {
        GraphCommit::new(id).with_parents(parents.iter().copied()).with_refs(refs.iter().copied())
    }

    #[test]
    fn linear_history_keeps_one_lane_and_one_color_from_top_to_bottom() {
        let result = layout_graph(
            &[commit("c", &["b"], &[]), commit("b", &["a"], &[]), commit("a", &[], &[])],
            &LayoutOptions::default(),
        );
        let lane_indices: Vec<usize> = result.rows.iter().map(|row| row.lane_index).collect();
        assert_eq!(lane_indices, [0, 0, 0]);
        let distinct_colors: HashSet<&LaneColor> =
            result.rows.iter().map(|row| &row.lane_color).collect();
        assert_eq!(distinct_colors.len(), 1);
        assert!(result.continuation.is_empty());
        assert_eq!(result.lane_count, 1);
    }

    #[test]
    fn root_commit_closes_every_lane() {
        let result = layout_graph(&[commit("root", &[], &[])], &LayoutOptions::default());
        assert!(result.rows[0].output_lanes.is_empty());
        assert!(result.rows[0].is_root);
        assert!(result.continuation.is_empty());
    }

    #[test]
    fn merge_opens_a_lane_for_the_second_parent_at_the_merge_row() {
        let result = layout_graph(&merge_history(), &LayoutOptions::default());
        assert!(result.rows[0].is_merge);
        let output_ids: Vec<&str> =
            result.rows[0].output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(output_ids, &["left", "right"]);
        // The merge's own circle sits in the lane that was waiting for it.
        assert_eq!(result.rows[0].lane_index, 0);
    }

    #[test]
    fn merge_converges_both_parents_back_into_one_lane_at_their_common_ancestor() {
        let result = layout_graph(&merge_history(), &LayoutOptions::default());
        let base_row = &result.rows[3];
        // Two lanes waited for `base`, so two lanes enter that row…
        let input_ids: Vec<&str> =
            base_row.input_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(input_ids, &["base", "base"]);
        // …and the second one closes into the first rather than being drawn twice.
        assert!(base_row.output_lanes.is_empty());
    }

    #[test]
    fn merge_keeps_the_left_lane_index_stable() {
        let result = layout_graph(&merge_history(), &LayoutOptions::default());
        assert_eq!(result.rows[1].lane_index, 0);
        assert_eq!(result.rows[2].lane_index, 1);
    }

    #[test]
    fn octopus_merge_draws_three_lanes() {
        let result = layout_graph(
            &[
                commit("m", &["a", "b", "c"], &[]),
                commit("a", &["base"], &[]),
                commit("b", &["base"], &[]),
                commit("c", &["base"], &[]),
                commit("base", &[], &[]),
            ],
            &LayoutOptions::default(),
        );
        let output_ids: Vec<&str> =
            result.rows[0].output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(output_ids, &["a", "b", "c"]);
        assert_eq!(result.rows[0].parent_ids.len(), 3);
        assert_eq!(result.lane_count, 3);
    }

    #[test]
    fn unknown_parent_stays_as_a_lane() {
        // Prevents: a page boundary rendering as the end of a branch, which would draw a
        // fake root in the middle of history.
        let result = layout_graph(
            &[commit("recent", &["not-loaded"], &[])],
            &LayoutOptions::default(),
        );
        let continuation_ids: Vec<&str> =
            result.continuation.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(continuation_ids, &["not-loaded"]);
        assert_eq!(result.rows[0].output_lanes.len(), 1);
    }

    #[test]
    fn second_page_continues_the_lanes_it_is_given_rather_than_restarting_at_lane_zero() {
        let first = layout_graph(&[commit("b", &["a"], &[])], &LayoutOptions::default());
        let second = layout_graph(
            &[commit("a", &[], &[])],
            &LayoutOptions { continuation: first.continuation, ..LayoutOptions::default() },
        );
        assert_eq!(second.rows[0].lane_index, 0);
        let input_ids: Vec<&str> =
            second.rows[0].input_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(input_ids, &["a"]);
        assert!(second.rows[0].output_lanes.is_empty());
    }

    #[test]
    fn second_page_keeps_lanes_at_the_index_the_first_page_left_them() {
        let first = layout_graph(
            &[
                commit("m", &["left", "right"], &[]),
                commit("left", &["base"], &[]),
                commit("right", &["base"], &[]),
            ],
            &LayoutOptions::default(),
        );
        let second = layout_graph(
            &[commit("base", &[], &[])],
            &LayoutOptions { continuation: first.continuation, ..LayoutOptions::default() },
        );
        let input_ids: Vec<&str> =
            second.rows[0].input_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(input_ids, &["base", "base"]);
        assert_eq!(second.rows[0].lane_index, 0);
    }

    #[test]
    fn new_lane_takes_the_next_palette_color_and_inherits_along_a_lane() {
        let result = layout_graph(
            &[commit("m", &["left", "right"], &[]), commit("left", &["base"], &[])],
            &LayoutOptions::default(),
        );
        let left = &result.rows[0].output_lanes[0];
        let right = &result.rows[0].output_lanes[1];
        assert_ne!(left.color, right.color);
        // The inherited lane keeps its colour when its commit appears.
        assert_eq!(result.rows[1].lane_color, left.color);
    }

    #[test]
    fn ref_color_is_stable_for_the_same_ref_name() {
        let palette = default_palette();
        let from_full = ref_color_for(&["refs/heads/main".into()], palette).unwrap();
        let from_short = ref_color_for(&["main".into()], palette).unwrap();
        assert_eq!(from_full, from_short);
        assert!(ref_color_for(&[], palette).is_none());
        let color = ref_color_for(&["refs/heads/main".into()], palette).unwrap();
        assert!(palette.contains(&color));
    }

    #[test]
    fn ref_color_is_used_for_the_lane_the_ref_points_at() {
        let color_for_ref = |entry: &GraphCommit| -> Option<LaneColor> {
            ref_color_for(&entry.ref_names, default_palette())
        };
        let result = layout_graph(
            &[commit("a", &["b"], &["refs/heads/main"])],
            &LayoutOptions { color_for_ref: Some(&color_for_ref), ..LayoutOptions::default() },
        );
        let lane_color = result.rows[0].lane_color.clone();
        assert_eq!(result.rows[0].output_lanes[0].color, lane_color);
    }

    #[test]
    fn layout_is_deterministic() {
        let commits = [
            commit("c", &["b"], &["refs/heads/main"]),
            commit("b", &["a"], &[]),
            commit("a", &[], &[]),
        ];
        assert_eq!(
            layout_graph(&commits, &LayoutOptions::default()),
            layout_graph(&commits, &LayoutOptions::default())
        );
    }

    #[test]
    fn surviving_lanes_keep_their_own_slot() {
        // Prevents: a renderer that aligns rows by index drawing a crossing line the data
        // does not contain. A lane may close, but a surviving lane never shifts sideways.
        let result = layout_graph(
            &[
                commit("m", &["a", "b", "c"], &[]),
                commit("a", &["base"], &[]),
                commit("c", &["base"], &[]),
                commit("b", &["base"], &[]),
                commit("base", &[], &[]),
            ],
            &LayoutOptions::default(),
        );
        for row in &result.rows {
            for (index, lane) in row.input_lanes.iter().enumerate() {
                if lane.id == row.id {
                    // This row's own lane is the one that becomes its first parent in place.
                    continue;
                }
                if let Some(survivor) = row.output_lanes.get(index) {
                    assert_eq!(survivor.id, lane.id);
                }
            }
        }
    }

    #[test]
    fn empty_page_invents_no_lanes() {
        let result = layout_graph(&[], &LayoutOptions::default());
        assert!(result.rows.is_empty());
        assert!(result.continuation.is_empty());
        assert_eq!(result.lane_count, 0);
    }

    #[test]
    fn empty_page_with_a_continuation_preserves_it() {
        // The TypeScript suite pins that the returned continuation is a fresh copy; in
        // Rust ownership already guarantees that, so the pinned behaviour is that an
        // empty page hands the lanes through untouched.
        let result = layout_graph(
            &[],
            &LayoutOptions {
                continuation: vec![LaneRef::new("x", "lane-1", 0)],
                ..LayoutOptions::default()
            },
        );
        assert_eq!(result.continuation, vec![LaneRef::new("x", "lane-1", 0)]);
        assert_eq!(result.lane_count, 1);
    }

    #[test]
    fn a_new_parent_opens_in_the_next_free_slot_without_displacing_other_branches() {
        // Updated product requirement: keep live branches parallel instead of inserting
        // a merge parent beside the trunk and moving every intervening branch.
        let result = layout_graph(&stable_branch_history(), &LayoutOptions::default());
        let output_ids: Vec<&str> =
            result.rows[2].output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(output_ids, &["left", "o", "side"]);
    }

    #[test]
    fn unrelated_branch_keeps_its_original_slot() {
        // Prevents an unrelated track wobbling sideways at every merge.
        let result = layout_graph(&stable_branch_history(), &LayoutOptions::default());
        let input_ids: Vec<&str> =
            result.rows[2].input_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(input_ids, &["m", "o"]);
        let output_slot_of_o = result.rows[2]
            .output_lanes
            .iter()
            .position(|lane| lane.id == "o")
            .unwrap();
        assert_eq!(output_slot_of_o, 1);
    }

    #[test]
    fn each_branch_circle_stays_in_the_lane_that_waited_for_it() {
        let result = layout_graph(&stable_branch_history(), &LayoutOptions::default());
        assert_eq!(result.rows[3].lane_index, 0); // left
        assert_eq!(result.rows[4].lane_index, 2); // side — newly opened track
        assert_eq!(result.rows[5].lane_index, 1); // o — stays parallel
    }

    #[test]
    fn local_branch_tip_recolors_the_line() {
        let result = layout_graph(
            &[
                commit("lane-mate", &["merge"], &["refs/heads/other"]),
                commit("merge", &["older"], &["refs/heads/current", "refs/tags/v1"]),
                commit("older", &["oldest"], &[]),
                commit("oldest", &[], &[]),
            ],
            &LayoutOptions { color_for_ref: Some(&lane_current_color), ..LayoutOptions::default() },
        );
        // `other` opened the lane above; from `merge` (current's tip) down it is
        // current's line and takes the current colour.
        assert_ne!(result.rows[0].output_lanes[0].color, "lane-current");
        assert_eq!(result.rows[1].output_lanes[0].color, "lane-current");
        assert_eq!(result.rows[2].output_lanes[0].color, "lane-current");
    }

    #[test]
    fn remote_branch_tip_takes_the_trunk_where_its_history_begins() {
        // GitKraken paints each segment in the colour of the nearest branch tip above
        // it, local or remote: a trunk that absorbed rc5's history reads as rc5's below
        // the point where it absorbed it, instead of wearing HEAD's colour all the way
        // down.
        let result = layout_graph(
            &[
                commit("tip", &["merge"], &["refs/heads/current"]),
                commit("merge", &["older"], &["refs/remotes/origin/rc5"]),
                commit("older", &["oldest"], &[]),
                commit("oldest", &[], &[]),
            ],
            &LayoutOptions { color_for_ref: Some(&lane_current_color), ..LayoutOptions::default() },
        );
        assert_eq!(result.rows[0].output_lanes[0].color, "lane-current");
        let inherited = result.rows[1].output_lanes[0].color.clone();
        assert_ne!(inherited, "lane-current");
        assert_eq!(
            inherited,
            ref_color_for(&["refs/remotes/origin/rc5".into()], default_palette()).unwrap()
        );
    }

    #[test]
    fn remote_twin_and_tags_alone_do_not_recolor() {
        // Prevents: the trunk flipping to a hash colour one commit under its own tip.
        // The tip asks its callback even at remote refs, so the guard is the callback's
        // (see the web wiring); the layout only promises not to recolor for tags.
        let result = layout_graph(
            &[
                commit("tip", &["under"], &["refs/heads/current"]),
                commit("under", &["older"], &["refs/remotes/origin/current"]),
                commit("older", &["oldest"], &["refs/tags/v9"]),
                commit("oldest", &[], &[]),
            ],
            &LayoutOptions { color_for_ref: Some(&lane_current_color), ..LayoutOptions::default() },
        );
        assert_eq!(result.rows[1].output_lanes[0].color, "lane-current");
        assert_eq!(result.rows[2].output_lanes[0].color, "lane-current");
    }

    #[test]
    fn a_merge_does_not_bend_unrelated_tracks_when_it_opens_another_parent() {
        // Prevents the sideways wobble seen around Xross's e8e312 merge.
        let result = layout_graph(
            &[
                commit("tip", &["merge"], &[]),
                commit("other", &["older"], &[]),
                commit("merge", &["first", "side"], &[]),
            ],
            &LayoutOptions::default(),
        );
        let row = &result.rows[2];
        let older_in = row.input_lanes.iter().find(|lane| lane.id == "older").unwrap();
        let older_out = row.output_lanes.iter().find(|lane| lane.id == "older").unwrap();
        assert_eq!(older_in.position, 1);
        assert_eq!(older_out.position, 1);
        let side_out = row.output_lanes.iter().find(|lane| lane.id == "side").unwrap();
        assert_eq!(side_out.position, 2);
    }

    #[test]
    fn an_unrelated_root_closing_preserves_the_other_tracks() {
        // Prevents a root in one history silently cutting every other live branch.
        let result = layout_graph(
            &[
                commit("a", &["root"], &[]),
                commit("b", &["older"], &[]),
                commit("root", &[], &[]),
                commit("older", &["base"], &[]),
            ],
            &LayoutOptions::default(),
        );
        let output_ids: Vec<&str> =
            result.rows[2].output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(output_ids, &["older"]);
        assert_eq!(result.rows[3].lane_index, 1);
    }

    #[test]
    fn an_already_active_merge_parent_joins_its_track_without_a_duplicate() {
        // e8e312's second parent already has a parallel track from another branch tip.
        let result = layout_graph(
            &[
                commit("tip", &["merge"], &[]),
                commit("other", &["shared"], &[]),
                commit("merge", &["first", "shared"], &[]),
            ],
            &LayoutOptions::default(),
        );
        let output_ids: Vec<&str> =
            result.rows[2].output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(output_ids, &["first", "shared"]);
        assert_eq!(result.lane_count, 2);
    }

    #[test]
    fn xross_fixture_keeps_parent_tracks_parallel_through_merges_and_page_boundaries() {
        let topology = fixture_topology();
        let result = layout_graph(&topology, &LayoutOptions::default());
        let merge = result
            .rows
            .iter()
            .find(|row| row.id == "e8e312c3ae194a418596e40a3ed5c192b6a31fd1")
            .expect("the fixture merge row must exist");
        assert_eq!(merge.parent_ids.len(), 2);
        let second_parent = &merge.parent_ids[1];
        assert_eq!(
            merge.output_lanes.iter().filter(|lane| &lane.id == second_parent).count(),
            1
        );
        for row in &result.rows {
            for lane in &row.input_lanes {
                if lane.id == row.id {
                    continue;
                }
                assert!(
                    row.output_lanes
                        .iter()
                        .any(|out| out.id == lane.id && out.position == lane.position),
                    "lane for {} must survive row {} unchanged",
                    lane.id,
                    row.id
                );
            }
        }
        for split in [100usize, 240, 247, 260] {
            let folded = layout_pages(
                &[&topology[..split], &topology[split..]],
                &LayoutOptions::default(),
            );
            assert_eq!(folded.rows, result.rows, "split at {split}");
        }
    }

    #[test]
    fn pages_fold_exactly_like_one_whole_layout() {
        let linear = [
            commit("f", &["e"], &[]),
            commit("e", &["d"], &[]),
            commit("d", &["c"], &[]),
            commit("c", &[], &[]),
        ];
        let folded = layout_pages(&[&linear[..2], &linear[2..]], &LayoutOptions::default());
        let whole = layout_graph(&linear, &LayoutOptions::default());
        assert_eq!(folded.rows, whole.rows);
        assert_eq!(folded.lane_count, whole.lane_count);
    }

    #[test]
    fn a_live_lane_survives_a_page_boundary_between_a_merge_and_its_parents() {
        // Splitting between the merge and its parents is the case where a naive restart
        // shows two unrelated lines instead of one branch waiting for a commit on the
        // next page.
        let branched = branched_history();
        let folded = layout_pages(&[&branched[..3], &branched[3..]], &LayoutOptions::default());
        assert_eq!(folded.rows, layout_graph(&branched, &LayoutOptions::default()).rows);
        let last_of_first_page = &folded.rows[2];
        let first_of_second_page = &folded.rows[3];
        let out_ids: Vec<&str> =
            last_of_first_page.output_lanes.iter().map(|lane| lane.id.as_str()).collect();
        let in_ids: Vec<&str> =
            first_of_second_page.input_lanes.iter().map(|lane| lane.id.as_str()).collect();
        assert_eq!(out_ids, in_ids);
        assert!(folded.lane_count > 1);
    }

    #[test]
    fn pages_report_the_widest_page_so_one_column_fits_all() {
        let wide = [
            commit("c", &["b1", "b2", "b3"], &[]),
            commit("b1", &[], &[]),
            commit("b2", &[], &[]),
            commit("b3", &[], &[]),
        ];
        let folded = layout_pages(&[&wide], &LayoutOptions::default());
        assert_eq!(folded.lane_count, layout_graph(&wide, &LayoutOptions::default()).lane_count);
        assert!(folded.lane_count >= 3);
    }

    #[test]
    fn a_page_loaded_out_of_order_starts_from_an_explicit_continuation() {
        let branched = branched_history();
        let first = layout_graph(&branched[..3], &LayoutOptions::default());
        let continued = layout_pages(
            &[&branched[3..]],
            &LayoutOptions { continuation: first.continuation, ..LayoutOptions::default() },
        );
        assert_eq!(continued.rows, layout_graph(&branched, &LayoutOptions::default()).rows[3..]);
    }

    #[test]
    fn an_empty_page_is_a_no_op_rather_than_resetting_the_lanes() {
        // A UI that renders a spinner page must not lose the continuation it already had.
        let branched = branched_history();
        let first = layout_graph(&branched[..3], &LayoutOptions::default());
        let folded = layout_pages(&[&branched[..3], &[]], &LayoutOptions::default());
        assert_eq!(folded.rows, first.rows);
    }

    fn merge_history() -> Vec<GraphCommit> {
        vec![
            commit("m", &["left", "right"], &[]),
            commit("left", &["base"], &[]),
            commit("right", &["base"], &[]),
            commit("base", &[], &[]),
        ]
    }

    fn stable_branch_history() -> Vec<GraphCommit> {
        vec![
            commit("t", &["m"], &[]),
            commit("u", &["o"], &[]),
            commit("m", &["left", "side"], &[]),
            commit("left", &["base"], &[]),
            commit("side", &["base"], &[]),
            commit("o", &["base"], &[]),
            commit("base", &[], &[]),
        ]
    }

    fn branched_history() -> Vec<GraphCommit> {
        vec![
            commit("m", &["l1", "r1"], &[]),
            commit("l1", &["l2"], &[]),
            commit("r1", &["r2"], &[]),
            commit("l2", &["base"], &[]),
            commit("r2", &["base"], &[]),
            commit("base", &[], &[]),
        ]
    }

    /// Mirrors the real web wiring (`laneColorFor` in apps/web): the checked-out branch
    /// and its remote twin keep the current colour; every other branch tip hashes its
    /// name.
    fn lane_current_color(entry: &GraphCommit) -> Option<LaneColor> {
        if entry
            .ref_names
            .iter()
            .any(|name| name == "refs/heads/current" || name == "refs/remotes/origin/current")
        {
            return Some("lane-current".into());
        }
        let others: Vec<LaneColor> = entry
            .ref_names
            .iter()
            .filter(|name| !name.ends_with("/HEAD"))
            .cloned()
            .collect();
        ref_color_for(&others, default_palette())
    }

    /// The fixture is a read-only snapshot of 271 date-ordered commits from xross-dev;
    /// OIDs except the reported merge are anonymized and it carries no `refNames`.
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureCommit {
        id: String,
        #[serde(default)]
        parent_ids: Vec<String>,
        #[serde(default)]
        ref_names: Vec<String>,
    }

    fn fixture_topology() -> Vec<GraphCommit> {
        let raw = include_str!("../../../tests/fixtures/graph/xross-e8e312.json");
        let parsed: Vec<FixtureCommit> = serde_json::from_str(raw).expect("fixture parses");
        parsed
            .into_iter()
            .map(|c| GraphCommit { id: c.id, parent_ids: c.parent_ids, ref_names: c.ref_names })
            .collect()
    }
}
