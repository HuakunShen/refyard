//! The listing a caller asks for: one source set, answered as the contract's
//! `SshHostList`.
//!
//! A catalogue holds a source and its budgets — no executor, no connector, no
//! credential. That absence is the design: enumerating candidates reads files, so
//! opening a host picker cannot run `ssh`, cannot evaluate a `Match`, and cannot touch a
//! key. What comes back is a set of candidates, each marked incomplete when the source
//! set was only partially enumerated.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use refyard_contract::host::{SshHostCandidate, SshHostList};
use refyard_contract::problem::{Problem, ProblemCode};
use sha2::{Digest, Sha256};

use super::config_lex::ConfigError;
use super::source::{digest_hex, read_source, ConfigSource, IncludeLimits, SourceReading};

/// A catalogue over one primary SSH configuration file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigCatalogue {
    pub source: ConfigSource,
    pub limits: IncludeLimits,
}

impl ConfigCatalogue {
    /// Builds a catalogue over `path`, with `include_base` the directory relative
    /// `Include` paths resolve against — the user's SSH directory.
    pub fn new(path: PathBuf, include_base: PathBuf) -> Self {
        Self {
            source: ConfigSource {
                id: source_id(&path),
                path,
                include_base,
            },
            limits: IncludeLimits::default(),
        }
    }

    /// The concrete aliases this source declares.
    ///
    /// This reads files and nothing else: no connection, no `ssh -G`, no `Match`
    /// evaluation, no key, no credential. An alias is not a verified machine, and a list
    /// marked incomplete is not a claim that these are all of them.
    pub async fn list(&self) -> Result<SshHostList, Problem> {
        if !self.source.path.is_absolute() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                format!(
                    "the SSH config source {} is not an absolute path",
                    self.source.path.display()
                ),
            ));
        }
        if !self.source.include_base.is_absolute() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                format!(
                    "the SSH config include base {} is not an absolute path",
                    self.source.include_base.display()
                ),
            ));
        }
        let source = self.source.clone();
        let limits = self.limits;
        // The walk is a recursive read of a few small files; running it on the blocking
        // pool keeps a slow or stalled filesystem off the async runtime.
        let reading = tokio::task::spawn_blocking(move || read_source(&source, limits))
            .await
            .map_err(|_| {
                Problem::new(
                    ProblemCode::InternalError,
                    "the SSH config walk did not finish",
                )
            })?
            .map_err(problem)?;
        let SourceReading {
            aliases,
            warnings,
            incomplete,
            revision,
        } = reading;
        let hosts = aliases
            .into_iter()
            .map(|alias| {
                let host_id = host_id(&self.source.id, &alias);
                SshHostCandidate {
                    host_id,
                    source_id: self.source.id.clone(),
                    display_label: alias.clone(),
                    discovery_incomplete: incomplete,
                    alias,
                }
            })
            .collect();
        Ok(SshHostList {
            hosts,
            warnings,
            revision,
        })
    }
}

/// The source id: a function of the path, so a selection made in one run names the same
/// source in the next one.
fn source_id(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_os_str().as_encoded_bytes());
    format!("source_{}", digest_hex(hasher.finalize().as_slice(), 32))
}

/// The host id: a function of (source, alias), so it survives a restart, and opaque, so
/// an alias that is not URL-safe never has to appear inside an id.
fn host_id(source_id: &str, alias: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_id.as_bytes());
    // A separator that appears in neither input, so ("ab", "c") and ("a", "bc") cannot
    // mint the same id.
    hasher.update([0u8]);
    hasher.update(alias.as_bytes());
    format!("host_{}", digest_hex(hasher.finalize().as_slice(), 32))
}

/// A failure the caller cannot see through: the source it configured cannot be read or
/// parsed, so there is no candidate list to be partial about.
fn problem(error: ConfigError) -> Problem {
    match &error {
        ConfigError::UnreadableFile {
            path,
            kind,
            message,
        } => {
            let code = match kind {
                ErrorKind::PermissionDenied => ProblemCode::Forbidden,
                ErrorKind::NotFound => ProblemCode::NotFound,
                ErrorKind::IsADirectory => ProblemCode::InvalidRequest,
                _ => ProblemCode::Unavailable,
            };
            Problem::new(
                code,
                format!("{} could not be read: {message}", path.display()),
            )
        }
        ConfigError::NotUtf8 { path } => Problem::new(
            ProblemCode::InvalidRequest,
            format!("{} is not UTF-8 text", path.display()),
        ),
        ConfigError::LimitExceeded { limit, value } => Problem::new(
            ProblemCode::LimitExceeded,
            format!("the SSH config {limit} limit of {value} was reached"),
        ),
        other => Problem::new(ProblemCode::InvalidRequest, other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_prefixed_and_derived_from_their_inputs() {
        let path = Path::new("/home/u/.ssh/config");
        assert_eq!(source_id(path), source_id(path));
        assert_ne!(source_id(path), source_id(Path::new("/home/u/.ssh/other")));
        assert!(source_id(path).starts_with("source_"));

        let source = source_id(path);
        assert_eq!(host_id(&source, "prod"), host_id(&source, "prod"));
        assert_ne!(host_id(&source, "prod"), host_id(&source, "staging"));
        assert_ne!(
            host_id(&source, "ab"),
            host_id(&format!("{source}c"), "b"),
            "a separator keeps two concatenations from colliding"
        );
        let id = host_id(&source, "prod");
        let suffix = id.strip_prefix("host_").expect("prefixed");
        assert_eq!(suffix.len(), 32);
        assert!(suffix
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
    }
}
