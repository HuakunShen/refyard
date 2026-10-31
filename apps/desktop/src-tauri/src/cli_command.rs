//! Putting the `refyard` command on the person's PATH.
//!
//! The bundle carries `refyard-launcher`; nobody wants to type
//! `/Applications/Refyard.app/Contents/MacOS/refyard-launcher .`, so this is the one-click
//! step every code editor ships: a link named `refyard` in a directory the shell already
//! searches. The link points at the bundled binary, which finds the app beside itself, so
//! an install stays correct when the app is updated in place and breaks visibly when the
//! app is deleted — never silently running some older copy.
//!
//! Two rules here are about not making things worse:
//!
//! - **nothing outside the person's home is written**, so there is no administrator prompt
//!   and no password to type. The cost is that `~/.local/bin` may not be on their PATH
//!   yet, which the answer says plainly, with the line to add.
//! - **an existing file is never replaced.** A regular file at the link's path is somebody
//!   else's command; it is reported, not clobbered. Only a link this action would have
//!   created is replaced, which is what makes a repeated install a no-op instead of an
//!   error.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// What the install did, in the shape the Settings sheet shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCommandInstall {
    /// True only when a `refyard` command now exists at `commandPath`.
    pub installed: bool,
    /// Where the command is, when one was installed.
    pub command_path: Option<String>,
    /// Whether that directory is on this process's `PATH`.
    ///
    /// A GUI process inherits the launch environment, not a login shell's, so this can be
    /// false while the person's own shell already finds the command. The message says
    /// which directory to look for rather than asserting what their shell will do.
    pub on_path: bool,
    /// What happened, or why it did not — the sentence the sheet shows.
    pub message: String,
}

/// The link's name: the command a person types, which is not the bundled binary's name.
///
/// macOS volumes are case-insensitive and the app's own executable is `Refyard`, so the
/// bundled copy is `refyard-launcher`; the link is where the short name lives.
pub const COMMAND_NAME: &str = "refyard";

/// The bundled launcher beside this process, when the bundle carries one.
///
/// `None` is an honest answer for a development build or a bundle built without the
/// command: the Settings sheet then says so instead of inventing a path.
pub fn bundled_launcher(executable: &Path) -> Option<PathBuf> {
    let directory = executable.parent()?;
    let name = if cfg!(windows) {
        "refyard-launcher.exe"
    } else {
        "refyard-launcher"
    };
    let candidate = directory.join(name);
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

/// Where the link goes: `<home>/.local/bin`, the per-user directory that needs no
/// administrator rights.
pub fn install_directory(home: &Path) -> PathBuf {
    home.join(".local").join("bin")
}

/// Whether a directory is on a `PATH`-shaped variable.
///
/// Entries are compared canonically when they resolve, so `/usr/bin/../local/bin` and
/// `/usr/local/bin` are the same entry, and lexically when they do not exist yet — which is
/// the case for a directory this action has only just created.
pub fn is_on_path(directory: &Path, path_variable: Option<&str>) -> bool {
    let Some(variable) = path_variable else {
        return false;
    };
    let wanted = std::fs::canonicalize(directory).unwrap_or_else(|_| directory.to_path_buf());
    variable
        .split(if cfg!(windows) { ';' } else { ':' })
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            let entry = PathBuf::from(entry);
            std::fs::canonicalize(&entry).unwrap_or(entry) == wanted
        })
}

/// The person's home directory, as this process sees it.
///
/// `HOME` is the Unix answer and `USERPROFILE` the Windows one. An empty value is not a
/// directory, so it is refused rather than becoming a link at `/.local/bin`.
pub fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|home| !home.as_os_str().is_empty())
}

