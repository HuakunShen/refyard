//! Preview tokens: this host's proof that a request was built against the content it is
//! about to change.
//!
//! The rule this enforces comes from the safety contract: a `git status` marker is not
//! evidence that a file still holds what the user was shown. `git status` says "this path
//! differs from the index", and that stays true across an edit, a checkout of the same
//! relative change, or an editor rewriting the file. So before a write, the host reads
//! the path, fingerprints the *content* — SHA-256 over the bytes, never the stat data —
//! and hands the browser an opaque token naming that exact fingerprint.
//!
//! A token is:
//!
//! - **bound** to one repository, one worktree, one build of the target, one path and one
//!   fingerprint, because a token minted for one of those must not authorise another;
//! - **single-use**, so a replayed request cannot change a file the user has not been
//!   shown again;
//! - **expiring**, so a token minted before a long pause is refused rather than applied
//!   to a working tree that moved on;
//! - **never a capability on its own** — a write must still pass scope, path-kind and
//!   batch validation, and the token only answers "is this the content the user saw?".
//!
//! Tokens live in memory only. They die with the process, which is the correct lifetime
//! for something that authorises one write against one observed state: a token that
//! outlived its process would be an authorisation nobody could audit.

use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher, RandomState};
use std::sync::Mutex;

use refyard_contract::problem::{Problem, ProblemCode};
use sha2::{Digest, Sha256};

use crate::files::ContentKind;

/// `LIMITS.previewTokenTtlSeconds` from the published contract, in milliseconds.
pub const PREVIEW_TTL_MS: i64 = 300_000;

/// The hard cap on live tokens; expired and used ones are pruned first.
pub const PREVIEW_MAX_ENTRIES: usize = 10_000;

/// What one token binds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewClaim {
    pub repository_id: String,
    pub worktree_id: String,
    pub target_generation: String,
    pub path_id: String,
    /// SHA-256 of the bytes that were read, or `None` when the path had no readable
    /// content. `None` is not the empty hash: it means no bytes were seen.
    pub fingerprint_hex: Option<String>,
    pub size_bytes: Option<u64>,
    pub content_kind: ContentKind,
}

/// What a token was minted for, as a client presents it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedPreview {
    pub preview_token: String,
    pub expires_at_ms: i64,
}

/// One token being presented, with the fingerprint recomputed now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewCheck {
    pub preview_token: String,
    pub repository_id: String,
    pub worktree_id: String,
    pub target_generation: String,
    pub path_id: String,
    /// The fingerprint of the content as it is now, or `None` when it could not be read.
    pub current_fingerprint_hex: Option<String>,
}

/// Why a token was refused. Every one of these is a `StalePreview` on the wire — the
/// client's action is the same for all of them, re-preview and confirm again — but the
/// reason is kept so a person reading a message can tell what happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewRefusal {
    /// A token this store never issued, or one it has already forgotten.
    UnknownToken,
    Expired,
    AlreadyUsed,
    WrongPath,
    WrongWorktree,
    WrongRepository,
    /// Minted against an earlier build of the execution target.
    StaleGeneration,
    /// The path could not be read at all now, which is never equal to a fingerprint.
    Unreadable,
    StaleContent,
}

impl PreviewRefusal {
    /// The sentence a client shows, phrased as what to do next.
    pub fn message(self) -> &'static str {
        match self {
            Self::UnknownToken => {
                "this preview token was not issued by this host, or it has already been replaced; re-preview the paths before changing them"
            }
            Self::Expired => {
                "this preview token expired; re-preview the paths before changing them"
            }
            Self::AlreadyUsed => {
                "this preview token has already been used; re-preview the paths before changing them"
            }
            Self::WrongPath => "this preview token was issued for a different path",
            Self::WrongWorktree => "this preview token was issued for a different worktree",
            Self::WrongRepository => "this preview token was issued for a different repository",
            Self::StaleGeneration => {
                "this preview token was issued before the execution target was rebuilt"
            }
            Self::Unreadable => "a selected path could no longer be read; re-preview it before changing it",
            Self::StaleContent => {
                "the file content changed since it was previewed; re-preview it before changing it"
            }
        }
    }

    /// The contract's refusal: one code, because a client's next step is the same for all
    /// of them, with the reason in the message and the path in the details.
    pub fn problem(self, path_id: Option<&str>) -> Problem {
        let mut problem = Problem::new(
            ProblemCode::StalePreview,
            format!(
                "{}; re-preview the selected paths and confirm again",
                self.message()
            ),
        );
        if let Some(path_id) = path_id {
            problem = problem.with_detail(
                "pathId",
                refyard_contract::problem::DetailValue::Text(path_id.to_string()),
            );
        }
        problem
    }
}

