//! Host-side execution for the Refyard native service.
//!
//! This crate owns everything that touches the machine: spawning processes, reading
//! and writing approved files, the repository registry, and the operation queue. It
//! is deliberately independent of any UI: the native CLI, the HTTP adapter and the
//! desktop shell all link this crate, and none of them may add Git semantics of
//! their own.

pub mod process;
