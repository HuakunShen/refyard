//! Planners for creating a repository: `git init` and `git clone`.
//!
//! Both write into an approved-root destination that the host has already proven is
//! inside the root. `clone` takes the network URL through the same safety gate as every
//! other remote (an `ext::`/option-like URL names a command and is refused), and never
//! recurses into submodules unless the request asked.

use super::branches::validated_ref_name;
use super::remotes::validated_remote_url;
use super::submodules::validated_relative_path;
use super::{DeadlineClass, GitPlan};
use crate::problem::CoreError;

fn validated_destination(destination: &str) -> Result<(), CoreError> {
    if destination.is_empty() || destination.as_bytes().contains(&0) {
        return Err(CoreError::invalid_input(
            "a repository destination must be a non-empty path",
        ));
    }
    Ok(())
}

/// `git init --quiet [--initial-branch=<name>] -- <destination>`.
///
/// `--quiet` keeps Git's advice text ("Using 'master' as the name for the initial
/// branch…") out of the diagnostic, which matters because the workflow reports that
/// diagnostic when the command fails: advice in the middle of it reads as a warning
/// about a failure that did not happen. `null` leaves the branch to Git's own default.
pub fn plan_repository_init(
    destination: &str,
    initial_branch: Option<&str>,
) -> Result<GitPlan, CoreError> {
    validated_destination(destination)?;
    if let Some(branch) = initial_branch {
        validated_ref_name(branch)?;
    }
    let mut argv = vec!["init".to_string(), "--quiet".to_string()];
    if let Some(branch) = initial_branch {
        argv.push(format!("--initial-branch={branch}"));
    }
    argv.push("--".to_string());
    argv.push(destination.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Hook,
    })
}

/// `git clone --quiet [--recurse-submodules] -- <url> <destination>`.
///
/// Submodules are initialised only when the request asked — `--recurse-submodules` by
/// default would make the first clone of a large project unexpectedly expensive. The
/// URL is safety-checked first: one that names a command is refused, never contacted.
pub fn plan_repository_clone(
    url: &str,
    destination: &str,
    initialize_submodules: bool,
) -> Result<GitPlan, CoreError> {
    validated_remote_url(url)?;
    validated_destination(destination)?;
    let mut argv = vec!["clone".to_string(), "--quiet".to_string()];
    if initialize_submodules {
        argv.push("--recurse-submodules".to_string());
    }
    argv.push("--".to_string());
    argv.push(url.to_string());
    argv.push(destination.to_string());
    Ok(GitPlan {
        argv,
        stdin: Vec::new(),
        deadline_class: DeadlineClass::Network,
    })
}

/// The absolute destination a workspace create lands at: the approved root's path plus a
/// confined relative path. Refused if the relative path could leave the root.
pub fn workspace_destination(
    root_path: &str,
    relative_destination: &str,
) -> Result<String, CoreError> {
    validated_relative_path(relative_destination)?;
    let joined = if root_path.ends_with('/') {
        format!("{root_path}{relative_destination}")
    } else {
        format!("{root_path}/{relative_destination}")
    };
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_init_names_its_branch_explicitly_or_defers_to_git() {
        assert_eq!(
            plan_repository_init("/root/new", None)
                .expect("a plan")
                .argv,
            vec!["init", "--quiet", "--", "/root/new"]
        );
        assert_eq!(
            plan_repository_init("/root/new", Some("main"))
                .expect("a plan")
                .argv,
            vec![
                "init",
                "--quiet",
                "--initial-branch=main",
                "--",
                "/root/new"
            ]
        );
        assert!(plan_repository_init("", None).is_err());
    }

    #[test]
    fn a_clone_checks_the_url_and_only_recurses_when_asked() {
        assert_eq!(
            plan_repository_clone("/local/repo", "/root/new", false)
                .expect("a plan")
                .argv,
            vec!["clone", "--quiet", "--", "/local/repo", "/root/new"]
        );
        let plan = plan_repository_clone("/local/repo", "/root/new", true).expect("a plan");
        assert_eq!(
            plan.argv,
            vec![
                "clone",
                "--quiet",
                "--recurse-submodules",
                "--",
                "/local/repo",
                "/root/new"
            ]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Network);
        // A URL that names a command is refused before it is ever contacted.
        assert!(plan_repository_clone("ext::evil", "/root/new", false).is_err());
    }

    #[test]
    fn a_workspace_destination_stays_inside_its_root() {
        assert_eq!(
            workspace_destination("/root", "new").expect("a path"),
            "/root/new"
        );
        // A `..` or absolute relative path would leave the root.
        assert!(workspace_destination("/root", "../escape").is_err());
        assert!(workspace_destination("/root", "/abs").is_err());
    }
}