#[derive(Debug, Clone)]
struct StoredPreview {
    claim: PreviewClaim,
    expires_at_ms: i64,
    used: bool,
}

/// The tokens this process has issued.
#[derive(Debug)]
pub struct PreviewStore {
    inner: Mutex<StoreState>,
    ttl_ms: i64,
    max_entries: usize,
}

#[derive(Debug)]
struct StoreState {
    entries: HashMap<String, StoredPreview>,
    /// A per-store random seed and a counter: the token must not be guessable from the
    /// claim it names, because a caller that could compute a token could authorise a write
    /// against content it never read. No RNG crate is in this workspace, so the seed comes
    /// from the standard library's `RandomState` — which fills its keys from the OS
    /// entropy pool — mixed with the clock and the process id.
    seed: [u8; 32],
    next: u64,
}

impl Default for PreviewStore {
    fn default() -> Self {
        Self::with_contract_limits()
    }
}

impl PreviewStore {
    /// A store with the contract's own TTL and entry cap.
    pub fn with_contract_limits() -> Self {
        Self::new(PREVIEW_TTL_MS, PREVIEW_MAX_ENTRIES)
    }

    pub fn new(ttl_ms: i64, max_entries: usize) -> Self {
        Self {
            inner: Mutex::new(StoreState {
                entries: HashMap::new(),
                seed: seed(),
                next: 0,
            }),
            ttl_ms,
            max_entries,
        }
    }

    /// Mints a token for one claim.
    pub fn issue(&self, claim: PreviewClaim) -> IssuedPreview {
        let mut state = self.inner.lock().expect("preview lock");
        state.next += 1;
        let token = mint(&state.seed, state.next, &claim);
        let expires_at_ms = clock_ms() + self.ttl_ms;
        state.entries.insert(
            token.clone(),
            StoredPreview {
                claim,
                expires_at_ms,
                used: false,
            },
        );
        Self::prune(&mut state, self.max_entries);
        IssuedPreview {
            preview_token: token,
            expires_at_ms,
        }
    }

    /// Verifies every check without consuming anything. For a dry run or a pre-flight.
    pub fn verify(&self, checks: &[PreviewCheck]) -> Result<(), PreviewRefusal> {
        let state = self.inner.lock().expect("preview lock");
        for check in checks {
            Self::check(&state, check)?;
        }
        Ok(())
    }

    /// Verifies every check, then consumes the tokens. All-or-nothing: one stale entry
    /// leaves the whole batch untouched, because a partially consumed batch would force
    /// the client to re-preview paths it never touched.
    pub fn redeem(&self, checks: &[PreviewCheck]) -> Result<(), PreviewRefusal> {
        let mut state = self.inner.lock().expect("preview lock");
        for check in checks {
            Self::check(&state, check)?;
        }
        for check in checks {
            if let Some(entry) = state.entries.get_mut(&check.preview_token) {
                entry.used = true;
            }
        }
        Ok(())
    }

    /// How many tokens are held, for a test or a diagnostic.
    pub fn size(&self) -> usize {
        self.inner.lock().expect("preview lock").entries.len()
    }

    /// Invalidates write previews when the root that scoped their worktree is retired.
    pub fn invalidate_worktree(&self, repository_id: &str, worktree_id: &str) -> usize {
        let mut state = self.inner.lock().expect("preview lock");
        let before = state.entries.len();
        state.entries.retain(|_, entry| {
            entry.claim.repository_id != repository_id || entry.claim.worktree_id != worktree_id
        });
        before - state.entries.len()
    }

