//! The environment rule, stated as a test rather than a comment.
//!
//! A Git command started with an inherited environment is a command that may run
//! against a different repository (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`) or
//! execute a program we did not choose (`GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`,
//! `GIT_ASKPASS`). Both are silent: the command succeeds and the answer is wrong.
//!
//! The counterweight is that SSH needs the user's agent socket, so "drop everything"
//! is not an option either.

use refyard_host::process::{sanitized_environment, FORCED, INHERITED};

fn source(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect()
}

fn value_of<'a>(env: &'a [(String, String)], name: &str) -> Option<&'a str> {
    env.iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

#[test]
fn drops_every_variable_that_could_redirect_git() {
    let hostile = source(&[
        ("PATH", "/usr/bin:/bin"),
        ("HOME", "/Users/someone"),
        ("GIT_DIR", "/somewhere/else/.git"),
        ("GIT_WORK_TREE", "/somewhere/else"),
        ("GIT_INDEX_FILE", "/tmp/other.index"),
        ("GIT_COMMON_DIR", "/tmp/other-common"),
        ("GIT_OBJECT_DIRECTORY", "/tmp/other-objects"),
        ("GIT_ALTERNATE_OBJECT_DIRECTORIES", "/tmp/objects"),
        ("GIT_EXTERNAL_DIFF", "/tmp/evil-diff"),
        ("GIT_SSH_COMMAND", "ssh -o StrictHostKeyChecking=no"),
        ("GIT_ASKPASS", "/tmp/askpass"),
        ("GIT_CONFIG_GLOBAL", "/tmp/other.gitconfig"),
        ("GIT_CONFIG_SYSTEM", "/tmp/system.gitconfig"),
        ("GIT_PAGER", "less"),
        ("GIT_TERMINAL_PROMPT", "1"),
        ("GIT_NAMESPACE", "other"),
        ("PAGER", "less"),
    ]);
    let env = sanitized_environment(&hostile);
    for (name, _) in &hostile {
        if name == "PATH" || name == "HOME" {
            continue;
        }
        if FORCED.iter().any(|(forced, _)| forced == name) {
            continue;
        }
        assert!(
            value_of(&env, name).is_none(),
            "{name} reached the child process"
        );
    }
}

#[test]
fn keeps_the_agent_socket_and_the_path() {
    // Dropping these is the other failure: SSH would find no key, and Git no program.
    let env = sanitized_environment(&source(&[
        ("PATH", "/opt/homebrew/bin:/usr/bin:/bin"),
        ("HOME", "/Users/someone"),
        (
            "SSH_AUTH_SOCK",
            "/private/tmp/com.apple.launchd.agent/Listeners",
        ),
        ("SSH_AGENT_PID", "1234"),
        ("TMPDIR", "/var/folders/xx/T/"),
    ]));
    assert_eq!(
        value_of(&env, "PATH"),
        Some("/opt/homebrew/bin:/usr/bin:/bin")
    );
    assert_eq!(value_of(&env, "HOME"), Some("/Users/someone"));
    assert_eq!(
        value_of(&env, "SSH_AUTH_SOCK"),
        Some("/private/tmp/com.apple.launchd.agent/Listeners")
    );
    assert_eq!(value_of(&env, "SSH_AGENT_PID"), Some("1234"));
    assert_eq!(value_of(&env, "TMPDIR"), Some("/var/folders/xx/T/"));
}

#[test]
fn forces_the_values_that_keep_a_command_from_waiting_for_a_human() {
    // A `git` that stops to ask for a password on a pipe nobody reads would sit
    // there until its deadline, and the host has no way to answer it.
    let env = sanitized_environment(&source(&[
        ("PATH", "/usr/bin"),
        ("GIT_TERMINAL_PROMPT", "1"),
        ("GIT_PAGER", "less"),
        ("PAGER", "less"),
    ]));
    assert_eq!(value_of(&env, "GIT_TERMINAL_PROMPT"), Some("0"));
    assert_eq!(value_of(&env, "GIT_PAGER"), Some("cat"));
    assert_eq!(value_of(&env, "PAGER"), Some("cat"));
}

#[test]
fn adds_the_forced_values_even_when_the_source_omits_them() {
    let env = sanitized_environment(&source(&[("PATH", "/usr/bin")]));
    for (name, value) in FORCED {
        assert_eq!(value_of(&env, name), Some(*value), "{name} was not added");
    }
}

#[test]
fn an_empty_source_still_produces_a_usable_environment() {
    let env = sanitized_environment(&[]);
    assert_eq!(env.len(), FORCED.len());
    assert!(env.iter().any(|(name, _)| name == "GIT_TERMINAL_PROMPT"));
}

#[test]
fn the_inherited_list_is_a_prefix_of_what_the_allow_list_claims() {
    // Every name in INHERITED must actually survive a pass through sanitize, or the
    // documented list and the behaviour have drifted apart.
    let candidates: Vec<(String, String)> = INHERITED
        .iter()
        .map(|name| ((*name).to_string(), "value".to_string()))
        .collect();
    let env = sanitized_environment(&candidates);
    for name in INHERITED {
        assert_eq!(
            value_of(&env, name),
            Some("value"),
            "{name} is listed as inherited but was dropped"
        );
    }
}
