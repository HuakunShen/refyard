//! The environment a Git command runs in.
//!
//! Two failure modes make this a module rather than a convenience:
//!
//! - **Inheriting everything is a correctness bug.** `GIT_DIR`, `GIT_WORK_TREE`,
//!   `GIT_INDEX_FILE` and `GIT_COMMON_DIR` redirect a command at a different
//!   repository than the one the user approved; `GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`
//!   and `GIT_ASKPASS` replace the program Git runs with one we did not choose. A
//!   developer machine and a CI runner both have such variables set often enough that
//!   "it worked on my machine" would otherwise be a real class of bug.
//! - **Inheriting nothing is also a bug.** Git needs `PATH`, and SSH needs the agent
//!   socket; a command started without them fails in a way that looks like a missing
//!   credential.
//!
//! So the rule is an allow-list plus forced values, and the list is here in one place
//! so it can be read and tested rather than inferred from a call site.

/// Variables passed through from the host process when present.
///
/// `SSH_AUTH_SOCK`/`SSH_AGENT_PID` are here on purpose: the user's key agent is the
/// intended way for SSH to authenticate, and hiding it would break the one
/// credential path this product supports.
pub const INHERITED: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "TZ",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
];

/// Values the host sets itself, overriding anything the environment claimed.
///
/// `GIT_TERMINAL_PROMPT=0` is not a preference: a command that stops to ask for a
/// password on a pipe nobody is reading would sit there until its deadline, and the
/// product has no way to answer it. Pagers are pinned because a pager would consume
/// the output the parser needs.
pub const FORCED: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GIT_PAGER", "cat"),
    ("PAGER", "cat"),
];

/// Builds the environment for one run: only the allowed names, then the forced values.
///
/// The source is passed in rather than read from the process, so a test can state the
/// dangerous input explicitly and so a provider can substitute another environment
/// (a fixture's own `HOME`, for instance) without changing this rule.
pub fn sanitized_environment(source: &[(String, String)]) -> Vec<(String, String)> {
    let mut result: Vec<(String, String)> = Vec::new();
    for (name, value) in source {
        if INHERITED.iter().any(|allowed| allowed == name) {
            result.push((name.clone(), value.clone()));
        }
    }
    for (name, value) in FORCED {
        match result.iter_mut().find(|(existing, _)| existing == name) {
            Some(entry) => entry.1 = (*value).to_string(),
            None => result.push(((*name).to_string(), (*value).to_string())),
        }
    }
    result
}

/// The same rule, applied to this process's own environment.
pub fn git_environment() -> Vec<(String, String)> {
    let source: Vec<(String, String)> = std::env::vars().collect();
    sanitized_environment(&source)
}
