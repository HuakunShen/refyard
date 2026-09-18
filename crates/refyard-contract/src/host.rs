//! The host-level half of the contract: execution targets, SSH discovery and what a
//! host can do about them.
//!
//! This is a projection of `packages/git-contract/src/host.ts`, field for field. It sits
//! here rather than in a host crate because both sides of every boundary need it: the
//! native service answers with these types, the Tauri dispatcher forwards them unchanged,
//! and a client compares them against the same JSON Schema the TypeScript types come
//! from.
//!
//! Two properties these types carry, and neither is decoration:
//!
//! - **a candidate is not a verified machine.** `SshHostCandidate` is an alias read out
//!   of a configuration file. Nothing in it proves the host exists, is reachable, or has
//!   the key someone expects, and `discoveryIncomplete` says the list itself may be
//!   partial.
//! - **a target is not a session.** A target says where Git would run and how a rebuilt
//!   one is told apart from the previous one; connecting to it is what produces a
//!   session, and that has its own lifecycle.

use serde::{Deserialize, Serialize};

/// Where Git runs: this machine, or a specific host the user selected from their own SSH
/// configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionTargetKind {
    Local,
    SshConfig,
}

/// Connection state of one execution target.
///
/// Only `ready` may be read from; `unavailable` carries a problem rather than an empty
/// result, so a client never shows "nothing here" for a target it could not reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionTargetState {
    Idle,
    Connecting,
    Ready,
    Unavailable,
}

/// Something the host could not fully account for while answering — a conditional
/// `Include` it will not evaluate, a file it could not read. Warnings accompany a partial
/// answer; they are not errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostWarning {
    pub code: String,
    pub message: String,
}

/// One concrete alias read from an SSH configuration source. It is a candidate, not a
/// verified machine: nothing here proves the host exists, is reachable, or has the key
/// the user thinks it has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshHostCandidate {
    pub host_id: String,
    pub source_id: String,
    pub alias: String,
    pub display_label: String,
    /// True when the source set this came from was only partially enumerated, so more
    /// aliases may exist that this list cannot show.
    pub discovery_incomplete: bool,
}

/// Host aliases read from configuration files, with the revision of the source set they
/// came from.
///
/// Reading this never contacts a server and never executes configuration: an SSH config
/// may contain a `Match exec` or a `ProxyCommand`, and a listing that evaluated them
/// would be running the user's configuration rather than reading it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SshHostList {
    pub hosts: Vec<SshHostCandidate>,
    pub warnings: Vec<HostWarning>,
    pub revision: String,
}

/// One target a session can run Git against.
///
/// `generation` changes when the target is rebuilt — a re-read of configuration, a
/// reconnect — and invalidates snapshots, cursors and previews bound to the previous one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionTargetSummary {
    pub target_id: String,
    pub kind: ExecutionTargetKind,
    pub label: String,
    pub state: ExecutionTargetState,
    /// True only where the host can enumerate directories on the *remote* side. A local
    /// target has nothing remote to browse.
    pub remote_path_browse: bool,
    pub generation: String,
}

/// What the host can do about targets and machines.
///
/// A client reads this to decide what to offer, so a false is a missing feature and never
/// a silently failing control. `localFolderPicker` is true only where the host can open a
/// real OS directory dialog; a browser uses the path picker instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostCapabilities {
    pub ssh_config: bool,
    pub local_folder_picker: bool,
    pub uncertain_operation_acknowledgement: bool,
    pub target_kinds: Vec<ExecutionTargetKind>,
}

// Not defined here yet: `CreateTargetRequest`.
//
// Its TypeScript form is a union whose two `ssh-config` variants differ only by which of
// `hostId` or `sourceId`+`manualAlias` they carry, which is a shape this crate can only
// project once something serves it — and nothing does until a provider can actually open
// the target it creates. Adding a Rust type that no code path can honour would be the
// first place this projection claims a capability the build does not have.
