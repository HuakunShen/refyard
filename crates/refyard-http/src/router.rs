//! The route table: one closed API, the same calls the desktop boundary makes.
//!
//! Every route decodes a request, checks the same gates in the same order — bearer,
//! scope, resource grant — and then calls one method on the application service. The
//! response is the service's own DTO; this layer adds no fields, no envelopes and no
//! defaults a client could mistake for service behaviour.
//!
//! Two deliberate absences: `worktrees`, `submodules` and `stashes` are not routed
//! because this build does not implement those reads (the `/api` catch-all answers 404,
//! and `capabilities.reads` does not list them), and the SSH-host listing has no route at
//! all — a host catalogue is not something a browser page may enumerate unless the
//! process was started to expose it.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::Router;
use refyard_contract::problem::{Problem, ProblemCode};
use refyard_contract::reads::{MutationKind, MutationTarget, PreviewsRequest};
use refyard_host::jobs::MutationRequest;
use refyard_host::service::{ApplicationService, StatusQuery, API_MAJOR};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::auth::{AuthStore, Session};
use crate::{events, origins};

/// The actor every HTTP operation is journalled under.
///
/// Every paired session of this process is the same local person; the desktop window's
/// per-window actors are a different boundary with a different threat model.
pub const ACTOR: &str = "local-user";

/// The byte limits the wire accepts, before any handler runs.
pub struct Limits {
    /// Largest JSON body accepted.
    pub max_body_bytes: usize,
    /// Largest request target accepted.
    pub max_url_bytes: usize,
    /// Largest number of query parameters accepted.
    pub max_query_parameters: usize,
    /// Largest single query value accepted.
    pub max_query_value_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_body_bytes: 1024 * 1024,
            max_url_bytes: 8192,
            max_query_parameters: 64,
            max_query_value_bytes: 4096,
        }
    }
}

/// Everything a handler needs, shared behind an `Arc`.
pub struct HttpState {
    pub service: Arc<ApplicationService>,
    pub auth: Arc<Mutex<AuthStore>>,
    pub authorities: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub service_instance_id: String,
    pub web_root: Option<std::path::PathBuf>,
    pub limits: Limits,
}

/// The scopes a route may demand, as the contract spells them.
mod scope {
    pub const READ: &str = "repository:read";
    pub const WRITE: &str = "repository:write";
    pub const WORKSPACE: &str = "workspace:manage";
}

/// Builds the application router: the origin gate wraps every route, the `/api` catch-all
/// answers unknown API paths after authentication, and everything else is static.
pub fn build(state: Arc<HttpState>) -> Router {
    let origin_gate = axum::middleware::from_fn_with_state(state.clone(), gate);
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/session/exchange", post(exchange))
        .route("/api/v1/capabilities", get(capabilities))
        .route("/api/v1/repositories", get(repositories))
        .route("/api/v1/repositories/register", post(register_repository))
        .route("/api/v1/repositories/revoke", post(revoke_repository))
        .route("/api/v1/filesystem/entries", get(filesystem_entries))
        .route("/api/v1/status", get(status))
        .route("/api/v1/history", get(history))
        .route("/api/v1/refs", get(refs))
        .route("/api/v1/diff", get(diff))
        .route("/api/v1/previews", post(previews))
        .route(
            "/api/v1/operations",
            get(operations_list).post(operations_submit),
        )
        .route("/api/v1/operations/cancel", post(operations_cancel))
        .route("/api/v1/events", get(events_stream))
        .route("/api", any(unknown_api))
        .route("/api/{*rest}", any(unknown_api))
        .fallback(static_fallback)
        .layer(origin_gate)
        .layer(axum::extract::DefaultBodyLimit::max(
            state.limits.max_body_bytes,
        ))
        .with_state(state)
}

