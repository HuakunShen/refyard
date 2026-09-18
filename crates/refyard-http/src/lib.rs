//! The native HTTP boundary: the closed API the desktop window serves over Tauri,
//! spoken over loopback HTTP for a browser or an integration client.
//!
//! This crate is a boundary, not a second implementation. Every route decodes a request,
//! calls one method on `refyard_host::service::ApplicationService`, and serializes the
//! contract's own DTO. The things it owns are the things a socket owns: pairing tickets
//! that become bearer sessions (`auth`), the exact Host/Origin rule (`origins`), the
//! route table (`router`), the event stream (`events`), and the static workbench
//! (`assets`). It never builds a Git argument, never reads a repository itself, and
//! never answers on anything but the loopback authority it was started with.
//!
//! The hosted form (non-loopback origins, passwords) is deliberately out of scope: this
//! crate refuses to pair any non-loopback origin, because the hosted form's second
//! factor is a different service's job to carry.

pub mod assets;
pub mod auth;
pub mod events;
pub mod origins;
pub mod router;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use refyard_host::service::ApplicationService;
use tokio::net::TcpListener;

use crate::auth::AuthStore;
use crate::router::HttpState;

/// Everything the boundary needs to start serving.
pub struct HttpHostOptions {
    /// The service this boundary speaks for. One process, one service.
    pub service: Arc<ApplicationService>,
    /// The loopback port to take. Port `0` lets the OS choose, which is how a test
    /// and a second instance coexist.
    pub port: u16,
    /// The built workbench to serve from `/`; `None` makes this an API-only process.
    pub web_root: Option<PathBuf>,
    /// Pairing-ticket lifetime in seconds. The sixty-second default is the design;
    /// widening it is a CLI-level choice for a URL that will be read later.
    pub ticket_ttl_seconds: u64,
    /// The grants every session paired through this host receives.
    pub grants: auth::Grants,
}

/// Why a listener did not start.
#[derive(Debug)]
pub enum StartError {
    /// The requested port is held by someone else. The caller decides whether that is a
    /// refusal (an explicitly requested port) or a reason to take a free one (the
    /// default), and that decision belongs above this layer.
    PortInUse(u16),
    /// The listener could not start at all, which no retry fixes.
    Other(String),
}

/// A running boundary: its address, its tickets, and the way to stop it.
pub struct HttpHost {
    pub base_url: String,
    pub port: u16,
    pub service_instance_id: String,
    pub auth: Arc<Mutex<AuthStore>>,
    pub authorities: Vec<String>,
    pub allowed_origins: Vec<String>,
    grants: auth::Grants,
    shutdown: tokio::sync::watch::Sender<bool>,
}

impl HttpHost {
    /// A browser pairing URL carrying one short-lived, single-use ticket.
    ///
    /// The ticket rides in the query string. That is safe here because this service never
    /// logs a query string, documents go out with `Referrer-Policy: no-referrer`, the
    /// ticket is single-use and expires in seconds, and the page strips it from the
    /// address bar as soon as it is spent.
    pub fn pairing_url(&self, origin: &str) -> Result<String, refyard_contract::problem::Problem> {
        if !self.allowed_origins.iter().any(|allowed| allowed == origin) {
            return Err(refyard_contract::problem::Problem::new(
                refyard_contract::problem::ProblemCode::Forbidden,
                format!("{origin} is not an origin this service answers on"),
            ));
        }
        let ticket = self.auth.lock().expect("auth lock").mint_ticket(
            origin,
            "cli",
            self.grants.clone(),
            refyard_host::clock::now_millis(),
        )?;
        Ok(format!("{origin}/?pair={}", ticket.ticket))
    }

    /// A supervisor pairing URL whose ticket is bound to the empty origin.
    ///
    /// The exchange compares a ticket's origin with the request's, and a machine client
    /// sends no Origin header at all — empty matches empty. A browser can never spend
    /// this ticket: it always sends an Origin, which never equals the empty binding, so
    /// the URL is inert in any browser that reaches it.
    pub fn machine_pairing_url(&self) -> Result<String, refyard_contract::problem::Problem> {
        let ticket = self.auth.lock().expect("auth lock").mint_ticket(
            "",
            "cli",
            self.grants.clone(),
            refyard_host::clock::now_millis(),
        )?;
        Ok(format!("{}/?pair={}", self.base_url, ticket.ticket))
    }

    /// Stops accepting connections and lets what is running finish.
    ///
    /// A mutation that has been accepted is a write in progress, and cutting its
    /// connection does not stop the write — it only hides the answer. The graceful
    /// shutdown of the HTTP stack drains in-flight requests before returning.
    pub async fn close(self) {
        let _ = self.shutdown.send(true);
    }
}

/// Starts the listener and returns once it is serving.
pub async fn start_http_host(options: HttpHostOptions) -> Result<HttpHost, StartError> {
    let service_instance_id = options.service.service_instance_id().to_string();
    let listener = TcpListener::bind(("127.0.0.1", options.port))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                StartError::PortInUse(options.port)
            } else {
                StartError::Other(format!("the listener could not start: {error}"))
            }
        })?;
    let port = listener
        .local_addr()
        .map_err(|error| StartError::Other(format!("the listener has no address: {error}")))?
        .port();

    let authorities = origins::loopback_authorities(port, false);
    let allowed_origins = origins::origins_for(&authorities);
    let auth = Arc::new(Mutex::new(AuthStore::with_ttl(
        &service_instance_id,
        options.ticket_ttl_seconds,
        auth::DEFAULT_SESSION_TTL_SECONDS,
    )));
    let state = Arc::new(HttpState {
        service: Arc::clone(&options.service),
        auth: Arc::clone(&auth),
        authorities: authorities.clone(),
        allowed_origins: allowed_origins.clone(),
        service_instance_id,
        web_root: options.web_root.clone(),
        limits: router::Limits::default(),
    });

    let (shutdown, shutdown_rx) = tokio::sync::watch::channel(false);
    let app = router::build(Arc::clone(&state));
    tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            let mut receiver = shutdown_rx;
            while !*receiver.borrow_and_update() {
                if receiver.changed().await.is_err() {
                    break;
                }
            }
        });
        if server.await.is_err() {
            // A serve loop that dies takes the process's API with it; the exit is the
            // supervisor's to notice, and the error is on stderr where a log can hold it.
            eprintln!("refyard: the HTTP serve loop ended unexpectedly");
        }
    });

    Ok(HttpHost {
        base_url: format!("http://127.0.0.1:{port}"),
        port,
        service_instance_id: state.service_instance_id.clone(),
        auth,
        authorities,
        allowed_origins,
        grants: options.grants,
        shutdown,
    })
}
