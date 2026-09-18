//! The event sink: a bounded ring of hints, with a live subscription handle.
//!
//! Events are **hints that invalidate cached reads**, never the evidence that anything
//! happened. Everything about this module follows from that sentence:
//!
//! - the ring holds at most `LIMITS.eventRingMaxEvents` envelopes or
//!   `LIMITS.eventRingMaxBytes`, whichever comes first. When it overflows the oldest are
//!   dropped, and a client that resumes behind the oldest point is answered with an
//!   [`EventPayload::EventGap`] naming the range it missed, so it re-reads instead of
//!   assuming nothing happened;
//! - a client that never subscribed can still recover every fact through
//!   `operation`/`operations`, which read the journal — the source of truth. The sink
//!   holds nothing a re-read cannot produce;
//! - the payloads are small: an operation record, or a repository id with the worktrees
//!   whose cached reads are now wrong. A diff, a file list or a source excerpt is never
//!   put in a stream.
//!
//! Two things are published, and nothing else: an operation's state change, and a
//! repository invalidation after a write that changed state. The engine publishes both
//! from the same place it writes the journal record, so a client that reconnects and
//! queries the operation sees the same state the event carried.

use std::collections::VecDeque;
use std::sync::Mutex;

use refyard_contract::reads::{EventEnvelope, EventPayload};
use tokio::sync::broadcast;

use crate::clock::now_iso8601;

/// `LIMITS.eventRingMaxEvents`.
pub const EVENT_RING_MAX_EVENTS: usize = 1_024;
/// `LIMITS.eventRingMaxBytes`.
pub const EVENT_RING_MAX_BYTES: usize = 1_048_576;

/// One event a live subscriber received, or the fact that it fell behind.
///
/// `Missed` is not an error and not an event: the subscription's buffer overflowed, and
/// the honest answer is that frames were dropped. The caller recovers by re-reading and by
/// asking the sink for [`EventSink::replay`] past its last sequence.
// The envelope is held unboxed: it is what the caller acts on, not an internal collection
// element, and a `Box` here would be an indirection every call site spelled out. The same
// choice the contract makes for `EventPayload`'s own `Operation` variant.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum SubscriberEvent {
    Event(EventEnvelope),
    /// This many events were dropped before the next one could be delivered.
    Missed {
        count: u64,
    },
}

/// A live subscription to the sink.
///
/// Dropping it ends the subscription; there is nothing else to release.
#[derive(Debug)]
pub struct EventSubscription {
    receiver: broadcast::Receiver<EventEnvelope>,
}