/// The gate every request passes before routing: this instance's authority, this
/// service's origins, and nothing else.
async fn gate(
    State(state): State<Arc<HttpState>>,
    request: Request,
    next: axum::middleware::Next,
) -> Response {
    let raw_target = request
        .uri()
        .path_and_query()
        .map(|target| target.to_string())
        .unwrap_or_default();
    if raw_target.len() > state.limits.max_url_bytes {
        return problem_response(Problem::new(
            ProblemCode::LimitExceeded,
            format!(
                "the request target may not exceed {} bytes",
                state.limits.max_url_bytes
            ),
        ));
    }
    let headers = request.headers();
    match origins::check(
        headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok()),
        headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok()),
        headers
            .get("sec-fetch-site")
            .and_then(|value| value.to_str().ok()),
        &state.authorities,
        &state.allowed_origins,
    ) {
        origins::Verdict::Ok => {}
        origins::Verdict::Refused(problem) => return problem_response(problem),
    }
    // The native service has no hosted origins, so the only preflight worth answering is
    // the one that says no.
    if request.method() == axum::http::Method::OPTIONS {
        let mut response = Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header(header::ALLOW, "GET, POST")
            .body(axum::body::Body::empty())
            .expect("a 405 with static headers cannot fail to build");
        mark_json(&mut response);
        return response;
    }
    next.run(request).await
}

/* --------------------------------------------------------------- the answer shape */

/// Headers every JSON answer carries: no caching, no MIME guessing.
fn json_headers() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            header::CONTENT_TYPE.as_str(),
            "application/json; charset=utf-8",
        ),
        (header::CACHE_CONTROL.as_str(), "no-store"),
        ("x-content-type-options", "nosniff"),
    ]
}

fn json_response(status: StatusCode, value: &impl Serialize) -> Response {
    let body = serde_json::to_vec(value)
        .unwrap_or_else(|_| br#"{"problem":{"code":"InternalError","message":"the answer could not be serialized","retryable":false}}"#.to_vec());
    let mut response = Response::builder()
        .status(status)
        .body(axum::body::Body::from(body))
        .expect("a response with a fixed status cannot fail to build");
    for (name, value) in json_headers() {
        response.headers_mut().insert(
            axum::http::HeaderName::from_lowercase(name.as_bytes())
                .expect("the header names below are lowercase"),
            axum::http::HeaderValue::from_str(value).expect("the header values below are ASCII"),
        );
    }
    response
}

fn mark_json(response: &mut Response) {
    for (name, value) in json_headers() {
        if let Ok(name) = axum::http::HeaderName::from_lowercase(name.as_bytes()) {
            if let Ok(value) = axum::http::HeaderValue::from_str(value) {
                response.headers_mut().insert(name, value);
            }
        }
    }
}

/// The HTTP status a problem maps to, one place, so a code can never mean 401 in one
/// handler and 500 in another.
pub fn status_for_problem(problem: &Problem) -> StatusCode {
    StatusCode::from_u16(match problem.code {
        ProblemCode::Unauthenticated => 401,
        ProblemCode::Forbidden => 403,
        ProblemCode::NotFound => 404,
        ProblemCode::InvalidRequest => 400,
        ProblemCode::UnsupportedOperation => 501,
        ProblemCode::InvalidOperationPayload => 422,
        ProblemCode::UnsupportedPathEncoding => 422,
        ProblemCode::StaleSnapshot
        | ProblemCode::StalePreview
        | ProblemCode::Conflict
        | ProblemCode::IdempotencyConflict
        | ProblemCode::NeedsAttention
        | ProblemCode::Cancelled => 409,
        ProblemCode::ResourceBusy => 429,
        ProblemCode::LimitExceeded => 413,
        ProblemCode::GitCommandFailed
        | ProblemCode::UncertainOutcome
        | ProblemCode::InternalError => 500,
        ProblemCode::Timeout => 504,
        ProblemCode::Unavailable => 503,
    })
    .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
}

fn problem_response(problem: Problem) -> Response {
    let status = status_for_problem(&problem);
    json_response(status, &serde_json::json!({ "problem": problem }))
}

/// A handler failure: the problem becomes the response, exactly as the contract spells it.
pub struct RouteError(pub Problem);

impl From<Problem> for RouteError {
    fn from(problem: Problem) -> Self {
        RouteError(problem)
    }
}

impl IntoResponse for RouteError {
    fn into_response(self) -> Response {
        problem_response(self.0)
    }
}

type RouteResult = Result<Response, RouteError>;

fn refused(code: ProblemCode, message: impl Into<String>) -> RouteError {
    RouteError(Problem::new(code, message))
}

/* ------------------------------------------------------------------- the helpers */

/// Resolves the `Authorization` header to a session, or refuses.
fn authorize(state: &HttpState, headers: &HeaderMap) -> Result<Session, Problem> {
    let header = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok());
    state.auth.lock().expect("auth lock").authorize(
        header,
        &state.service_instance_id,
        refyard_host::clock::now_millis(),
    )
}

