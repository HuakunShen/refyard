//! Pixel geometry for the commit graph.
//!
//! Rust port of `packages/git-ui/src/lib/geometry.ts` (this repository's own TypeScript
//! module) with one deliberate change of shape: instead of SVG path strings it returns
//! structured segments — a straight line or a cubic curve — which the GPUI renderer
//! turns into stroked paths directly. The math is identical, including the midline
//! control points that make a curve leave a circle vertically and arrive at a lane
//! vertically.
//!
//! `layout` decides *where lanes are* — indices, colours, continuation. This module
//! turns that decision into the segments a row draws, and nothing else. It lives apart
//! from the layout because it is the part that has to agree with the list's fixed row
//! height, and the only way to keep two things in agreement is to have one number that
//! both are given.

use crate::layout::GraphRow;

/// How much room one row and its lanes get, in pixels.
///
/// The scale is anchored on GitKraken's spacing at its roomy end — roughly 43px rows,
/// 26px avatar nodes and 3px lanes — which is what makes its graph read as calm instead
/// of dense. This workbench defaults to the compact end instead ([`CompactMetrics`]): a
/// workbench is read for what changed, so the most commits per screen wins, and the
/// proportions are held constant here (lane stroke ≈ 7% of the row, avatar ≈ 30%) so the
/// denser rows stay legible rather than merely smaller.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Metrics {
    /// Row height in pixels. The virtualized list uses this same value.
    pub row_height: f32,
    /// Horizontal distance between lane centres.
    pub lane_width: f32,
    /// Padding before the first lane and after the last.
    pub lane_padding: f32,
    /// Commit circle radius.
    pub radius: f32,
    /// Lane stroke width, scaled with the row so a roomy graph is not drawn with
    /// hairlines.
    pub line_width: f32,
}

/// The compact preset a workbench is read at.
pub const COMPACT_METRICS: Metrics = Metrics {
    row_height: 28.0,
    lane_width: 14.0,
    lane_padding: 10.0,
    radius: 4.5,
    line_width: 2.0,
};

/// The roomy preset.
pub const COMFORTABLE_METRICS: Metrics = Metrics {
    row_height: 36.0,
    lane_width: 20.0,
    lane_padding: 12.0,
    radius: 6.0,
    line_width: 2.5,
};

/// The default: compact, because a history list is read for what changed.
pub const DEFAULT_METRICS: Metrics = COMPACT_METRICS;

/// Centre x of a lane index.
pub fn lane_x(index: usize, metrics: &Metrics) -> f32 {
    metrics.lane_padding + metrics.radius + index as f32 * metrics.lane_width
}

/// Centre y of a row index, using the same row height the list is laid out with.
pub fn row_center_y(index: usize, metrics: &Metrics) -> f32 {
    index as f32 * metrics.row_height + metrics.row_height / 2.0
}

/// Width the graph column needs for `lane_count` lanes.
pub fn gutter_width(lane_count: usize, metrics: &Metrics) -> f32 {
    let last = lane_count.saturating_sub(1);
    lane_x(last, metrics) + metrics.radius + metrics.lane_padding
}

/// Avatar radius for a row: GitKraken's 26px photo in a 43px row is a 0.30 ratio, with
/// floors and ceilings so a compact graph still shows a face and a roomy one does not
/// turn the photo into the row.
pub fn avatar_radius_for(metrics: &Metrics) -> f32 {
    (metrics.row_height * 0.3).clamp(6.0, 14.0)
}

/// Below these a squeezed graph stops shrinking and lets the column clip it.
const MIN_LANE_WIDTH: f32 = 6.0;
const MIN_RADIUS: f32 = 2.5;
const MIN_LINE_WIDTH: f32 = 1.25;
const MIN_LANE_PADDING: f32 = 6.0;

