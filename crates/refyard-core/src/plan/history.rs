//! Argument vectors for the history reads: the topology walk, the object batch that
//! carries commit bodies and blobs, and the check that a name really is a commit.
//!
//! Two properties matter more than the option list:
//!
//! - tips arrive on **stdin**, one per line, so a name can never be read as an option
//!   and no shell or argv quoting is involved;
//! - the walk is pinned to the tips the caller recorded, not to a ref name, so a page
//!   that took a while cannot interleave commits from a branch that moved underneath
//!   it. The caller reports the moved tips instead.
//!
//! Object bodies come from `cat-file --batch`, whose length framing is the only reason
//! a commit message containing a quote, a newline or a backslash survives the trip.
//!
//! The reference's planner also carries the authorised directory handle, a command
//! description and a text-search locale; `GitPlan` has none of those, because the host
//! binds the directory and names the command when it runs the plan.

use crate::bytes::is_object_name;
use crate::plan::GitPlan;
use crate::problem::CoreError;

/// Everything the topology walk narrows on, mirroring the reference's option object.
///
/// Host-normalised predicates only: no Git pattern and no option list is accepted, so
/// a caller cannot turn a filter into an argument.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RevListOptions<'a> {
    /// The tips the page was started from. Object names, never ref names.
    pub tips: &'a [&'a str],
    pub max_count: i64,
    pub skip: i64,
    pub first_parent_only: bool,
    /// Evaluate one located commit with the same predicates, without walking parents.
    pub only_oid: Option<&'a str>,
    pub message: Option<&'a str>,
    pub author: Option<&'a str>,
    pub committed_after_seconds: Option<i64>,
    pub committed_before_seconds: Option<i64>,
    pub path_text: Option<&'a str>,
}

impl<'a> RevListOptions<'a> {
    /// A page of `max_count` rows, skipping `skip`, over `tips`.
    ///
    /// `max_count` and `skip` are required rather than defaulted, because zero is a
    /// meaningful value for both and a default would be indistinguishable from intent.
    pub fn new(tips: &'a [&'a str], max_count: i64, skip: i64) -> Self {
        Self {
            tips,
            max_count,
            skip,
            ..Self::default()
        }
    }
}

/// `git rev-list --topo-order --parents --max-count=… [filters] --stdin [-- <path>]`.
pub fn plan_rev_list(options: RevListOptions<'_>) -> Result<GitPlan, CoreError> {
    let RevListOptions {
        tips,
        max_count,
        skip,
        first_parent_only,
        only_oid,
        message,
        author,
        committed_after_seconds,
        committed_before_seconds,
        path_text,
    } = options;

    if let Some(oid) = only_oid {
        if !is_object_name(oid.as_bytes()) {
            return Err(CoreError::invalid_input("onlyOid must be a full object ID"));
        }
    }
    if tips.is_empty() && only_oid.is_none() {
        return Err(CoreError::invalid_input(
            "planRevList requires at least one tip",
        ));
    }

    // Git stores commit timestamps as unsigned seconds, so a pre-epoch upper bound
    // selects no commit rather than every commit before it.
    let effective_max_count = match committed_before_seconds {
        Some(seconds) if seconds < 0 => 0,
        _ => max_count,
    };
    let mut argv = argv(&[
        "rev-list",
        "--topo-order",
        "--parents",
        &format!("--max-count={effective_max_count}"),
    ]);
    if path_text.is_some() {
        // A user-supplied path must not be read as a pattern; the reference places
        // this before the subcommand, which is where git accepts it.
        argv.insert(0, "--literal-pathspecs".to_string());
    }
    if only_oid.is_some() {
        argv.push("--no-walk=unsorted".to_string());
    }
    if skip > 0 {
        argv.push(format!("--skip={skip}"));
    }
    if first_parent_only {
        argv.push("--first-parent".to_string());
    }
    if message.is_some() || author.is_some() {
        // Fixed strings and a case-insensitive match: the filters are host-normalised
        // predicates, not regular expressions a caller chose.
        argv.push("--fixed-strings".to_string());
        argv.push("--regexp-ignore-case".to_string());
    }
    if let Some(message) = message {
        argv.push(format!("--grep={message}"));
    }
    if let Some(author) = author {
        argv.push(format!("--author={author}"));
    }
    if let Some(seconds) = committed_after_seconds {
        if seconds >= 0 {
            // `--since-as-filter` keeps the walk whole; a cutoff that stopped
            // traversal would lose newer ancestors of older children. The complete
            // date grammar is used because a bare `@seconds` can be guessed.
            argv.push(format!("--since-as-filter=@{seconds} +0000"));
        }
    }
    if let Some(seconds) = committed_before_seconds {
        if seconds >= 0 {
            argv.push(format!("--min-age={seconds}"));
        }
    }
    argv.push("--stdin".to_string());
    if let Some(path) = path_text {
        argv.push("--".to_string());
        argv.push(path.to_string());
    }

    // One located commit replaces the tip list: the page is that commit's row alone.
    let selected: Vec<&str> = match only_oid {
        Some(oid) => vec![oid],
        None => tips.to_vec(),
    };
    let mut plan = GitPlan::new(argv);
    plan.stdin = names_stdin(&selected);
    Ok(plan)
}

