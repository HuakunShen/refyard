//! The machine's own OpenSSH, described as data.
//!
//! Two things live here: the safety option set the execution policy fixes, and the
//! rendering of one local argument vector from it. Both are data so that dropping an
//! option is a failing test rather than an incident, and so that nothing above this module
//! can add, remove or reorder one.
//!
//! The vector is handed to `Command` directly. There is no local shell: the alias is one
//! element and the remote command string is another, so nothing here is exposed to local
//! word splitting. What the *remote* login shell does with the command string is
//! `quote`'s business; this module only guarantees which host is asked and which options
//! are in force when it is asked.

use std::path::{Path, PathBuf};

use refyard_contract::problem::{DetailValue, Problem, ProblemCode};

/// The option set the execution policy fixes, in the order the design lists it.
///
/// Every entry is a decision:
///
/// - no TTY is requested and `StdinNull` stays off, because `cat-file --batch` and
///   `--pathspec-from-file=-` need the byte stream the caller wrote;
/// - `BatchMode=yes` turns "nobody can answer a prompt" into a failed connection instead
///   of a command that waits for input nobody will type;
/// - the session type, remote command, forwarding and local-command options all disable a
///   feature this product does not use, so a user's configuration cannot turn a read into
///   a tunnel or a locally executed hook;
/// - `StrictHostKeyChecking=yes` is host verification on, and it stays on: nothing in this
///   crate may downgrade it, and a first-time trust is the user's to establish in their own
///   terminal;
/// - the connect and keepalive timeouts bound a dead peer below the attempt deadline.
///
/// `PermitLocalCommand=no` disables the local `~.`/`LocalCommand` escape hatch. It does
/// **not** disable `ProxyCommand`, `Match exec` or `KnownHostsCommand`, which are the
/// user's own configuration and may run local programs; that trust boundary is the user's
/// and this list must never be presented as if it closed it.
pub const SAFETY_OPTIONS: &[(&str, &str)] = &[
    ("BatchMode", "yes"),
    ("RequestTTY", "no"),
    ("RemoteCommand", "none"),
    ("SessionType", "default"),
    ("StdinNull", "no"),
    ("ForkAfterAuthentication", "no"),
    ("ClearAllForwardings", "yes"),
    ("ForwardAgent", "no"),
    ("ForwardX11", "no"),
    ("PermitLocalCommand", "no"),
    ("StrictHostKeyChecking", "yes"),
    ("ConnectTimeout", "15"),
    ("ServerAliveInterval", "15"),
    ("ServerAliveCountMax", "2"),
];

/// The flag that answers "do not request a PTY", which is not an `-o` option.
pub const NO_TTY_FLAG: &str = "-T";

/// The safety options rendered the way `ssh` reads them: `-T`, then `-o name=value` each.
pub fn base_options() -> Vec<String> {
    let mut options = Vec::with_capacity(1 + SAFETY_OPTIONS.len() * 2);
    options.push(NO_TTY_FLAG.to_string());
    for (name, value) in SAFETY_OPTIONS {
        options.push("-o".to_string());
        options.push(format!("{name}={value}"));
    }
    options
}

/// Refuses anything that is not a concrete host token.
///
/// The alias reaches `ssh` as one argument vector element, so it is not word-split
/// locally; the refusal is about what a *host token* may be. A leading `-` would make the
/// token parse as an option, and control characters, whitespace and shell metacharacters
/// are not part of any alias this product will act on. The rule is an allow-list rather
/// than a list of known-bad characters, so a character nobody thought of is refused too.
///
/// A hand-entered user or port is a separate field of the user's configuration, never
/// spliced into this token or into the option list.
pub fn validate_alias(alias: &str) -> Result<(), Problem> {
    let refuse = |reason: String| {
        Problem::new(
            ProblemCode::InvalidRequest,
            format!("the SSH host alias is not a concrete host token: {reason}"),
        )
    };
    if alias.is_empty() {
        return Err(refuse("it is empty".to_string()));
    }
    if alias.len() > 255 {
        return Err(refuse("it is longer than 255 bytes".to_string()));
    }
    if alias.starts_with('-') {
        return Err(refuse("it starts with '-'".to_string()));
    }
    for character in alias.chars() {
        let allowed =
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '@');
        if !allowed {
            return Err(refuse(format!(
                "it contains the character {character:?}, which is not part of a host token this host will act on"
            )));
        }
    }
    Ok(())
}

/// The complete local argument vector for one connect-and-exec.
///
/// The alias is validated here rather than by the caller so there is no path to `Command`
/// that skips it.
///
/// `config_file` is an explicitly chosen per-user configuration file. It is appended to the
/// fixed options rather than replacing any of them, so choosing a source can never drop a
/// safety option, and it is *not* a default: the machine's own configuration is used when
/// the caller passes `None`. Naming a file here changes which configuration is read at all
/// — OpenSSH skips the system-wide file and the user's default file when `-F` is given — so
/// it is the caller's explicit choice of a source, not a way to tune this invocation.
pub fn exec_argv(
    alias: &str,
    remote_command: &str,
    config_file: Option<&Path>,
) -> Result<Vec<String>, Problem> {
    validate_alias(alias)?;
    let mut argv = base_options();
    if let Some(path) = config_file {
        if !path.is_absolute() {
            return Err(Problem::new(
                ProblemCode::InvalidRequest,
                format!(
                    "the SSH configuration source {} is not an absolute path",
                    path.display()
                ),
            ));
        }
        argv.push("-F".to_string());
        argv.push(path.display().to_string());
    }
    argv.push(alias.to_string());
    argv.push(remote_command.to_string());
    Ok(argv)
}