/// Metrics that squeeze `lane_count` lanes into `available_width`, GitKraken-style.
///
/// At or above the natural gutter the base metrics hold unchanged. Below it the whole
/// span scales together — padding, lane spacing, dots and strokes — until the lanes fit,
/// so a narrow graph column compresses its graph instead of forcing the column wide or
/// dropping lanes. Padding is part of the span rather than a fixed inset: two 12px
/// insets are a quarter of a 100px column, and holding them fixed is what made a narrow
/// column overflow by the very pixels it was trying to save.
///
/// The floors keep a maximally squeezed graph legible; past them the column simply
/// clips, which is what GitKraken does too.
pub fn compressed_metrics(lane_count: usize, available_width: f32, base: &Metrics) -> Metrics {
    if lane_count <= 1 || available_width >= gutter_width(lane_count, base) {
        return *base;
    }
    let last = (lane_count - 1) as f32;
    let span = 2.0 * base.lane_padding + 2.0 * base.radius + last * base.lane_width;
    let scale = (available_width / span).max(MIN_LANE_WIDTH / base.lane_width).min(1.0);
    let lane_padding = (base.lane_padding * scale).max(MIN_LANE_PADDING);
    let radius = (base.radius * scale).max(MIN_RADIUS);
    let line_width = (base.line_width * scale).max(MIN_LINE_WIDTH);
    let mut lane_width = (base.lane_width * scale).max(MIN_LANE_WIDTH);

    // Each term above is an independently rounded product, so the reconstruction can
    // land a fraction of a pixel above the width it was scaled to fit — and "every lane
    // fits" is this function's whole promise: a column that overflows by an ulp clips
    // its last lane. So what was built is measured and the remainder comes out of the
    // lane spacing, which is the only term multiplied by the lane count. At the floor
    // there is nothing left to take, and the documented answer past it is to clip.
    let first = Metrics { lane_padding, lane_width, radius, line_width, ..*base };
    let overflow = gutter_width(lane_count, &first) - available_width;
    if overflow > 0.0 && lane_width > MIN_LANE_WIDTH {
        lane_width = (lane_width - overflow / last).max(MIN_LANE_WIDTH);
    }
    Metrics { lane_padding, lane_width, radius, line_width, ..*base }
}

/// The shape of one drawn edge: a straight line, or the cubic curve between different
/// lanes whose two control points sit on the horizontal midline.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SegmentShape {
    Line { x0: f32, y0: f32, x1: f32, y1: f32 },
    Curve { x0: f32, y0: f32, x1: f32, y1: f32 },
}

impl SegmentShape {
    /// The horizontal midline both control points sit on, so a curve leaves its start
    /// and enters its end vertically. A straight edge has no control points.
    pub fn mid_y(&self) -> Option<f32> {
        match self {
            SegmentShape::Line { .. } => None,
            SegmentShape::Curve { y0, y1, .. } => Some((y0 + y1) / 2.0),
        }
    }

    pub fn start(&self) -> (f32, f32) {
        match self {
            SegmentShape::Line { x0, y0, .. } | SegmentShape::Curve { x0, y0, .. } => (*x0, *y0),
        }
    }

    pub fn end(&self) -> (f32, f32) {
        match self {
            SegmentShape::Line { x1, y1, .. } | SegmentShape::Curve { x1, y1, .. } => (*x1, *y1),
        }
    }
}

/// One edge between two points: straight when the x positions match (a lane continuing
/// through, or a first parent in the same lane), the midline cubic otherwise.
pub fn edge_shape(x0: f32, y0: f32, x1: f32, y1: f32) -> SegmentShape {
    if x0 == x1 {
        SegmentShape::Line { x0, y0, x1, y1 }
    } else {
        SegmentShape::Curve { x0, y0, x1, y1 }
    }
}

/// What a segment means, for a renderer that styles merges and branches differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    /// A lane passing straight through, or the trunk continuing.
    Lane,
    /// A lane converging into this row's commit from another slot.
    Merge,
    /// A new lane leaving this row's commit towards a parent.
    Branch,
}

/// One drawn segment with the colour token of the lane it belongs to.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub shape: SegmentShape,
    pub color: crate::layout::LaneColor,
    pub kind: SegmentKind,
}

/// The commit circle of a row.
#[derive(Debug, Clone, PartialEq)]
pub struct Circle {
    pub cx: f32,
    pub cy: f32,
    pub color: crate::layout::LaneColor,
}

