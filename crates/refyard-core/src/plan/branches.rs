//! Planners for creating and switching branches.
//!
//! The name is the argument that must not become an option, so it is validated against
//! the same rules the contract's `validateBranchName` applies — Git's own ref rules,
//! spelled once here — and every command names the branch after a `--` where Git offers
//! one. `switch --create` has no separator form, which is exactly why the validation is
//! the boundary and not a separator.
//!
//! Nothing here forces anything: a switch that conflicts with local changes is Git's to
//! refuse, and the refusal is the answer.

use crate::problem::CoreError;

use super::GitPlan;

/// The most characters one branch or tag name may carry, from
/// `LIMITS.branchNameMaxLength`.
pub const REF_NAME_MAX_LENGTH: usize = 255;

/// The contract's ref-name rules, applied before any command exists.
///
/// Prevents: a name that starts with `-` reaching argv as the option it spells, and a
/// name Git itself would refuse ("..", `@{`, trailing `.lock`, control characters,
/// `~^:?*[\`, empty or dot-leading path components) failing later and less clearly.
pub fn validated_ref_name(name: &str) -> Result<(), CoreError> {
    let refused = |why: &str| {
        Err(CoreError::invalid_input(format!(
            "a ref name {why}: {name:?}"
        )))
    };
    if name.is_empty() {
        return refused("cannot be empty");
    }
    if name.len() > REF_NAME_MAX_LENGTH {
        return refused(&format!("is longer than {REF_NAME_MAX_LENGTH} characters"));
    }
    if name == "@" {
        return refused("cannot be the single character \"@\"");
    }
    if name.starts_with('-') {
        return refused("cannot start with \"-\" (it would be read as an option)");
    }
    if name.starts_with('/') || name.ends_with('/') {
        return refused("cannot start or end with \"/\"");
    }
    if name.ends_with('.') {
        return refused("cannot end with \".\"");
    }
    if name.to_ascii_lowercase().ends_with(".lock") {
        return refused("cannot end with \".lock\"");
    }
    if name.contains("..") {
        return refused("cannot contain \"..\"");
    }
    if name.contains("@{") {
        return refused("cannot contain \"@{\"");
    }
    if name.contains("//") {
        return refused("cannot contain \"//\"");
    }
    if name.bytes().any(|byte| byte <= 0x20 || byte == 0x7f) {
        return refused("cannot contain control characters or spaces");
    }
    if name
        .bytes()
        .any(|byte| matches!(byte, b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\'))
    {
        return refused("cannot contain ~ ^ : ? * [ or \\");
    }
    for component in name.split('/') {
        if component.is_empty() {
            return refused("cannot contain an empty path component");
        }
        if component.starts_with('.') {
            return refused("cannot have a path component starting with \".\"");
        }
    }
    Ok(())
}

fn validated_start_oid(start_oid: Option<&str>) -> Result<(), CoreError> {
    match start_oid {
        None => Ok(()),
        Some(oid) => super::merge::validated_source_oid(oid),
    }
}

/// `git branch -- <name> [<startOid>]` — the branch is created, not checked out.
pub fn plan_branch_create(name: &str, start_oid: Option<&str>) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    validated_start_oid(start_oid)?;
    let mut argv = vec!["branch".to_string(), "--".to_string(), name.to_string()];
    if let Some(oid) = start_oid {
        argv.push(oid.to_string());
    }
    Ok(GitPlan::read(argv))
}

/// `git switch --create <name> [<startOid>]` — created and checked out in one command.
pub fn plan_branch_create_and_switch(
    name: &str,
    start_oid: Option<&str>,
) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    validated_start_oid(start_oid)?;
    let mut argv = vec![
        "switch".to_string(),
        "--create".to_string(),
        name.to_string(),
    ];
    if let Some(oid) = start_oid {
        argv.push(oid.to_string());
    }
    Ok(GitPlan::read(argv))
}

/// `git switch -- <name>` — never forced; a conflict with local changes is Git's to
/// report.
pub fn plan_branch_switch(name: &str) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    Ok(GitPlan::read(vec![
        "switch".to_string(),
        "--".to_string(),
        name.to_string(),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn a_branch_is_created_behind_a_separator_and_never_checked_out_unasked() {
        let plan = plan_branch_create("feature/graph", Some(OID)).expect("a plan");
        assert_eq!(plan.argv, vec!["branch", "--", "feature/graph", OID]);
        let bare = plan_branch_create("main", None).expect("a plan");
        assert_eq!(bare.argv, vec!["branch", "--", "main"]);
    }

    #[test]
    fn create_and_switch_names_the_branch_after_create() {
        let plan = plan_branch_create_and_switch("feature", None).expect("a plan");
        assert_eq!(plan.argv, vec!["switch", "--create", "feature"]);
    }

    #[test]
    fn a_switch_is_separator_and_never_forced() {
        let plan = plan_branch_switch("main").expect("a plan");
        assert_eq!(plan.argv, vec!["switch", "--", "main"]);
    }

    #[test]
    fn names_that_would_be_options_or_illegal_refs_are_refused_before_a_command_exists() {
        for bad in [
            "--force",
            "",
            "has space",
            "a..b",
            "@{",
            "a//b",
            "leading/",
            "trailing.",
            "point.lock",
            "POINT.LOCK",
            ".hidden",
            "a/b/",
            "@",
            "tilde~",
            "caret^",
            "colon:",
            "quest?",
            "star*",
            "bracket[",
            "back\\",
        ] {
            assert!(
                plan_branch_create(bad, None).is_err(),
                "{bad:?} must be refused"
            );
        }
        // The same rules gate the start point's shape as a merge source's.
        assert!(plan_branch_create("ok", Some("--force")).is_err());
        assert!(plan_branch_create("ok", Some("main")).is_err());
        let long: String = "a".repeat(REF_NAME_MAX_LENGTH + 1);
        assert!(plan_branch_create(&long, None).is_err());
        assert!(
            plan_branch_create(&"a".repeat(REF_NAME_MAX_LENGTH), None).is_ok(),
            "255 characters is the documented limit"
        );
    }
}
