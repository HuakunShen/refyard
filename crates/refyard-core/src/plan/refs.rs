//! Ref and layout planners that were not part of the status module.
//!
//! Kept separate so `plan/status.rs` stays about one panel: what a branch is called
//! and where a repository's directories are is refs work, even though both read the
//! same repository.

use super::GitPlan;

/// Resolves a name that should be a commit, refusing to treat a tag object as one.
pub fn plan_rev_parse_commit(revision: &str) -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{revision}^{{commit}}"),
    ])
}

/// Whether one commit is an ancestor of another. Exit 1 means "no", which is an
/// answer rather than a failure.
pub fn plan_is_commit_ancestor(ancestor: &str, descendant: &str) -> GitPlan {
    GitPlan::read(vec![
        "merge-base".to_string(),
        "--is-ancestor".to_string(),
        ancestor.to_string(),
        descendant.to_string(),
    ])
}

/// The configured remotes, with fetch and push URLs.
pub fn plan_remotes() -> GitPlan {
    GitPlan::read(vec!["remote".to_string(), "-v".to_string()])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::DeadlineClass;

    #[test]
    fn a_commit_lookup_requires_a_commit() {
        // Without the `^{commit}` peel, a tag object would resolve and then be read
        // as if it were a commit.
        let plan = plan_rev_parse_commit("refs/tags/v1");
        assert_eq!(
            plan.argv.last().map(String::as_str),
            Some("refs/tags/v1^{commit}")
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn ancestry_is_asked_as_a_question_not_a_failure() {
        let plan = plan_is_commit_ancestor("a", "b");
        assert_eq!(plan.argv, vec!["merge-base", "--is-ancestor", "a", "b"]);
    }
}
