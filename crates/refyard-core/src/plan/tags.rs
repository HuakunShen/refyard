//! Planners for creating tags.
//!
//! A tag is a name other people fetch, so the rules are conservative: an existing tag
//! is never overwritten (Git refuses without `--force`, and no planner adds it), the
//! annotated message travels on stdin as bytes exactly like a commit message, and
//! signing configuration is left alone — a user with `tag.gpgSign=true` gets signed
//! annotated tags, and that is their configuration, not this build's decision.

use crate::problem::CoreError;

use super::{branches::validated_ref_name, merge::validated_source_oid, DeadlineClass, GitPlan};

/// `git tag -- <name> [<targetOid>]` — the lightweight form.
pub fn plan_tag_create_lightweight(
    name: &str,
    target_oid: Option<&str>,
) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    validated_target(target_oid)?;
    let mut argv = vec!["tag".to_string(), "--".to_string(), name.to_string()];
    if let Some(oid) = target_oid {
        argv.push(oid.to_string());
    }
    Ok(GitPlan::read(argv))
}

/// `git tag --annotate --cleanup=verbatim --file=- <name> [<targetOid>]` — the
/// annotated form, with the message on stdin verbatim.
pub fn plan_tag_create_annotated(
    name: &str,
    target_oid: Option<&str>,
    message: &[u8],
) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    validated_target(target_oid)?;
    validated_message(message)?;
    let mut argv = vec![
        "tag".to_string(),
        "--annotate".to_string(),
        "--cleanup=verbatim".to_string(),
        "--file=-".to_string(),
        name.to_string(),
    ];
    if let Some(oid) = target_oid {
        argv.push(oid.to_string());
    }
    Ok(GitPlan {
        argv,
        stdin: message.to_vec(),
        // An annotated tag writes an object and, for a signing configuration, runs
        // that signer: the hook class is the honest deadline.
        deadline_class: DeadlineClass::Hook,
    })
}

fn validated_target(target_oid: Option<&str>) -> Result<(), CoreError> {
    match target_oid {
        None => Ok(()),
        Some(oid) => validated_source_oid(oid),
    }
}

fn validated_message(message: &[u8]) -> Result<(), CoreError> {
    if message.is_empty() {
        return Err(CoreError::invalid_input(
            "an annotated tag requires a non-empty message; omit the annotation for a lightweight tag",
        ));
    }
    if message.contains(&0) {
        return Err(CoreError::invalid_input("a tag message cannot contain NUL"));
    }
    if message.iter().all(u8::is_ascii_whitespace) {
        return Err(CoreError::invalid_input("a tag message cannot be blank"));
    }
    Ok(())
}

/// `git tag --delete <name>` — local only; a remote tag is never touched.
pub fn plan_tag_delete(name: &str) -> Result<GitPlan, CoreError> {
    validated_ref_name(name)?;
    Ok(GitPlan::read(vec![
        "tag".to_string(),
        "--delete".to_string(),
        name.to_string(),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    const OID: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn a_lightweight_tag_names_its_target_behind_a_separator() {
        let plan = plan_tag_create_lightweight("v1.2.0", Some(OID)).expect("a plan");
        assert_eq!(plan.argv, vec!["tag", "--", "v1.2.0", OID]);
        assert!(plan.stdin.is_empty());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn an_annotated_tag_travels_on_stdin_verbatim_and_runs_nothing_implicitly() {
        let plan = plan_tag_create_annotated("v1", None, b"release\n\nnotes \n").expect("a plan");
        assert_eq!(
            plan.argv,
            vec!["tag", "--annotate", "--cleanup=verbatim", "--file=-", "v1"]
        );
        assert_eq!(plan.stdin, b"release\n\nnotes \n");
        assert_eq!(plan.deadline_class, DeadlineClass::Hook);
    }

    #[test]
    fn a_tag_refuses_bad_names_targets_and_blank_or_nul_messages() {
        assert!(plan_tag_create_lightweight("-e", None).is_err());
        assert!(plan_tag_create_lightweight("v1", Some("main")).is_err());
        assert!(plan_tag_create_annotated("v1", None, b"").is_err());
        assert!(plan_tag_create_annotated("v1", None, b" \n").is_err());
        assert!(plan_tag_create_annotated("v1", None, b"a\0b").is_err());
    }
}
