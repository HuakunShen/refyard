//! Planners for status, repository layout, HEAD, and the index listing.
//!
//! These are the read-only commands a status panel needs. Two conventions carry
//! safety rather than style: `--no-optional-locks` on status means a read cannot
//! take the index lock and interfere with a write happening in another terminal, and
//! `--path-format=absolute` on the layout query means `--git-common-dir` prints an
//! absolute path instead of one that means something different depending on where
//! Git was run.

use super::{DeadlineClass, GitPlan};

/// `git status --porcelain=v2 --branch -z [--show-stash] [--ignored=matching]`.
pub fn plan_status(options: StatusOptions) -> GitPlan {
    let mut argv = vec![
        "--no-optional-locks".to_string(),
        "status".to_string(),
        "--porcelain=v2".to_string(),
        "--branch".to_string(),
        "-z".to_string(),
    ];
    if options.show_stash {
        argv.push("--show-stash".to_string());
    }
    if options.include_ignored {
        argv.push("--ignored=matching".to_string());
    }
    GitPlan::read(argv)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatusOptions {
    pub include_ignored: bool,
    pub show_stash: bool,
}

/// Repository layout facts, one per line: git dir, common dir, top level, bare,
/// object format, shallow.
///
/// `omit_top_level` exists because Git refuses `--show-toplevel` outside a work tree:
/// in a bare repository the combined call exits 128 after printing only the paths it
/// could resolve. The caller asks for the bare-safe form instead of reading a
/// half-printed answer as if it were complete.
pub fn plan_repository_layout(omit_top_level: bool) -> GitPlan {
    let mut argv = vec![
        "--no-optional-locks".to_string(),
        "rev-parse".to_string(),
        "--path-format=absolute".to_string(),
        "--absolute-git-dir".to_string(),
        "--git-common-dir".to_string(),
    ];
    if !omit_top_level {
        argv.push("--show-toplevel".to_string());
    }
    argv.push("--is-bare-repository".to_string());
    argv.push("--show-object-format".to_string());
    argv.push("--is-shallow-repository".to_string());
    GitPlan::read(argv)
}

/// HEAD's symbolic ref, or a non-zero exit when HEAD is detached.
pub fn plan_head_ref() -> GitPlan {
    GitPlan::read(vec![
        "symbolic-ref".to_string(),
        "--quiet".to_string(),
        "HEAD".to_string(),
    ])
}

/// HEAD's object name; exit 1 in an unborn repository.
pub fn plan_head_oid() -> GitPlan {
    GitPlan::read(vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        "HEAD".to_string(),
    ])
}

/// Every ref, with the fields the refs panel renders.
///
/// The format string uses `%00` separators so a ref name containing a space cannot
/// shift the following fields, and `%(HEAD)` reports which branch is checked out
/// without a second command.
pub fn plan_for_each_ref() -> GitPlan {
    GitPlan::read(vec![
        "for-each-ref".to_string(),
        "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)%00%(upstream)%00%(upstream:track)%00%(HEAD)%00%(*objectname)".to_string(),
        "--sort=refname".to_string(),
    ])
}

/// The index, with modes and stage numbers.
pub fn plan_ls_files_stage() -> GitPlan {
    GitPlan::read(vec![
        "ls-files".to_string(),
        "--stage".to_string(),
        "-z".to_string(),
    ])
}

/// Unmerged entries only, used to describe conflicts without a full status read.
pub fn plan_ls_files_unmerged() -> GitPlan {
    GitPlan::read(vec![
        "ls-files".to_string(),
        "--unmerged".to_string(),
        "--stage".to_string(),
        "-z".to_string(),
    ])
}

/// The worktree list, in Git's own porcelain format.
pub fn plan_worktree_list() -> GitPlan {
    GitPlan::read(vec![
        "worktree".to_string(),
        "list".to_string(),
        "--porcelain".to_string(),
        "-z".to_string(),
    ])
}

/// The stash reflog, with the locator, object name, subject and commit time.
pub fn plan_stash_list() -> GitPlan {
    GitPlan::read(vec![
        "reflog".to_string(),
        "show".to_string(),
        "--format=%gd%x00%H%x00%gs%x00%ct".to_string(),
        "refs/stash".to_string(),
    ])
}

/// How long a layout read may take. Kept next to the planner so the class is not
/// chosen at the call site.
pub const LAYOUT_DEADLINE: DeadlineClass = DeadlineClass::Read;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_never_takes_the_index_lock() {
        // Without --no-optional-locks a read can block a write running in the user's
        // own terminal, which would be a read interfering with a commit.
        let plan = plan_status(StatusOptions::default());
        assert_eq!(plan.argv[0], "--no-optional-locks");
        assert_eq!(
            plan.argv,
            vec![
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
                "-z"
            ]
        );
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
        assert!(plan.stdin.is_empty());
    }

    #[test]
    fn status_options_are_appended_in_a_fixed_order() {
        let plan = plan_status(StatusOptions {
            include_ignored: true,
            show_stash: true,
        });
        assert_eq!(
            plan.argv.last().map(String::as_str),
            Some("--ignored=matching")
        );
        assert!(plan.argv.contains(&"--show-stash".to_string()));
    }

    #[test]
    fn layout_asks_for_absolute_paths() {
        // A relative common dir would be interpreted against whatever directory Git
        // happened to run in.
        let plan = plan_repository_layout(false);
        assert!(plan.argv.contains(&"--path-format=absolute".to_string()));
        assert!(plan.argv.contains(&"--show-toplevel".to_string()));
    }

    #[test]
    fn layout_can_omit_the_top_level_for_a_bare_repository() {
        let plan = plan_repository_layout(true);
        assert!(!plan.argv.contains(&"--show-toplevel".to_string()));
        assert!(plan.argv.contains(&"--is-bare-repository".to_string()));
    }

    #[test]
    fn ref_listing_separates_fields_with_nul_rather_than_spaces() {
        // A ref name may contain a space; a space-separated format would shift every
        // following field.
        let plan = plan_for_each_ref();
        let format = plan
            .argv
            .iter()
            .find(|argument| argument.starts_with("--format="))
            .expect("a format argument");
        assert_eq!(format.matches("%00").count(), 7);
        assert!(format.contains("%(*objectname)"));
    }

    #[test]
    fn stash_listing_uses_a_nul_separated_format() {
        let plan = plan_stash_list();
        // The reflog format spells a NUL as `%x00`; `%00` is the for-each-ref spelling.
        assert!(plan.argv.iter().any(|arg| arg.contains("%x00")));
        assert_eq!(plan.argv.last().map(String::as_str), Some("refs/stash"));
    }
}