/// Installs the command this build carries, from the process that carries it.
///
/// Every failure is an answer rather than an error: the Settings sheet shows what happened,
/// and nothing is left half-done — a link either exists at the reported path or it does not.
pub fn install_for_this_process() -> CliCommandInstall {
    let Some(home) = home_directory() else {
        return CliCommandInstall {
            installed: false,
            command_path: None,
            on_path: false,
            message: "this machine reports no home directory, so there is nowhere to install \
                      the command"
                .to_string(),
        };
    };
    let launcher = std::env::current_exe()
        .ok()
        .and_then(|executable| bundled_launcher(&executable));
    let Some(launcher) = launcher else {
        // Naming a path this process never found would be a guess dressed as evidence;
        // the sheet says what is true — this build does not carry the command.
        return CliCommandInstall {
            installed: false,
            command_path: None,
            on_path: false,
            message: format!(
                "this build carries no `{COMMAND_NAME}` command beside the application; reinstall \
                 the desktop app to get one"
            ),
        };
    };
    install(&launcher, &home, std::env::var("PATH").ok().as_deref())
}

/// Installs the command, or explains why it could not.
pub fn install(launcher: &Path, home: &Path, path_variable: Option<&str>) -> CliCommandInstall {
    install_platform(launcher, home, path_variable)
}

#[cfg(unix)]
fn install_platform(
    launcher: &Path,
    home: &Path,
    path_variable: Option<&str>,
) -> CliCommandInstall {
    let directory = install_directory(home);
    let link = directory.join(COMMAND_NAME);
    if !launcher.is_file() {
        return CliCommandInstall {
            installed: false,
            command_path: None,
            on_path: false,
            message: format!(
                "this build carries no `{COMMAND_NAME}` command (looked for {}); reinstall the \
                 desktop app to get one",
                launcher.display()
            ),
        };
    }
    if let Err(problem) = std::fs::create_dir_all(&directory) {
        return CliCommandInstall {
            installed: false,
            command_path: None,
            on_path: false,
            message: format!(
                "cannot create {} ({problem}); the command was not installed",
                directory.display()
            ),
        };
    }
    // An existing entry is replaced only when it is a link, and only because a link is
    // this action's own artefact — possibly pointing at an app that has since moved.
    match std::fs::symlink_metadata(&link) {
        Ok(metadata) if !metadata.file_type().is_symlink() => {
            return CliCommandInstall {
                installed: false,
                command_path: Some(link.display().to_string()),
                on_path: is_on_path(&directory, path_variable),
                message: format!(
                    "{} already exists and is not the link this would create; it was left alone",
                    link.display()
                ),
            };
        }
        Ok(_) => {
            let _ = std::fs::remove_file(&link);
        }
        Err(_) => {}
    }
    if let Err(problem) = std::os::unix::fs::symlink(launcher, &link) {
        return CliCommandInstall {
            installed: false,
            command_path: None,
            on_path: false,
            message: format!(
                "cannot create the link {} ({problem}); the command was not installed",
                link.display()
            ),
        };
    }
    let on_path = is_on_path(&directory, path_variable);
    let message = if on_path {
        format!(
            "`{COMMAND_NAME}` is installed at {}; open a directory with `{COMMAND_NAME} .`",
            link.display()
        )
    } else {
        format!(
            "`{COMMAND_NAME}` is installed at {}, which is not on this app's PATH. Add it in \
             your shell profile: export PATH=\"{}:$PATH\"",
            link.display(),
            directory.display()
        )
    };
    CliCommandInstall {
        installed: true,
        command_path: Some(link.display().to_string()),
        on_path,
        message,
    }
}

