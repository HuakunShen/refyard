//! Execution providers: where Git actually runs.
//!
//! A provider is the only thing that knows whether a command runs on this machine or
//! on another one. Everything above it — planners, parsers, workflows, the operation
//! queue — is written against the same operations, which is what makes the local and
//! SSH paths one implementation rather than two.

pub mod local;
pub mod ssh;
