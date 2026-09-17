//! The bounded process runner.
//!
//! Every Git and SSH command in the native host goes through `run`. It exists because
//! the failure modes of spawning a child are the failure modes of the product: a child
//! that blocks on a full pipe while we read the other stream, output that arrives
//! faster than it is consumed, a command that never returns, and a process that
//! outlives the operation that started it.
//!
//! Two properties are structural rather than conventional:
//!
//! - stdout and stderr are drained **concurrently**, so a command writing heavily to
//!   both cannot deadlock against a full pipe buffer;
//! - output is **bounded**, and a truncated stream is reported as truncated, because
//!   an incomplete protocol frame parsed as if it were complete is a wrong answer
//!   rather than a partial one.
//!
//! The runner never builds a command line. It takes a program and an argument vector,
//! starts no shell, and clears the environment before adding back a documented set.

pub mod cleanup;
pub mod environment;
pub mod runner;

pub use cleanup::{cancellation, CancelHandle, CancelSignal};
pub use environment::{git_environment, sanitized_environment, FORCED, INHERITED};
pub use runner::run;

// Re-exported so a caller does not need to depend on `refyard-core` for the types it
// receives back from a run.
pub use refyard_core::outcome::RunOutcome;
pub use refyard_core::outcome::{ExecutionState, TerminationReason};
pub use refyard_core::plan::{DeadlineClass, GitPlan, ProcessSpec};
