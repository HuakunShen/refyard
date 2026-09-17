//! Pure Git mechanics for the Refyard native host.
//!
//! Nothing in this crate touches a process, a socket, a clock, or the filesystem. It
//! turns bytes into values and intentions into argument vectors, which is what makes
//! it testable without a repository and portable to any host.
//!
//! The rules from the TypeScript core carry over unchanged: parse from bytes and
//! unframe by format, never decode a protocol stream to a string first, never trim a
//! protocol path, and never hardcode a 40-character object name.

pub mod outcome;
pub mod plan;

pub use outcome::{ExecutionState, RunOutcome, TerminationReason};
pub use plan::{DeadlineClass, GitPlan, ProcessSpec};
