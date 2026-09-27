//! The Rust projection of the public contract.
//!
//! Each module mirrors one schema module of `packages/git-contract/src` and takes its
//! field names, nullability and enum values from it. The checked-in JSON Schema
//! (`packages/git-contract/generated/contract.schema.json`) is the same contract in
//! another form; where this crate and that schema disagree, this crate is wrong.

pub mod diff;
pub mod history;
pub mod host;
pub mod problem;
pub mod reads;
pub mod refs;

pub use reads::WorkspaceRootId;
