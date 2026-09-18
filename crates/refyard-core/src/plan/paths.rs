//! Planners for the path-scoped writes: stage and unstage.
//!
//! Two rules are implemented here, and both exist because of a way a Git client gets
//! dangerous:
//!
//! 1. **A path from the user is a path, not a pattern.** `--literal-pathspecs` is set on
//!    every command that receives one, so a file called `:(glob)**` or `*.txt` stages
//!    that file rather than expanding to a set nobody selected.
//! 2. **Paths travel as bytes on stdin, never interpolated into argv.** The list is
//!    NUL-delimited (`--pathspec-from-file=-` with `--pathspec-file-nul`), so a name
//!    containing a newline, a quote or a leading `-` cannot become a second argument or
//!    a flag — and `--` closes the option list even where a Git version ignores one of
//!    the two.
//!
//! Both are the strategies the Node reference's `planStage`/`planUnstage`/
//! `planUnstageUnborn` promise; the argument vectors here are the same, in the same
//! order, so the SSH transport sends the command the local transport runs.

use crate::problem::CoreError;

use super::{DeadlineClass, GitPlan};

/// NUL-joins raw path bytes for `--pathspec-from-file=- --pathspec-file-nul`.
///
/// A trailing NUL after every path, including the last: this is the format Git's
/// `--pathspec-file-nul` defines, and a last entry without one would be dropped by a Git
/// that only commits a pathspec at a terminator.
pub fn pathspec_stdin(paths: &[Vec<u8>]) -> Vec<u8> {
    let mut stdin = Vec::with_capacity(paths.iter().map(|path| path.len() + 1).sum());
    for path in paths {
        stdin.extend_from_slice(path);
        stdin.push(0);
    }
    stdin
}

/// The argument vector every path-scoped write shares: literal pathspecs, the path list
/// on stdin, NUL framing, and `--` before anything could be read as an option.
fn pathspec_plan(verb: &[&str], paths: &[Vec<u8>]) -> GitPlan {
    let mut argv: Vec<String> = vec!["--literal-pathspecs".to_string()];
    argv.extend(verb.iter().map(|value| (*value).to_string()));
    argv.push("--pathspec-from-file=-".to_string());
    argv.push("--pathspec-file-nul".to_string());
    argv.push("--".to_string());
    GitPlan {
        argv,
        stdin: pathspec_stdin(paths),
        // Staging runs the user's hooks, filters and signer, so it gets the hook
        // deadline rather than a read's.
        deadline_class: DeadlineClass::Hook,
    }
}

/// `git add` for exactly the selected paths.
///
/// Nothing here stages implicitly: the paths named are the paths staged, and the index
/// entries for every other changed path are left as they are.
pub fn plan_stage(paths: &[Vec<u8>]) -> GitPlan {
    pathspec_plan(&["add"], paths)
}

/// `git restore --staged` for the selected paths: the index only, working tree untouched.
///
/// `--source=HEAD` is deliberately absent. Unstage means "make the index match HEAD", and
/// spelling the source would make this plan wrong for a repository whose HEAD is a ref
/// that has not been created yet; that case is [`plan_unstage_unborn`].
pub fn plan_unstage(paths: &[Vec<u8>]) -> GitPlan {
    pathspec_plan(&["restore", "--staged"], paths)
}

/// Unstage in a repository with no commits: remove the entries from the index.
///
/// `git restore --staged` needs a HEAD to restore from, and an unborn branch has none, so
/// this is a separate plan rather than a flag on the previous one: the difference is
/// exactly the kind of thing that silently leaves an empty repository if it is inferred.
/// It removes index entries only — the working-tree files are not touched.
pub fn plan_unstage_unborn(paths: &[Vec<u8>]) -> GitPlan {
    pathspec_plan(&["rm", "--cached", "-r"], paths)
}

/// Refuses a path list that would produce a command with nothing to do.
///
/// `git add` with an empty pathspec list stages everything under the current directory,
/// which is the opposite of "the paths the user selected". Every caller runs this before
/// planning, so an empty selection is a typed refusal rather than a whole-repository add.
pub fn require_paths(paths: &[Vec<u8>]) -> Result<(), CoreError> {
    if paths.is_empty() {
        return Err(CoreError::invalid_input(
            "a path-scoped write needs at least one path",
        ));
    }
    for path in paths {
        if path.contains(&0) {
            return Err(CoreError::unsupported_path_encoding(
                "pathspec",
                "a path containing NUL cannot address a file on any POSIX host",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<Vec<u8>> {
        values
            .iter()
            .map(|value| value.as_bytes().to_vec())
            .collect()
    }

    #[test]
    fn stage_passes_literal_pathspecs_on_stdin_with_nul_framing() {
        // Prevents: `git add` reading a file called `:(glob)**` as a pattern, and a path
        // containing a newline splitting into two pathspecs.
        let plan = plan_stage(&paths(&["a.txt", ":(glob)**", "line\nbreak.txt"]));
        assert_eq!(
            plan.argv,
            vec![
                "--literal-pathspecs",
                "add",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
                "--"
            ]
        );
        assert_eq!(
            plan.stdin,
            b"a.txt\0:(glob)**\0line\nbreak.txt\0".to_vec(),
            "the path list is bytes on stdin, so no quoting or length rule applies"
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
    }

    #[test]
    fn unstage_restores_the_index_only_and_unborn_removes_the_entries() {
        // The two plans differ by design; inferring one from the other is how an unborn
        // repository ends up with its files deleted or its index untouched.
        let staged = plan_unstage(&paths(&["a.txt"]));
        assert_eq!(staged.argv[1], "restore");
        assert_eq!(staged.argv[2], "--staged");
        assert!(
            !staged.argv.contains(&"--source=HEAD".to_string()),
            "an explicit source is what an unborn repository cannot answer"
        );

        let unborn = plan_unstage_unborn(&paths(&["a.txt"]));
        assert_eq!(
            unborn.argv,
            vec![
                "--literal-pathspecs",
                "rm",
                "--cached",
                "-r",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
                "--"
            ],
            "`rm --cached` removes index entries and never touches the working tree"
        );
        assert_eq!(unborn.stdin, b"a.txt\0".to_vec());
    }

    #[test]
    fn an_empty_selection_or_a_nul_in_a_path_is_refused_before_a_command_exists() {
        // An empty path list is an `add` of everything, which is not what the caller
        // asked for; NUL cannot travel through a pathspec on stdin.
        assert!(require_paths(&[]).is_err());
        assert!(require_paths(&[b"bad\0name".to_vec()]).is_err());
        assert!(require_paths(&paths(&["a.txt"])).is_ok());
    }
}