/// `git cat-file --batch`, with the object names on stdin.
pub fn plan_cat_file_batch(object_names: &[&str]) -> Result<GitPlan, CoreError> {
    if object_names.is_empty() {
        return Err(CoreError::invalid_input(
            "planCatFileBatch requires at least one object name",
        ));
    }
    let mut plan = GitPlan::new(argv(&["cat-file", "--batch"]));
    plan.stdin = names_stdin(object_names);
    Ok(plan)
}

/// One blob's content through the same object protocol. Used for previews.
pub fn plan_cat_file_blob(object_name: &str) -> GitPlan {
    let mut plan = GitPlan::new(argv(&["cat-file", "--batch"]));
    plan.stdin = names_stdin(&[object_name]);
    plan
}

/// `git rev-parse --verify --quiet <name>^{commit}`.
///
/// `--verify --quiet` turns "this name no longer resolves" into a plain exit status
/// instead of a message to be matched, and `^{commit}` refuses a tag or a tree that
/// merely happens to be named like a commit. The name must already be a resolved
/// object name: the host derives tips from `rev-parse` output and never passes a ref
/// name or user text here, which is why the reference does not re-validate it either.
pub fn plan_rev_parse_commit(object_name: &str) -> GitPlan {
    GitPlan::new(argv(&[
        "rev-parse",
        "--verify",
        "--quiet",
        &format!("{object_name}^{{commit}}"),
    ]))
}

