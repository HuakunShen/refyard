//! Argument vectors for the diff reads: name-status, numstat and text patches.
//!
//! Every diff here is read-only and every one of them carries `--no-ext-diff` and
//! `--no-textconv`, so a repository's own configuration cannot turn a read into
//! running an external program. Machine formats ask for `-z`, because a path may
//! contain a newline and only NUL framing survives that.
//!
//! The one-path patch is the only planner that accepts a path, and it treats it the
//! way a user-supplied path must be treated: `--literal-pathspecs` so a file called
//! `:(glob)**` is a file rather than a pattern that expands to the whole repository,
//! and `--` before it so a file called `-n` cannot become an option.
//!
//! The reference's planner also carries the authorised directory handle and a command
//! description; `GitPlan` has neither, because the host binds the directory and names
//! the command when it runs the plan.

use crate::plan::GitPlan;

/// Which revisions a diff compares. All three are optional in the reference, and the
/// default (no field set) is the working tree against the index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DiffOptions<'a> {
    /// Compare the index against HEAD instead of the working tree.
    pub cached: bool,
    /// Range start. A commit, never a ref the user typed into a shell string.
    pub from: Option<&'a str>,
    pub to: Option<&'a str>,
}

/// `git diff --name-status -z [--cached] [<from>] [<to>]`.
pub fn plan_diff_name_status(options: DiffOptions<'_>) -> GitPlan {
    let mut argv = argv(&[
        "diff",
        "--name-status",
        "-z",
        "--no-ext-diff",
        "--no-textconv",
    ]);
    push_range(&mut argv, options);
    GitPlan::new(argv)
}

/// `git diff --numstat -z [--cached] [<from>] [<to>]`.
pub fn plan_diff_numstat(options: DiffOptions<'_>) -> GitPlan {
    let mut argv = argv(&["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv"]);
    push_range(&mut argv, options);
    GitPlan::new(argv)
}

/// Text patch for the whole change set.
///
/// `--submodule=short` makes a submodule change print its object names instead of
/// attempting to diff the submodule's contents, which would either be wrong or empty.
pub fn plan_diff_patch_all(options: DiffOptions<'_>) -> GitPlan {
    let mut argv = argv(&[
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--patch",
        "--submodule=short",
    ]);
    push_range(&mut argv, options);
    GitPlan::new(argv)
}

/// Text patch for exactly one path.
///
/// The path is text because a Git argument vector is text; the byte-level rule lives
/// one level up, where the host refuses a path whose bytes are not representable and
/// never substitutes a display form for it. The path is also the only thing after
/// `--`, and `--literal-pathspecs` keeps a path that looks like a pattern from
/// expanding into every path in the repository.
pub fn plan_diff_patch_for_path(path: &str, options: DiffOptions<'_>) -> GitPlan {
    let mut argv = argv(&[
        "--literal-pathspecs",
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--patch",
        "--submodule=short",
    ]);
    push_range(&mut argv, options);
    argv.push("--".to_string());
    argv.push(path.to_string());
    GitPlan::new(argv)
}

/// `--cached` first, then the range, in the order the reference emits them: Git reads
/// them as options first and revisions second, and a revision before `--cached` would
/// still parse but would no longer describe the same comparison.
fn push_range(argv: &mut Vec<String>, options: DiffOptions<'_>) {
    if options.cached {
        argv.push("--cached".to_string());
    }
    if let Some(from) = options.from {
        argv.push(from.to_string());
    }
    if let Some(to) = options.to {
        argv.push(to.to_string());
    }
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::DeadlineClass;

    #[test]
    fn name_status_asks_for_nul_framing_and_no_external_program() {
        // `--no-ext-diff`/`--no-textconv` are what keep a repository setting from
        // turning reading a diff into executing a configured command.
        assert_eq!(
            plan_diff_name_status(DiffOptions::default()).argv,
            vec![
                "diff",
                "--name-status",
                "-z",
                "--no-ext-diff",
                "--no-textconv"
            ]
        );
    }

    #[test]
    fn numstat_asks_for_the_same_shape_with_counts() {
        assert_eq!(
            plan_diff_numstat(DiffOptions::default()).argv,
            vec!["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv"]
        );
    }

    #[test]
    fn a_cached_range_is_appended_cached_then_from_then_to() {
        let options = DiffOptions {
            cached: true,
            from: Some("HEAD"),
            to: Some("HEAD~2"),
        };
        assert_eq!(
            plan_diff_name_status(options).argv,
            vec![
                "diff",
                "--name-status",
                "-z",
                "--no-ext-diff",
                "--no-textconv",
                "--cached",
                "HEAD",
                "HEAD~2"
            ]
        );
    }

    #[test]
    fn the_whole_change_set_patch_asks_for_the_short_submodule_form() {
        // Without `--submodule=short` a gitlink change would be rendered by recursing
        // into the submodule, which is either absent or an unrelated repository.
        assert_eq!(
            plan_diff_patch_all(DiffOptions::default()).argv,
            vec![
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--patch",
                "--submodule=short"
            ]
        );
    }

    #[test]
    fn the_one_path_patch_is_literal_and_ends_with_the_separator_and_the_path() {
        // A path that looks like a pathspec must stay a file, and a path that looks
        // like an option must stay a path.
        let plan = plan_diff_patch_for_path(":(glob)**", DiffOptions::default());
        assert_eq!(plan.argv[0], "--literal-pathspecs");
        let tail = &plan.argv[plan.argv.len() - 2..];
        assert_eq!(tail, ["--".to_string(), ":(glob)**".to_string()]);

        let dashed = plan_diff_patch_for_path("-n", DiffOptions::default());
        assert_eq!(dashed.argv[dashed.argv.len() - 1], "-n");
    }

    #[test]
    fn every_diff_plan_is_a_read_with_no_stdin() {
        let plans = [
            plan_diff_name_status(DiffOptions::default()),
            plan_diff_numstat(DiffOptions::default()),
            plan_diff_patch_all(DiffOptions::default()),
            plan_diff_patch_for_path("a.txt", DiffOptions::default()),
        ];
        for plan in plans {
            assert_eq!(plan.deadline_class, DeadlineClass::Read);
            assert!(plan.stdin.is_empty());
        }
    }
}
