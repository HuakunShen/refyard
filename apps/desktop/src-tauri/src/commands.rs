//! The Tauri command surface: ten commands, each a thin wrapper.
//!
//! A command does three things and no more — take the caller's window label, check that the
//! caller owns the session it named, and hand a closed request to the dispatcher. The bodies
//! are `pub` functions taking a label string, so `tests/session_owner.rs` drives the real
//! dispatch and the real ownership gate without a window; only Tauri's argument extraction is
//! outside those tests, and it decides nothing.
//!
//! Arguments arrive as `serde_json::Value` for the requests the contract defines as unions so
//! that an unknown method becomes a `Problem` the adapter already knows how to read, instead
//! of an IPC deserialization error that reaches the caller as an untyped failure.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::dispatch::{self, GitReadRequest, HostRequest};
use crate::events::StreamPosition;
use crate::session::NativeSessionMetadata;
use crate::AppState;
use refyard_contract::problem::{Problem, ProblemCode, ProblemResponse};
use refyard_contract::reads::{OperationRecord, OperationStatus};
use refyard_host::jobs::{MutationRequest, SubmitResult};

/// How many operations `operation_list` answers with when the caller does not say.
///
/// The journal keeps everything; this is only the page size, and a caller that asks for more
/// gets a bounded answer rather than an unbounded scan of the state directory.
const DEFAULT_OPERATION_LIMIT: u32 = 50;
const MAX_OPERATION_LIMIT: u32 = 200;

/// `refyard_connect` — mints a session for the calling window.
///
/// The window label is the ownership record: whatever command this session is used for next,
/// the caller must present the same label.
pub fn connect(
    state: &AppState,
    caller_label: &str,
) -> Result<NativeSessionMetadata, ProblemResponse> {
    Ok(state
        .sessions
        .connect(caller_label, std::sync::Arc::clone(&state.service)))
}

/// `refyard_git_read` — one read through the session the caller owns.
pub async fn git_read(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    request: Value,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let request: GitReadRequest = decode(request)?;
    dispatch::dispatch_read(&service, request).await
}

/// `refyard_host_request` — one host question through the session the caller owns.
pub async fn host_request(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    request: Value,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let request: HostRequest = decode(request)?;
    dispatch::dispatch_host(&service, request).await
}