impl EventSubscription {
    /// The next event, `Missed` once the subscription's buffer overflowed, or `None` once
    /// the sink is gone.
    pub async fn recv(&mut self) -> Option<SubscriberEvent> {
        match self.receiver.recv().await {
            Ok(event) => Some(SubscriberEvent::Event(event)),
            Err(broadcast::error::RecvError::Lagged(count)) => {
                Some(SubscriberEvent::Missed { count })
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    }
}

#[derive(Debug, Default)]
struct RingState {
    events: VecDeque<EventEnvelope>,
    bytes: usize,
    sequence: u64,
}

/// A bounded ring of recent events plus a live delivery channel.
#[derive(Debug)]
pub struct EventSink {
    inner: Mutex<RingState>,
    sender: broadcast::Sender<EventEnvelope>,
    max_events: usize,
    max_bytes: usize,
}

impl Default for EventSink {
    fn default() -> Self {
        Self::with_limits(EVENT_RING_MAX_EVENTS, EVENT_RING_MAX_BYTES)
    }
}

impl EventSink {
    /// A sink bounded by the contract's published ring limits.
    pub fn new() -> Self {
        Self::default()
    }

    /// A sink with caller-supplied bounds, for a test that has to overflow one.
    pub fn with_limits(max_events: usize, max_bytes: usize) -> Self {
        // The channel is as deep as the ring: a subscriber that keeps up never misses,
        // and one that does not is told so rather than blocking the publisher.
        let (sender, _) = broadcast::channel(max_events.max(1));
        Self {
            inner: Mutex::new(RingState::default()),
            sender,
            max_events,
            max_bytes,
        }
    }

    /// Publishes one hint and answers with the envelope it became.
    ///
    /// The sequence is minted here and is monotonic for the life of the sink, so two
    /// envelopes a client received can always be ordered, and a hole in the sequence is
    /// the signal that something was missed.
    pub fn publish(&self, payload: EventPayload) -> EventEnvelope {
        let envelope = {
            let mut state = self.inner.lock().expect("event ring lock");
            state.sequence += 1;
            let envelope = EventEnvelope {
                sequence: state.sequence,
                emitted_at: now_iso8601(),
                payload,
            };
            let size = serde_json::to_vec(&envelope)
                .map(|bytes| bytes.len())
                .unwrap_or(0);
            state.events.push_back(envelope.clone());
            state.bytes += size;
            while state.events.len() > self.max_events || state.bytes > self.max_bytes {
                let Some(dropped) = state.events.pop_front() else {
                    break;
                };
                let dropped_size = serde_json::to_vec(&dropped)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0);
                state.bytes = state.bytes.saturating_sub(dropped_size);
            }
            envelope
        };
        // A send with no subscribers is not a failure: the ring still holds the event for
        // whoever asks next.
        let _ = self.sender.send(envelope.clone());
        envelope
    }

    /// The highest sequence this sink has minted. `0` before the first publish.
    pub fn high_watermark(&self) -> u64 {
        self.inner.lock().expect("event ring lock").sequence
    }

    /// The events after `since`, or a `eventGap` notice when the ring no longer holds
    /// that point.
    ///
    /// `None` means "a subscription that has no cursor yet": it starts at the current
    /// high watermark and receives nothing retroactively, because a first subscription
    /// must not be told it missed events that happened before it existed.
    pub fn replay(&self, since: Option<u64>) -> Vec<EventEnvelope> {
        let state = self.inner.lock().expect("event ring lock");
        let Some(since) = since else {
            return Vec::new();
        };
        let oldest = state.events.front().map(|event| event.sequence);
        let gap = |from: u64, to: u64| EventEnvelope {
            sequence: state.sequence,
            emitted_at: now_iso8601(),
            payload: EventPayload::EventGap {
                from_sequence: from,
                to_sequence: to,
            },
        };
        match oldest {
            None => {
                if since < state.sequence {
                    vec![gap(since + 1, state.sequence)]
                } else {
                    Vec::new()
                }
            }
            Some(oldest) => {
                if since + 1 < oldest {
                    let mut events = vec![gap(since + 1, oldest - 1)];
                    events.extend(state.events.iter().cloned());
                    events
                } else {
                    state
                        .events
                        .iter()
                        .filter(|event| event.sequence > since)
                        .cloned()
                        .collect()
                }
            }
        }
    }

    /// Subscribes for live delivery from this point on.
    pub fn subscribe(&self) -> EventSubscription {
        EventSubscription {
            receiver: self.sender.subscribe(),
        }
    }

    /// How many events the ring holds, and how many bytes they occupy.
    pub fn size(&self) -> (usize, usize) {
        let state = self.inner.lock().expect("event ring lock");
        (state.events.len(), state.bytes)
    }

    /// The range of sequences the ring actually holds, when it holds any.
    pub fn bounds(&self) -> Option<(u64, u64)> {
        let state = self.inner.lock().expect("event ring lock");
        let first = state.events.front()?.sequence;
        let last = state.events.back()?.sequence;
        Some((first, last))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use refyard_contract::reads::{
        HeadKind, HeadState, MutationKind, MutationTarget, OperationRecord, OperationStatus,
    };

    fn operation(operation_id: &str) -> EventPayload {
        EventPayload::Operation {
            operation: OperationRecord {
                operation_id: operation_id.to_string(),
                client_request_id: format!("crid-{operation_id}"),
                kind: MutationKind::StagePaths,
                target: MutationTarget::Worktree {
                    repository_id: "repo_1".to_string(),
                    worktree_id: "wt_1".to_string(),
                    expected_snapshot_id: "snap_1".to_string(),
                },
                status: OperationStatus::Running,
                sequence: 1,
                accepted_at: "2026-09-18T10:00:00.000Z".to_string(),
                started_at: None,
                finished_at: None,
                result: None,
                problem: None,
            },
        }
    }

    fn change() -> EventPayload {
        EventPayload::RepositoryChanged {
            repository_id: "repo_1".to_string(),
            worktree_ids: vec!["wt_1".to_string()],
            snapshot_invalidated: true,
        }
    }

    #[test]
    fn sequences_are_monotonic_and_a_first_subscription_starts_at_the_high_watermark() {
        let sink = EventSink::new();
        assert_eq!(sink.high_watermark(), 0);
        assert_eq!(sink.publish(operation("op_1")).sequence, 1);
        assert_eq!(sink.publish(change()).sequence, 2);
        assert_eq!(sink.high_watermark(), 2);
        // A subscription without a cursor is not told about events that predate it.
        assert!(sink.replay(None).is_empty());
        // One with a cursor at the high watermark receives nothing next.
        assert!(sink.replay(Some(2)).is_empty());
        // And one that resumes behind it receives exactly what it missed.
        let replay = sink.replay(Some(0));
        assert_eq!(
            replay
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<u64>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn a_client_that_fell_behind_the_ring_is_told_the_range_it_missed() {
        // Prevents: a UI that reconnects past the ring's oldest retained event and
        // assumes nothing happened in between.
        let sink = EventSink::with_limits(2, 1_048_576);
        sink.publish(operation("op_1"));
        sink.publish(change());
        sink.publish(operation("op_2"));
        assert_eq!(sink.bounds(), Some((2, 3)));
        let replay = sink.replay(Some(0));
        assert_eq!(
            replay.len(),
            3,
            "one gap notice plus the two retained events"
        );
        match &replay[0].payload {
            EventPayload::EventGap {
                from_sequence,
                to_sequence,
            } => {
                assert_eq!(*from_sequence, 1);
                assert_eq!(*to_sequence, 1, "the gap names exactly what was dropped");
            }
            other => panic!("expected an eventGap first, got {other:?}"),
        }
        // A client that is only one behind is answered with the event itself.
        let replay = sink.replay(Some(1));
        assert_eq!(replay.len(), 2);
        assert_eq!(replay[0].sequence, 2);
    }

    #[test]
    fn the_ring_is_bounded_by_bytes_as_well_as_by_count() {
        // One event's serialized size, measured rather than guessed, so the byte bound
        // below admits exactly two of them.
        let measured = EventSink::new();
        measured.publish(operation("op_1"));
        let one_event = measured.size().1;
        assert!(one_event > 0);

        let sink = EventSink::with_limits(1_000, one_event * 2);
        sink.publish(operation("op_1"));
        sink.publish(operation("op_2"));
        sink.publish(operation("op_3"));
        assert_eq!(
            sink.size().0,
            2,
            "the byte bound evicts the oldest event, exactly as the count bound does"
        );
        assert_eq!(sink.bounds(), Some((2, 3)));
    }

    #[tokio::test]
    async fn a_live_subscription_receives_published_events_in_sequence_order() {
        let sink = EventSink::new();
        let mut subscription = sink.subscribe();
        let published = sink.publish(operation("op_1"));
        match subscription.recv().await {
            Some(SubscriberEvent::Event(received)) => {
                assert_eq!(received.sequence, published.sequence);
                assert_eq!(received.payload, published.payload);
            }
            other => panic!("expected the published event, got {other:?}"),
        }
        drop(sink);
        assert!(subscription.recv().await.is_none(), "a dropped sink closes");
    }

    #[tokio::test]
    async fn a_subscriber_that_fell_behind_is_told_how_many_frames_it_missed() {
        // Prevents: a slow listener that silently loses frames and renders a repository
        // state that no read agrees with.
        let sink = EventSink::with_limits(2, 1_048_576);
        let mut subscription = sink.subscribe();
        for index in 0..5 {
            sink.publish(operation(&format!("op_{index}")));
        }
        match subscription.recv().await {
            Some(SubscriberEvent::Missed { count }) => assert!(count >= 3, "got {count}"),
            other => panic!("expected a Missed notice, got {other:?}"),
        }
    }

    /// The payload shape is the contract's, not a local invention.
    #[test]
    fn a_published_envelope_serializes_as_the_contract_publishes_it() {
        let sink = EventSink::new();
        let envelope = sink.publish(change());
        let json = serde_json::to_value(&envelope).expect("serializes");
        assert_eq!(json["sequence"], 1);
        assert_eq!(json["payload"]["kind"], "repositoryChanged");
        assert_eq!(json["payload"]["repositoryId"], "repo_1");
        assert!(json["emittedAt"]
            .as_str()
            .is_some_and(|text| text.ends_with('Z')));
        assert_eq!(
            serde_json::to_value(HeadState {
                kind: HeadKind::Unborn,
                branch_name: None,
                oid: None,
                detached: false,
            })
            .expect("serializes")["kind"],
            "unborn"
        );
    }
}
