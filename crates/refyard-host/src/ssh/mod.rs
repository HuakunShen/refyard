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

pub mod config_catalogue;
pub mod config_lex;
pub mod source;

pub use config_catalogue::ConfigCatalogue;
pub use config_lex::{concrete_aliases, ConfigError, ConfigLine};
pub use source::{ConfigSource, IncludeLimits};
