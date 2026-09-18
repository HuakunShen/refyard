//! The SSH host listing, against real files in a temporary `~/.ssh`.
//!
//! The listing's whole promise is that it reads the machine's own configuration and
//! nothing else. Every fixture here is a file this test staged into its own temporary
//! directory — never the developer's real `~/.ssh` — no case reaches a server, and the
//! one case that stages a configuration naming commands asserts that none of them ran.
//!
//! Every listing runs under `within`'s deadline: a walk that could not terminate would
//! hang the picker, so a hang has to be a visible failure rather than a test that waits.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

use refyard_contract::host::SshHostList;
use refyard_contract::problem::ProblemCode;
use refyard_host::ssh::{concrete_aliases, ConfigCatalogue};

/// The workspace fixtures, resolved from the crate root so the test does not depend on
/// the directory cargo was invoked from.
fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/ssh-config")
}

/// Runs one listing under a deadline.
async fn within<F: Future>(future: F) -> F::Output {
    tokio::time::timeout(Duration::from_secs(10), future)
        .await
        .expect("the listing finished")
}

/// A temporary `~/.ssh` plus the fixtures staged into it.
struct Stage {
    _temp: tempfile::TempDir,
    ssh: PathBuf,
}

impl Stage {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temporary directory");
        let ssh = temp.path().join("ssh");
        std::fs::create_dir_all(&ssh).expect("create the fixture SSH directory");
        Self { _temp: temp, ssh }
    }

    /// The temporary root, for paths outside `~/.ssh`.
    fn root(&self) -> &Path {
        self._temp.path()
    }

    /// A directory that is not the SSH directory, for the relative-include case.
    fn elsewhere(&self) -> PathBuf {
        self.root().join("elsewhere")
    }

    fn copy_to(&self, fixture: &str, destination: &Path) -> PathBuf {
        let source = fixtures().join(fixture);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).expect("create the destination directory");
        }
        std::fs::copy(&source, destination).expect("stage the fixture");
        destination.to_path_buf()
    }

    fn copy(&self, fixture: &str, relative: &str) -> PathBuf {
        self.copy_to(fixture, &self.ssh.join(relative))
    }

    fn write(&self, relative: &str, text: &str) -> PathBuf {
        let path = self.ssh.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create the destination directory");
        }
        std::fs::write(&path, text).expect("write the file");
        path
    }

    /// A catalogue whose source is this stage's `config`, with `include_base` this
    /// stage's SSH directory — the same shape the service builds from a user's home.
    fn catalogue(&self) -> ConfigCatalogue {
        ConfigCatalogue::new(self.ssh.join("config"), self.ssh.clone())
    }

    async fn list(&self) -> SshHostList {
        within(self.catalogue().list())
            .await
            .expect("the listing is a read")
    }
}

fn aliases(listing: &SshHostList) -> Vec<String> {
    listing
        .hosts
        .iter()
        .map(|host| host.alias.clone())
        .collect()
}

fn codes(listing: &SshHostList) -> Vec<String> {
    listing
        .warnings
        .iter()
        .map(|warning| warning.code.clone())
        .collect()
}

fn ids(listing: &SshHostList) -> Vec<(String, String)> {
    listing
        .hosts
        .iter()
        .map(|host| (host.host_id.clone(), host.source_id.clone()))
        .collect()
}

/// The contract's prefixed-id rule, checked without a pattern library.
fn is_prefixed_id(id: &str, prefix: &str) -> bool {
    match id.strip_prefix(&format!("{prefix}_")) {
        Some(rest) => {
            !rest.is_empty()
                && rest.len() <= 96
                && rest.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '_' || character == '-'
                })
        }
        None => false,
    }
}

fn all_incomplete(listing: &SshHostList) -> bool {
    !listing.hosts.is_empty() && listing.hosts.iter().all(|host| host.discovery_incomplete)
}

#[test]
fn concrete_aliases_are_not_wildcard_rules() {
    let names = concrete_aliases("Host prod staging\nHost *.corp !blocked\nHost bare\n")
        .expect("the text lexes");
    assert_eq!(names, vec!["prod", "staging", "bare"]);
}

#[test]
fn a_host_line_with_no_options_is_still_a_candidate() {
    // Nothing is configured for it, but a person who wrote the line means to reach it.
    assert_eq!(
        concrete_aliases("Host bare\n").expect("the text lexes"),
        vec!["bare"]
    );
}

#[test]
fn wildcards_and_negations_contribute_nothing() {
    assert!(concrete_aliases("Host *.corp !blocked\n")
        .expect("the text lexes")
        .is_empty());
    assert!(concrete_aliases("Host web?\n")
        .expect("the text lexes")
        .is_empty());
    assert!(concrete_aliases("Host %h\n")
        .expect("the text lexes")
        .is_empty());
}

