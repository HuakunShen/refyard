//! Native sessions, and which window owns each one.
//!
//! `refyard_connect` mints a session and records the WebView that asked for it; every later
//! command checks its caller against that record. A session is what carries the approved
//! repositories and the execution target, so a second WebView must not be able to drive one
//! it did not open. That is the entire reason this is a registry rather than a counter, and
//! it is what `tests/session_owner.rs` drives through the real command bodies.
//!
//! Session ids are sequential, which is deliberate rather than an oversight: nothing
//! structural is derived from them (the cache namespace carries the service instance id, not
//! the session id's entropy), only local application code can reach the IPC at all — Tauri
//! refuses custom commands from a remote origin — and a caller that names a session it does
//! not own is refused here regardless of how it learned the id.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use refyard_contract::problem::{Problem, ProblemCode};
use refyard_host::service::ApplicationService;
use serde::Serialize;

/// What `refyard_connect` answers.
///
/// The TypeScript half of this wire format is `nativeSessionMetadataSchema` in
/// `packages/backend-tauri/src/commands.ts`. That schema is strict, so a field renamed on
/// one side alone makes the adapter refuse the session instead of caching under a key the
/// host never minted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionMetadata {
    pub session_id: String,
    pub service_instance_id: String,
    /// The prefix every cache key on this session carries. Never a token, never a path:
    /// the UI's cache key is this plus repository, worktree and query.
    pub cache_namespace: String,
    pub backend_label: String,
}

/// How this host describes itself to the UI. The HTTP adapter reports "HTTP service"; the
/// label says which transport answered, so a screenshot of the workbench is unambiguous.
const BACKEND_LABEL: &str = "Native host";

struct SessionEntry {
    owner_label: String,
    service: Arc<ApplicationService>,
}

/// The sessions this process has handed out.
#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionEntry>>,
    minted: AtomicU64,
}

impl SessionRegistry {
    /// Mints a session owned by the WebView labelled `owner_label`.
    pub fn connect(
        &self,
        owner_label: &str,
        service: Arc<ApplicationService>,
    ) -> NativeSessionMetadata {
        let service_instance_id = service.service_instance_id().to_owned();
        let session_id = format!("sess_{}", self.minted.fetch_add(1, Ordering::Relaxed) + 1);
        let cache_namespace = format!("native/{service_instance_id}/{session_id}");
        self.entries().insert(
            session_id.clone(),
            SessionEntry {
                owner_label: owner_label.to_owned(),
                service,
            },
        );
        NativeSessionMetadata {
            session_id,
            service_instance_id,
            cache_namespace,
            backend_label: BACKEND_LABEL.to_owned(),
        }
    }

    /// The service a session reads through, once the caller is known to own it.
    ///
    /// The caller passes the WebView label it came from; a command handler has no way to
    /// ask for a session's service without also saying who is asking.
    pub fn service_for(
        &self,
        session_id: &str,
        caller_label: &str,
    ) -> Result<Arc<ApplicationService>, Problem> {
        let entries = self.entries();
        let entry = entries
            .get(session_id)
            .ok_or_else(|| no_such_session(session_id))?;
        if entry.owner_label != caller_label {
            return Err(Problem::new(
                ProblemCode::Forbidden,
                format!(
                    "window \"{caller_label}\" does not own session {session_id}; \
                     a session is driven by the window that opened it"
                ),
            ));
        }
        Ok(Arc::clone(&entry.service))
    }

    /// Ends a session.
    ///
    /// Ending a session that is already gone succeeds: `dispose` runs on teardown and on a
    /// window closing, and a second call means the session is already over, which is the
    /// state the caller asked for. A window that does not own the session is still refused,
    /// so this cannot be used to close someone else's.
    pub fn disconnect(&self, session_id: &str, caller_label: &str) -> Result<(), Problem> {
        let mut entries = self.entries();
        match entries.get(session_id) {
            None => Ok(()),
            Some(entry) if entry.owner_label != caller_label => Err(Problem::new(
                ProblemCode::Forbidden,
                format!(
                    "window \"{caller_label}\" does not own session {session_id}; \
                     a session is ended by the window that opened it"
                ),
            )),
            Some(_) => {
                entries.remove(session_id);
                Ok(())
            }
        }
    }

    /// How many sessions are live. Diagnostics and tests only.
    pub fn len(&self) -> usize {
        self.entries().len()
    }

    /// Whether any session is live.
    pub fn is_empty(&self) -> bool {
        self.entries().is_empty()
    }

    /// A poisoned lock means another command panicked while holding it. The registry is a
    /// plain map with no invariant that a panic could have left half-updated, so handing it
    /// back is better than failing every later command for the rest of the process's life.
    fn entries(&self) -> MutexGuard<'_, HashMap<String, SessionEntry>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn no_such_session(session_id: &str) -> Problem {
    Problem::new(
        ProblemCode::NotFound,
        format!("no such session: {session_id}"),
    )
}