/// `refyard_disconnect` — ends the session. Idempotent for its owner.
pub fn disconnect(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<(), ProblemResponse> {
    state
        .sessions
        .disconnect(session_id, caller_label)
        .map_err(failed)
}

/// `refyard_events_subscribe` — registers an event stream for this window.
pub fn events_subscribe(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    // The handshake carries the position of the stream this subscription is joining: the
    // watermark the adapter merges against, and whatever the ring still holds for a caller
    // with a cursor. A subscription that has no cursor gets no replay, and re-reads on mount.
    let ack = state.events.subscribe(
        session_id,
        caller_label,
        service.service_instance_id(),
        StreamPosition {
            high_watermark: service.events().high_watermark(),
            replay: service.events().replay(None),
        },
    );
    to_value(ack)
}

/// `refyard_events_unsubscribe` — ends it. Idempotent for the window that opened it.
pub fn events_unsubscribe(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    subscription_id: &str,
) -> Result<(), ProblemResponse> {
    state
        .events
        .unsubscribe(subscription_id, session_id, caller_label)
        .map_err(failed)
}

/// `refyard_mutation_submit` — one write through the session the caller owns.
///
/// The **session is the actor**: two windows hold two sessions, so the operation one of them
/// submitted is the operation only it can list, read or cancel. The write itself goes to the
/// service, which decides — the caller cannot name a program, a path or an argument here, and
/// what it asks for is checked against the repository's approved state before Git is started.
pub async fn mutation_submit(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    request: Value,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let request: MutationRequest = decode(request)?;
    let submitted = service
        .submit_mutation(session_id, request)
        .await
        .map_err(failed)?;
    to_value(submission_answer(&submitted))
}

/// `refyard_operation_get` — one operation, if this session submitted it.
pub fn operation_get(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    operation_id: &str,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let record = service
        .operation_for(session_id, operation_id)
        .map_err(failed)?;
    to_value(record)
}

/// `refyard_operation_list` — this session's operations, newest first.
///
/// An empty list is the truth here, not a claim that nothing can be written: whether writing is
/// possible at all is `capabilities().operations`, and a build with no effects lists none.
pub fn operation_list(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    limit: Option<u32>,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let limit = limit
        .unwrap_or(DEFAULT_OPERATION_LIMIT)
        .clamp(1, MAX_OPERATION_LIMIT) as usize;
    to_value(service.operations(session_id, limit))
}

/// `refyard_operation_cancel` — cancels an operation that has not started.
pub fn operation_cancel(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
    operation_id: &str,
) -> Result<Value, ProblemResponse> {
    let service = state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    let record = service
        .cancel_operation(session_id, operation_id)
        .map_err(failed)?;
    to_value(record)
}

/// Turning a payload that is not the request the union publishes into an `InvalidRequest`.
///
/// The message names the field or variant serde rejected, which is what makes a mismatch
/// between the adapter and the host diagnosable; it never echoes the payload back.
fn decode<T: DeserializeOwned>(request: Value) -> Result<T, ProblemResponse> {
    serde_json::from_value(request).map_err(|error| {
        failed(Problem::new(
            ProblemCode::InvalidRequest,
            format!("the request is not one this host implements: {error}"),
        ))
    })
}

/// The submission answer the adapter publishes (`NativeSubmission` in the adapter).
///
/// An acceptance is not the operation's outcome — the write has not run yet, and a client that
/// treated this as success would be reporting something it has not observed. It is the
/// operation's identity, which the caller follows with `operation`.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum NativeSubmission {
    Accepted {
        accepted: AcceptedOperation,
    },
    /// Boxed because a record is far larger than an acceptance: the enum is built once per
    /// submission and mostly holds the smaller variant.
    Duplicate {
        record: Box<OperationRecord>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptedOperation {
    operation_id: String,
    status: OperationStatus,
    accepted_at: String,
}

fn submission_answer(submitted: &SubmitResult) -> NativeSubmission {
    if submitted.duplicate {
        NativeSubmission::Duplicate {
            record: Box::new(submitted.record.clone()),
        }
    } else {
        NativeSubmission::Accepted {
            accepted: AcceptedOperation {
                operation_id: submitted.record.operation_id.clone(),
                status: submitted.record.status,
                accepted_at: submitted.record.accepted_at.clone(),
            },
        }
    }
}

fn failed(problem: Problem) -> ProblemResponse {
    ProblemResponse { problem }
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, ProblemResponse> {
    serde_json::to_value(value).map_err(|error| {
        failed(Problem::new(
            ProblemCode::InternalError,
            format!("the answer could not be serialized: {error}"),
        ))
    })
}

/* ------------------------------------------------------------- Tauri commands */

#[tauri::command]
pub async fn refyard_connect(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<NativeSessionMetadata, ProblemResponse> {
    connect(&state, window.label())
}

#[tauri::command]
pub async fn refyard_git_read(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    request: Value,
) -> Result<Value, ProblemResponse> {
    git_read(&state, window.label(), &session_id, request).await
}

#[tauri::command]
pub async fn refyard_host_request(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    request: Value,
) -> Result<Value, ProblemResponse> {
    host_request(&state, window.label(), &session_id, request).await
}

#[tauri::command]
pub async fn refyard_disconnect(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), ProblemResponse> {
    disconnect(&state, window.label(), &session_id)
}

#[tauri::command]
pub async fn refyard_events_subscribe(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, ProblemResponse> {
    events_subscribe(&state, window.label(), &session_id)
}

#[tauri::command]
pub async fn refyard_events_unsubscribe(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    subscription_id: String,
) -> Result<(), ProblemResponse> {
    events_unsubscribe(&state, window.label(), &session_id, &subscription_id)
}

#[tauri::command]
pub async fn refyard_mutation_submit(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    request: Value,
) -> Result<Value, ProblemResponse> {
    mutation_submit(&state, window.label(), &session_id, request).await
}

#[tauri::command]
pub async fn refyard_operation_get(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    operation_id: String,
) -> Result<Value, ProblemResponse> {
    operation_get(&state, window.label(), &session_id, &operation_id)
}

#[tauri::command]
pub async fn refyard_operation_list(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<u32>,
) -> Result<Value, ProblemResponse> {
    operation_list(&state, window.label(), &session_id, limit)
}

#[tauri::command]
pub async fn refyard_operation_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
    operation_id: String,
) -> Result<Value, ProblemResponse> {
    operation_cancel(&state, window.label(), &session_id, &operation_id)
}
