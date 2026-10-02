//! The workbench's views. Each view owns its async calls through the bridge, reports
//! navigation upward by emitting events, and reads repository state from the shared
//! `RepoStore`.

pub mod branches;
pub mod changes;
pub mod diff_view;
pub mod history;
pub mod launcher;
pub mod workbench;
