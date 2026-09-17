//! Ending a child we no longer want, and the signal that says so.
//!
//! A deadline that fires while the command keeps running is not a deadline. The
//! runner therefore terminates the process and **reaps** it before returning: a
//! zombie or a still-running `git`/`ssh` is exactly the leak a user notices as "the
//! app is still holding my repository" after a window is closed.
//!
//! There is no graceful shutdown to negotiate here. A killed local client cannot roll
//! back a remote command, so pretending to close politely would only delay the honest
//! answer — that the outcome of that command is unknown.

use tokio::process::Child;
use tokio::sync::watch;

/// The cancelling half of a cancellation. Cloneable so one session can hold it while
/// several commands observe it.
#[derive(Clone)]
pub struct CancelHandle(watch::Sender<bool>);

/// The observing half. A run takes at most one.
#[derive(Clone)]
pub struct CancelSignal(watch::Receiver<bool>);

/// Creates a fresh cancellation pair.
pub fn cancellation() -> (CancelHandle, CancelSignal) {
    let (sender, receiver) = watch::channel(false);
    (CancelHandle(sender), CancelSignal(receiver))
}

impl CancelHandle {
    /// Requests cancellation. Idempotent.
    pub fn cancel(&self) {
        let _ = self.0.send(true);
    }
}

impl CancelSignal {
    /// Resolves once cancellation has been requested. Never resolves if it is not.
    pub async fn cancelled(mut self) {
        loop {
            if *self.0.borrow() {
                return;
            }
            if self.0.changed().await.is_err() {
                // The handle was dropped, which means nobody can cancel any more.
                return;
            }
        }
    }
}

/// Kills the child and waits for it, so nothing is left for the OS to reap and no
/// orphan keeps running against the repository.
pub async fn terminate(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}
