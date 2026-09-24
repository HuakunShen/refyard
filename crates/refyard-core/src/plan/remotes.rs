//! Planners for remote configuration: `git remote add`, `set-url`, `rename`, `remove`.
//!
//! These are config changes, not network operations — nothing here talks to a server.
//! But a remote URL is the one request field that can name a *command* to run: Git's
//! transport-helper syntax (`ext::sh -c …`) and option-like URLs (`--upload-pack=…`)
//! execute code when a later fetch or push uses them. So the URL is validated against a
//! closed grammar — `https://` and `ssh://` URLs, scp-like `user@host:path`, or an
//! absolute local path — before it can reach `git`, and a name is pinned to a
//! ref-component so it cannot be read as a switch. A URL that names a command is
//! refused here, at the trusted boundary, never configured for a later surprise.

use super::{DeadlineClass, GitPlan};
use crate::problem::CoreError;

/// A remote name is 1–64 chars, `[A-Za-z0-9]` then `[A-Za-z0-9._-]` — the same closed
/// grammar as the contract, so a crafted name can neither begin as a switch nor carry a
/// path separator into the config section.
pub fn validated_remote_name(name: &str) -> Result<(), CoreError> {
    let bytes = name.as_bytes();
    let ok = !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'_' || *b == b'-');
    if ok {
        Ok(())
    } else {
        Err(CoreError::invalid_input(
            "remote names are 1-64 characters of [A-Za-z0-9._-], starting with a letter or digit",
        ))
    }
}

/// The one place a remote URL may be turned into argv. Mirrors the reference's
/// `unsafeRemoteUrlReason` byte for byte: only `https://`/`ssh://`, scp-like, or an
/// absolute local path pass; `ext::`, `--option`, control characters and spaces are
/// refused so no URL here can name a command to run or a switch to interpret.
pub fn validated_remote_url(url: &str) -> Result<(), CoreError> {
    let reason = unsafe_remote_url_reason(url);
    match reason {
        None => Ok(()),
        Some(reason) => Err(CoreError::invalid_input(format!(
            "the remote URL is not accepted: {reason}"
        ))),
    }
}

fn unsafe_remote_url_reason(value: &str) -> Option<&'static str> {
    if value.is_empty() {
        return Some("it must not be empty");
    }
    if value.len() > 2048 {
        return Some("it must not exceed 2048 characters");
    }
    if value.starts_with('-') {
        return Some("it must not start with \"-\" (it would be read as an option)");
    }
    if value.contains("::") {
        return Some("transport helper syntax (for example ext::) is not accepted");
    }
    // Any C0 control character, space, or DEL would let a URL smuggle an argument.
    if value
        .chars()
        .any(|c| (c as u32) <= 0x20 || (c as u32) == 0x7f)
    {
        return Some("it must not contain control characters or spaces");
    }
    // An absolute local path (POSIX or Windows) is an explicitly approved form.
    if value.starts_with('/') || windows_absolute(value) {
        return None;
    }
    if scp_like(value) {
        return None;
    }
    if value.starts_with("https://") || value.starts_with("ssh://") {
        return None;
    }
    Some("only https:// and ssh:// URLs, scp-like remotes, or absolute local paths are accepted")
}

fn windows_absolute(value: &str) -> bool {
    // `C:\` or `C:/`, or a UNC host share `\\host\`.
    let bytes = value.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    value.starts_with("\\\\") && value.len() > 2
}

fn scp_like(value: &str) -> bool {
    // `user@host:path` — user is [A-Za-z0-9._~%+-], host is [A-Za-z0-9._-], then a
    // single `:`, then a non-empty path with no control characters or spaces.
    let Some((user_host, path)) = value.split_once(':') else {
        return false;
    };
    if path.is_empty()
        || path
            .chars()
            .any(|c| (c as u32) <= 0x20 || (c as u32) == 0x7f)
    {
        return false;
    }
    let Some((user, host)) = user_host.split_once('@') else {
        return false;
    };
    let user_ok = !user.is_empty()
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '%' | '+' | '-'));
    let host_ok = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    user_ok && host_ok
}

fn hooked(argv: Vec<String>) -> GitPlan {
    GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    }
}