fn allows_scope(session: &Session, scope: &str) -> bool {
    session.grants.scopes.iter().any(|granted| granted == scope)
        || (scope.starts_with("repository:")
            && session
                .grants
                .scopes
                .iter()
                .any(|granted| granted == "repository:*"))
}

fn require_scope(session: &Session, scope: &str) -> Result<(), Problem> {
    if allows_scope(session, scope) {
        return Ok(());
    }
    let mut problem = Problem::new(
        ProblemCode::Forbidden,
        "this session does not carry the authority this request needs",
    );
    problem.details.get_or_insert_with(Default::default).insert(
        "requiredScope".to_string(),
        refyard_contract::problem::DetailValue::Text(scope.to_string()),
    );
    Err(problem)
}

/// The approved root a repository lives in, from the service's own repository list.
async fn repository_root_of(state: &HttpState, repository_id: &str) -> Option<String> {
    state
        .service
        .repositories()
        .await
        .repositories
        .into_iter()
        .find(|record| record.repository_id == repository_id)
        .map(|record| record.allowed_root_id)
}

/// A request may only touch a repository its session was granted, directly or through
/// its root.
async fn require_repository_grant(
    state: &HttpState,
    session: &Session,
    repository_id: &str,
) -> Result<(), Problem> {
    if state
        .auth
        .lock()
        .expect("auth lock")
        .allows_repository(session, repository_id)
    {
        return Ok(());
    }
    let covered_by_root = repository_root_of(state, repository_id)
        .await
        .is_some_and(|root| {
            session
                .grants
                .allowed_root_ids
                .iter()
                .any(|granted| granted == &root)
        });
    if covered_by_root {
        return Ok(());
    }
    let mut problem = Problem::new(
        ProblemCode::Forbidden,
        "this session was not granted that repository",
    );
    problem.details.get_or_insert_with(Default::default).insert(
        "repositoryId".to_string(),
        refyard_contract::problem::DetailValue::Text(repository_id.to_string()),
    );
    Err(problem)
}

/// Reads and bounds a query string, then decodes it strictly.
///
/// Unknown parameters are rejected, not ignored: a client that misspells `worktreeId`
/// must be told, not silently answered for the whole repository.
fn query_of<T: DeserializeOwned>(raw: Option<&str>, limits: &Limits) -> Result<T, Problem> {
    let raw = raw.unwrap_or("");
    let pairs: Vec<(&str, &str)> = raw
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| pair.split_once('=').unwrap_or((pair, "")))
        .collect();
    if pairs.len() > limits.max_query_parameters {
        return Err(Problem::new(
            ProblemCode::LimitExceeded,
            format!(
                "a request may carry at most {} query parameters",
                limits.max_query_parameters
            ),
        ));
    }
    for (_, value) in &pairs {
        if value.len() > limits.max_query_value_bytes {
            return Err(Problem::new(
                ProblemCode::LimitExceeded,
                format!(
                    "a query value may not exceed {} bytes",
                    limits.max_query_value_bytes
                ),
            ));
        }
    }
    serde_urlencoded::from_str::<T>(raw).map_err(|error| {
        Problem::new(
            ProblemCode::InvalidRequest,
            format!("the query is not valid: {error}"),
        )
    })
}

/// Reads a JSON body under the byte limit and decodes it strictly.
async fn body_of<T: DeserializeOwned>(
    request_body: axum::body::Bytes,
    limits: &Limits,
) -> Result<T, Problem> {
    if request_body.len() > limits.max_body_bytes {
        return Err(Problem::new(
            ProblemCode::LimitExceeded,
            format!(
                "the request body may not exceed {} bytes",
                limits.max_body_bytes
            ),
        ));
    }
    if request_body.is_empty() {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "a JSON body is required",
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&request_body).map_err(|_| {
        Problem::new(
            ProblemCode::InvalidRequest,
            "the request body is not valid JSON",
        )
    })?;
    serde_json::from_value(value).map_err(|error| {
        Problem::new(
            ProblemCode::InvalidRequest,
            format!("the request body is not valid: {error}"),
        )
    })
}

