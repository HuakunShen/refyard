//! Planner for adding a submodule: `git submodule add`.
//!
//! The URL is safety-checked before it becomes argv (an `ext::` or `--upload-pack=` URL
//! names a command, so it is refused, never contacted), and the destination is a path
//! *inside* the working tree — relative, with no `..` segment and no absolute form, so
//! adding a submodule can never write outside the tree it is added to.

use super::branches::validated_ref_name;
use super::remotes::validated_remote_url;
use super::{DeadlineClass, GitPlan};
use crate::problem::CoreError;

/// A submodule destination: relative to the working tree, 1–1024 bytes, and confined
/// to it. `--` in the argv already keeps a leading `-` from being read as a switch;
/// this rejects the escapes (`..`, an absolute path) and the bytes that cannot be a
/// single argv field.
pub fn validated_relative_path(path: &str) -> Result<(), CoreError> {
    if path.is_empty() || path.len() > 1024 {
        return Err(CoreError::invalid_input(
            "a submodule path must be between 1 and 1024 bytes",
        ));
    }
    if path.starts_with('/') {
        return Err(CoreError::invalid_input(
            "a submodule path must be relative to the working tree, not absolute",
        ));
    }
    if path.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(CoreError::invalid_input(
            "a submodule path must not contain control characters",
        ));
    }
    if path.split('/').any(|segment| segment == "..") {
        return Err(CoreError::invalid_input(
            "a submodule path must stay inside the working tree (`..` is refused)",
        ));
    }
    Ok(())
}

/// `git submodule add [-b <branch>] -- <url> <path>`.
///
/// The `--` separates the switches from the operands so neither the URL nor the path
/// can be mistaken for an option. `git submodule add` registers the URL and checks the
/// working tree out — that is Git's own behaviour for `add`, and what this reports.
pub fn plan_submodule_add(
    url: &str,
    path: &str,
    branch_name: Option<&str>,
) -> Result<GitPlan, CoreError> {
    validated_remote_url(url)?;
    validated_relative_path(path)?;
    if let Some(branch) = branch_name {
        validated_ref_name(branch)?;
    }
    let mut argv = vec!["submodule".to_string(), "add".to_string()];
    if let Some(branch) = branch_name {
        argv.push("-b".to_string());
        argv.push(branch.to_string());
    }
    argv.push("--".to_string());
    argv.push(url.to_string());
    argv.push(path.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Network,
    })
}

/// `git submodule update --checkout [--init] [--recursive] -- <paths>`.
///
/// The recorded commit is the target, always: no `--remote`, `--force`, `--merge` or
/// `--rebase`. Each path is confined to the working tree, and `--` keeps a path from
/// being read as a switch.
pub fn plan_submodule_update(
    paths: &[String],
    initialize: bool,
    recursive: bool,
) -> Result<GitPlan, CoreError> {
    let mut argv = vec![
        "submodule".to_string(),
        "update".to_string(),
        "--checkout".to_string(),
    ];
    if initialize {
        argv.push("--init".to_string());
    }
    if recursive {
        argv.push("--recursive".to_string());
    }
    argv.push("--".to_string());
    for path in paths {
        validated_relative_path(path)?;
        argv.push(path.clone());
    }
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Network,
    })
}