#[test]
fn aliases_are_in_file_order_and_the_first_occurrence_wins() {
    let names = concrete_aliases("Host zeta alpha\nHost alpha beta\n").expect("the text lexes");
    assert_eq!(names, vec!["zeta", "alpha", "beta"]);
}

#[tokio::test]
async fn keywords_are_case_insensitive_and_host_equals_is_a_header() {
    let stage = Stage::new();
    stage.copy("keywords.conf", "config");

    let listing = stage.list().await;

    assert_eq!(
        aliases(&listing),
        vec!["UpperCase", "EqualForm", "Tabbed", "Too"],
        "keyword case, `Host=value`, tabs and comments must all be read the way OpenSSH reads them"
    );
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn an_include_cycle_stops_that_chain_with_a_warning() {
    let stage = Stage::new();
    stage.copy("cycle/root.conf", "config");
    stage.copy("cycle/one.conf", "one.conf");
    stage.copy("cycle/two.conf", "two.conf");

    let listing = within(stage.catalogue().list())
        .await
        .expect("a cycle is a warning, not a failed listing");

    assert_eq!(
        aliases(&listing),
        vec!["cycle-root", "cycle-one", "cycle-two"],
        "every file on the cycle is read exactly once"
    );
    assert!(codes(&listing).contains(&"include-cycle".to_string()));
    assert!(
        all_incomplete(&listing),
        "a configuration with a cycle was not fully accounted for"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn an_alias_of_a_file_in_the_chain_is_a_cycle_too() {
    let stage = Stage::new();
    stage.write("config", "Host symlink-root\nInclude alias.conf\n");
    std::os::unix::fs::symlink(stage.ssh.join("config"), stage.ssh.join("alias.conf"))
        .expect("symlink to the file already open");

    let listing = within(stage.catalogue().list()).await.expect("completes");

    assert_eq!(aliases(&listing), vec!["symlink-root"]);
    assert!(
        codes(&listing).contains(&"include-cycle".to_string()),
        "a second path to the same open file is the same cycle"
    );
}

#[tokio::test]
async fn a_quoted_include_path_containing_a_space_is_read() {
    let stage = Stage::new();
    stage.copy("quoted/root.conf", "config");
    stage.copy("quoted/sub dir/space name.conf", "sub dir/space name.conf");

    let listing = stage.list().await;

    assert_eq!(aliases(&listing), vec!["quoted-root", "from-quoted-path"]);
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn a_relative_include_resolves_against_the_include_base() {
    let stage = Stage::new();
    // The including file is deliberately not in include_base: if the path resolved
    // against the including file's directory, sibling.conf would be missing.
    stage.copy_to("relative/including.conf", &stage.elsewhere().join("config"));
    stage.copy("relative/sibling.conf", "sibling.conf");
    assert!(!stage.elsewhere().join("sibling.conf").exists());

    let catalogue = ConfigCatalogue::new(stage.elsewhere().join("config"), stage.ssh.clone());
    let listing = within(catalogue.list()).await.expect("completes");

    assert_eq!(
        aliases(&listing),
        vec!["relative-root", "from-include-base"]
    );
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn an_absent_primary_config_is_an_empty_list_with_no_warnings() {
    let stage = Stage::new();

    let listing = stage.list().await;

    assert!(listing.hosts.is_empty());
    assert!(
        listing.warnings.is_empty(),
        "no config file is the normal state of a machine, not a problem to report"
    );
    assert!(
        !listing.revision.is_empty(),
        "a revision names the empty source set too"
    );
}

#[tokio::test]
async fn an_include_line_may_name_several_files() {
    let stage = Stage::new();
    stage.write(
        "config",
        "Host multi-root\nInclude first.conf second.conf\n",
    );
    stage.write("first.conf", "Host from-first\n");
    stage.write("second.conf", "Host from-second\n");

    let listing = stage.list().await;

    assert_eq!(
        aliases(&listing),
        vec!["multi-root", "from-first", "from-second"],
        "include arguments are read in the order they are written"
    );
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn a_tilde_include_resolves_against_the_ssh_directorys_parent() {
    let stage = Stage::new();
    stage.write("config", "Host tilde-root\nInclude ~/shared.conf\n");
    stage.copy_to("relative/sibling.conf", &stage.root().join("shared.conf"));

    let listing = stage.list().await;

    assert_eq!(aliases(&listing), vec!["tilde-root", "from-include-base"]);
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn a_token_dependent_include_is_reported_not_guessed() {
    let stage = Stage::new();
    stage.write("config", "Host token-root\nInclude %d/conf.d/*.conf\n");

    let listing = stage.list().await;

    assert_eq!(aliases(&listing), vec!["token-root"]);
    assert!(
        codes(&listing).contains(&"include-unenumerable".to_string()),
        "the walk cannot know what %d expands to: {:?}",
        codes(&listing)
    );
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn a_file_with_an_unterminated_quote_is_reported_as_unparsable() {
    let stage = Stage::new();
    stage.write("config", "Host ok\nHost \"unterminated\n");

    let listing = stage.list().await;

    assert!(
        aliases(&listing).is_empty(),
        "where an argument ends is not knowable, so the file names no candidates"
    );
    assert!(
        codes(&listing).contains(&"config-unparsable".to_string()),
        "{:?}",
        codes(&listing)
    );
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_include_leaves_the_readable_hosts_and_says_so() {
    use std::os::unix::fs::PermissionsExt;

    let stage = Stage::new();
    stage.copy("partial/root.conf", "config");
    stage.copy("partial/readable.conf", "readable.conf");
    let locked = stage.copy("partial/locked.conf", "locked.conf");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000))
        .expect("make the include unreadable");

    let listing = within(stage.catalogue().list()).await.expect("completes");

    assert_eq!(
        aliases(&listing),
        vec!["partial-root", "from-readable"],
        "one unreadable include must not hide the hosts the readable ones declare"
    );
    assert!(codes(&listing).contains(&"include-unreadable".to_string()));
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn glob_expansion_is_lexicographic() {
    let stage = Stage::new();
    stage.copy("glob/root.conf", "config");
    // Staged out of order: sorted expansion, not the order the directory was written in.
    stage.copy("glob/glob.d/z.conf", "glob.d/z.conf");
    stage.copy("glob/glob.d/a.conf", "glob.d/a.conf");
    stage.copy("glob/glob.d/m.conf", "glob.d/m.conf");

    let listing = stage.list().await;

    assert_eq!(
        aliases(&listing),
        vec!["glob-root", "glob-a", "glob-m", "glob-z"]
    );
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn a_glob_that_matches_nothing_is_not_a_warning_but_a_named_missing_include_is() {
    let stage = Stage::new();
    stage.write("config", "Host glob-empty-root\nInclude missing/*.conf\n");

    let listing = stage.list().await;

    assert_eq!(aliases(&listing), vec!["glob-empty-root"]);
    assert!(
        listing.warnings.is_empty(),
        "a glob that finds no files enumerated everything there is: {:?}",
        codes(&listing)
    );
    assert!(!all_incomplete(&listing));

    let stage = Stage::new();
    stage.write("config", "Host named-missing-root\nInclude absent.conf\n");

    let listing = stage.list().await;

    assert_eq!(aliases(&listing), vec!["named-missing-root"]);
    assert!(
        codes(&listing).contains(&"include-missing".to_string()),
        "a path named literally was expected to exist: {:?}",
        codes(&listing)
    );
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn the_depth_limit_stops_the_walk_with_a_warning() {
    let stage = Stage::new();
    stage.write("config", "Host depth-root\nInclude level-1.conf\n");
    for index in 1..=6 {
        stage.write(
            &format!("level-{index}.conf"),
            &format!("Host depth-{index}\nInclude level-{}.conf\n", index + 1),
        );
    }

    let mut catalogue = stage.catalogue();
    assert_eq!(catalogue.limits.depth, 8, "the plan's depth budget");
    assert_eq!(catalogue.limits.files, 128, "the plan's file budget");
    assert_eq!(
        catalogue.limits.bytes,
        2 * 1024 * 1024,
        "the plan's byte budget"
    );
    catalogue.limits.depth = 3;

    let listing = within(catalogue.list()).await.expect("completes");

    assert_eq!(
        aliases(&listing),
        vec!["depth-root", "depth-1", "depth-2", "depth-3"]
    );
    assert!(codes(&listing).contains(&"include-depth-limit".to_string()));
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn the_file_limit_stops_the_walk_with_a_warning() {
    let stage = Stage::new();
    stage.write("config", "Host root\nInclude one.conf\n");
    stage.write("one.conf", "Host one\nInclude two.conf\n");
    stage.write("two.conf", "Host two\n");

    let mut catalogue = stage.catalogue();
    catalogue.limits.files = 1;

    let listing = within(catalogue.list()).await.expect("completes");

    assert_eq!(aliases(&listing), vec!["root"]);
    assert!(codes(&listing).contains(&"include-file-limit".to_string()));
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn the_byte_limit_stops_the_walk_with_a_warning() {
    let stage = Stage::new();
    stage.write("config", "Host small\nInclude big.conf\n");
    stage.write(
        "big.conf",
        &format!("Host big\n{}", "# padding\n".repeat(64)),
    );

    let mut catalogue = stage.catalogue();
    catalogue.limits.bytes = 128;

    let listing = within(catalogue.list()).await.expect("completes");

    assert_eq!(aliases(&listing), vec!["small"]);
    assert!(codes(&listing).contains(&"include-bytes-limit".to_string()));
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn a_match_block_is_not_a_list_of_aliases() {
    let stage = Stage::new();
    stage.copy("match/root.conf", "config");

    let listing = stage.list().await;

    assert_eq!(
        aliases(&listing),
        vec!["listed-before"],
        "the criteria on a Match line are not machines"
    );
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
}

#[tokio::test]
async fn an_include_inside_a_match_block_is_reported_not_read() {
    let stage = Stage::new();
    stage.copy("match/conditional-include.conf", "config");
    stage.copy("match/inside-match.conf", "inside-match.conf");

    let listing = stage.list().await;

    assert_eq!(
        aliases(&listing),
        vec!["listed-before", "listed-after"],
        "OpenSSH reads that Include only when it evaluates the match, so its hosts are not known"
    );
    assert!(
        codes(&listing).contains(&"include-unenumerable".to_string()),
        "{:?}",
        codes(&listing)
    );
    assert!(all_incomplete(&listing));
}

#[tokio::test]
async fn opening_the_listing_executes_nothing_from_the_configuration() {
    let stage = Stage::new();
    let proof = stage.root().join("executed");
    let template =
        std::fs::read_to_string(fixtures().join("exec/root.conf.in")).expect("read the template");
    let config = template.replace("@PROOF@", proof.to_str().expect("utf8 path"));
    stage.write("config", &config);

    let listing = within(stage.catalogue().list()).await.expect("completes");

    assert_eq!(aliases(&listing), vec!["exec-probe"]);
    assert!(listing.warnings.is_empty(), "{:?}", codes(&listing));
    assert!(
        !proof.exists(),
        "the listing ran a command the configuration named"
    );
}

#[tokio::test]
async fn the_revision_binds_the_listing_to_the_bytes_it_read() {
    let stage = Stage::new();
    stage.write("config", "Host prod\nInclude extra.conf\n");
    stage.write("extra.conf", "Host extra\n");

    let first = stage.list().await;
    let second = stage.list().await;

    assert_eq!(aliases(&first), vec!["prod", "extra"]);
    assert_eq!(
        first.revision, second.revision,
        "an unchanged source set has one revision"
    );
    assert_eq!(
        ids(&first),
        ids(&second),
        "a selection made against one listing must survive a re-read"
    );

    stage.write("extra.conf", "Host extro\n");
    let changed = stage.list().await;

    assert_ne!(
        first.revision, changed.revision,
        "one changed byte in an included file must change the revision"
    );
}

#[tokio::test]
async fn ids_are_prefixed_url_safe_and_deterministic_for_their_inputs() {
    let stage = Stage::new();
    stage.copy("basic.conf", "config");

    let listing = stage.list().await;

    assert!(!listing.hosts.is_empty());
    for host in &listing.hosts {
        assert!(is_prefixed_id(&host.host_id, "host"), "{}", host.host_id);
        assert!(
            is_prefixed_id(&host.source_id, "source"),
            "{}",
            host.source_id
        );
        assert_eq!(host.display_label, host.alias);
    }
    let source_ids: Vec<&str> = listing
        .hosts
        .iter()
        .map(|host| host.source_id.as_str())
        .collect();
    assert!(source_ids.windows(2).all(|pair| pair[0] == pair[1]));
    assert!(listing.revision.starts_with("sha256-"));
    assert!(
        !listing.revision.is_empty()
            && listing
                .revision
                .chars()
                .all(|character| character.is_ascii_alphanumeric()
                    || character == '-'
                    || character == '_'),
        "{}",
        listing.revision
    );

    let again = stage.catalogue().list().await.expect("completes");
    assert_eq!(
        ids(&listing),
        ids(&again),
        "ids are a function of (source path, alias), not of one process"
    );
}

#[tokio::test]
async fn a_source_that_is_not_text_is_refused_rather_than_read_lossily() {
    let stage = Stage::new();
    std::fs::write(stage.ssh.join("config"), b"Host ok\n\xff\xfe\n").expect("write bytes");

    let refused = within(stage.catalogue().list()).await.expect_err("refused");

    // A lossy decode would produce an alias whose bytes are not the file's, and that
    // alias would be sent back to OpenSSH later.
    assert_eq!(refused.code, ProblemCode::InvalidRequest);
}

#[cfg(unix)]
#[tokio::test]
async fn an_unreadable_primary_file_is_refused_not_answered_with_an_empty_list() {
    use std::os::unix::fs::PermissionsExt;

    let stage = Stage::new();
    let config = stage.write("config", "Host hidden\n");
    std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o000))
        .expect("make the primary unreadable");

    let refused = within(stage.catalogue().list()).await.expect_err("refused");

    // An empty list here would say "this machine has no hosts" about a file that exists
    // and could not be read.
    assert_eq!(refused.code, ProblemCode::Forbidden);
}
