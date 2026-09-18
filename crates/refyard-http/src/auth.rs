//! Pairing: a one-time ticket becomes a bearer session.
//!
//! A local service has no user directory. It can only ask whether the caller holds the
//! secret the CLI minted, so the CLI mints a 256-bit ticket, hands it to the browser in a
//! pairing URL that lives for seconds, and exchanges it once for a bearer token that lives
//! in memory and nowhere else.
//!
//! The rules, each closing a named hole:
//!
//! - **single use** — a ticket that could be redeemed twice is a password in a URL a
//!   browser history keeps;
//! - **short life** — the default sixty seconds covers the walk from the printed URL to
//!   the exchange, and widening it is a CLI-level choice, never a smaller number;
//! - **bound to instance and origin** — a ticket spent against the wrong origin or a
//!   different service process is consumed on first sight, not left dangling;
//! - **in memory only** — a restart invalidates every ticket and session, and nothing
//!   about a session survives in a file;
//! - **constant-time comparison** — a ticket is a secret, and a `==` compare would leak
//!   its prefix through timing to a caller that can retry.
//!
//! The hosted second factor (a scrypt-hashed password for non-loopback origins) is
//! deliberately absent: this crate refuses to mint a ticket for any non-loopback origin,
//! so there is nothing here for a password to protect. A caller that wants the hosted
//! form is asking for a different service than the native one.

use std::collections::HashMap;

use refyard_contract::problem::{Problem, ProblemCode};

/// How long a pairing ticket may wait to be exchanged.
pub const DEFAULT_TICKET_TTL_SECONDS: u64 = 60;
/// How long a paired session lives. There is no refresh and no remember-me.
pub const DEFAULT_SESSION_TTL_SECONDS: u64 = 8 * 60 * 60;
/// Housekeeping bounds, not eviction policies a user is meant to notice.
const MAX_TICKETS: usize = 64;
const MAX_SESSIONS: usize = 16;
/// The length of a minted secret, in bytes, before base64url encoding.
const SECRET_BYTES: usize = 32;

/// What a paired session may do, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grants {
    pub allowed_root_ids: Vec<String>,
    pub repository_ids: Vec<String>,
    pub scopes: Vec<String>,
}

impl Grants {
    /// The grants a native session starts with, over the repositories the CLI approved.
    ///
    /// The write and network scopes travel with the read scope because the workbench's
    /// whole purpose is to work on the repositories a person named; narrowing them is the
    /// hosted form's business, not this one's.
    pub fn for_repositories(allowed_root_ids: Vec<String>, repository_ids: Vec<String>) -> Self {
        Self {
            allowed_root_ids,
            repository_ids,
            scopes: vec![
                "repository:read".to_string(),
                "repository:write".to_string(),
                "repository:network".to_string(),
                "workspace:manage".to_string(),
            ],
        }
    }

    fn add(&mut self, allowed_root_id: &str, repository_id: &str) {
        if !self.allowed_root_ids.iter().any(|id| id == allowed_root_id) {
            self.allowed_root_ids.push(allowed_root_id.to_string());
        }
        if !self.repository_ids.iter().any(|id| id == repository_id) {
            self.repository_ids.push(repository_id.to_string());
        }
    }

    fn remove_repository(
        &mut self,
        repository_id: &str,
        allowed_root_id: &str,
        root_has_repositories: bool,
    ) {
        self.repository_ids.retain(|id| id != repository_id);
        if !root_has_repositories {
            self.allowed_root_ids.retain(|id| id != allowed_root_id);
        }
    }
}

/// A one-shot pairing ticket, bound to the origin it may be spent from.
#[derive(Debug, Clone)]
pub struct BootstrapTicket {
    pub ticket: String,
    pub service_instance_id: String,
    pub origin: String,
    pub actor: String,
    pub grants: Grants,
    pub expires_at_ms: i64,
}

