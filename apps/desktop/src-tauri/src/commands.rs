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
use serde_json::Value;
use tauri::State;

use crate::dispatch::{self, GitReadRequest, HostRequest};
use crate::session::NativeSessionMetadata;
use crate::AppState;
use refyard_contract::problem::{Problem, ProblemCode, ProblemResponse};

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
    let ack = state
        .events
        .subscribe(session_id, caller_label, service.service_instance_id());
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

/// `refyard_mutation_submit` — refused, and refused *after* the ownership check.
///
/// Every write command goes through the same gate as the reads even though none of them can
/// do anything yet: a refusal that skipped the gate would teach a caller that the gate is
/// optional.
pub fn mutation_submit(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<Value, ProblemResponse> {
    state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    Err(writes_not_implemented("refyard_mutation_submit"))
}

/// `refyard_operation_get` — refused: nothing in this build mints an operation.
pub fn operation_get(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<Value, ProblemResponse> {
    state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    Err(writes_not_implemented("refyard_operation_get"))
}

/// `refyard_operation_list` — refused. An empty list would read as "you have no operations",
/// which is a different claim from "this build cannot run one".
pub fn operation_list(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<Value, ProblemResponse> {
    state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    Err(writes_not_implemented("refyard_operation_list"))
}

/// `refyard_operation_cancel` — refused.
pub fn operation_cancel(
    state: &AppState,
    caller_label: &str,
    session_id: &str,
) -> Result<Value, ProblemResponse> {
    state
        .sessions
        .service_for(session_id, caller_label)
        .map_err(failed)?;
    Err(writes_not_implemented("refyard_operation_cancel"))
}

/// Turns a payload that is not the request the union publishes into an `InvalidRequest`.
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

fn writes_not_implemented(command: &str) -> ProblemResponse {
    failed(Problem::new(
        ProblemCode::UnsupportedOperation,
        format!(
            "{command} is not implemented: this build reads repositories and cannot change \
             one, so no mutation is accepted, no operation exists to report, and \
             capabilities lists none"
        ),
    ))
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
) -> Result<Value, ProblemResponse> {
    mutation_submit(&state, window.label(), &session_id)
}

#[tauri::command]
pub async fn refyard_operation_get(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, ProblemResponse> {
    operation_get(&state, window.label(), &session_id)
}

#[tauri::command]
pub async fn refyard_operation_list(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, ProblemResponse> {
    operation_list(&state, window.label(), &session_id)
}

#[tauri::command]
pub async fn refyard_operation_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Value, ProblemResponse> {
    operation_cancel(&state, window.label(), &session_id)
}
