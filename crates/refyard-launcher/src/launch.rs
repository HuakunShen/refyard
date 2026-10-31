//! Which executable to start, and with which directories.
//!
//! The launcher ships inside the application bundle, so it can name the app it belongs to
//! without a search path, a registry lookup or a stored preference: the bundle's own main
//! executable is its sibling (macOS `Contents/MacOS/Refyard`) and, for a development build
//! or a platform that installs flat, a known name beside the launcher's own file. That is
//! the whole resolution — a machine with no app at that place gets a refusal naming what
//! was looked for, never a guess at some other `refyard`.
//!
//! Paths are resolved here, against the directory the person typed in, and only here: the
//! window must receive an absolute directory, because the process it starts does not share
//! the launcher's working directory.

use std::path::{Path, PathBuf};

/// What to start: the application executable and the directories it should open.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub directories: Vec<PathBuf>,
}

/// The names tried beside the launcher on desktops that install it flat.
///
/// The bundle's product name first (what a macOS bundle and a Linux AppImage call the
/// window), then the Cargo binary name, which is what a development build produces.
fn sibling_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["Refyard.exe", "refyard-desktop.exe"]
    } else {
        &["Refyard", "refyard-desktop"]
    }
}

/// The application executable this launcher belongs to.
///
/// `executable` is `std::env::current_exe`, which on macOS reports the path the person ran
/// — including the `~/.local/bin/refyard` symlink — so it is resolved through links here
/// before anything is looked for beside it.
pub fn program_for(executable: &Path) -> Result<PathBuf, String> {
    // Resolve the launcher's own path first. A command installed into `PATH` is a symlink
    // into the bundle, and `current_exe` answers with the link on macOS — so without this
    // step the search would look for the app beside `~/.local/bin` instead of beside the
    // binary the person actually ran.
    let executable = std::fs::canonicalize(executable).unwrap_or_else(|_| executable.to_path_buf());
    let directory = executable.parent().ok_or_else(|| {
        format!(
            "{} is not a path this launcher can read an application from",
            executable.display()
        )
    })?;
    // The launcher must never answer with itself. On a case-insensitive filesystem —
    // macOS by default — probing `Refyard` beside a launcher named `refyard` opens the
    // launcher again, and `refyard` would fork itself forever.
    let own = executable.as_path();
    if let Some(bundled) = bundle_program(directory) {
        if is_other_file(&bundled, own) {
            return Ok(bundled);
        }
    }
    for name in sibling_names() {
        let candidate = directory.join(name);
        if is_other_file(&candidate, own) {
            return Ok(candidate);
        }
    }
    let tried = sibling_names()
        .iter()
        .map(|name| directory.join(name).display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "no Refyard application beside this command (looked for {tried}); \
         install the desktop app, or run the one inside its bundle"
    ))
}

/// Whether `candidate` is a readable file that is not the launcher itself.
///
/// The comparison is by canonical path because a name is not an identity: a
/// case-insensitive volume, or a symlink, can make the launcher answer with itself.
fn is_other_file(candidate: &Path, own: &Path) -> bool {
    if !candidate.is_file() {
        return false;
    }
    match std::fs::canonicalize(candidate) {
        Ok(found) => found != own,
        // A file whose canonical path cannot be read is not one this launcher can start.
        Err(_) => false,
    }
}

/// The bundle's main executable, when the launcher sits inside `Contents/MacOS` of an
/// `.app`. The bundle's own name is the executable's name: a renamed `Refyard.app` still
/// names its binary the same way.
fn bundle_program(launcher_directory: &Path) -> Option<PathBuf> {
    let contents = launcher_directory.parent()?;
    let bundle = contents.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    if bundle.extension()? != "app" {
        return None;
    }
    Some(launcher_directory.join(bundle.file_stem()?))
}

/// Turns what the person typed into absolute directories.
///
/// A relative operand is relative to the directory the command ran in, which is why `cwd`
/// is a parameter rather than something read here. Every directory must exist: a typo is
/// reported at the prompt that made it, instead of arriving in the window as an unnamed
/// failure after the launcher has already exited.
pub fn resolve_directories(requested: &[String], cwd: &Path) -> Result<Vec<PathBuf>, String> {
    let mut resolved = Vec::with_capacity(requested.len());
    for request in requested {
        let named = if Path::new(request).is_absolute() {
            PathBuf::from(request)
        } else {
            cwd.join(request)
        };
        let canonical = std::fs::canonicalize(&named).map_err(|problem| {
            format!(
                "cannot open {} ({problem}); pass a directory that exists",
                named.display()
            )
        })?;
        if !canonical.is_dir() {
            return Err(format!("{} is not a directory", canonical.display()));
        }
        resolved.push(canonical);
    }
    Ok(resolved)
}