/// Everything one row draws, in row-local coordinates (the caller translates by index).
///
/// Lanes are matched between the row's input and output **by id, then by position**: the
/// layout preserves explicit positions, so a surviving lane is found by id and slot; when
/// a lane's slot moved (a new lane opened beside it), the id match still finds it and the
/// move is drawn as a shallow curve. Matching by index would draw that shift as a merge
/// into this row's commit — a line the data does not contain. The id match gives the
/// three segment kinds a row can have:
///
/// - a lane whose id survives into the output passes through, straight when it keeps its
///   slot and a shallow curve when it shifted;
/// - a lane waiting for *this* commit (id === row id) ends at the circle;
/// - an output lane no input lane claims opened at this row, drawn from the circle to the
///   bottom edge.
#[derive(Debug, Clone, PartialEq)]
pub struct RowGeometry {
    pub circle: Circle,
    pub segments: Vec<Segment>,
}

/// The short horizontal line from a ref label into the graph, GitKraken-style.
///
/// A branch or tag label lives in the column to the left of the graph, so without this
/// the pill and the lane it names are two things a reader has to join up themselves.
/// It runs from the column's left edge to the node's centre at the node's own y.
pub fn ref_connector(lane_index: usize, index: usize, metrics: &Metrics) -> SegmentShape {
    SegmentShape::Line {
        x0: 0.0,
        y0: row_center_y(index, metrics),
        x1: lane_x(lane_index, metrics),
        y1: row_center_y(index, metrics),
    }
}