/// One name per line on stdin, with a trailing newline.
///
/// Names are separated by newlines rather than NULs because that is what `rev-list
/// --stdin` and `cat-file --batch` read; each name must already be a full object name,
/// and a newline inside one is therefore impossible.
fn names_stdin(names: &[&str]) -> Vec<u8> {
    let mut stdin = Vec::new();
    for name in names {
        stdin.extend_from_slice(name.as_bytes());
        stdin.push(b'\n');
    }
    stdin
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::DeadlineClass;

    const TIP_A: &str = "fef12e3705ae5eb4037d164d06a78a9dda8392c2";
    const TIP_B: &str = "d21595332413c62dbd2bc0b53bd88575d5a61a1b";

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn the_walk_reads_its_tips_from_stdin() {
        // Tips on stdin and not in argv: a ref name cannot be read as an option, and
        // the page cannot follow a branch that moved after the snapshot.
        let plan = plan_rev_list(RevListOptions::new(&[TIP_A, TIP_B], 50, 0)).expect("plan");
        assert_eq!(
            plan.argv,
            strings(&[
                "rev-list",
                "--topo-order",
                "--parents",
                "--max-count=50",
                "--stdin"
            ])
        );
        assert_eq!(plan.stdin, format!("{TIP_A}\n{TIP_B}\n").into_bytes());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn a_user_path_is_literal_and_comes_after_the_separator() {
        let options = RevListOptions {
            path_text: Some(":(glob)**"),
            ..RevListOptions::new(&[TIP_A], 50, 0)
        };
        let plan = plan_rev_list(options).expect("plan");
        assert_eq!(plan.argv[0], "--literal-pathspecs");
        assert_eq!(
            plan.argv[plan.argv.len() - 2..].to_vec(),
            strings(&["--", ":(glob)**"])
        );
    }

    #[test]
    fn every_narrowing_option_is_emitted_in_the_reference_order() {
        // The order is the reference's; each option is a separate condition there, and
        // reordering them here would silently change which filters combine.
        let options = RevListOptions {
            first_parent_only: true,
            only_oid: Some(TIP_A),
            message: Some("fix"),
            author: Some("Person"),
            committed_after_seconds: Some(100),
            committed_before_seconds: Some(200),
            path_text: Some("src/lib.rs"),
            ..RevListOptions::new(&[], 50, 10)
        };
        let plan = plan_rev_list(options).expect("plan");
        assert_eq!(
            plan.argv,
            strings(&[
                "--literal-pathspecs",
                "rev-list",
                "--topo-order",
                "--parents",
                "--max-count=50",
                "--no-walk=unsorted",
                "--skip=10",
                "--first-parent",
                "--fixed-strings",
                "--regexp-ignore-case",
                "--grep=fix",
                "--author=Person",
                "--since-as-filter=@100 +0000",
                "--min-age=200",
                "--stdin",
                "--",
                "src/lib.rs",
            ])
        );
        assert_eq!(plan.stdin, format!("{TIP_A}\n").into_bytes());
    }

    #[test]
    fn a_located_commit_replaces_the_tip_list() {
        let options = RevListOptions {
            only_oid: Some(TIP_B),
            ..RevListOptions::new(&[TIP_A], 1, 0)
        };
        let plan = plan_rev_list(options).expect("plan");
        assert!(plan.argv.iter().any(|arg| arg == "--no-walk=unsorted"));
        // The located commit is the only thing on stdin; the page's tips are not
        // walked, because the caller asked for that one row.
        assert_eq!(plan.stdin, format!("{TIP_B}\n").into_bytes());
    }

    #[test]
    fn a_pre_epoch_upper_bound_selects_no_commit_instead_of_every_commit() {
        // Git timestamps are unsigned; passing a negative value through would make the
        // walk return history that the caller asked to exclude.
        let options = RevListOptions {
            committed_before_seconds: Some(-1),
            ..RevListOptions::new(&[TIP_A], 50, 0)
        };
        let plan = plan_rev_list(options).expect("plan");
        assert!(plan.argv.contains(&"--max-count=0".to_string()));
        assert!(!plan.argv.iter().any(|arg| arg.starts_with("--min-age")));
    }

    #[test]
    fn refuses_an_only_oid_that_is_not_a_full_object_name() {
        let options = RevListOptions {
            only_oid: Some("HEAD"),
            ..RevListOptions::new(&[TIP_A], 50, 0)
        };
        let error = plan_rev_list(options).expect_err("not an object name");
        assert!(matches!(error, CoreError::InvalidInput { .. }));
    }

    #[test]
    fn refuses_a_walk_with_no_tip_and_no_located_commit() {
        let error = plan_rev_list(RevListOptions::new(&[], 50, 0)).expect_err("no tips");
        assert!(error.to_string().contains("at least one tip"));
    }

    #[test]
    fn the_object_batch_sends_every_name_on_stdin() {
        let plan = plan_cat_file_batch(&[TIP_A, TIP_B]).expect("plan");
        assert_eq!(plan.argv, strings(&["cat-file", "--batch"]));
        assert_eq!(plan.stdin, format!("{TIP_A}\n{TIP_B}\n").into_bytes());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn the_object_batch_refuses_an_empty_name_list() {
        // `cat-file --batch` with no input blocks waiting for stdin that will never
        // come; the caller must be told it asked for nothing.
        let error = plan_cat_file_batch(&[]).expect_err("empty");
        assert!(matches!(error, CoreError::InvalidInput { .. }));
    }

    #[test]
    fn one_blob_is_read_through_the_same_protocol() {
        let plan = plan_cat_file_blob(TIP_A);
        assert_eq!(plan.argv, strings(&["cat-file", "--batch"]));
        assert_eq!(plan.stdin, format!("{TIP_A}\n").into_bytes());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }

    #[test]
    fn the_commit_check_asks_for_the_commit_peel() {
        let plan = plan_rev_parse_commit(TIP_A);
        assert_eq!(
            plan.argv,
            strings(&[
                "rev-parse",
                "--verify",
                "--quiet",
                "fef12e3705ae5eb4037d164d06a78a9dda8392c2^{commit}"
            ])
        );
        assert!(plan.stdin.is_empty());
        assert_eq!(plan.deadline_class, DeadlineClass::Read);
    }
}
