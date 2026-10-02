//! Locating the machine's own programs on PATH.
//!
//! PATH is not one format. Windows separates entries with `;` — so the colon of every
//! drive letter is data, not a delimiter — and names its executables with an `.exe`
//! extension; the other platforms separate with `:` and run extensionless files.
//! Resolving a program by one platform's rules on another machine finds nothing, and a
//! desktop shell that cannot find Git opens no window and prints to a stderr nobody
//! attached — the exact failure that shipped the Windows 0.2.x builds unable to start.
//!
//! The separator and the candidate name are chosen from an `os` argument spelled the way
//! `std::env::consts::OS` spells it, so every branch is exercised by a test on one
//! machine instead of being a claim about a platform nobody ran.

use std::path::{Path, PathBuf};

/// Finds `program` — named without extension — on a PATH-style variable.
///
/// The first directory holding the program wins, in PATH order: the person's PATH is how
/// they chose which Git runs, so shadowing is their decision, not this function's. An
/// empty entry means the current directory on paper; resolving it would run whatever
/// file sits wherever the process happened to start, so empty entries are skipped.
pub fn program(path_var: &str, program: &str, os: &str) -> Option<PathBuf> {
    let windows = os == "windows";
    let separator = if windows { ';' } else { ':' };
    for directory in path_var.split(separator) {
        if directory.is_empty() {
            continue;
        }
        // A Windows executable carries its extension in the file system; a file named
        // `git` with none is not the program the loader would run for `git`, so it is
        // not a match. Everywhere else the extensionless name is the executable.
        let name = if windows {
            format!("{program}.exe")
        } else {
            program.to_owned()
        };
        let candidate = Path::new(directory).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn executable(directory: &TempDir, name: &str) -> PathBuf {
        let path = directory.path().join(name);
        std::fs::write(&path, b"").expect("create the candidate file");
        path
    }

    // Discovery answers the path as PATH spelled it, which on a Windows host running a
    // unix-rule case has no drive letter (the fragment after `C:`): the same file, named
    // the way the current drive resolves it. Canonicalizing both sides compares the
    // files, not the spellings, so one test asserts every platform's branch anywhere.
    fn assert_found(found: Option<PathBuf>, expected: &Path) {
        let found = found.expect("the program is found");
        assert_eq!(
            found.canonicalize().unwrap(),
            expected.canonicalize().unwrap()
        );
    }

    // Prevents: the colon of a Windows drive letter being read as a PATH separator,
    // which cut every entry in two and left the installed Git unfindable — the shell
    // then exited before any window or message could say why.
    #[test]
    fn a_windows_path_splits_on_semicolons_and_finds_the_exe() {
        let elsewhere = TempDir::new().unwrap();
        let tools = TempDir::new().unwrap();
        let git = executable(&tools, "git.exe");
        let path_var = format!(
            "{};{};C:\\Program Files\\Git\\cmd",
            elsewhere.path().display(),
            tools.path().display()
        );
        assert_found(program(&path_var, "git", "windows"), &git);
    }

    // Prevents: an extensionless file named like the program being taken for the
    // Windows executable — the loader would not run it, so the discovery would hand
    // the provider a program that cannot execute.
    #[test]
    fn a_windows_program_is_found_only_with_its_extension() {
        let tools = TempDir::new().unwrap();
        executable(&tools, "git");
        let path_var = tools.path().display().to_string();
        assert!(program(&path_var, "git", "windows").is_none());
    }

    // Prevents: the Windows fix breaking the platforms the product already shipped on,
    // where PATH is colon-separated and the executable has no extension.
    #[test]
    fn unix_paths_still_split_on_colons_and_run_extensionless() {
        let tools = TempDir::new().unwrap();
        let git = executable(&tools, "git");
        let path_var = format!("/usr/bin:{}", tools.path().display());
        for os in ["linux", "macos"] {
            assert_found(program(&path_var, "git", os), &git);
        }
    }

    // PATH order is how a person chooses which program runs; a later entry winning
    // would silently substitute another installation of the same tool.
    #[test]
    fn the_first_directory_with_the_program_wins() {
        let first = TempDir::new().unwrap();
        let second = TempDir::new().unwrap();
        let git = executable(&first, "git");
        executable(&second, "git");
        let path_var = format!("{}:{}", first.path().display(), second.path().display());
        assert_found(program(&path_var, "git", "linux"), &git);
    }

    // Prevents: an empty PATH entry — the current directory on paper — resolving a
    // program relative to wherever the process happened to start.
    #[test]
    fn empty_entries_are_skipped_on_both_separators() {
        let tools = TempDir::new().unwrap();
        let git = executable(&tools, "git.exe");
        let windows_var = format!(";;{};;", tools.path().display());
        assert_found(program(&windows_var, "git", "windows"), &git);
        let git_unix = executable(&tools, "git");
        let unix_var = format!("::{}::", tools.path().display());
        assert_found(program(&unix_var, "git", "linux"), &git_unix);
    }

    #[test]
    fn nothing_is_found_when_no_directory_holds_the_program() {
        assert!(program("C:\\nowhere;C:\\elsewhere", "git", "windows").is_none());
        assert!(program("/nowhere:/elsewhere", "git", "linux").is_none());
        assert!(program("", "git", "windows").is_none());
    }
}