/* --------------------------------------------------------------------- the routes */

/// The host's own liveness, answerable without Git and without a session.
async fn health(State(state): State<Arc<HttpState>>) -> RouteResult {
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({
            "alive": true,
            "apiMajor": API_MAJOR,
            "serviceInstanceId": state.service_instance_id,
        }),
    ))
}

/// The pairing exchange: the one route that turns a ticket into a bearer session.
async fn exchange(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ExchangeBody {
        ticket: String,
        // Accepted because the wire schema has it, and unused because a native ticket is
        // never a hosted one: the schema stays shared with the reference host.
        #[serde(default)]
        #[allow(dead_code)]
        password: Option<String>,
    }
    let body: ExchangeBody = body_of(body, &state.limits).await?;
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let mut auth = state.auth.lock().expect("auth lock");
    let session = auth.exchange(
        &body.ticket,
        origin,
        &state.service_instance_id,
        refyard_host::clock::now_millis(),
    )?;
    drop(auth);
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({
            "token": session.token,
            "tokenType": "Bearer",
            "expiresAt": refyard_host::clock::format_iso8601_millis(session.expires_at_ms),
            "serviceInstanceId": state.service_instance_id,
            "apiMajor": API_MAJOR,
            "sessionId": session.session_id,
            "grants": {
                "allowedRootIds": session.grants.allowed_root_ids,
                "repositoryIds": session.grants.repository_ids,
                "scopes": session.grants.scopes,
            },
        }),
    ))
}