    fn check(state: &StoreState, check: &PreviewCheck) -> Result<(), PreviewRefusal> {
        let Some(entry) = state.entries.get(&check.preview_token) else {
            return Err(PreviewRefusal::UnknownToken);
        };
        if entry.used {
            return Err(PreviewRefusal::AlreadyUsed);
        }
        if entry.expires_at_ms <= clock_ms() {
            return Err(PreviewRefusal::Expired);
        }
        if entry.claim.repository_id != check.repository_id {
            return Err(PreviewRefusal::WrongRepository);
        }
        if entry.claim.worktree_id != check.worktree_id {
            return Err(PreviewRefusal::WrongWorktree);
        }
        if entry.claim.target_generation != check.target_generation {
            return Err(PreviewRefusal::StaleGeneration);
        }
        if entry.claim.path_id != check.path_id {
            return Err(PreviewRefusal::WrongPath);
        }
        let Some(current) = &check.current_fingerprint_hex else {
            // Nothing was read now. Comparing that against the nothing an unreadable
            // preview recorded would authorise a write against bytes nobody saw.
            return Err(PreviewRefusal::Unreadable);
        };
        if entry.claim.fingerprint_hex.as_ref() != Some(current) {
            return Err(PreviewRefusal::StaleContent);
        }
        Ok(())
    }

    /// Drops dead tokens, and then the oldest live ones if the cap is still exceeded.
    ///
    /// Dead entries go first because an expired or already-used token that is still
    /// remembered produces `expired`/`already-used`, which tells the client what to do;
    /// forgetting it early would downgrade every refusal to "unknown token" and lose the
    /// reason.
    fn prune(state: &mut StoreState, max_entries: usize) {
        if state.entries.len() <= max_entries {
            return;
        }
        let current = clock_ms();
        state
            .entries
            .retain(|_, entry| !entry.used && entry.expires_at_ms > current);
        if state.entries.len() <= max_entries {
            return;
        }
        let mut live: Vec<(String, i64)> = state
            .entries
            .iter()
            .map(|(token, entry)| (token.clone(), entry.expires_at_ms))
            .collect();
        live.sort_by_key(|(_, expires_at)| *expires_at);
        for (token, _) in live.into_iter().take(state.entries.len() - max_entries) {
            state.entries.remove(&token);
        }
    }
}

/// A token that cannot be computed from the claim it names.
fn mint(seed: &[u8; 32], counter: u64, claim: &PreviewClaim) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seed);
    hasher.update(counter.to_be_bytes());
    hasher.update(claim.repository_id.as_bytes());
    hasher.update([0]);
    hasher.update(claim.worktree_id.as_bytes());
    hasher.update([0]);
    hasher.update(claim.target_generation.as_bytes());
    hasher.update([0]);
    hasher.update(claim.path_id.as_bytes());
    hasher.update([0]);
    hasher.update(claim.fingerprint_hex.as_deref().unwrap_or(""));
    let digest = hasher.finalize();
    let mut token = String::with_capacity(3 + 32);
    token.push_str("pt_");
    for byte in &digest[..16] {
        token.push_str(&format!("{byte:02x}"));
    }
    token
}

/// 32 bytes of per-store seed material.
fn seed() -> [u8; 32] {
    let random = RandomState::new();
    let mut hasher = Sha256::new();
    for round in 0u64..4 {
        let mut state = random.build_hasher();
        state.write_u64(round);
        state.write_u64(clock_ms() as u64);
        hasher.update(state.finish().to_be_bytes());
    }
    hasher.update(std::process::id().to_be_bytes());
    hasher.finalize().into()
}

