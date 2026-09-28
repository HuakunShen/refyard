//! Ref and layout planners that were not part of the status module.
//!
//! Kept separate so `plan/status.rs` stays about one panel: what a branch is called
//! and where a repository's directories are is refs work, even though both read the
//! same repository.

use super::{names_stdin, GitPlan};
use crate::bytes::is_object_name;
use crate::problem::CoreError;

/// The `.gitmodules` config entries, with NUL-framed key/value records.
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

/// The recorded tree entries for an explicit set of literal repository paths.
///
/// Paths are arguments only after `--literal-pathspecs` and `--`; an invalid path or
/// non-object revision is refused here rather than becoming Git's option syntax.
pub fn plan_ls_tree_entries(revision: &str, paths: &[String]) -> Result<GitPlan, CoreError> {
    if !is_object_name(revision.as_bytes()) {
        return Err(CoreError::invalid_input(
            "plan_ls_tree_entries requires a 40- or 64-character lowercase object name",
        ));
    }
    if paths.is_empty() {
        return Err(CoreError::invalid_input(
            "plan_ls_tree_entries requires at least one path",
        ));
    }
    for path in paths {
        if path.is_empty()
            || path.starts_with('/')
            || path.contains('\0')
            || path
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return Err(CoreError::invalid_input(
                "plan_ls_tree_entries requires normalized repository-relative paths",
            ));
        }
    }
    let mut argv = vec![
        "--literal-pathspecs".to_string(),
        "ls-tree".to_string(),
        "-z".to_string(),
        revision.to_string(),
        "--".to_string(),
    ];
    argv.extend(paths.iter().cloned());
    Ok(GitPlan::read(argv))
}

/// Resolves a name that should be a commit, refusing to treat a tag object as one.
pub fn plan_rev_parse_commit(revision: &str) -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{revision}^{{commit}}"),
    ])
}

/// Enumerates every object whose name starts with a validated lowercase hex prefix.
pub fn plan_disambiguate_commit_prefix(prefix: &str) -> Result<GitPlan, CoreError> {
    if !(4..=64).contains(&prefix.len())
        || !prefix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(CoreError::invalid_input(
            "a commit prefix must contain 4–64 lowercase hexadecimal characters",
        ));
    }
    Ok(GitPlan::read(vec![
        "rev-parse".to_string(),
        format!("--disambiguate={prefix}"),
    ]))
}

/// Classifies a bounded list of already enumerated objects without reading their bodies.
pub fn plan_cat_file_object_types(object_names: &[&str]) -> Result<GitPlan, CoreError> {
    if object_names.is_empty() {
        return Err(CoreError::invalid_input(
            "plan_cat_file_object_types requires at least one object name",
        ));
    }
    if object_names
        .iter()
        .any(|name| !is_object_name(name.as_bytes()))
    {
        return Err(CoreError::invalid_input(
            "plan_cat_file_object_types requires full lowercase object names",
        ));
    }
    let mut plan = GitPlan::read(vec![
        "cat-file".to_string(),
        "--batch-check=%(objectname) %(objecttype)".to_string(),
    ]);
    plan.stdin = names_stdin(object_names);
    Ok(plan)
}

/// Whether one commit is an ancestor of another. Exit 1 means "no", which is an
/// answer rather than a failure.
pub fn plan_is_commit_ancestor(ancestor: &str, descendant: &str) -> Result<GitPlan, CoreError> {
    if !is_object_name(ancestor.as_bytes()) || !is_object_name(descendant.as_bytes()) {
        return Err(CoreError::invalid_input(
            "plan_is_commit_ancestor requires full lowercase object names",
        ));
    }
    Ok(GitPlan::read(vec![
        "merge-base".to_string(),
        "--is-ancestor".to_string(),
        ancestor.to_string(),
        descendant.to_string(),
    ]))
}

/// The configured remotes, with fetch and push URLs.
pub fn plan_remotes() -> GitPlan {
    GitPlan::read(vec!["remote".to_string(), "-v".to_string()])
}

