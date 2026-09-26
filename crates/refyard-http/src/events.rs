//! The event stream: the sink's hints over Server-Sent Events.
//!
//! Frames are the transport of [`refyard_host::events::EventSink`]'s envelopes, and the
//! framing is chosen so a browser's `EventSource` *and* a `fetch`-based reader (which is
//! what the workbench uses, because `EventSource` cannot send an Authorization header)
//! both survive it: `id` is the sequence, `event` is the payload kind, `data` is the
//! whole envelope as one line of JSON. Resume is by `?since=` only — `Last-Event-ID` is
//! deliberately not read, so a reconnect states its own cursor instead of trusting a
//! header a proxy may have eaten.

use std::convert::Infallible;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, HeaderValue, StatusCode};
use refyard_contract::reads::{EventEnvelope, EventPayload};
use refyard_host::events::{EventSink, SubscriberEvent};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// The reconnect hint a client uses after a dropped stream.
const RETRY_MILLIS: u64 = 3_000;
/// How often a comment frame proves the connection is alive.
const HEARTBEAT: Duration = Duration::from_secs(15);

/// The event-stream response for one subscription starting at `since`.
///
/// The replay is written first, then the reconnect hint, then live frames for as long as
/// the reader keeps the channel open. A subscription whose buffer overflows does not
/// pretend otherwise: the next delivered event is preceded by a gap frame naming exactly
/// the sequences that were dropped, which is the client's signal to re-read.
pub fn response(since: Option<u64>, sink: &EventSink) -> axum::response::Response {
    let (sender, receiver) = mpsc::channel::<Result<String, Infallible>>(64);
    let subscription = sink.subscribe();
    let replay = sink.replay(since);

    tokio::spawn(async move {
        for envelope in &replay {
            if sender.send(Ok(frame(envelope))).await.is_err() {
                return;
            }
        }
        // Sent once, after the replay: a client that reconnects waits this long before
        // giving up on the stream that told it about the events it missed.
        if sender
            .send(Ok(format!("retry: {RETRY_MILLIS}\n\n")))
            .await
            .is_err()
        {
            return;
        }
        let mut subscription = subscription;
        // The last sequence this reader has actually delivered, so a gap can name the
        // range it lost. The replay counts: a client that resumed from `since` now stands
        // at the newest replayed envelope, not at `since`.
        let mut delivered = replay
            .last()
            .map(|envelope| envelope.sequence)
            .or(since)
            .unwrap_or(0);
        let mut pending_gap_from: Option<u64> = None;
        let mut heartbeat = tokio::time::interval(HEARTBEAT);
        heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                event = subscription.recv() => {
                    let Some(event) = event else { return; };
                    match event {
                        SubscriberEvent::Event(envelope) => {
                            // Subscribing precedes the replay snapshot, so an event published
                            // between those calls is both replayed and queued here. Never
                            // deliver it twice or move this stream's cursor backwards.
                            if envelope.sequence <= delivered {
                                continue;
                            }
                            if let Some(from) = pending_gap_from.take() {
                                if envelope.sequence > from + 1 {
                                    let gap = gap_envelope(from + 1, envelope.sequence - 1);
                                    if sender.send(Ok(frame(&gap))).await.is_err() {
                                        return;
                                    }
                                }
                            }
                            delivered = envelope.sequence;
                            if sender.send(Ok(frame(&envelope))).await.is_err() {
                                return;
                            }
                        }
                        SubscriberEvent::Missed { .. } => {
                            // Frames were dropped between `delivered` and whatever arrives
                            // next; the gap is only nameable once the next envelope shows
                            // where the stream picked up again.
                            pending_gap_from.get_or_insert(delivered);
                        }
                    }
                }
                _ = heartbeat.tick() => {
                    if sender.send(Ok(": keep-alive\n\n".to_string())).await.is_err() {
                        return;
                    }
                }
            }
        }
    });

    axum::response::Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/event-stream; charset=utf-8"),
        )
        .header(header::CACHE_CONTROL, HeaderValue::from_static("no-store"))
        .header(header::CONNECTION, HeaderValue::from_static("keep-alive"))
        .header("x-accel-buffering", HeaderValue::from_static("no"))
        .header(
            "x-content-type-options",
            HeaderValue::from_static("nosniff"),
        )
        .body(Body::from_stream(ReceiverStream::new(receiver)))
        .expect("a stream response with static headers cannot fail to build")
}

fn gap_envelope(from: u64, to: u64) -> EventEnvelope {
    EventEnvelope {
        sequence: to,
        emitted_at: refyard_host::clock::now_iso8601(),
        payload: EventPayload::EventGap {
            from_sequence: from,
            to_sequence: to,
        },
    }
}

/// One envelope as an SSE frame.
pub fn frame(envelope: &EventEnvelope) -> String {
    let kind = serde_json::to_value(&envelope.payload)
        .ok()
        .and_then(|value| value["kind"].as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string());
    let data = serde_json::to_string(envelope).unwrap_or_else(|_| "{}".to_string());
    format!("id: {}\nevent: {kind}\ndata: {data}\n\n", envelope.sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_carries_the_sequence_the_kind_and_the_whole_envelope() {
        let envelope = EventEnvelope {
            sequence: 7,
            emitted_at: "2026-09-18T10:00:00.000Z".to_string(),
            payload: EventPayload::RepositoryChanged {
                repository_id: "repo_1".to_string(),
                worktree_ids: vec!["wt_1".to_string()],
                snapshot_invalidated: true,
            },
        };
        assert_eq!(
            frame(&envelope),
            "id: 7\nevent: repositoryChanged\ndata: {\"sequence\":7,\"emittedAt\":\"2026-09-18T10:00:00.000Z\",\"payload\":{\"kind\":\"repositoryChanged\",\"repositoryId\":\"repo_1\",\"worktreeIds\":[\"wt_1\"],\"snapshotInvalidated\":true}}\n\n"
        );
    }

    // Prevents: a lagging subscriber being told nothing and assuming nothing happened.
    // The gap frame is the client's instruction to re-read.
    #[test]
    fn a_gap_frame_names_the_range_a_slow_reader_lost() {
        let frame = frame(&gap_envelope(4, 9));
        assert!(frame.contains("event: eventGap"), "{frame}");
        assert!(frame.contains("\"fromSequence\":4"), "{frame}");
        assert!(frame.contains("\"toSequence\":9"), "{frame}");
    }
}