/// A paired session: a bearer token with its grants and its clock.
#[derive(Debug, Clone)]
pub struct Session {
    pub token: String,
    pub session_id: String,
    pub actor: String,
    pub grants: Grants,
    pub service_instance_id: String,
    pub issued_at_ms: i64,
    pub expires_at_ms: i64,
}

/// Where a ticket exchange or an authorization ended.
pub type AuthResult<T> = Result<T, Problem>;

/// The tickets and sessions of one running process.
#[derive(Debug)]
pub struct AuthStore {
    service_instance_id: String,
    ticket_ttl_ms: u64,
    session_ttl_ms: u64,
    tickets: HashMap<String, BootstrapTicket>,
    sessions: HashMap<String, Session>,
}

impl AuthStore {
    pub fn new(service_instance_id: impl Into<String>) -> Self {
        Self::with_ttl(
            service_instance_id,
            DEFAULT_TICKET_TTL_SECONDS,
            DEFAULT_SESSION_TTL_SECONDS,
        )
    }

    pub fn with_ttl(
        service_instance_id: impl Into<String>,
        ticket_ttl_seconds: u64,
        session_ttl_seconds: u64,
    ) -> Self {
        Self {
            service_instance_id: service_instance_id.into(),
            ticket_ttl_ms: ticket_ttl_seconds * 1000,
            session_ttl_ms: session_ttl_seconds * 1000,
            tickets: HashMap::new(),
            sessions: HashMap::new(),
        }
    }

    /// Mints a ticket for exactly one origin and one grant set.
    ///
    /// A non-loopback origin is refused outright: the hosted form needs a second factor
    /// this crate does not carry, and refusing here is the only honest answer.
    pub fn mint_ticket(
        &mut self,
        origin: &str,
        actor: &str,
        grants: Grants,
        now_ms: i64,
    ) -> Result<BootstrapTicket, Problem> {
        if !is_loopback_origin(origin) {
            return Err(Problem::new(
                ProblemCode::Forbidden,
                "the native service pairs loopback origins only; the hosted form is a different service",
            ));
        }
        self.prune(now_ms);
        let record = BootstrapTicket {
            ticket: random_secret(""),
            service_instance_id: self.service_instance_id.clone(),
            origin: origin.to_string(),
            actor: actor.to_string(),
            grants,
            expires_at_ms: now_ms + self.ticket_ttl_ms as i64,
        };
        self.tickets.insert(record.ticket.clone(), record.clone());
        Ok(record)
    }

