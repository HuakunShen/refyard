//! Host-side execution for the Refyard native service.
//!
//! This crate owns everything that touches the machine: spawning processes, resolving
//! approved paths, the repository registry, snapshots, and the operation queue. It is
//! deliberately independent of any UI: the native CLI, the HTTP adapter and the
//! desktop shell all link this crate, and none of them may add Git semantics of their
//! own.

pub mod clock;
pub mod paths;
pub mod process;
pub mod providers;
pub mod reads;
pub mod registry;
pub mod service;
pub mod snapshots;
pub mod ssh;
pub mod targets;