/// Presence of each object name, answered without transferring a body.
///
/// Used for the "missing parent" question: a graph that draws a parent as a root hides
/// a shallow clone or a partially fetched repository, and `--batch-check` answers
/// presence for a whole list in one process.
pub fn plan_cat_file_exists(object_names: &[&str]) -> Result<GitPlan, CoreError> {
    if object_names.is_empty() {
        return Err(CoreError::invalid_input(
            "plan_cat_file_exists requires at least one object name",
        ));
    }
    let mut plan = GitPlan::new(vec![
        "cat-file".to_string(),
        "--batch-check=%(objectname)".to_string(),
    ]);
    plan.stdin = names_stdin(object_names);
    Ok(plan)
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
        let ancestor = "0123456789abcdef0123456789abcdef01234567";
        let descendant = "fedcba9876543210fedcba9876543210fedcba98";
        let plan = plan_is_commit_ancestor(ancestor, descendant).expect("full object names");
        assert_eq!(
            plan.argv,
            vec!["merge-base", "--is-ancestor", ancestor, descendant]
        );
    }

    #[test]
    fn commit_prefix_plans_are_hex_only_and_bounded() {
        let plan = plan_disambiguate_commit_prefix("a1b2").expect("valid prefix");
        assert_eq!(plan.argv, vec!["rev-parse", "--disambiguate=a1b2"]);
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
        assert!(plan_disambiguate_commit_prefix("-e123").is_err());
        assert!(plan_disambiguate_commit_prefix("ABCDEF").is_err());
        assert!(plan_disambiguate_commit_prefix("abc").is_err());
    }

    #[test]
    fn object_type_plans_require_full_names_and_use_stdin() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let plan = plan_cat_file_object_types(&[oid]).expect("one full object name");
        assert_eq!(
            plan.argv,
            vec!["cat-file", "--batch-check=%(objectname) %(objecttype)"]
        );
        assert_eq!(plan.stdin, format!("{oid}\n").as_bytes());
        assert!(plan_cat_file_object_types(&[]).is_err());
        assert!(plan_cat_file_object_types(&["not-an-oid"]).is_err());
    }

    #[test]
    fn ancestry_plans_require_full_object_names() {
        assert!(plan_is_commit_ancestor("a", "b").is_err());
    }

    #[test]
    fn presence_is_asked_for_a_whole_list_in_one_process() {
        // One `cat-file` for the page's parents, not one process per parent: a shallow
        // clone's page can name dozens of them.
        let plan = plan_cat_file_exists(&["aaaa", "bbbb"]).expect("plan");
        assert_eq!(plan.argv, vec!["cat-file", "--batch-check=%(objectname)"]);
        assert_eq!(plan.stdin, b"aaaa\nbbbb\n".to_vec());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn a_presence_check_with_no_names_is_refused() {
        // `cat-file --batch-check` with no input would wait for stdin that never comes.
        let error = plan_cat_file_exists(&[]).expect_err("empty");
        assert!(matches!(error, CoreError::InvalidInput { .. }));
    }

    #[test]
    fn submodule_config_is_scoped_to_gitmodules_and_nul_delimited() {
        let plan = plan_submodule_config();
        assert_eq!(
            plan.argv,
            vec![
                "config",
                "-z",
                "--file",
                ".gitmodules",
                "--get-regexp",
                "^submodule\\.",
            ]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
        assert!(plan.stdin.is_empty());
    }

    #[test]
    fn recorded_submodule_entries_are_literal_and_cannot_escape_the_tree() {
        let oid = "0123456789abcdef0123456789abcdef01234567";
        let plan = plan_ls_tree_entries(oid, &["modules/child".into(), "-name[*]".into()])
            .expect("literal pathspecs");
        assert_eq!(
            plan.argv,
            vec![
                "--literal-pathspecs",
                "ls-tree",
                "-z",
                oid,
                "--",
                "modules/child",
                "-name[*]",
            ]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
        assert!(plan.stdin.is_empty());
        assert!(plan_ls_tree_entries(oid, &["../outside".into()]).is_err());
        assert!(plan_ls_tree_entries("HEAD", &["modules/child".into()]).is_err());
    }
}
