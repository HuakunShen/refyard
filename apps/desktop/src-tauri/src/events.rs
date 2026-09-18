//! Event subscriptions, scoped to the window that opened them.
//!
//! The adapter's order is listener first, then the subscribe handshake, then a merge of the
//! replayed and live streams by sequence number (`packages/backend-tauri/src/events.ts`).
//! The host's half of that is: answer the handshake with an id and a watermark, remember who
//! owns the subscription, and deliver every later frame to that window and no other.
//!
//! The stream itself is the service's: [`crate::relay`] reads the service's sink and hands
//! each envelope to the windows that subscribed, through the ownership recorded here. This
//! module stays about *who may receive what* — the handshake, the ownership check and the
//! per-subscription frames — so all of it is decidable without a window, and the tests drive
//! it that way.
//!
//! Nothing here becomes a second source of truth: an event says something changed and the
//! caller re-reads. A client that never subscribed, or that was disconnected while a write
//! happened, still finds every fact through `operation`/`operations`, which read the journal.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{EventEnvelope, EventPayload};
use serde::Serialize;

/// The event name the adapter listens on, fixed by the adapter contract.
pub const NATIVE_EVENT_NAME: &str = "refyard://event";

/// Where the service's stream stands when a subscription is opened.
///
/// The host answers the handshake with the position it will not go back behind: `replay` is
/// what the ring still holds for a caller that named a cursor, and `high_watermark` is the
/// last sequence minted. A subscription with no cursor gets no replay — it has nothing to
/// compare against, and the caller re-reads what it needs on mount anyway.
#[derive(Debug, Clone, Default)]
pub struct StreamPosition {
    pub high_watermark: u64,
    pub replay: Vec<EventEnvelope>,
}

/// What `refyard_events_subscribe` answers. The TypeScript half is `subscriptionAckSchema`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSubscriptionAck {
    pub subscription_id: String,
    pub service_instance_id: String,
    /// The last sequence this subscription will have seen after its replay is applied.
    pub high_watermark: u64,
    pub replay: Vec<EventEnvelope>,
}

/// One event frame as it reaches the WebView.
///
/// The four fields are the adapter's filter (`scopedEventFrameSchema`): a frame whose session,
/// subscription or service instance does not match the subscriber is dropped, so a rename here
/// would silently stop every event from arriving. `tests/session_owner.rs` pins the shape.
///
/// It owns its fields because one envelope becomes one frame *per subscriber*, each with its
/// own subscription id: a borrowing frame would either leak or force the caller to keep every
/// subscription alive for as long as a frame travels.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedEventFrame {
    pub session_id: String,
    pub subscription_id: String,
    pub service_instance_id: String,
    pub event: EventEnvelope,
}

/// One subscription, as the relay needs it: who owns it and which session it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSubscription {
    pub subscription_id: String,
    pub session_id: String,
    pub owner_label: String,
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
        stream: StreamPosition,
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
            high_watermark: stream.high_watermark,
            replay: stream.replay,
        }
    }

    /// Every live subscription, so the relay can address its frames.
    pub fn live(&self) -> Vec<LiveSubscription> {
        self.entries()
            .iter()
            .map(|(subscription_id, entry)| LiveSubscription {
                subscription_id: subscription_id.clone(),
                session_id: entry.session_id.clone(),
                owner_label: entry.owner_label.clone(),
            })
            .collect()
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

/// One frame per live subscription, each addressed to the window that opened it.
///
/// Pure on purpose: this is the part of delivery that can be wrong without anything failing —
/// a frame sent to the wrong window, or dropped, is exactly the bug the ownership record
/// exists to prevent — so it is decided by a function the tests can drive without a window.
pub fn frames_for(
    registry: &EventRegistry,
    service_instance_id: &str,
    event: &EventEnvelope,
) -> Vec<(String, ScopedEventFrame)> {
    registry
        .live()
        .into_iter()
        .map(|subscription| {
            let frame = ScopedEventFrame {
                session_id: subscription.session_id,
                subscription_id: subscription.subscription_id,
                service_instance_id: service_instance_id.to_owned(),
                event: event.clone(),
            };
            (subscription.owner_label, frame)
        })
        .collect()
}

/// The frame that tells a subscriber it fell behind.
///
/// A gap is published through the sink rather than invented here, because the sink owns the
/// sequence: a subscriber that minted its own would produce a frame the client cannot order
/// against the events around it, and the client drops anything at or below what it has seen.
pub fn gap_payload(from_sequence: u64, to_sequence: u64) -> EventPayload {
    EventPayload::EventGap {
        from_sequence,
        to_sequence,
    }
}