/// `git submodule sync [--recursive] -- <paths>` — copy URLs from the parent's
/// configuration into the submodules. No network.
pub fn plan_submodule_sync(paths: &[String], recursive: bool) -> Result<GitPlan, CoreError> {
    let mut argv = vec!["submodule".to_string(), "sync".to_string()];
    if recursive {
        argv.push("--recursive".to_string());
    }
    argv.push("--".to_string());
    for path in paths {
        validated_relative_path(path)?;
        argv.push(path.clone());
    }
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git config -z --file .gitmodules --get-regexp ^submodule\.` — every configured
/// submodule key and value. Read before an update or sync so a crafted `.gitmodules`
/// cannot name a command URL that the run would then contact.
pub fn plan_submodule_config() -> GitPlan {
    GitPlan::read(vec![
        "config".to_string(),
        "-z".to_string(),
        "--file".to_string(),
        ".gitmodules".to_string(),
        "--get-regexp".to_string(),
        "^submodule\\.".to_string(),
    ])
}

/// Parse `git config -z --get-regexp` output: NUL-framed `<key>\n<value>` records.
/// Returns the URLs a `.gitmodules` configures (the `submodule.<name>.url` values).
///
/// Byte-level: the separator is exactly one `0x0a` and the value is raw bytes after it;
/// a record without that shape is skipped rather than guessed at. The value is decoded
/// only to validate the URL grammar, which is a byte test in `validated_remote_url`.
pub fn submodule_config_urls(bytes: &[u8]) -> Vec<String> {
    let mut urls = Vec::new();
    for frame in bytes.split(|b| *b == 0) {
        if frame.is_empty() {
            continue;
        }
        let Some(separator) = frame.iter().position(|b| *b == 0x0a) else {
            continue;
        };
        if separator == 0 {
            continue;
        }
        let key = &frame[..separator];
        let value = &frame[separator + 1..];
        // Only `submodule.<name>.url` carries a URL to contact.
        let key_str = String::from_utf8_lossy(key);
        if key_str.starts_with("submodule.") && key_str.ends_with(".url") && !value.is_empty() {
            urls.push(String::from_utf8_lossy(value).to_string());
        }
    }
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_submodule_path_stays_inside_the_working_tree() {
        assert!(validated_relative_path("vendor/lib").is_ok());
        assert!(validated_relative_path("lib").is_ok());
        // An absolute path or a `..` segment would write outside the tree being edited.
        assert!(validated_relative_path("/etc").is_err());
        assert!(validated_relative_path("../escape").is_err());
        assert!(validated_relative_path("a/../../escape").is_err());
        assert!(validated_relative_path("a\0b").is_err());
        assert!(validated_relative_path("").is_err());
    }

    #[test]
    fn a_submodule_add_separates_its_operands_and_never_a_command_url() {
        assert_eq!(
            plan_submodule_add("/local/repo", "vendor/lib", None)
                .expect("a plan")
                .argv,
            vec!["submodule", "add", "--", "/local/repo", "vendor/lib"]
        );
        let plan = plan_submodule_add("/local/repo", "lib", Some("main")).expect("a plan");
        assert_eq!(
            plan.argv,
            vec!["submodule", "add", "-b", "main", "--", "/local/repo", "lib"]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Network);
        // A transport-helper URL names a command: refused before it is ever contacted.
        assert!(plan_submodule_add("ext::evil", "lib", None).is_err());
        assert!(plan_submodule_add("--upload-pack=evil", "lib", None).is_err());
    }
}

#[cfg(test)]
mod update_sync_tests {
    use super::*;

    #[test]
    fn a_submodule_update_checks_out_the_recorded_commit_and_never_a_forced_form() {
        let paths = vec!["vendor/lib".to_string(), "vendor/other".to_string()];
        assert_eq!(
            plan_submodule_update(&paths, true, true)
                .expect("a plan")
                .argv,
            vec![
                "submodule",
                "update",
                "--checkout",
                "--init",
                "--recursive",
                "--",
                "vendor/lib",
                "vendor/other"
            ]
        );
        let plan = plan_submodule_update(&paths, false, false).expect("a plan");
        assert_eq!(
            plan.argv,
            vec![
                "submodule",
                "update",
                "--checkout",
                "--",
                "vendor/lib",
                "vendor/other"
            ]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Network);
        // A `..` path would reach outside the working tree.
        assert!(plan_submodule_update(&["../escape".to_string()], false, false).is_err());
    }

    #[test]
    fn a_submodule_sync_only_copies_urls() {
        assert_eq!(
            plan_submodule_sync(&["vendor/lib".to_string()], true)
                .expect("a plan")
                .argv,
            vec!["submodule", "sync", "--recursive", "--", "vendor/lib"]
        );
        assert_eq!(
            plan_submodule_sync(&[], false)
                .expect("a plan")
                .deadline_class,
            DeadlineClass::Hook
        );
    }

    #[test]
    fn the_url_safety_scan_reads_only_the_configured_urls() {
        // A crafted .gitmodules: one safe local URL and one that names a command.
        let config = b"submodule.lib.url\n/local/repo\0submodule.lib.path\nvendor/lib\0submodule.evil.url\next::rm\0";
        assert_eq!(
            submodule_config_urls(config),
            vec!["/local/repo".to_string(), "ext::rm".to_string()]
        );
        // A record without the `<key>\n<value>` shape is skipped, never guessed at.
        let malformed = b"submodule.lib.url\n/local\0garbage-no-newline\0";
        assert_eq!(submodule_config_urls(malformed), vec!["/local".to_string()]);
    }
}
