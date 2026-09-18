//! POSIX single-quote encoding for the one string SSH exec gives us.
//!
//! `ssh host <command>` sends a *command string*, not an argument vector: whatever is
//! written there is re-parsed by the remote login shell. Every value this crate places in
//! that string therefore goes through `quote_posix` first, so a path or an argument
//! containing a space, an apostrophe, a `$` or a newline is one literal word on the far
//! side rather than syntax for the shell to act on. Nothing here starts a shell locally,
//! and nothing is ever handed to `eval`.

use refyard_contract::problem::{Problem, ProblemCode};

use super::HostError;

/// Encodes one value as a single POSIX shell word.
///
/// The encoding is `'` … `'` with every embedded `'` written as `'"'"'`: close the
/// single-quoted span, open a double-quoted span holding one apostrophe, close it, and
/// reopen the single-quoted span. A single-quoted POSIX word can contain every byte
/// except `'`, so this escape is complete and a quoted value can never end its own word.
///
/// A value containing NUL is refused. NUL terminates a C string, so a command string
/// carrying one would be silently truncated by the remote shell or the kernel rather than
/// reaching the program; refusing here means no process starts with a command that says
/// something other than what the caller asked for.
pub fn quote_posix(value: &str) -> Result<String, HostError> {
    if value.contains('\0') {
        return Err(Problem::new(
            ProblemCode::UnsupportedPathEncoding,
            "a value containing NUL cannot be sent as an SSH command string",
        ));
    }
    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('\'');
    for character in value.chars() {
        if character == '\'' {
            quoted.push_str("'\"'\"'");
        } else {
            quoted.push(character);
        }
    }
    quoted.push('\'');
    Ok(quoted)
}

/// The fixed remote template: `git -C <quoted path> <quoted arguments…>`.
///
/// The template is the whole command the remote login shell parses. There is no `eval`,
/// no variable, no redirection and no separator: the only thing between `git -C` and the
/// arguments is quoting, so a path or an argument cannot become a second statement or an
/// option.
///
/// An empty repository path is refused rather than passed: `git -C ''` does not mean "the
/// directory I was told", and the caller that lost the path has a bug that a clean refusal
/// surfaces. An empty argument vector is refused for the same reason — a bare `git -C …`
/// is not a command this host ever planned.
pub fn remote_git_command(repo_path: &str, argv: &[String]) -> Result<String, HostError> {
    if repo_path.is_empty() {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "a remote git command needs a non-empty repository path",
        ));
    }
    if argv.is_empty() {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            "a remote git command needs at least one argument",
        ));
    }
    let mut command = format!("git -C {}", quote_posix(repo_path)?);
    for argument in argv {
        command.push(' ');
        command.push_str(&quote_posix(argument)?);
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_apostrophe_leaves_and_reopens_the_single_quoted_word() {
        assert_eq!(quote_posix("a'b").expect("quotable"), "'a'\"'\"'b'");
    }

    #[test]
    fn a_nul_is_refused_before_a_process_could_start() {
        let error = quote_posix("bad\0path").expect_err("NUL is not representable");
        assert_eq!(error.code, ProblemCode::UnsupportedPathEncoding);
    }

    #[test]
    fn an_empty_value_is_one_empty_word_rather_than_no_word() {
        // Interpolating an empty value unquoted would drop the argument entirely and
        // shift every following argument into the wrong position.
        assert_eq!(quote_posix("").expect("quotable"), "''");
    }

    #[test]
    fn the_template_quotes_the_path_and_each_argument() {
        let argv = vec!["status".to_string(), "--porcelain=v2".to_string()];
        assert_eq!(
            remote_git_command("/srv/a b", &argv).expect("quotable"),
            "git -C '/srv/a b' 'status' '--porcelain=v2'"
        );
    }

    #[test]
    fn a_missing_path_or_an_empty_argument_vector_is_refused_rather_than_guessed_at() {
        let argv = vec!["status".to_string()];
        assert_eq!(
            remote_git_command("", &argv).expect_err("no path").code,
            ProblemCode::InvalidRequest
        );
        assert_eq!(
            remote_git_command("/srv/repo", &[])
                .expect_err("no argv")
                .code,
            ProblemCode::InvalidRequest
        );
    }
}