    /// Redeems a ticket. Every mismatch except a hosted password consumes it on first
    /// sight, so a wrong-origin retry cannot fish for the right one.
    pub fn exchange(
        &mut self,
        ticket: &str,
        origin: &str,
        service_instance_id: &str,
        now_ms: i64,
    ) -> AuthResult<Session> {
        self.prune(now_ms);
        let record = match self.find_ticket(ticket) {
            Some(record) => record,
            None => {
                return Err(Problem::new(
                    ProblemCode::Unauthenticated,
                    "that pairing ticket is not valid: it was already used, it expired, or this service did not issue it",
                ));
            }
        };
        if record.expires_at_ms <= now_ms {
            self.tickets.remove(&record.ticket);
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "that pairing ticket expired; start the workbench again",
            ));
        }
        if record.service_instance_id != service_instance_id {
            self.tickets.remove(&record.ticket);
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "that pairing ticket belongs to a different service process",
            ));
        }
        if record.origin != origin {
            self.tickets.remove(&record.ticket);
            return Err(Problem::new(
                ProblemCode::Forbidden,
                "that pairing ticket was issued for a different origin",
            ));
        }
        self.tickets.remove(&record.ticket);
        let session = Session {
            token: random_secret("rfs_"),
            session_id: format!("sess_{}", random_token(12)),
            actor: record.actor,
            grants: record.grants,
            service_instance_id: self.service_instance_id.clone(),
            issued_at_ms: now_ms,
            expires_at_ms: now_ms + self.session_ttl_ms as i64,
        };
        self.sessions.insert(session.token.clone(), session.clone());
        Ok(session)
    }

    /// Resolves an `Authorization` header to the session it names.
    pub fn authorize(
        &self,
        authorization: Option<&str>,
        service_instance_id: &str,
        now_ms: i64,
    ) -> AuthResult<Session> {
        let Some(header) = authorization.filter(|value| !value.is_empty()) else {
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "this service requires a bearer token; pair again from the CLI",
            ));
        };
        let Some(token) = header.strip_prefix("Bearer ") else {
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "the Authorization header must be `Bearer <token>`",
            ));
        };
        let Some(session) = self.find_session(token) else {
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "that session is not valid: it expired, or this service restarted",
            ));
        };
        if session.service_instance_id != service_instance_id {
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "that session belongs to a different service process",
            ));
        }
        if session.expires_at_ms <= now_ms {
            return Err(Problem::new(
                ProblemCode::Unauthenticated,
                "that session expired; pair again from the CLI",
            ));
        }
        Ok(session)
    }

    /// Does this session's grant cover the repository?
    pub fn allows_repository(&self, session: &Session, repository_id: &str) -> bool {
        session
            .grants
            .repository_ids
            .iter()
            .any(|id| id == repository_id)
    }

    /// Adds a newly registered repository to one live session, so the repository a
    /// window just opened is one that window can read.
    pub fn grant(&mut self, session_id: &str, allowed_root_id: &str, repository_id: &str) -> bool {
        let Some(session) = self
            .sessions
            .values_mut()
            .find(|session| session.session_id == session_id)
        else {
            return false;
        };
        session.grants.add(allowed_root_id, repository_id);
        true
    }

    /// Removes a revoked repository from every live session.
    pub fn revoke_repository(
        &mut self,
        repository_id: &str,
        allowed_root_id: &str,
        root_has_repositories: bool,
    ) {
        for session in self.sessions.values_mut() {
            session
                .grants
                .remove_repository(repository_id, allowed_root_id, root_has_repositories);
        }
    }

    pub fn revoke(&mut self, session_id: &str) -> bool {
        let token = self
            .sessions
            .values()
            .find(|session| session.session_id == session_id)
            .map(|session| session.token.clone());
        match token {
            Some(token) => self.sessions.remove(&token).is_some(),
            None => false,
        }
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn ticket_count(&self) -> usize {
        self.tickets.len()
    }

    fn prune(&mut self, now_ms: i64) {
        self.tickets
            .retain(|_, record| record.expires_at_ms > now_ms);
        self.sessions
            .retain(|_, session| session.expires_at_ms > now_ms);
        while self.tickets.len() > MAX_TICKETS {
            let Some(oldest) = self
                .tickets
                .values()
                .min_by_key(|record| record.expires_at_ms)
                .map(|record| record.ticket.clone())
            else {
                break;
            };
            self.tickets.remove(&oldest);
        }
        while self.sessions.len() > MAX_SESSIONS {
            let Some(oldest) = self
                .sessions
                .values()
                .min_by_key(|session| session.issued_at_ms)
                .map(|session| session.token.clone())
            else {
                break;
            };
            self.sessions.remove(&oldest);
        }
    }

    fn find_ticket(&self, ticket: &str) -> Option<BootstrapTicket> {
        self.tickets
            .iter()
            .find(|(candidate, _)| secret_matches(ticket, candidate))
            .map(|(_, record)| record.clone())
    }

    fn find_session(&self, token: &str) -> Option<Session> {
        self.sessions
            .iter()
            .find(|(candidate, _)| secret_matches(token, candidate))
            .map(|(_, session)| session.clone())
    }
}

