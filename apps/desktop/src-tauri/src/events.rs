//! Event subscriptions, scoped to the window that opened them.
//!
//! The adapter's order is listener first, then the subscribe handshake, then a merge of the
//! replayed and live streams by sequence number (`packages/backend-tauri/src/events.ts`).
//! The host's half of that is: answer the handshake with an id and a watermark, remember who
//! owns the subscription, and deliver every later frame to that window and no other.
//!
//! This build emits nothing yet, and the handshake says so rather than implying otherwise:
//! the replay is empty and the watermark is zero because there is no mutation and therefore
//! no journal entry to replay. A subscription is still a real subscription — the id is what
//! the emitter will address — so the adapter's merge logic is exercised against the host that
//! will emit rather than against a mock.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::EventEnvelope;
use serde::Serialize;

/// The event name the adapter listens on, fixed by the adapter contract.
pub const NATIVE_EVENT_NAME: &str = "refyard://event";

/// What `refyard_events_subscribe` answers. The TypeScript half is `subscriptionAckSchema`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubscriptionAck {
    pub subscription_id: String,
    pub service_instance_id: String,
    /// The last sequence this subscription has seen. Zero means the stream has never carried
    /// an event, which is not the same as "everything is up to date" — the adapter re-reads
    /// when it is told something changed, and this build changes nothing.
    pub high_watermark: u64,
    pub replay: Vec<EventEnvelope>,
}

/// One event frame as it reaches the WebView.
///
/// The four fields are the adapter's filter (`scopedEventFrameSchema`): a frame whose session,
/// subscription or service instance does not match the subscriber is dropped, so a rename here
/// would silently stop every event from arriving. `tests/session_owner.rs` pins the shape.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedEventFrame<'a> {
    pub session_id: &'a str,
    pub subscription_id: &'a str,
    pub service_instance_id: &'a str,
    pub event: &'a EventEnvelope,
}

struct SubscriptionEntry {
    session_id: String,
    owner_label: String,
}

/// The subscriptions this process has handed out.
#[derive(Default)]
pub struct EventRegistry {
    subscriptions: Mutex<HashMap<String, SubscriptionEntry>>,
    minted: AtomicU64,
}

impl EventRegistry {
    /// Records a subscription and answers the handshake.
    pub fn subscribe(
        &self,
        session_id: &str,
        owner_label: &str,
        service_instance_id: &str,
    ) -> NativeSubscriptionAck {
        let subscription_id = format!("sub_{}", self.minted.fetch_add(1, Ordering::Relaxed) + 1);
        self.entries().insert(
            subscription_id.clone(),
            SubscriptionEntry {
                session_id: session_id.to_owned(),
                owner_label: owner_label.to_owned(),
            },
        );
        NativeSubscriptionAck {
            subscription_id,
            service_instance_id: service_instance_id.to_owned(),
            high_watermark: 0,
            replay: Vec::new(),
        }
    }

    /// Ends a subscription.
    ///
    /// Like `disconnect`, ending a subscription that is already gone succeeds — the adapter
    /// calls this from `dispose`, which runs on unmount and on teardown — while a window that
    /// does not own it is refused, so this cannot silence another window's stream.
    pub fn unsubscribe(
        &self,
        subscription_id: &str,
        session_id: &str,
        caller_label: &str,
    ) -> Result<(), Problem> {
        let mut entries = self.entries();
        match entries.get(subscription_id) {
            None => Ok(()),
            Some(entry) if entry.owner_label != caller_label || entry.session_id != session_id => {
                Err(Problem::new(
                    ProblemCode::Forbidden,
                    format!(
                        "window \"{caller_label}\" does not own subscription {subscription_id} \
                         on session {session_id}"
                    ),
                ))
            }
            Some(_) => {
                entries.remove(subscription_id);
                Ok(())
            }
        }
    }

    /// The window a frame must be delivered to, or `None` if the subscription is gone.
    pub fn owner_of(&self, subscription_id: &str) -> Option<String> {
        self.entries()
            .get(subscription_id)
            .map(|entry| entry.owner_label.clone())
    }

    /// How many subscriptions are live. Diagnostics and tests only.
    pub fn len(&self) -> usize {
        self.entries().len()
    }

    /// Whether any subscription is live.
    pub fn is_empty(&self) -> bool {
        self.entries().is_empty()
    }

    /// See `SessionRegistry::entries` for why a poisoned lock is not a failure here.
    fn entries(&self) -> MutexGuard<'_, HashMap<String, SubscriptionEntry>> {
        self.subscriptions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}
