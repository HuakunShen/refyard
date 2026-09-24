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