/// Everything needed to start the window, decided without starting it.
pub fn plan(requested: &[String], executable: &Path, cwd: &Path) -> Result<Launch, String> {
    Ok(Launch {
        program: program_for(executable)?,
        directories: resolve_directories(requested, cwd)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch() -> tempfile::TempDir {
        tempfile::tempdir().expect("a temporary directory")
    }

    // Prevents: a symlinked `refyard` in PATH resolving the application to `~/.local/bin`
    // — where no app exists — instead of to the bundle the binary was installed from.
    #[test]
    fn a_launcher_inside_a_bundle_names_the_bundles_own_executable() {
        let root = scratch();
        let binary_directory = root
            .path()
            .join("Refyard.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&binary_directory).expect("the bundle layout");
        let app = binary_directory.join("Refyard");
        fs::write(&app, b"fixture").expect("the app executable");

        let found = program_for(&binary_directory.join("refyard-launcher"))
            .expect("the bundle answers for itself");
        assert_eq!(
            std::fs::canonicalize(found).expect("canonical app"),
            std::fs::canonicalize(&app).expect("canonical app")
        );
    }

    // Prevents: the one flow the PATH install actually produces — `refyard` is a symlink
    // in `~/.local/bin` — being unable to find the bundle, because the search looked beside
    // the link instead of beside the binary it points at. macOS's `current_exe` answers with
    // the link, so this is the normal case, not an edge one.
    #[cfg(unix)]
    #[test]
    fn a_command_installed_on_path_reaches_its_bundle_through_the_link() {
        use std::os::unix::fs::symlink;

        let root = scratch();
        let binary_directory = root
            .path()
            .join("Refyard.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&binary_directory).expect("the bundle layout");
        let app = binary_directory.join("Refyard");
        fs::write(&app, b"fixture").expect("the app executable");
        let launcher = binary_directory.join("refyard-launcher");
        fs::write(&launcher, b"fixture").expect("the launcher");

        let installed_directory = root.path().join("home").join(".local").join("bin");
        fs::create_dir_all(&installed_directory).expect("the install directory");
        let installed = installed_directory.join("refyard");
        symlink(&launcher, &installed).expect("the installed command");

        assert_eq!(
            std::fs::canonicalize(
                program_for(&installed).expect("the bundle answers through the link")
            )
            .expect("canonical app"),
            std::fs::canonicalize(&app).expect("canonical app")
        );
    }

    // Prevents: a development build, or a Linux install that puts both binaries in one
    // directory, being told the application is missing.
    #[test]
    fn a_flat_install_finds_the_application_beside_the_launcher() {
        let root = scratch();
        let launcher = root.path().join(if cfg!(windows) {
            "refyard-launcher.exe"
        } else {
            "refyard-launcher"
        });
        fs::write(&launcher, b"fixture").expect("the launcher");
        let name = sibling_names()[1];
        let app = root.path().join(name);
        fs::write(&app, b"fixture").expect("the app");

        assert_eq!(
            std::fs::canonicalize(program_for(&launcher).expect("the sibling answers"))
                .expect("canonical app"),
            std::fs::canonicalize(&app).expect("canonical app")
        );
    }

    // Prevents: a refusal that does not say what it looked for, and — on a
    // case-insensitive volume, where `Refyard` and `refyard` are one file — the launcher
    // finding itself and fork-bombing instead of reporting a broken install.
    #[test]
    fn a_missing_application_names_what_was_looked_for_and_is_never_itself() {
        let root = scratch();
        let launcher = root.path().join("refyard-launcher");
        fs::write(&launcher, b"fixture").expect("the launcher");
        let refusal = program_for(&launcher).expect_err("nothing to start");
        assert!(refusal.contains("Refyard"), "{refusal}");
    }

    #[test]
    fn relative_directories_are_resolved_against_the_working_directory() {
        let root = scratch();
        let repository = root.path().join("repo");
        fs::create_dir(&repository).expect("the repository directory");

        let resolved = resolve_directories(&["repo".to_string()], root.path()).expect("resolved");
        assert_eq!(
            resolved,
            vec![std::fs::canonicalize(&repository).expect("canonical")]
        );
    }

    // Prevents: the window opening on a directory the person did not name because the
    // operand was a typo, or on a file.
    #[test]
    fn a_missing_or_non_directory_operand_is_refused_at_the_prompt() {
        let root = scratch();
        let file = root.path().join("file.txt");
        fs::write(&file, b"fixture").expect("the file");

        let missing = resolve_directories(&["nope".to_string()], root.path())
            .expect_err("a missing directory");
        assert!(missing.contains("nope"), "{missing}");

        let not_a_directory = resolve_directories(&["file.txt".to_string()], root.path())
            .expect_err("a file is not a directory");
        assert!(
            not_a_directory.contains("not a directory"),
            "{not_a_directory}"
        );
    }

    // Prevents: the window receiving a path through a symlink while the person, and the
    // repository's own display path, name the directory it points at.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_operand_resolves_to_the_directory_it_names() {
        use std::os::unix::fs::symlink;

        let root = scratch();
        let real = root.path().join("real");
        fs::create_dir(&real).expect("the real directory");
        let link = root.path().join("link");
        symlink(&real, &link).expect("the symlink");

        let resolved = resolve_directories(&["link".to_string()], root.path()).expect("resolved");
        assert_eq!(
            resolved,
            vec![std::fs::canonicalize(&real).expect("canonical")]
        );
    }

    #[test]
    fn a_plan_carries_both_halves_and_refuses_nothing_it_was_given() {
        let root = scratch();
        let binary_directory = root
            .path()
            .join("Refyard.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&binary_directory).expect("the bundle layout");
        let app = binary_directory.join("Refyard");
        fs::write(&app, b"fixture").expect("the app executable");
        let repository = root.path().join("repo");
        fs::create_dir(&repository).expect("the repository");

        let plan = plan(
            &[repository.display().to_string()],
            &binary_directory.join("refyard-launcher"),
            root.path(),
        )
        .expect("a plan");
        assert_eq!(
            std::fs::canonicalize(plan.program).expect("canonical app"),
            std::fs::canonicalize(&app).expect("canonical app")
        );
        assert_eq!(
            plan.directories,
            vec![std::fs::canonicalize(&repository).expect("canonical")]
        );
    }
}