#[cfg(not(unix))]
fn install_platform(
    _launcher: &Path,
    _home: &Path,
    _path_variable: Option<&str>,
) -> CliCommandInstall {
    // Windows needs a registry write to extend the user's PATH, which this build does not
    // do — so it says so rather than claiming an install nothing will find.
    CliCommandInstall {
        installed: false,
        command_path: None,
        on_path: false,
        message: "installing the command into PATH is not supported on this platform yet"
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temporary directory")
    }

    #[cfg(unix)]
    #[test]
    fn an_install_creates_one_link_that_names_the_bundled_launcher() {
        let root = scratch();
        let bundle = root.path().join("bundle");
        std::fs::create_dir(&bundle).expect("the bundle directory");
        let launcher = bundle.join("refyard-launcher");
        std::fs::write(&launcher, b"fixture").expect("the launcher");
        let home = root.path().join("home");
        std::fs::create_dir(&home).expect("the home directory");

        let outcome = install(&launcher, &home, Some("/usr/bin:/bin"));
        assert!(outcome.installed, "{}", outcome.message);
        let link = install_directory(&home).join(COMMAND_NAME);
        assert_eq!(
            std::fs::read_link(&link).expect("the link"),
            launcher,
            "the link must name the bundled command, not a copy of it"
        );
        assert!(!outcome.on_path);
        // Prevents: a successful install that never tells the person why `refyard` is still
        // "command not found".
        assert!(outcome.message.contains("PATH"), "{}", outcome.message);
    }

    #[cfg(unix)]
    #[test]
    fn the_install_reports_that_the_directory_is_on_path_when_it_is() {
        let root = scratch();
        let launcher = root.path().join("refyard-launcher");
        std::fs::write(&launcher, b"fixture").expect("the launcher");
        let home = root.path().join("home");
        std::fs::create_dir(&home).expect("the home");
        let directory = install_directory(&home);
        let path = format!("/usr/bin:{}", directory.display());

        let outcome = install(&launcher, &home, Some(&path));
        assert!(outcome.installed, "{}", outcome.message);
        assert!(outcome.on_path);
        assert!(outcome.message.contains("`refyard` is installed"));
    }

    // Prevents: a second install failing, or a link that pointed at a moved app being kept.
    #[cfg(unix)]
    #[test]
    fn installing_again_replaces_its_own_link_and_nothing_else() {
        let root = scratch();
        let first = root.path().join("first").join("refyard-launcher");
        let second = root.path().join("second").join("refyard-launcher");
        std::fs::create_dir_all(first.parent().expect("parent")).expect("the first bundle");
        std::fs::create_dir_all(second.parent().expect("parent")).expect("the second bundle");
        std::fs::write(&first, b"fixture").expect("the first launcher");
        std::fs::write(&second, b"fixture").expect("the second launcher");
        let home = root.path().join("home");
        std::fs::create_dir(&home).expect("the home");

        assert!(install(&first, &home, None).installed);
        assert!(install(&second, &home, None).installed);
        assert_eq!(
            std::fs::read_link(install_directory(&home).join(COMMAND_NAME)).expect("the link"),
            second
        );
    }

    // Prevents: overwriting a hand-written script that happens to be called `refyard`.
    #[cfg(unix)]
    #[test]
    fn a_regular_file_at_the_commands_name_is_left_alone() {
        let root = scratch();
        let launcher = root.path().join("refyard-launcher");
        std::fs::write(&launcher, b"fixture").expect("the launcher");
        let home = root.path().join("home");
        let directory = install_directory(&home);
        std::fs::create_dir_all(&directory).expect("the install directory");
        let existing = directory.join(COMMAND_NAME);
        std::fs::write(&existing, b"#!/bin/sh\n").expect("the existing command");

        let outcome = install(&launcher, &home, None);
        assert!(!outcome.installed);
        assert!(
            outcome.message.contains("left alone"),
            "{}",
            outcome.message
        );
        assert_eq!(
            std::fs::read(&existing).expect("the existing command"),
            b"#!/bin/sh\n"
        );
    }

    #[test]
    fn a_bundle_without_the_command_says_so_instead_of_installing_nothing_quietly() {
        let root = scratch();
        let outcome = install(&root.path().join("refyard-launcher"), root.path(), None);
        assert!(!outcome.installed);
        assert!(outcome.message.contains("no `refyard` command"));
    }

    #[test]
    fn the_bundled_launcher_is_found_beside_the_running_process() {
        let root = scratch();
        let executable = root.path().join("Refyard");
        std::fs::write(&executable, b"fixture").expect("the executable");
        let launcher = root.path().join(if cfg!(windows) {
            "refyard-launcher.exe"
        } else {
            "refyard-launcher"
        });
        std::fs::write(&launcher, b"fixture").expect("the launcher");
        assert_eq!(bundled_launcher(&executable), Some(launcher));
        let elsewhere = root.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("another directory");
        assert_eq!(bundled_launcher(&elsewhere.join("Refyard")), None);
    }
}