/// The host's one clock, so a token's expiry and a journal timestamp agree on "now".
fn clock_ms() -> i64 {
    crate::clock::now_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claim(path_id: &str) -> PreviewClaim {
        PreviewClaim {
            repository_id: "repo_1".to_string(),
            worktree_id: "wt_1".to_string(),
            target_generation: "gen_1".to_string(),
            path_id: path_id.to_string(),
            fingerprint_hex: Some("aa".to_string()),
            size_bytes: Some(2),
            content_kind: ContentKind::Text,
        }
    }

    fn check(token: &str, path_id: &str, fingerprint: Option<&str>) -> PreviewCheck {
        PreviewCheck {
            preview_token: token.to_string(),
            repository_id: "repo_1".to_string(),
            worktree_id: "wt_1".to_string(),
            target_generation: "gen_1".to_string(),
            path_id: path_id.to_string(),
            current_fingerprint_hex: fingerprint.map(str::to_string),
        }
    }

    #[test]
    fn two_tokens_for_the_same_claim_are_different_strings() {
        // A token a caller could predict is an authorisation it could forge.
        let store = PreviewStore::with_contract_limits();
        let first = store.issue(claim("path_1")).preview_token;
        let second = store.issue(claim("path_1")).preview_token;
        assert_ne!(first, second);
        assert!(first.starts_with("pt_"));
    }

    #[test]
    fn a_token_expires_and_the_reason_is_kept() {
        // An expired token is remembered so the client is told to re-preview, instead of
        // being told the token never existed.
        let store = PreviewStore::new(-1, 10);
        let issued = store.issue(claim("path_1"));
        assert_eq!(
            store.verify(&[check(&issued.preview_token, "path_1", Some("aa"))]),
            Err(PreviewRefusal::Expired)
        );
    }

    #[test]
    fn a_refused_batch_consumes_nothing() {
        let store = PreviewStore::with_contract_limits();
        let good = store.issue(claim("path_1")).preview_token;
        let stale = store.issue(claim("path_2")).preview_token;
        let refused = store.redeem(&[
            check(&good, "path_1", Some("aa")),
            check(&stale, "path_2", Some("bb")),
        ]);
        assert_eq!(refused, Err(PreviewRefusal::StaleContent));
        assert_eq!(
            store.redeem(&[check(&good, "path_1", Some("aa"))]),
            Ok(()),
            "the batch that failed must not have spent the token that was fine"
        );
    }

    #[test]
    fn the_cap_drops_dead_tokens_before_live_ones() {
        let store = PreviewStore::new(60_000, 2);
        let first = store.issue(claim("path_1")).preview_token;
        let second = store.issue(claim("path_2")).preview_token;
        assert_eq!(store.size(), 2);
        // Spend the first, then mint one more: the spent token is the one to forget, and
        // the live one that is still in a browser's pending request is kept.
        store
            .redeem(&[check(&first, "path_1", Some("aa"))])
            .expect("redeemed");
        let _third = store.issue(claim("path_3")).preview_token;
        assert_eq!(store.size(), 2, "the cap is not a suggestion");
        assert_eq!(
            store.verify(&[check(&second, "path_2", Some("aa"))]),
            Ok(()),
            "a live token was dropped before a spent one"
        );
        assert_eq!(
            store.verify(&[check(&first, "path_1", Some("aa"))]),
            Err(PreviewRefusal::UnknownToken),
            "the spent token was the one forgotten"
        );
    }

    #[test]
    fn a_token_presented_for_a_different_claim_is_refused_by_name() {
        let store = PreviewStore::with_contract_limits();
        let issued = store.issue(claim("path_1")).preview_token;
        let mut wrong_path = check(&issued, "path_2", Some("aa"));
        assert_eq!(
            store.verify(&[wrong_path.clone()]),
            Err(PreviewRefusal::WrongPath)
        );
        wrong_path.path_id = "path_1".to_string();
        wrong_path.worktree_id = "wt_2".to_string();
        assert_eq!(
            store.verify(&[wrong_path.clone()]),
            Err(PreviewRefusal::WrongWorktree)
        );
        wrong_path.worktree_id = "wt_1".to_string();
        wrong_path.repository_id = "repo_2".to_string();
        assert_eq!(
            store.verify(&[wrong_path.clone()]),
            Err(PreviewRefusal::WrongRepository)
        );
        wrong_path.repository_id = "repo_1".to_string();
        wrong_path.target_generation = "gen_2".to_string();
        assert_eq!(
            store.verify(&[wrong_path]),
            Err(PreviewRefusal::StaleGeneration)
        );
    }

    #[test]
    fn retiring_a_worktree_invalidates_its_write_previews() {
        let store = PreviewStore::new(60_000, 32);
        let issued = store.issue(claim("path_1"));

        assert_eq!(store.invalidate_worktree("repo_1", "wt_1"), 1);
        assert_eq!(store.size(), 0);
        assert_eq!(
            store.verify(&[check(&issued.preview_token, "path_1", Some("fingerprint"))]),
            Err(PreviewRefusal::UnknownToken)
        );
    }

    #[test]
    fn an_unreadable_path_is_never_equal_to_the_absence_of_bytes() {
        let store = PreviewStore::with_contract_limits();
        let issued = store
            .issue(PreviewClaim {
                fingerprint_hex: None,
                size_bytes: None,
                content_kind: ContentKind::Unrepresentable,
                ..claim("path_1")
            })
            .preview_token;
        assert_eq!(
            store.redeem(&[check(&issued, "path_1", None)]),
            Err(PreviewRefusal::Unreadable)
        );
        assert_eq!(
            store.redeem(&[check(
                &issued,
                "path_1",
                Some("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            )]),
            Err(PreviewRefusal::StaleContent),
            "the empty-file hash is not what an unreadable preview bound"
        );
    }
}
