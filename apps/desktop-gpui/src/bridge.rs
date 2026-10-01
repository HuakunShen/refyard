//! The tokio↔GPUI bridge.
//!
//! `ApplicationService` is tokio-native: it spawns `git` with `tokio::process`, keeps
//! its event ring on `tokio::sync::broadcast`, and its methods must run on a reactor
//! that can drive those futures. GPUI's executors cannot. The app therefore owns one
//! multi-thread tokio [`Runtime`] and this module is the only way UI code touches it:
//!
//! 1. a view opens a bounded `smol::channel` pair (runtime-agnostic, so the receiver
//!    can be awaited on GPUI's main-thread executor);
//! 2. the service future is spawned on the runtime via [`HostRuntime::spawn`], with only
//!    `Send` data crossing — never an `Entity`, `Window` or `Context`;
//! 3. the view polls the channel inside `cx.spawn`, where both the `Ok` and the closed
//!    channel (`Err`) arms reset the UI state. A closed channel means the background
//!    task panicked; swallowing it would leave a progress state that never ends.
//!
//! Stale results are discarded by generation counters kept by the caller: cancelling a
//! request means bumping the counter, because dropping a GPUI `Task` does not stop an
//! already-running future.

use std::future::Future;
use tokio::runtime::Runtime;

pub struct HostRuntime {
    runtime: Runtime,
}

impl HostRuntime {
    pub fn new() -> Result<Self, String> {
        Runtime::new()
            .map(|runtime| Self { runtime })
            .map_err(|error| format!("failed to start the host runtime: {error}"))
    }

    /// Spawn a future that does not report back. Used for fire-and-forget work; result
    /// delivery goes through a channel the caller opened.
    pub fn spawn<F>(&self, future: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.runtime.spawn(future);
    }
}