pub fn row_geometry(row: &GraphRow, index: usize, metrics: &Metrics) -> RowGeometry {
    let cx = lane_x(row.lane_index, metrics);
    let cy = row_center_y(index, metrics);
    let top = index as f32 * metrics.row_height;
    let bottom = top + metrics.row_height;
    let mut segments: Vec<Segment> = Vec::new();

    // One output slot can be claimed by at most one input lane, so a degenerate commit
    // that lists one parent twice still draws both of its lines.
    let mut claimed = std::collections::HashSet::<usize>::new();
    let output_slot_of = |lane: &crate::layout::LaneRef, claimed: &std::collections::HashSet<usize>| {
        // First a stable match: same id and the same slot the layout gave it.
        row.output_lanes
            .iter()
            .enumerate()
            .find(|(slot, out)| {
                out.id == lane.id && out.position == lane.position && !claimed.contains(slot)
            })
            .map(|(slot, _)| slot)
            .or_else(|| {
                // Then a shifted survivor: same id on a moved slot, drawn as a shallow
                // curve.
                row.output_lanes
                    .iter()
                    .enumerate()
                    .find(|(slot, out)| out.id == lane.id && !claimed.contains(slot))
                    .map(|(slot, _)| slot)
            })
    };

    for lane in &row.input_lanes {
        let x = lane_x(lane.position, metrics);
        if lane.id == row.id {
            // This lane was waiting for the commit: it ends at the circle, whether it is
            // the lane that continues as the first parent or one that converges here.
            segments.push(Segment {
                shape: edge_shape(x, top, cx, cy),
                color: lane.color.clone(),
                kind: if x == cx { SegmentKind::Lane } else { SegmentKind::Merge },
            });
            continue;
        }
        let Some(output_slot) = output_slot_of(lane, &claimed) else {
            // A live lane always continues; drawing a straight pass-through keeps the
            // line whole even if the layout ever hands over a row that drops one.
            segments.push(Segment {
                shape: edge_shape(x, top, x, bottom),
                color: lane.color.clone(),
                kind: SegmentKind::Lane,
            });
            continue;
        };
        claimed.insert(output_slot);
        let x_out = lane_x(row.output_lanes[output_slot].position, metrics);
        segments.push(Segment {
            shape: edge_shape(x, top, x_out, bottom),
            color: lane.color.clone(),
            kind: if x_out == x { SegmentKind::Lane } else { SegmentKind::Merge },
        });
    }

    for (slot, lane) in row.output_lanes.iter().enumerate() {
        // An output slot an input claimed is already drawn — unless this row's commit
        // opened it as a parent, in which case the circle-to-bottom edge is still owed.
        let is_parent = row.parent_ids.contains(&lane.id);
        let has_unclaimed_twin = row
            .output_lanes
            .iter()
            .enumerate()
            .any(|(other_slot, other)| other.id == lane.id && !claimed.contains(&other_slot));
        if claimed.contains(&slot) && (!is_parent || has_unclaimed_twin) {
            continue;
        }
        let x = lane_x(lane.position, metrics);
        segments.push(Segment {
            shape: edge_shape(cx, cy, x, bottom),
            color: lane.color.clone(),
            kind: if x == cx { SegmentKind::Lane } else { SegmentKind::Branch },
        });
    }

    RowGeometry { circle: Circle { cx, cy, color: row.lane_color.clone() }, segments }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{layout_graph, GraphCommit, LaneRef};

    const METRICS: Metrics = Metrics { row_height: 24.0, lane_width: 10.0, ..COMPACT_METRICS };

    fn ref_lane(id: &str, position: usize) -> crate::layout::LaneRef {
        crate::layout::LaneRef::new(id, "lane-1", position)
    }

    fn ref_lane_colored(id: &str, color: &str, position: usize) -> crate::layout::LaneRef {
        crate::layout::LaneRef::new(id, color, position)
    }

    /// A hand-built row, so a case can state exactly the lane state it is about. The
    /// TypeScript originals omitted positions and relied on array indices; here every
    /// lane carries the slot the layout would have given it.
    fn row(
        id: &str,
        lane_index: usize,
        input_lanes: Vec<crate::layout::LaneRef>,
        output_lanes: Vec<crate::layout::LaneRef>,
    ) -> GraphRow {
        GraphRow {
            id: id.to_owned(),
            parent_ids: Vec::new(),
            ref_names: Vec::new(),
            lane_index,
            lane_color: "lane-1".to_owned(),
            input_lanes,
            output_lanes,
            is_merge: false,
            is_root: false,
        }
    }

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-4, "{a} != {b}");
    }

    #[test]
    fn lane_zero_is_centred_in_the_left_padding_and_lanes_are_one_width_apart() {
        approx(lane_x(0, &METRICS), METRICS.lane_padding + METRICS.radius);
        approx(lane_x(1, &METRICS) - lane_x(0, &METRICS), METRICS.lane_width);
    }

    #[test]
    fn a_row_centre_sits_half_a_row_height_below_its_own_top_edge() {
        // If this drifts from the list's row height, every circle moves off its text row
        // — the classic "graph is fine, list is fine, together they are wrong" bug.
        approx(row_center_y(0, &METRICS), METRICS.row_height / 2.0);
        approx(row_center_y(3, &METRICS), 3.0 * METRICS.row_height + METRICS.row_height / 2.0);
    }

    #[test]
    fn the_gutter_widens_as_lanes_are_added_and_never_narrows() {
        let one = gutter_width(1, &METRICS);
        let four = gutter_width(4, &METRICS);
        assert!(four > one);
        approx(four - one, 3.0 * METRICS.lane_width);
        // A single lane still has room for its circle on both sides.
        assert!(one >= 2.0 * (METRICS.radius + METRICS.lane_padding));
    }

    #[test]
    fn densities_scale_row_lanes_dots_and_strokes_together() {
        // The failure this prevents: raising the row height alone, which leaves a roomy
        // list drawn with compact-width lanes and hairline strokes — the graph stops
        // matching the rows it is drawn against.
        let small = &COMPACT_METRICS;
        let large = &COMFORTABLE_METRICS;
        assert!(large.row_height > small.row_height);
        assert!(large.lane_width > small.lane_width);
        assert!(large.radius > small.radius);
        assert!(large.line_width > small.line_width);
        // The stroke stays around 7% of the row at every density: that ratio is what
        // keeps a roomy graph from looking like a compact one that was stretched.
        assert!((large.line_width / large.row_height - 0.07).abs() < 0.05);
    }

    #[test]
    fn avatar_radius_is_gitrakens_30_percent_of_the_row_within_floors() {
        approx(avatar_radius_for(&COMFORTABLE_METRICS), 10.8);
        // A compact row still shows a face; a row too short for one keeps the floor.
        approx(
            avatar_radius_for(&Metrics { row_height: 8.0, ..COMPACT_METRICS }),
            6.0,
        );
    }

    #[test]
    fn the_default_density_is_compact() {
        // Prevents: a history table that opens at GitKraken's calm spacing, which trades
        // the commits a reader came for against whitespace they did not ask for.
        assert_eq!(DEFAULT_METRICS, COMPACT_METRICS);
        approx(DEFAULT_METRICS.row_height, 28.0);
    }

    #[test]
    fn base_metrics_hold_once_the_column_fits_the_lanes() {
        let lanes = 4;
        assert_eq!(
            compressed_metrics(lanes, gutter_width(lanes, &METRICS), &METRICS),
            METRICS
        );
        assert_eq!(compressed_metrics(lanes, 10_000.0, &METRICS), METRICS);
        // A single lane never needs squeezing: the padding alone surrounds it.
        assert_eq!(compressed_metrics(1, 0.0, &METRICS), METRICS);
    }

    #[test]
    fn squeezing_shrinks_the_lane_spacing_so_every_lane_fits_a_narrow_column() {
        // Real-world failure prevented: a user-narrowed graph column that either forced
        // the table wide again or silently dropped lanes would undo the resize;
        // GitKraken compresses the lanes instead, and so must we.
        let lanes = 6;
        let width = 60.0;
        let squeezed = compressed_metrics(lanes, width, &METRICS);
        assert!(gutter_width(lanes, &squeezed) <= width);
        // Squeezing is proportionate: lanes stay evenly spaced and dots stay round.
        assert!(squeezed.lane_width < METRICS.lane_width);
        assert!(squeezed.radius < METRICS.radius);
        // The padding is part of the span, so it shrinks too — held fixed it would be
        // the pixels that overflow.
        assert!(squeezed.lane_padding < METRICS.lane_padding);
        // Evenly spaced, within a tolerance, because a lane centre is a sum of floats
        // and the difference of two sums is not exactly the addend.
        approx(lane_x(3, &squeezed) - lane_x(2, &squeezed), squeezed.lane_width);
        approx(lane_x(2, &squeezed) - lane_x(1, &squeezed), squeezed.lane_width);
        // The row height is the list's layout and must never move.
        approx(squeezed.row_height, METRICS.row_height);
    }

    #[test]
    fn padding_scales_with_the_span_and_has_a_floor_of_its_own() {
        // At the lane-width floor the padding has already scaled by the same factor, so
        // it is the base padding times that factor, not the base padding.
        let floor_scale = 6.0 / METRICS.lane_width;
        let squeezed = compressed_metrics(20, 40.0, &METRICS);
        approx(squeezed.lane_padding, METRICS.lane_padding * floor_scale);
        // A roomy base scales further down than its own floor allows: 14px insets at the
        // lane floor would be 3.2px, which is not an inset any more.
        let roomy_base = Metrics { lane_width: 26.0, lane_padding: 14.0, ..COMFORTABLE_METRICS };
        let roomy = compressed_metrics(20, 40.0, &roomy_base);
        approx(roomy.lane_padding, MIN_LANE_PADDING);
    }

    #[test]
    fn squeezing_stops_at_a_legible_floor_and_lets_the_column_clip_past_it() {
        let squeezed = compressed_metrics(20, 40.0, &METRICS);
        // The lane-width floor sets the scale; the radius rides it unless it would dip
        // under its own floor.
        let floor_scale = 6.0 / METRICS.lane_width;
        approx(squeezed.lane_width, 6.0);
        approx(squeezed.radius, (2.5f32).max(METRICS.radius * floor_scale));
        // Past the floor the gutter may exceed the column; the renderer clips, which is
        // exactly what a hard-squeezed GitKraken graph does.
        assert!(gutter_width(20, &squeezed) > 40.0);
    }

    #[test]
    fn a_ref_connector_runs_from_the_column_left_edge_to_the_node_centre() {
        // The failure this prevents: a branch pill in the BRANCH/TAG column and its lane
        // in the graph column reading as two unrelated things. GitKraken draws the join.
        let SegmentShape::Line { x0, y0, x1, y1 } = ref_connector(2, 3, &METRICS) else {
            panic!("a ref connector is a straight line");
        };
        approx(x0, 0.0);
        approx(y0, row_center_y(3, &METRICS));
        approx(x1, lane_x(2, &METRICS));
        approx(y1, row_center_y(3, &METRICS));
    }

    #[test]
    fn a_ref_connector_is_horizontal_so_it_never_looks_like_a_graph_edge() {
        let connector = ref_connector(1, 5, &METRICS);
        let (_, y0) = connector.start();
        let (_, y1) = connector.end();
        assert_eq!(y0, y1);
    }

    #[test]
    fn a_lane_waiting_for_another_commit_passes_straight_through_in_its_own_color() {
        let geometry = &row_geometry(
            &row(
                "b",
                0,
                vec![ref_lane_colored("c", "lane-2", 0), ref_lane_colored("b", "lane-3", 1)],
                vec![ref_lane_colored("c", "lane-2", 0), ref_lane_colored("x", "lane-3", 1)],
            ),
            0,
            &METRICS,
        );
        let first = &geometry.segments[0];
        assert_eq!(first.kind, SegmentKind::Lane);
        // The unrelated lane must not be repainted with the row's colour, which is how a
        // graph ends up showing two branches as one.
        assert_eq!(first.color, "lane-2");
        let (x0, y0) = first.shape.start();
        let (x1, y1) = first.shape.end();
        approx(x0, lane_x(0, &METRICS));
        approx(y0, 0.0);
        approx(x1, lane_x(0, &METRICS));
        approx(y1, METRICS.row_height);
    }

    #[test]
    fn a_converging_lane_enters_the_circle_and_the_first_parent_leaves_straight_down() {
        let geometry = row_geometry(
            &row(
                "m",
                0,
                vec![ref_lane_colored("m", "lane-1", 0), ref_lane_colored("m", "lane-4", 1)],
                vec![ref_lane_colored("p", "lane-1", 0)],
            ),
            1,
            &METRICS,
        );
        let cx = lane_x(0, &METRICS);
        let cy = row_center_y(1, &METRICS);
        let kinds: Vec<SegmentKind> = geometry.segments.iter().map(|s| s.kind).collect();
        assert_eq!(kinds, [SegmentKind::Lane, SegmentKind::Merge, SegmentKind::Lane]);
        // The converging lane comes in from lane 1 at the top edge…
        let (_, y0) = geometry.segments[1].shape.start();
        let (x1, y1) = geometry.segments[1].shape.end();
        approx(y0, METRICS.row_height);
        approx(x1, cx);
        approx(y1, cy);
        // …and the first parent leaves straight down to the bottom edge.
        let (x2, y2) = geometry.segments[2].shape.end();
        approx(x2, cx);
        approx(y2, 2.0 * METRICS.row_height);
    }

    #[test]
    fn an_extra_parents_lane_starts_with_a_branch_curve_from_the_circle() {
        let geometry = row_geometry(
            &row(
                "m",
                0,
                vec![ref_lane_colored("m", "lane-1", 0)],
                vec![ref_lane_colored("p1", "lane-1", 0), ref_lane_colored("p2", "lane-2", 1)],
            ),
            2,
            &METRICS,
        );
        let branch = geometry
            .segments
            .iter()
            .find(|segment| segment.kind == SegmentKind::Branch)
            .expect("a branch curve");
        let (x0, y0) = branch.shape.start();
        let (x1, y1) = branch.shape.end();
        approx(x0, lane_x(0, &METRICS));
        approx(y0, row_center_y(2, &METRICS));
        approx(x1, lane_x(1, &METRICS));
        approx(y1, 3.0 * METRICS.row_height);
        // The curve's control points sit on the horizontal midline, so it leaves the
        // circle vertically and arrives at the lane vertically.
        approx(branch.shape.mid_y().expect("a curve"), (y0 + y1) / 2.0);
    }

    #[test]
    fn a_root_commit_draws_no_outgoing_segment() {
        let geometry = row_geometry(
            &row("r", 0, vec![ref_lane("r", 0)], vec![]),
            0,
            &METRICS,
        );
        assert_eq!(geometry.segments.len(), 1);
        assert_eq!(geometry.segments[0].kind, SegmentKind::Lane);
    }

    #[test]
    fn a_lane_stays_alive_when_its_parent_was_not_loaded() {
        // The paging case: an unresolved parent stays a lane instead of becoming a root.
        // Dropping the segment here is what makes "load more" visually detach from
        // history.
        let geometry = row_geometry(
            &row(
                "page-last",
                0,
                vec![ref_lane("page-last", 0)],
                vec![ref_lane("not-loaded-yet", 0)],
            ),
            0,
            &METRICS,
        );
        let downward = geometry
            .segments
            .iter()
            .filter(|segment| {
                let (_, y1) = segment.shape.end();
                (y1 - METRICS.row_height).abs() < 1e-4
            })
            .count();
        assert_eq!(downward, 1);
    }

    #[test]
    fn a_real_merged_history_accounts_for_every_lane_once_per_row() {
        let layout = layout_graph(
            &[
                GraphCommit::new("c").with_parents(["b1", "b2"]),
                GraphCommit::new("b1").with_parents(["a"]),
                GraphCommit::new("b2").with_parents(["a"]),
                GraphCommit::new("a"),
            ],
            &crate::layout::LayoutOptions::default(),
        );
        assert_eq!(layout.rows.len(), 4);
        for (index, graph_row) in layout.rows.iter().enumerate() {
            let geometry = row_geometry(graph_row, index, &METRICS);
            let pass_through = graph_row
                .input_lanes
                .iter()
                .zip(graph_row.output_lanes.iter())
                .filter(|(lane, output)| output.id == lane.id)
                .count();
            let expected = graph_row.input_lanes.len() + graph_row.output_lanes.len() - pass_through;
            assert_eq!(geometry.segments.len(), expected);
            approx(geometry.circle.cy, row_center_y(index, &METRICS));
            assert_eq!(geometry.circle.color, graph_row.lane_color);
        }
    }

    #[test]
    fn a_surviving_lane_that_shifted_sideways_draws_as_a_curve_not_a_merge() {
        // The layout opens `side` between the trunk and `o`; `o` keeps its identity but
        // moves one slot right. Matching by index would bend `o` into this row's circle
        // — a merge the repository does not contain.
        let shifted_row = row(
            "m",
            0,
            vec![ref_lane_colored("m", "lane-current", 0), ref_lane_colored("o", "lane-2", 1)],
            vec![
                ref_lane_colored("left", "lane-current", 0),
                ref_lane_colored("side", "lane-5", 1),
                ref_lane_colored("o", "lane-2", 2),
            ],
        );
        let geometry = row_geometry(&shifted_row, 3, &METRICS);
        let o_in = lane_x(1, &METRICS);
        let o_out = lane_x(2, &METRICS);
        let o_segments: Vec<&Segment> =
            geometry.segments.iter().filter(|s| s.color == "lane-2").collect();
        assert_eq!(o_segments.len(), 1);
        let (x0, y0) = o_segments[0].shape.start();
        let (x1, y1) = o_segments[0].shape.end();
        approx(x0, o_in);
        approx(y0, 3.0 * METRICS.row_height);
        approx(x1, o_out);
        approx(y1, 4.0 * METRICS.row_height);
    }

    #[test]
    fn the_branch_lane_that_opened_beside_the_trunk_draws_from_the_circle_down() {
        let shifted_row = row(
            "m",
            0,
            vec![ref_lane_colored("m", "lane-current", 0), ref_lane_colored("o", "lane-2", 1)],
            vec![
                ref_lane_colored("left", "lane-current", 0),
                ref_lane_colored("side", "lane-5", 1),
                ref_lane_colored("o", "lane-2", 2),
            ],
        );
        let geometry = row_geometry(&shifted_row, 3, &METRICS);
        let branch = geometry
            .segments
            .iter()
            .find(|s| s.color == "lane-5")
            .expect("the branch segment");
        assert_eq!(branch.kind, SegmentKind::Branch);
        let (x0, y0) = branch.shape.start();
        let (x1, y1) = branch.shape.end();
        approx(x0, lane_x(0, &METRICS));
        approx(y0, row_center_y(3, &METRICS));
        approx(x1, lane_x(1, &METRICS));
        approx(y1, 4.0 * METRICS.row_height);
    }

    #[test]
    fn the_right_track_draws_straight_after_the_left_root_closes() {
        // Prevents array compaction making a surviving branch curve into an empty slot.
        let result = layout_graph(
            &[
                GraphCommit::new("a").with_parents(["root"]),
                GraphCommit::new("b").with_parents(["older"]),
                GraphCommit::new("root"),
                GraphCommit::new("older").with_parents(["base"]),
            ],
            &crate::layout::LayoutOptions::default(),
        );
        let geometry = row_geometry(&result.rows[2], 2, &METRICS);
        let straight = SegmentShape::Line {
            x0: lane_x(1, &METRICS),
            y0: 48.0,
            x1: lane_x(1, &METRICS),
            y1: 72.0,
        };
        assert!(
            geometry.segments.iter().any(|s| s.shape == straight),
            "the surviving older track must pass straight through slot 1"
        );
    }

    #[test]
    fn a_merge_edge_to_an_existing_parent_does_not_bend_its_through_track() {
        let result = layout_graph(
            &[
                GraphCommit::new("tip").with_parents(["merge"]),
                GraphCommit::new("other").with_parents(["shared"]),
                GraphCommit::new("merge").with_parents(["first", "shared"]),
            ],
            &crate::layout::LayoutOptions::default(),
        );
        let geometry = row_geometry(&result.rows[2], 2, &METRICS);
        let through = SegmentShape::Line {
            x0: lane_x(1, &METRICS),
            y0: 48.0,
            x1: lane_x(1, &METRICS),
            y1: 72.0,
        };
        let merge_edge = SegmentShape::Curve {
            x0: lane_x(0, &METRICS),
            y0: 60.0,
            x1: lane_x(1, &METRICS),
            y1: 72.0,
        };
        assert!(geometry.segments.iter().any(|s| s.shape == through));
        assert!(geometry.segments.iter().any(|s| s.shape == merge_edge));
    }

    #[test]
    fn duplicate_ancestor_tracks_stay_attached_to_their_own_slots() {
        // Prevents matching by pending OID choosing a different parallel track with that
        // OID.
        let result = layout_graph(
            &[
                GraphCommit::new("tip").with_parents(["next"]),
                GraphCommit::new("other").with_parents(["base"]),
                GraphCommit::new("next").with_parents(["base"]),
            ],
            &crate::layout::LayoutOptions::default(),
        );
        let geometry = row_geometry(&result.rows[2], 2, &METRICS);
        let expected = SegmentShape::Line {
            x0: lane_x(1, &METRICS),
            y0: 48.0,
            x1: lane_x(1, &METRICS),
            y1: 72.0,
        };
        assert!(geometry.segments.iter().any(|s| s.shape == expected));
    }

    #[test]
    fn a_lane_ref_position_is_honoured_by_the_geometry() {
        // Guards the one number the list and the graph must agree on: a lane's slot, not
        // its array position, is where it draws.
        let geometry = row_geometry(
            &row(
                "a",
                0,
                vec![LaneRef::new("a", "lane-1", 0)],
                vec![LaneRef::new("p", "lane-1", 0)],
            ),
            5,
            &METRICS,
        );
        approx(geometry.circle.cx, lane_x(0, &METRICS));
        approx(geometry.circle.cy, row_center_y(5, &METRICS));
    }
}
