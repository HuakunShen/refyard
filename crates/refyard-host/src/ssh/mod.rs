//! Reading the machine's own SSH configuration without running any of it.
//!
//! The host picker needs one thing: the concrete `Host` aliases a configuration file
//! declares. Producing that list must never run `ssh`, never evaluate a `Match`, never
//! open a key and never execute an `Include`d program — a configuration file can name a
//! `Match exec` command or a `ProxyCommand`, and a listing that evaluated them would be
//! running the user's configuration rather than reading it.
//!
//! The three parts are deliberately separate:
//!
//! - `config_lex` turns text into lines and answers the pure question of which `Host`
//!   patterns name a machine directly;
//! - `source` walks the primary file and its unconditional `Include`s under depth, file
//!   and byte budgets, turning every place it stopped into a warning;
//! - `config_catalogue` binds those answers to the contract's `SshHostList`: stable ids
//!   for a source and an alias, a content revision, and `discoveryIncomplete` when the
//!   list is not known to be complete.
//!
//! A candidate is not a verified machine. Nothing here proves an alias exists, is
//! reachable, or has the key the user expects; that is OpenSSH's business at connect time.
//!
//! The execution half of the module is the other way round: it never guesses, and it
//! never re-states the machine's configuration. `quote` encodes the one command string
//! the remote login shell parses, `openssh` fixes the local argument vector as data,
//! `connection` runs one attempt under a cancellable deadline, `policy` asks whether this
//! machine's OpenSSH accepts the fixed option set, and `probe` asks the far side whether
//! it can carry the reads at all. The user's configuration is used verbatim, never
//! imported, rewritten or worked around — including the `ProxyCommand` and `Match exec`
//! programs a user may have written, which this crate neither runs nor claims to disable.

pub mod config_catalogue;
pub mod config_lex;
pub mod connection;
pub mod openssh;
pub mod policy;
pub mod probe;
pub mod quote;
pub mod source;

pub use config_catalogue::ConfigCatalogue;
pub use config_lex::{concrete_aliases, ConfigError, ConfigLine};
pub use connection::SshConnection;
pub use openssh::{base_options, exec_argv, validate_alias, SAFETY_OPTIONS};
pub use policy::SshPolicy;
pub use probe::RemoteFacts;
pub use quote::{quote_posix, remote_git_command};
pub use source::{ConfigSource, IncludeLimits};

/// The failure vocabulary the SSH design gives this layer.
///
/// In this crate a host failure is the contract's `Problem`, not a parallel hierarchy, so
/// `HostError` is that same type under the name the design uses. Keeping the name means a
/// call site reads the way the design does while the code keeps one closed set of codes.
pub type HostError = refyard_contract::problem::Problem;
