//! Where a host keeps the private state that has to outlive it.
//!
//! The operation journal is the reason this exists. A write whose result is unknown blocks
//! further writes *until a person acknowledges it*, and that block is only worth anything if
//! the record is still there after the process that created it is gone — so the default has
//! to be a durable per-user location, not a temporary directory the system may clear.
//!
//! The rule is the same one the Node host implements in
//! `packages/host-node/src/registry/roots.ts`: `REFYARD_STATE_DIR` first (how a fixture or a
//! portable install pins it), then the platform's own per-user location. Two hosts of the
//! same product must not disagree about where a person's state is, and a test that drives
//! this function has to be able to name a directory that is not the machine's.

use std::path::{Path, PathBuf};

/// The environment variable that names the state directory outright.
pub const STATE_DIR_VARIABLE: &str = "REFYARD_STATE_DIR";

/// What the state directory's name is under any of the platform roots.
const PRODUCT_DIRECTORY: &str = "refyard";

/// The fallback used only when there is no home to speak of — a container, or a process
/// whose environment was scrubbed. It is named here so it is a decision, not an accident.
const FALLBACK: &str = "refyard-state";

/// Resolves the state directory from an environment and an operating system name.
///
/// `os` is `std::env::consts::OS` in production and a literal in tests, so every branch can
/// be exercised on one machine instead of being a claim about a platform nobody ran.
pub fn default_state_root(environment: &[(String, String)], os: &str) -> PathBuf {
    if let Some(explicit) = non_empty(environment, STATE_DIR_VARIABLE) {
        return PathBuf::from(explicit);
    }
    let home = non_empty(environment, "HOME").or_else(|| non_empty(environment, "USERPROFILE"));
    match os {
        "macos" => match home {
            Some(home) => Path::new(home)
                .join("Library")
                .join("Application Support")
                .join(PRODUCT_DIRECTORY),
            None => temporary(environment),
        },
        "windows" => match non_empty(environment, "LOCALAPPDATA") {
            Some(local) => Path::new(local).join(PRODUCT_DIRECTORY),
            None => match home {
                Some(home) => Path::new(home)
                    .join("AppData")
                    .join("Local")
                    .join(PRODUCT_DIRECTORY),
                None => temporary(environment),
            },
        },
        _ => match non_empty(environment, "XDG_STATE_HOME") {
            Some(xdg) => Path::new(xdg).join(PRODUCT_DIRECTORY),
            None => match home {
                Some(home) => Path::new(home)
                    .join(".local")
                    .join("state")
                    .join(PRODUCT_DIRECTORY),
                None => temporary(environment),
            },
        },
    }
}

fn temporary(environment: &[(String, String)]) -> PathBuf {
    let base = non_empty(environment, "TMPDIR").unwrap_or("/tmp");
    Path::new(base).join(FALLBACK)
}

/// An environment value, but only when it can be used as a path.
///
/// An empty value is how a shell spells "unset" and would become a path of nothing; the
/// behaviours it selects are the ones that need no variable at all.
fn non_empty<'a>(environment: &'a [(String, String)], name: &str) -> Option<&'a str> {
    environment
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(values: &[(&str, &str)]) -> Vec<(String, String)> {
        values
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn root(values: &[(&str, &str)], os: &str) -> PathBuf {
        default_state_root(&environment(values), os)
    }

    // Prevents: a fixture or a portable install pinned by REFYARD_STATE_DIR writing into
    // the person's real state directory, where a second copy of the journal would then have
    // to be reconciled by hand.
    #[test]
    fn an_explicit_state_directory_wins_over_every_platform_default() {
        assert_eq!(
            root(
                &[
                    ("REFYARD_STATE_DIR", "/var/tmp/refyard-explicit"),
                    ("HOME", "/home/someone")
                ],
                "macos"
            ),
            PathBuf::from("/var/tmp/refyard-explicit")
        );
    }

    // Prevents: the journal living in a purgeable temporary directory (which is what the
    // Node host did before this rule), so a block left by a crash disappears with the
    // system's own cleanup and the next process reports a clean machine.
    #[test]
    fn macos_uses_application_support_and_linux_uses_the_state_home() {
        assert_eq!(
            root(&[("HOME", "/Users/someone")], "macos"),
            PathBuf::from("/Users/someone/Library/Application Support/refyard")
        );
        assert_eq!(
            root(
                &[
                    ("HOME", "/home/someone"),
                    ("XDG_STATE_HOME", "/home/someone/.state")
                ],
                "linux"
            ),
            PathBuf::from("/home/someone/.state/refyard")
        );
        assert_eq!(
            root(&[("HOME", "/home/someone")], "linux"),
            PathBuf::from("/home/someone/.local/state/refyard")
        );
    }

    #[test]
    fn windows_uses_local_app_data() {
        assert_eq!(
            root(
                &[
                    ("USERPROFILE", "C:\\Users\\someone"),
                    ("LOCALAPPDATA", "C:\\Users\\someone\\AppData\\Local")
                ],
                "windows"
            ),
            PathBuf::from("C:\\Users\\someone\\AppData\\Local").join("refyard")
        );
        assert_eq!(
            root(&[("USERPROFILE", "C:\\Users\\someone")], "windows"),
            PathBuf::from("C:\\Users\\someone")
                .join("AppData")
                .join("Local")
                .join("refyard")
        );
    }

    // Prevents: a container or a scrubbed environment failing to start over a variable
    // that is simply absent. The fallback is still a named directory.
    #[test]
    fn a_scrubbed_environment_falls_back_to_a_named_directory() {
        assert_eq!(
            root(&[("TMPDIR", "/var/tmp/x")], "linux"),
            PathBuf::from("/var/tmp/x/refyard-state")
        );
        assert_eq!(root(&[], "linux"), PathBuf::from("/tmp/refyard-state"));
    }

    // Prevents: an empty value — which is how a shell spells "unset" — being taken as the
    // directory, which would put the journal in the process's working directory.
    #[test]
    fn an_empty_value_selects_the_default_it_cannot_name() {
        assert_eq!(
            root(
                &[("REFYARD_STATE_DIR", ""), ("HOME", "/home/someone")],
                "linux"
            ),
            PathBuf::from("/home/someone/.local/state/refyard")
        );
    }
}
