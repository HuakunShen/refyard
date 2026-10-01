//! Commit-graph layout: lane allocation, page continuation and ref colours, ported from
//! the TypeScript package (`packages/git-graph`) so the GPUI desktop computes the same
//! graph as the web workbench. Pure Rust: no host APIs, no GUI dependency, no IO.
//!
//! This module decides *where lanes are* — indices, colours, continuation — and nothing
//! about how they look. Pixel geometry lives in `geometry`; both are testable without a
//! window.

pub mod layout;

pub use layout::{
    default_palette, layout_graph, layout_pages, ref_color_for, GraphCommit, GraphRow,
    LayoutOptions, LayoutResult, LaneColor, LaneRef, PagesLayoutResult,
};