/// `git remote add <name> <fetchUrl>` — a config change only.
pub fn plan_remote_add(name: &str, fetch_url: &str) -> Result<GitPlan, CoreError> {
    validated_remote_name(name)?;
    validated_remote_url(fetch_url)?;
    Ok(hooked(vec![
        "remote".to_string(),
        "add".to_string(),
        name.to_string(),
        fetch_url.to_string(),
    ]))
}

/// `git remote set-url [--push] <name> <url>`.
pub fn plan_remote_set_url(name: &str, url: &str, push: bool) -> Result<GitPlan, CoreError> {
    validated_remote_name(name)?;
    validated_remote_url(url)?;
    let mut argv = vec!["remote".to_string(), "set-url".to_string()];
    if push {
        argv.push("--push".to_string());
    }
    argv.push(name.to_string());
    argv.push(url.to_string());
    Ok(hooked(argv))
}

/// `git remote rename <old> <new>` — remote-tracking refs move with it.
pub fn plan_remote_rename(name: &str, new_name: &str) -> Result<GitPlan, CoreError> {
    validated_remote_name(name)?;
    validated_remote_name(new_name)?;
    Ok(hooked(vec![
        "remote".to_string(),
        "rename".to_string(),
        name.to_string(),
        new_name.to_string(),
    ]))
}

/// `git remote remove <name>` — local branches are untouched by Git itself.
pub fn plan_remote_remove(name: &str) -> Result<GitPlan, CoreError> {
    validated_remote_name(name)?;
    Ok(hooked(vec![
        "remote".to_string(),
        "remove".to_string(),
        name.to_string(),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_remote_name_is_a_ref_component_that_cannot_be_a_switch() {
        assert!(validated_remote_name("origin").is_ok());
        assert!(validated_remote_name("a.b_c-1").is_ok());
        assert!(validated_remote_name("").is_err());
        assert!(validated_remote_name("-origin").is_err());
        assert!(validated_remote_name("has space").is_err());
        assert!(validated_remote_name("has/slash").is_err());
        assert!(validated_remote_name(&"x".repeat(65)).is_err());
    }

    #[test]
    fn a_url_that_names_a_command_is_refused_before_it_reaches_git() {
        // The RCE vectors: a transport helper and an option-like URL both execute or
        // override what runs. Neither may ever be configured.
        assert!(validated_remote_url("ext::sh -c evil").is_err());
        assert!(validated_remote_url("ext::bash").is_err());
        assert!(validated_remote_url("--upload-pack=touch /tmp/x").is_err());
        assert!(validated_remote_url("-oProxyCommand=evil").is_err());
        assert!(validated_remote_url("https://a b").is_err());
        assert!(validated_remote_url("").is_err());
        assert!(validated_remote_url(&"a".repeat(2049)).is_err());
    }

    #[test]
    fn the_approved_url_forms_are_accepted() {
        assert!(validated_remote_url("https://example.com/r.git").is_ok());
        assert!(validated_remote_url("ssh://git@example.com/r.git").is_ok());
        assert!(validated_remote_url("git@example.com:owner/r.git").is_ok());
        assert!(validated_remote_url("/abs/local/path").is_ok());
        assert!(validated_remote_url("C:\\repos\\r").is_ok());
    }

    #[test]
    fn the_planners_name_the_commands_and_never_force() {
        assert_eq!(
            plan_remote_add("origin", "https://e.com/r")
                .expect("a plan")
                .argv,
            vec!["remote", "add", "origin", "https://e.com/r"]
        );
        assert_eq!(
            plan_remote_set_url("origin", "ssh://e.com/r", true)
                .expect("a plan")
                .argv,
            vec!["remote", "set-url", "--push", "origin", "ssh://e.com/r"]
        );
        assert_eq!(
            plan_remote_rename("a", "b").expect("a plan").argv,
            vec!["remote", "rename", "a", "b"]
        );
        assert_eq!(
            plan_remote_remove("origin").expect("a plan").argv,
            vec!["remote", "remove", "origin"]
        );
        // An unsafe URL never becomes argv at all.
        assert!(plan_remote_add("origin", "ext::sh -c evil").is_err());
    }
}