/// Resolves the `ssh` executable once, at startup.
///
/// A path is resolved rather than a bare name passed to `Command`, so a later change to
/// `PATH` cannot swap the program between two commands of one session.
pub fn discover() -> Result<PathBuf, String> {
    let path = std::env::var("PATH").unwrap_or_default();
    for directory in path.split(':') {
        if directory.is_empty() {
            continue;
        }
        let candidate = Path::new(directory).join("ssh");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("ssh was not found on PATH".to_string())
}

/// The same resolution, as the typed problem a capability answer carries.
///
/// A machine with no OpenSSH cannot reach a remote repository, and saying so with the
/// reason is the whole answer: the local provider still works, so this refuses the SSH
/// transport rather than the host.
pub fn discover_program() -> Result<PathBuf, Problem> {
    discover().map_err(|diagnostic| {
        Problem::new(
            ProblemCode::Unavailable,
            "this machine's ssh could not be found, so remote repositories are unavailable",
        )
        .with_detail("diagnostic", DetailValue::Text(diagnostic))
    })
}

/// The environment an SSH command runs with, taken from this process.
///
/// The same allow-list the Git provider uses, for the same reasons: `HOME` is how OpenSSH
/// finds the user's configuration and `known_hosts`, and `SSH_AUTH_SOCK` is the supported
/// key path; everything else a hostile environment could set (`GIT_SSH_COMMAND`,
/// `GIT_DIR`) is dropped. A fixture substitutes its own vector rather than editing this
/// rule.
pub fn ssh_environment() -> Vec<(String, String)> {
    let source: Vec<(String, String)> = std::env::vars().collect();
    crate::process::sanitized_environment(&source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_option_list_is_exactly_the_policy_set_in_order() {
        // Hard-coded rather than derived from the constant: a test that renders the
        // constant it checks would pass with an option deleted from both.
        assert_eq!(
            base_options(),
            vec![
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "RequestTTY=no",
                "-o",
                "RemoteCommand=none",
                "-o",
                "SessionType=default",
                "-o",
                "StdinNull=no",
                "-o",
                "ForkAfterAuthentication=no",
                "-o",
                "ClearAllForwardings=yes",
                "-o",
                "ForwardAgent=no",
                "-o",
                "ForwardX11=no",
                "-o",
                "PermitLocalCommand=no",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "ConnectTimeout=15",
                "-o",
                "ServerAliveInterval=15",
                "-o",
                "ServerAliveCountMax=2",
            ]
        );
    }

    #[test]
    fn agent_forwarding_is_never_enabled() {
        // The one option whose value must never flip: this product does not forward the
        // user's key agent to a remote host.
        assert!(SAFETY_OPTIONS.contains(&("ForwardAgent", "no")));
        assert!(!base_options()
            .iter()
            .any(|option| option == "ForwardAgent=yes"));
    }

    #[test]
    fn a_host_token_cannot_look_like_an_option_or_carry_syntax() {
        assert!(validate_alias("prod-1.example_2@jump").is_ok());
        for refused in [
            "-oForwardAgent=yes",
            "prod host",
            "prod;rm",
            "prod$(id)",
            "prod\nhost",
            "prod'host",
            "prod*host",
            "",
        ] {
            let problem = validate_alias(refused).expect_err("refused");
            assert_eq!(problem.code, ProblemCode::InvalidRequest, "{refused:?}");
        }
    }

    #[test]
    fn the_command_string_is_one_element_after_the_alias() {
        let argv = exec_argv("prod", "git -C '/srv/a b' 'status'", None).expect("argv");
        assert_eq!(argv[argv.len() - 2], "prod");
        assert_eq!(argv[argv.len() - 1], "git -C '/srv/a b' 'status'");
        assert_eq!(argv.len(), base_options().len() + 2);
    }

    #[test]
    fn a_chosen_config_source_is_appended_and_never_replaces_a_safety_option() {
        let argv =
            exec_argv("prod", "true", Some(Path::new("/scratch/.ssh/config"))).expect("argv");
        // The fixed options keep their exact positions, with the source after them.
        assert_eq!(&argv[..base_options().len()], base_options().as_slice());
        assert_eq!(argv[base_options().len()], "-F");
        assert_eq!(argv[base_options().len() + 1], "/scratch/.ssh/config");
        assert_eq!(argv[argv.len() - 2], "prod");
    }

    #[test]
    fn a_relative_config_source_is_refused_rather_than_resolved_against_a_cwd() {
        let problem =
            exec_argv("prod", "true", Some(Path::new(".ssh/config"))).expect_err("refused");
        assert_eq!(problem.code, ProblemCode::InvalidRequest);
    }
}