/// Compares two secrets in time independent of where they first differ.
///
/// A secret compared with early return leaks its longest matching prefix to a caller
/// that can measure and retry; folding every byte removes the signal.
fn secret_matches(given: &str, expected: &str) -> bool {
    let given = given.as_bytes();
    let expected = expected.as_bytes();
    if given.len() != expected.len() {
        return false;
    }
    given
        .iter()
        .zip(expected.iter())
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

/// `32 bytes of randomness, base64url — the alphabet a URL survives.`
fn random_secret(prefix: &str) -> String {
    format!("{prefix}{}", random_token(SECRET_BYTES))
}

/// Base64url of `bytes` random bytes from the operating system's generator.
fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the operating system random source is available");
    base64url_encode(&buffer)
}

/// Base64url without padding, the spelling a URL path survives untouched.
fn base64url_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let bytes = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let number = ((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | bytes[2] as u32;
        output.push(ALPHABET[(number >> 18) as usize & 63] as char);
        output.push(ALPHABET[(number >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            output.push(ALPHABET[(number >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            output.push(ALPHABET[number as usize & 63] as char);
        }
    }
    output
}

/// Is this origin one of this machine's loopback spellings?
///
/// Nothing else is ever accepted: no LAN address, no hostname, no tunnel. The hosted
/// form is a different service with a different threat model.
fn is_loopback_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let authority = rest.trim_end_matches('/');
    for loopback in ["127.0.0.1", "localhost", "[::1]"] {
        if authority == loopback
            || authority
                .strip_prefix(loopback)
                .is_some_and(|rest| rest.starts_with(':'))
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> AuthStore {
        AuthStore::new("srvc_test")
    }

    fn grants() -> Grants {
        Grants::for_repositories(vec!["root_1".to_string()], vec!["repo_1".to_string()])
    }

    #[test]
    fn a_ticket_exchanges_once_and_never_twice() {
        let mut store = store();
        let ticket = store
            .mint_ticket("http://127.0.0.1:9595", "cli", grants(), 1_000)
            .expect("loopback ticket");
        let session = store
            .exchange(&ticket.ticket, "http://127.0.0.1:9595", "srvc_test", 2_000)
            .expect("first exchange succeeds");
        assert_eq!(session.grants, grants());
        assert_eq!(session.actor, "cli");
        // Prevents: a ticket in a browser history being replayed into a second session.
        assert!(store
            .exchange(&ticket.ticket, "http://127.0.0.1:9595", "srvc_test", 2_001)
            .is_err());
        assert_eq!(store.session_count(), 1);
    }

    #[test]
    fn an_expired_ticket_is_consumed_and_named_as_expired() {
        let mut store = store();
        let ticket = store
            .mint_ticket("http://127.0.0.1:9595", "cli", grants(), 1_000)
            .expect("ticket");
        let problem = store
            .exchange(
                &ticket.ticket,
                "http://127.0.0.1:9595",
                "srvc_test",
                1_000 + DEFAULT_TICKET_TTL_SECONDS as i64 * 1000 + 1,
            )
            .expect_err("expired");
        assert_eq!(problem.code, ProblemCode::Unauthenticated);
        // A second try says the same thing, because the ticket is gone either way.
        assert!(store
            .exchange(
                &ticket.ticket,
                "http://127.0.0.1:9595",
                "srvc_test",
                1_000 + DEFAULT_TICKET_TTL_SECONDS as i64 * 1000 + 2
            )
            .is_err());
    }

    // Prevents: a URL minted for `http://127.0.0.1:9595` being spent against a different
    // origin, or against a second service instance that happens to share the port.
    #[test]
    fn a_ticket_bound_to_one_origin_or_instance_is_consumed_when_mismatched() {
        let mut store = store();
        let ticket = store
            .mint_ticket("http://127.0.0.1:9595", "cli", grants(), 1_000)
            .expect("ticket");
        assert!(store
            .exchange(&ticket.ticket, "http://localhost:9595", "srvc_test", 1_100)
            .is_err());
        assert!(
            store.ticket_count() == 0,
            "the mismatch consumed the ticket"
        );
        let ticket = store
            .mint_ticket("http://127.0.0.1:9595", "cli", grants(), 2_000)
            .expect("ticket");
        assert!(store
            .exchange(&ticket.ticket, "http://127.0.0.1:9595", "srvc_other", 2_100)
            .is_err());
        assert!(store.ticket_count() == 0);
    }

    // Prevents: the native service pairing a tunnel or LAN origin, which is the hosted
    // form and needs a second factor this crate does not carry.
    #[test]
    fn a_non_loopback_origin_is_refused_before_a_ticket_exists() {
        let mut store = store();
        for origin in [
            "https://workbench.example",
            "http://192.168.1.10:9595",
            "http://[fd00::1]:9595",
        ] {
            assert!(
                store.mint_ticket(origin, "cli", grants(), 1_000).is_err(),
                "{origin}"
            );
        }
        assert_eq!(store.ticket_count(), 0);
    }

    #[test]
    fn a_bearer_authorizes_only_its_own_session_and_instance() {
        let mut store = store();
        let ticket = store
            .mint_ticket("http://127.0.0.1:9595", "cli", grants(), 1_000)
            .expect("ticket");
        let session = store
            .exchange(&ticket.ticket, "http://127.0.0.1:9595", "srvc_test", 2_000)
            .expect("session");
        let header = format!("Bearer {}", session.token);
        assert!(store.authorize(Some(&header), "srvc_test", 2_500).is_ok());
        assert!(store.authorize(Some(&header), "srvc_other", 2_500).is_err());
        assert!(store
            .authorize(Some("Bearer rfs_nonsense"), "srvc_test", 2_500)
            .is_err());
        assert!(store
            .authorize(Some(&session.token), "srvc_test", 2_500)
            .is_err());
        assert!(store.authorize(None, "srvc_test", 2_500).is_err());
    }

    // Prevents: a repository registered later being unreadable by the session that
    // registered it, or a revoked one staying readable by the session that revoked it.
    #[test]
    fn grants_follow_registrations_and_revocations() {
        let mut store = store();
        let ticket = store
            .mint_ticket(
                "http://127.0.0.1:9595",
                "cli",
                Grants::for_repositories(vec![], vec![]),
                1_000,
            )
            .expect("ticket");
        let session = store
            .exchange(&ticket.ticket, "http://127.0.0.1:9595", "srvc_test", 2_000)
            .expect("session");
        assert!(!store.allows_repository(&session, "repo_2"));
        assert!(store.grant(&session.session_id, "root_2", "repo_2"));
        let fresh = store
            .authorize(
                Some(&format!("Bearer {}", session.token)),
                "srvc_test",
                2_100,
            )
            .expect("still valid");
        assert!(store.allows_repository(&fresh, "repo_2"));
        store.revoke_repository("repo_2", "root_2", false);
        let after = store
            .authorize(
                Some(&format!("Bearer {}", session.token)),
                "srvc_test",
                2_200,
            )
            .expect("still valid");
        assert!(!store.allows_repository(&after, "repo_2"));
    }

    #[test]
    fn secrets_compare_in_time_independent_of_their_first_difference() {
        assert!(secret_matches("abc", "abc"));
        assert!(!secret_matches("abc", "abd"));
        assert!(!secret_matches("abc", "abcd"));
        assert!(!secret_matches("abcd", "abc"));
    }

    #[test]
    fn base64url_encoding_matches_the_alphabet_a_url_survives() {
        assert_eq!(base64url_encode(&[]), "");
        // 0xf8 = 111110 00 → '-' then 'A'; the two leftover bits pad with zeros and the
        // output stays unpadded, which is the spelling a URL path survives untouched.
        assert_eq!(base64url_encode(&[0xf8]), "-A");
        assert_eq!(base64url_encode(&[0xf8, 0x3f]), "-D8");
        // The standard vector from RFC 4648's base64url table, no padding.
        assert_eq!(base64url_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64url_encode(b"foob"), "Zm9vYg");
        assert_eq!(random_token(32).len(), 43);
    }
}