async fn capabilities(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CapabilitiesQuery {
        #[serde(default)]
        target_id: Option<String>,
        #[serde(default)]
        repository_id: Option<String>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: CapabilitiesQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    if let Some(repository_id) = &query.repository_id {
        require_repository_grant(&state, &session, repository_id).await?;
    }
    // The query names a target and a repository as a coherence claim; the answer is the
    // service's own capability answer either way, but a claim that cannot be true is an
    // invalid request rather than a capability list that ignores it.
    if let Some(repository_id) = &query.repository_id {
        let record = state
            .service
            .repositories()
            .await
            .repositories
            .into_iter()
            .find(|record| &record.repository_id == repository_id);
        let record = record.ok_or_else(|| {
            refused(
                ProblemCode::InvalidRequest,
                format!("unknown repository {repository_id}"),
            )
            .0
        })?;
        if let Some(target_id) = &query.target_id {
            if record
                .target_id
                .as_deref()
                .unwrap_or(state.service.target_id())
                != target_id
            {
                return Err(refused(
                    ProblemCode::InvalidRequest,
                    format!("repository {repository_id} does not belong to target {target_id}"),
                ));
            }
        }
    } else if let Some(target_id) = &query.target_id {
        if !state
            .service
            .targets()
            .iter()
            .any(|target| &target.target_id == target_id)
        {
            return Err(refused(
                ProblemCode::InvalidRequest,
                format!("unknown target {target_id}"),
            ));
        }
    }
    let answer = state.service.capabilities().await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn repositories(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct NoQuery {}
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let _: NoQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    let answer = state.service.repositories().await;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn register_repository(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RegisterBody {
        path: String,
        #[serde(default)]
        target_id: Option<String>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::WORKSPACE)?;
    let body: RegisterBody = body_of(body, &state.limits).await?;

    let before: BTreeSet<String> = state
        .service
        .repositories()
        .await
        .repositories
        .into_iter()
        .map(|record| record.repository_id)
        .collect();
    let answer = state
        .service
        .register_repository_on(&body.path, body.target_id.as_deref())
        .await?;
    // The repository this session just opened is one this session can read, whether it
    // was created here or already existed.
    let mut auth = state.auth.lock().expect("auth lock");
    for record in &answer.repositories {
        if !before.contains(&record.repository_id) || record.display_path == body.path {
            auth.grant(
                &session.session_id,
                &record.allowed_root_id,
                &record.repository_id,
            );
        }
    }
    drop(auth);
    Ok(json_response(StatusCode::OK, &answer))
}

async fn revoke_repository(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RevokeBody {
        repository_id: String,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::WORKSPACE)?;
    let body: RevokeBody = body_of(body, &state.limits).await?;

    let root_before = repository_root_of(&state, &body.repository_id).await;
    let answer = state.service.revoke_repository(&body.repository_id).await?;
    // A revoked repository leaves every session, and its root leaves with it only when
    // nothing else still lives there.
    if let Some(root) = root_before {
        let root_has_repositories = answer
            .allowed_roots
            .iter()
            .any(|allowed| allowed.allowed_root_id == root);
        state.auth.lock().expect("auth lock").revoke_repository(
            &body.repository_id,
            &root,
            root_has_repositories,
        );
    }
    Ok(json_response(StatusCode::OK, &answer))
}

async fn filesystem_entries(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FilesystemQuery {
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        target_id: Option<String>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::WORKSPACE)?;
    let query: FilesystemQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    let answer = state
        .service
        .filesystem_entries_on(query.path.as_deref(), query.target_id.as_deref())
        .await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn status(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    // `includeIgnored` is deliberately absent: the published status schema carries
    // `repositoryId` and `worktreeId` only, and a request that sends more is invalid —
    // the same answer the reference host gives, which is a contract quirk carried over
    // rather than quietly fixed on one side.
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct StatusRouteQuery {
        repository_id: String,
        #[serde(default)]
        worktree_id: Option<String>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: StatusRouteQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    let repository_id = query.repository_id.clone();
    require_repository_grant(&state, &session, &repository_id).await?;
    let mut service_query = StatusQuery::new(query.repository_id);
    service_query.worktree_id = query.worktree_id;
    let answer = state.service.status(&service_query).await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn history(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: refyard_contract::history::HistoryQuery =
        query_of(raw_query.0.as_deref(), &state.limits)?;
    require_repository_grant(&state, &session, &query.repository_id).await?;
    let answer = state.service.history(&query).await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn refs(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RefsQuery {
        repository_id: String,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: RefsQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    require_repository_grant(&state, &session, &query.repository_id).await?;
    let answer = state.service.refs(&query.repository_id).await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn diff(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: refyard_contract::diff::DiffQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    require_repository_grant(&state, &session, &query.repository_id).await?;
    let answer = state.service.diff(&query).await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn previews(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let request: PreviewsRequest = body_of(body, &state.limits).await?;
    require_repository_grant(&state, &session, &request.repository_id).await?;
    let answer = state.service.previews(&request).await?;
    Ok(json_response(StatusCode::OK, &answer))
}

async fn operations_list(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct OperationsQuery {
        #[serde(default)]
        operation_id: Option<String>,
        #[serde(default)]
        limit: Option<u64>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: OperationsQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    match query.operation_id {
        Some(operation_id) => {
            let record = match state.service.operation_for(ACTOR, &operation_id) {
                Ok(record) => record,
                Err(problem) if problem.code == ProblemCode::NotFound => {
                    return Err(refused(
                        ProblemCode::NotFound,
                        "no such operation for this session",
                    ));
                }
                Err(problem) => return Err(RouteError(problem)),
            };
            Ok(json_response(
                StatusCode::OK,
                &serde_json::json!({ "operations": [record], "truncated": false }),
            ))
        }
        None => {
            let limit = query.limit.unwrap_or(50);
            if limit == 0 {
                return Err(refused(
                    ProblemCode::InvalidRequest,
                    "limit must be at least 1",
                ));
            }
            let answer = state.service.operations(ACTOR, limit.min(200) as usize);
            Ok(json_response(StatusCode::OK, &answer))
        }
    }
}

/// The scope a mutation kind demands, per the contract's own split of authorities.
///
/// The table is total even though this build submits only three kinds: the scope of a
/// *recorded* operation is asked when it is cancelled, and a kind this build will never
/// record still has to map to the authority the contract says it needs.
fn scope_for_kind(kind: MutationKind) -> &'static str {
    match kind {
        MutationKind::InitRepository | MutationKind::CloneRepository => scope::WORKSPACE,
        MutationKind::Fetch | MutationKind::Push | MutationKind::Pull | MutationKind::PushTag => {
            "repository:network"
        }
        _ => scope::WRITE,
    }
}

async fn operations_submit(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    let session = authorize(&state, &headers)?;
    let request: MutationRequest = body_of(body, &state.limits).await?;
    require_scope(&session, scope_for_kind(request.operation.kind()))?;

    // A submission names a resource; the resource must be one this session holds.
    if let Some(repository_id) = request.repository_id() {
        require_repository_grant(&state, &session, repository_id).await?;
    }
    if let MutationTarget::Workspace {
        allowed_root_id, ..
    } = &request.target
    {
        let granted = session
            .grants
            .allowed_root_ids
            .iter()
            .any(|granted| granted == allowed_root_id);
        if !granted {
            let mut problem = Problem::new(
                ProblemCode::Forbidden,
                "this session was not granted that root",
            );
            problem.details.get_or_insert_with(Default::default).insert(
                "allowedRootId".to_string(),
                refyard_contract::problem::DetailValue::Text(allowed_root_id.clone()),
            );
            return Err(RouteError(problem));
        }
    }

    let submitted = state.service.submit_mutation(ACTOR, request).await?;
    if submitted.duplicate {
        return Ok(json_response(
            StatusCode::OK,
            &serde_json::json!({ "operation": submitted.record, "duplicate": true }),
        ));
    }
    Ok(json_response(
        StatusCode::ACCEPTED,
        &serde_json::json!({
            "operationId": submitted.record.operation_id,
            "status": submitted.record.status,
            "acceptedAt": submitted.record.accepted_at,
        }),
    ))
}

async fn operations_cancel(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CancelBody {
        operation_id: String,
    }
    let session = authorize(&state, &headers)?;
    let body: CancelBody = body_of(body, &state.limits).await?;
    // The scope is the cancelled operation's own kind, which means an unknown operation
    // cannot leak its existence through the scope check — the handler's not-found does.
    if let Ok(record) = state.service.operation_for(ACTOR, &body.operation_id) {
        require_scope(&session, scope_for_kind(record.kind))?;
    }
    let record = state.service.cancel_operation(ACTOR, &body.operation_id)?;
    Ok(json_response(
        StatusCode::OK,
        &serde_json::json!({ "operation": record }),
    ))
}

async fn events_stream(
    State(state): State<Arc<HttpState>>,
    headers: HeaderMap,
    raw_query: axum::extract::RawQuery,
) -> RouteResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct EventsQuery {
        #[serde(default)]
        since: Option<u64>,
    }
    let session = authorize(&state, &headers)?;
    require_scope(&session, scope::READ)?;
    let query: EventsQuery = query_of(raw_query.0.as_deref(), &state.limits)?;
    Ok(events::response(query.since, state.service.events()))
}

/// Every unknown `/api` path: authenticate first, then say the route does not exist.
///
/// The order matters. Answering an unknown path differently for a valid bearer would let
/// a caller map the API surface by brute force; answering it with the SPA would turn a
/// broken client request into a page that looks alive.
async fn unknown_api(State(state): State<Arc<HttpState>>, request: Request) -> RouteResult {
    authorize(&state, request.headers())?;
    Err(refused(
        ProblemCode::NotFound,
        format!("no API route {}", request.uri().path()),
    ))
}

/// Anything that is not `/api` is the static workbench, when this process serves one.
async fn static_fallback(
    State(state): State<Arc<HttpState>>,
    method: axum::http::Method,
    request: Request,
) -> Response {
    let path = request.uri().path().to_string();
    let head_only = method == axum::http::Method::HEAD;
    let Some(web_root) = &state.web_root else {
        return problem_response(Problem::new(
            ProblemCode::NotFound,
            format!("no file at {path}"),
        ));
    };
    match crate::assets::serve(web_root, &path, head_only) {
        Ok(crate::assets::Serving::File { body, headers }) => {
            let mut response = Response::builder()
                .status(StatusCode::OK)
                .body(axum::body::Body::from(body))
                .expect("a response with a fixed status cannot fail to build");
            for (name, value) in headers {
                if let (Ok(name), Ok(value)) = (
                    axum::http::HeaderName::from_lowercase(name.as_bytes()),
                    axum::http::HeaderValue::from_str(&value),
                ) {
                    response.headers_mut().insert(name, value);
                }
            }
            response
        }
        Ok(crate::assets::Serving::NotFound) => problem_response(Problem::new(
            ProblemCode::NotFound,
            format!("no file at {path}"),
        )),
        Err(problem) => problem_response(problem),
    }
}

/* -------------------------------------------------------------------- the queries */
