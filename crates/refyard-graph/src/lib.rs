//! Commit-graph layout: lane allocation, page continuation, ref colours and pixel
//! geometry, ported from the TypeScript packages (`packages/git-graph`,
//! `packages/git-ui/src/lib/geometry.ts`, `packages/git-ui/src/lib/head-segment.ts`) so
//! the GPUI desktop renders the same graph as the web workbench. Pure Rust: no host
//! APIs, no GUI dependency, no IO.
//!
//! `layout` decides *where lanes are*; `geometry` turns that decision into row-local
//! segments the renderer draws; `head` marks the stretch of history where the
//! checked-out branch still owns its line.

pub mod geometry;
pub mod head;
pub mod layout;

pub use geometry::{
    avatar_radius_for, compressed_metrics, edge_shape, gutter_width, lane_x, ref_connector,
    row_center_y, row_geometry, Circle, COMPACT_METRICS, COMFORTABLE_METRICS, DEFAULT_METRICS,
    Metrics, RowGeometry, Segment, SegmentKind, SegmentShape,
};
pub use head::{head_segment_for, HeadSegment};
pub use layout::{
    default_palette, layout_graph, layout_pages, ref_color_for, ColorForRef, GraphCommit, GraphRow,
    LayoutOptions, LayoutResult, LaneColor, LaneRef, PagesLayoutResult,
};
