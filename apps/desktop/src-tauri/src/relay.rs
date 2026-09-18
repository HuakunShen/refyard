//! The event relay: the service's stream, delivered to the windows that subscribed.
//!
//! One task for the process, not one per subscription. It holds a single subscription to the
//! service's sink and, for every envelope, asks [`crate::events`] which windows should receive
//! it. A per-subscription task would need the same ownership answer anyway, and would make the
//! order in which two windows see the same event depend on scheduling.
//!
//! Falling behind is reported, not hidden. The sink's channel is as deep as its ring, so a
//! subscriber that keeps up never misses; one that does not is told how many envelopes it
//! lost. The relay turns that into a `eventGap` frame **published through the sink**, so it
//! carries a sequence the sink minted and cannot tie with a later event — a client orders
//! frames by sequence and drops what it has already seen, so an invented sequence would make
//! it drop a real event or accept a stale one. A gap makes the client re-read, which is the
//! only safe response to a stream with a hole in it.
//!
//! Nothing here is evidence: an event is a hint, and every fact in it is also readable through
//! `operation`/`operations`. A window that never subscribed loses nothing but the hint.

use std::sync::Arc;

use refyard_host::events::SubscriberEvent;
use refyard_host::service::ApplicationService;
use tauri::{AppHandle, Emitter};

use crate::events::{frames_for, gap_payload, EventRegistry, NATIVE_EVENT_NAME};

/// Runs until the service's stream ends — which is when the process is going away.
pub async fn run(
    app: AppHandle,
    service: Arc<ApplicationService>,
    subscriptions: Arc<EventRegistry>,
) {
    let instance_id = service.service_instance_id().to_owned();
    let mut stream = service.subscribe_events();
    // The last sequence this relay handed out, so a gap names the range that was dropped
    // rather than the whole stream.
    let mut delivered: u64 = 0;

    while let Some(received) = stream.recv().await {
        let envelope = match received {
            SubscriberEvent::Event(envelope) => {
                delivered = delivered.max(envelope.sequence);
                envelope
            }
            SubscriberEvent::Missed { .. } => {
                // The gap is published, so it mints its own sequence and reaches every
                // subscriber — including this one, which is how it gets delivered below.
                // Nothing is delivered directly here, or the same frame would arrive twice.
                service.events().publish(gap_payload(
                    delivered + 1,
                    service.events().high_watermark(),
                ));
                continue;
            }
        };
        for (label, frame) in frames_for(&subscriptions, &instance_id, &envelope) {
            // A window that closed between the lookup and the emit is not an error: the
            // subscription is gone and its next frame is simply not addressed to anyone.
            let _ = app.emit_to(label, NATIVE_EVENT_NAME, frame);
        }
    }
}
