//! The SSH provider against a real sshd and a real `git`, on a host with no Refyard.
//!
//! Every test here is `#[ignore]`d because it needs the Docker fixture. Run it as:
//!
//! ```text
//! pnpm native:ssh:fixture -- start
//! cargo test -p refyard-host --test ssh_exec -- --ignored --test-threads=1
//! pnpm native:ssh:fixture -- stop
//! ```
//!
//! `--test-threads=1` is part of the command, not a convenience: the cases share one
//! fixture container and the ones that copy the repository bytes read the same local clone.
//!
//! Two properties are the point of the whole file. First, the *bytes*: each read's plans
//! run over SSH and over a byte-for-byte copy of the same repository on this machine, and
//! the raw stdout has to be identical, because a read's parser must not be able to tell
//! which transport it ran on. Second, the *refusals*: a host key that does not match what
//! the client already knows is a failed connection that changes nothing on disk, not a
//! warning the product talks past.
//!
//! The fixture's client configuration is named with `-F` rather than isolated through
//! `HOME`: OpenSSH reads `~/.ssh/config`, `~/.ssh/known_hosts` and `~` from the passwd
//! entry for the uid, so a scratch `HOME` would silently have used the developer's own
//! files. The fixture's configuration file carries absolute paths to its own key and
//! known_hosts for the same reason.

use std::path::{Path, PathBuf};

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::HistoryQuery;
use refyard_contract::host::{ExecutionTargetKind, ExecutionTargetState};
use refyard_contract::problem::ProblemCode;
use refyard_core::parse::cat_file::{CatFileDecoder, CatFileEntry, CatFileObjectType};
use refyard_core::parse::meta::parse_rev_list_topology;
use refyard_core::parse::status::{parse_status, StatusRecordKind};
use refyard_core::plan::diff::{plan_diff_patch_all, plan_diff_patch_for_path, DiffOptions};
use refyard_core::plan::history::{plan_cat_file_batch, plan_rev_list, RevListOptions};
use refyard_core::plan::status::{plan_head_oid, plan_status, StatusOptions};
use refyard_host::process::RunOutcome;
use refyard_host::providers::local::LocalGit;
use refyard_host::providers::ssh::SshGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};
use refyard_host::ssh::openssh;
use refyard_host::targets::CreateTargetRequest;

/// The file whose name carries an apostrophe and spaces: the quoting layer's end-to-end case.
const PUNCTUATED_PATH: &str = "weird 'quoted' name.txt";

/// What `scripts/native-ssh-fixture.ts` wrote when it started the container.
struct Fixture {
    alias: String,
    config_file: PathBuf,
    home: PathBuf,
    repo_path: String,
    local_repo_path: PathBuf,
    known_hosts: PathBuf,
}

impl Fixture {
    /// Reads the state file the fixture wrote, or skips the case with a clear message.
    ///
    /// A fixture that is absent or stopped is an environment a case cannot run in, not a
    /// product failure: failing here would report the absence of a container as a broken
    /// transport. The state file survives `stop` on purpose (its keys and local copy are
    /// reused), so liveness is checked by connecting to the address the fixture published —
    /// a refusal or a timeout means nothing is listening, and the case skips.
    fn load_or_skip() -> Option<Self> {
        let path = state_path();
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!(
                "skipping: no SSH fixture state at {}; start it with `pnpm native:ssh:fixture -- start`",
                path.display()
            );
            return None;
        };
        let state: serde_json::Value =
            serde_json::from_str(&text).expect("the fixture state is JSON");
        let field = |name: &str| -> String {
            state
                .get(name)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_else(|| panic!("the fixture state has no {name}"))
                .to_string()
        };
        let fixture = Self {
            alias: field("alias"),
            config_file: PathBuf::from(field("config_file")),
            home: PathBuf::from(field("home")),
            repo_path: field("repo_path"),
            local_repo_path: PathBuf::from(field("local_repo_path")),
            known_hosts: PathBuf::from(field("known_hosts")),
        };
        let host = field("host");
        let port = state.get("port").and_then(serde_json::Value::as_u64);
        if !fixture_is_listening(&host, port) {
            eprintln!(
                "skipping: nothing is listening at {host}:{} (fixture state exists but the container is stopped); start it with `pnpm native:ssh:fixture -- start`",
                port.map(|value| value.to_string()).unwrap_or_else(|| "?".to_string())
            );
            return None;
        }
        Some(fixture)
    }
}

/// Whether the fixture's published port accepts a connection.
///
/// A TCP check rather than an SSH one: it needs no key, no configuration and no host key,
/// and it answers exactly the question "is the container still running".
fn fixture_is_listening(host: &str, port: Option<u64>) -> bool {
    let Ok(address) = host.parse::<std::net::IpAddr>() else {
        return false;
    };
    let Some(port) = port.and_then(|value| u16::try_from(value).ok()) else {
        return false;
    };
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::new(address, port),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
}

/// The state file, from `REFYARD_SSH_FIXTURE_STATE` or the workspace's own `target/`.
fn state_path() -> PathBuf {
    match std::env::var("REFYARD_SSH_FIXTURE_STATE") {
        Ok(path) => PathBuf::from(path).join("state.json"),
        Err(_) => {
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/native-ssh-fixture/state.json")
        }
    }
}

/// A provider pointed at the fixture's configuration source, with an environment that
/// carries nothing but a `PATH` and the fixture's own home.
fn remote_provider(fixture: &Fixture) -> SshGit {
    SshGit::at_config(
        openssh::discover().expect("ssh is installed on this machine"),
        fixture_environment(&fixture.home),
        &fixture.alias,
        Some(fixture.config_file.clone()),
    )
    .expect("the fixture alias and configuration source are valid")
}

/// A provider reading a config file the test wrote and a different home, for the case that
/// must not reach the real fixture configuration.
fn provider_with_config(fixture: &Fixture, home: &Path, config: PathBuf) -> SshGit {
    SshGit::at_config(
        openssh::discover().expect("ssh is installed on this machine"),
        fixture_environment(home),
        &fixture.alias,
        Some(config),
    )
    .expect("the alias and configuration source are valid")
}

/// The environment the SSH client runs with inside these tests.
///
/// No `SSH_AUTH_SOCK`: the fixture's key comes from its configuration file, so an agent
/// cannot make a failing case pass, and the developer's agent keys are never offered.
fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    vec![
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ),
        ("HOME".to_string(), home.display().to_string()),
        ("LANG".to_string(), "C.UTF-8".to_string()),
        ("TERM".to_string(), "dumb".to_string()),
    ]
}

/// This machine's `git`, with a home of its own and no global configuration, so the local
/// half of every comparison runs under stated conditions rather than the developer's.
fn local_git(home: &Path) -> LocalGit {
    let program = LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf();
    LocalGit::at(
        program,
        vec![
            (
                "PATH".to_string(),
                std::env::var("PATH")
                    .unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
            ),
            ("HOME".to_string(), home.display().to_string()),
            ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
            ("GIT_CONFIG_GLOBAL".to_string(), "/dev/null".to_string()),
            ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
            ("GIT_PAGER".to_string(), "cat".to_string()),
            ("PAGER".to_string(), "cat".to_string()),
        ],
    )
}

/// A temporary home for the local side of a comparison.
fn local_home() -> tempfile::TempDir {
    tempfile::tempdir().expect("a temporary directory")
}

/// Asserts one run produced an answer, with its diagnostic when it did not.
fn expect_success(outcome: &RunOutcome, what: &str) {
    assert!(
        outcome.succeeded(),
        "{what} did not succeed: state {:?} exit {:?} stderr {}",
        outcome.state,
        outcome.exit_code,
        String::from_utf8_lossy(&outcome.stderr)
    );
    assert!(
        outcome.output_complete,
        "{what} answered with a truncated stream"
    );
}

/// HEAD's object name on the far side, as a string.
async fn remote_head(provider: &SshGit, fixture: &Fixture) -> String {
    let plan = plan_head_oid();
    let outcome = provider.run(&fixture.repo_path, plan, None).await;
    expect_success(&outcome, "rev-parse HEAD");
    String::from_utf8(outcome.stdout)
        .expect("an object name is ASCII")
        .trim()
        .to_string()
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn the_remote_repository_opens_and_probes_with_the_same_parsers_as_a_local_one() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);

    let facts = provider
        .probe(&fixture.repo_path)
        .await
        .expect("the fixture host answers the shell, git and layout probes");
    assert!(!facts.layout.is_bare);
    assert_eq!(
        facts.layout.top_level.as_deref(),
        Some(fixture.repo_path.as_str()),
        "the layout query is the local one, run remotely"
    );
    assert_eq!(facts.layout.object_format, "sha1");
    assert!(
        facts
            .git_version
            .chars()
            .next()
            .is_some_and(|first| first.is_ascii_digit()),
        "the remote git reported {:?}",
        facts.git_version
    );

    // `version()` is the same question the capability answer asks a local provider.
    assert!(!provider.version().await.expect("version").is_empty());

    // `open()` asks only the layout question, and gets the same answer.
    let opened = provider.open(&fixture.repo_path).await.expect("open");
    assert_eq!(opened.common_dir, facts.layout.common_dir);
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn status_over_ssh_is_byte_identical_to_the_local_run_on_the_same_repository() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);
    let home = local_home();
    let plan = plan_status(StatusOptions::default());

    let remote = provider.run(&fixture.repo_path, plan.clone(), None).await;
    expect_success(&remote, "status over ssh");
    let local = local_git(home.path())
        .run(&fixture.local_repo_path, &plan, None)
        .await;
    expect_success(&local, "status locally");

    assert_eq!(
        remote.stdout, local.stdout,
        "the transport changed the bytes a status read sees"
    );

    // The bytes are also the answer the status parser expects, and they describe the
    // repository the fixture staged: two modified tracked files and one untracked file.
    let parsed = parse_status(&remote.stdout, 1_000).expect("a status stream");
    assert!(parsed.branch.seen);
    let modified: Vec<Vec<u8>> = parsed
        .records
        .iter()
        .filter(|record| record.kind == StatusRecordKind::Ordinary)
        .map(|record| record.path.clone())
        .collect();
    assert!(modified.contains(&b"a.txt".to_vec()));
    assert!(modified.contains(&PUNCTUATED_PATH.as_bytes().to_vec()));
    assert!(parsed
        .records
        .iter()
        .any(|record| record.kind == StatusRecordKind::Untracked
            && record.path == b"untracked file.txt".to_vec()));
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn history_over_ssh_is_byte_identical_to_the_local_run_on_the_same_repository() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);
    let home = local_home();
    let tip = remote_head(&provider, &fixture).await;
    let plan = plan_rev_list(RevListOptions::new(&[tip.as_str()], 50, 0)).expect("plan");

    let remote = provider.run(&fixture.repo_path, plan.clone(), None).await;
    expect_success(&remote, "rev-list over ssh");
    let local = local_git(home.path())
        .run(&fixture.local_repo_path, &plan, None)
        .await;
    expect_success(&local, "rev-list locally");

    // The tips travel on stdin, so this also proves stdin was not swallowed: an empty
    // stream would make `rev-list --stdin` succeed with no rows at all.
    assert_eq!(
        remote.stdout, local.stdout,
        "the transport changed the bytes a history read sees"
    );
    let rows = parse_rev_list_topology(&remote.stdout).expect("a topology walk");
    assert_eq!(rows.len(), 2, "the fixture made two commits");
    assert_eq!(rows[0].oid, tip);
    assert!(rows[0].parent_oids.len() == 1);
    assert!(
        rows[1].parent_oids.is_empty(),
        "the root commit has no parent"
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn diffs_over_ssh_are_byte_identical_to_the_local_run_including_a_quoted_path_argument() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);
    let home = local_home();
    let local = local_git(home.path());

    let whole = plan_diff_patch_all(DiffOptions::default());
    let remote = provider.run(&fixture.repo_path, whole.clone(), None).await;
    expect_success(&remote, "diff over ssh");
    let local_outcome = local.run(&fixture.local_repo_path, &whole, None).await;
    expect_success(&local_outcome, "diff locally");
    assert_eq!(
        remote.stdout, local_outcome.stdout,
        "the transport changed the bytes a diff read sees"
    );
    assert!(String::from_utf8_lossy(&remote.stdout).contains(PUNCTUATED_PATH));

    // One path argument, with an apostrophe and spaces in it: the whole point of the
    // quoting layer, exercised end to end rather than asserted as a string.
    let one_path = plan_diff_patch_for_path(PUNCTUATED_PATH, DiffOptions::default());
    let remote = provider
        .run(&fixture.repo_path, one_path.clone(), None)
        .await;
    expect_success(&remote, "single-path diff over ssh");
    let local_outcome = local.run(&fixture.local_repo_path, &one_path, None).await;
    expect_success(&local_outcome, "single-path diff locally");
    assert_eq!(remote.stdout, local_outcome.stdout);
    assert!(
        !remote.stdout.is_empty(),
        "a quoted path argument that reached git as another argument would diff nothing"
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn cat_file_batch_over_ssh_frames_the_objects_its_stdin_named() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);
    let home = local_home();
    let tip = remote_head(&provider, &fixture).await;
    let plan = plan_cat_file_batch(&[tip.as_str()]).expect("plan");
    assert!(
        !plan.stdin.is_empty(),
        "the object name travels on stdin, which is what this test is about"
    );

    let remote = provider.run(&fixture.repo_path, plan.clone(), None).await;
    expect_success(&remote, "cat-file --batch over ssh");
    let local = local_git(home.path())
        .run(&fixture.local_repo_path, &plan, None)
        .await;
    expect_success(&local, "cat-file --batch locally");
    assert_eq!(
        remote.stdout, local.stdout,
        "the transport changed the bytes of a length-framed protocol"
    );

    let mut decoder = CatFileDecoder::new();
    let entries = decoder.push(&remote.stdout).expect("length-framed bodies");
    decoder.finish().expect("the stream ended between objects");
    assert_eq!(entries.len(), 1);
    match &entries[0] {
        CatFileEntry::Object {
            oid,
            object_type,
            body,
        } => {
            assert_eq!(oid, &tip);
            assert_eq!(*object_type, CatFileObjectType::Commit);
            assert!(
                String::from_utf8_lossy(body).contains("fixture: second content"),
                "the commit body did not survive stdin and the framed stream"
            );
        }
        CatFileEntry::Missing { input } => {
            panic!("the fixture's own commit was reported missing: {input}")
        }
    }
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_cancelled_attempt_stops_the_local_ssh_and_reports_cancelled() {
    use refyard_host::process::cancellation;
    use refyard_host::process::{ExecutionState, TerminationReason};

    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let provider = remote_provider(&fixture);
    let (handle, signal) = cancellation();
    // Cancelled before the attempt starts: the deadline branch of the runner resolves on
    // its first poll, so this is the cancel path and not a race with a fast connection.
    handle.cancel();
    let plan = plan_status(StatusOptions::default());
    let outcome = provider.run(&fixture.repo_path, plan, Some(signal)).await;
    assert_eq!(outcome.state, ExecutionState::Interrupted);
    assert_eq!(outcome.termination, Some(TerminationReason::Cancelled));
    assert_eq!(outcome.exit_code, None);
    // The local `ssh` was killed rather than left holding the session.
    assert!(outcome.stdout.is_empty());
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn an_expired_attempt_deadline_kills_the_local_ssh_rather_than_waiting_for_it() {
    use refyard_host::process::{ExecutionState, TerminationReason};
    use refyard_host::ssh::connection::SshConnection;
    use refyard_host::ssh::quote::remote_git_command;

    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let connection = SshConnection::with_config_file(
        openssh::discover().expect("ssh is installed on this machine"),
        fixture_environment(&fixture.home),
        &fixture.alias,
        Some(fixture.config_file.clone()),
    )
    .expect("a valid connection");
    let command = remote_git_command(&fixture.repo_path, &["--version".to_string()])
        .expect("an encodable command");

    let started = std::time::Instant::now();
    let outcome = connection
        .run(
            &command,
            Vec::new(),
            std::time::Duration::from_millis(1),
            64 * 1024,
            64 * 1024,
            None,
        )
        .await;
    assert_eq!(outcome.state, ExecutionState::Interrupted);
    assert_eq!(outcome.termination, Some(TerminationReason::Timeout));
    assert!(
        started.elapsed() < std::time::Duration::from_secs(10),
        "the deadline did not stop the attempt: {:?} elapsed",
        started.elapsed()
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_host_key_that_does_not_match_what_the_client_knows_is_refused() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let scratch = tempfile::tempdir().expect("a temporary directory");
    let ssh_dir = scratch.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).expect("create the scratch .ssh");

    // A known_hosts entry for the same host and port holding a *different* key: exactly
    // what an attacker in the middle would present, and what a first contact with the
    // right key must never be confused with.
    let known = std::fs::read_to_string(&fixture.known_hosts).expect("the fixture's known_hosts");
    let mutated: String = known
        .split_whitespace()
        .enumerate()
        .map(|(index, field)| {
            if index == 2 {
                let mut bytes = field.as_bytes().to_vec();
                let position = bytes.len() / 2;
                bytes[position] = if bytes[position] == b'A' { b'B' } else { b'A' };
                String::from_utf8(bytes).expect("base64 is UTF-8")
            } else {
                field.to_string()
            }
        })
        .collect::<Vec<String>>()
        .join(" ");
    let poisoned = ssh_dir.join("known_hosts");
    std::fs::write(&poisoned, format!("{mutated}\n")).expect("write the wrong key");

    // The fixture's own configuration, with only the known_hosts path changed, so the
    // option list and every other input stay exactly what the passing cases use.
    let config = std::fs::read_to_string(&fixture.config_file).expect("the fixture config");
    let config = config.replace(
        fixture.known_hosts.to_str().expect("a UTF-8 path"),
        poisoned.to_str().expect("a UTF-8 path"),
    );
    let config_path = ssh_dir.join("config");
    std::fs::write(&config_path, config).expect("write the scratch config");

    let provider = provider_with_config(&fixture, scratch.path(), config_path);
    let plan = plan_status(StatusOptions::default());
    let outcome = provider.run(&fixture.repo_path, plan, None).await;

    assert!(!outcome.succeeded(), "a wrong host key must not connect");
    assert_eq!(outcome.exit_code, Some(255), "ssh refused the connection");
    assert!(
        outcome.stdout.is_empty(),
        "a refused connection must not produce read output"
    );
    let diagnostic = String::from_utf8_lossy(&outcome.stderr);
    assert!(
        diagnostic.contains("Host key verification failed")
            || diagnostic.contains("REMOTE HOST IDENTIFICATION HAS CHANGED"),
        "unexpected diagnostic: {diagnostic}"
    );

    // The client's known_hosts is the user's file: a failed connection must leave it
    // exactly as it was, and must not have written a new key anywhere beside it.
    let after = std::fs::read_to_string(&poisoned).expect("the poisoned known_hosts");
    assert_eq!(after, format!("{mutated}\n"));
    assert!(!ssh_dir.join("known_hosts.old").exists());
}

#[tokio::test]
#[ignore = "requires this machine's own OpenSSH; no fixture container is needed"]
async fn the_machines_openssh_accepts_the_fixed_option_set() {
    let policy = refyard_host::ssh::policy::probe_this_machine()
        .await
        .expect("this machine's OpenSSH accepts the safety options");
    assert!(
        policy.version.contains("OpenSSH"),
        "got {:?}",
        policy.version
    );
    assert_eq!(policy.options.len(), openssh::SAFETY_OPTIONS.len());
    // The probe runs one connection attempt per option against a port nothing listens on;
    // a build that did not know an option would have refused it before connecting.
    assert!(!policy.executable.is_empty());
}

/// The client half of the fixture state has to be a real, private set of files: a fixture
/// that reused a world-readable key would still pass every byte comparison.
#[test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
fn the_fixture_client_files_exist_and_the_key_is_private() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    assert!(fixture.config_file.is_file(), "{:?}", fixture.config_file);
    assert!(fixture.known_hosts.is_file(), "{:?}", fixture.known_hosts);
    assert!(fixture.home.is_dir(), "{:?}", fixture.home);
    assert!(
        fixture.local_repo_path.join(".git").is_dir(),
        "{:?}",
        fixture.local_repo_path
    );
    let key = fixture.home.join(".ssh/id_ed25519");
    let metadata = std::fs::metadata(&key).expect("the fixture generated a client key");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            metadata.permissions().mode() & 0o077,
            0,
            "the fixture's private key is readable by other users"
        );
    }
}

/// A service whose local target is this machine's Git under the fixture's scratch home,
/// and whose SSH execution reads the fixture's configuration source with the fixture's own
/// environment: no agent, its own home, its own known_hosts.
///
/// The environment has to be stated rather than inherited: the process's own `HOME` and
/// `SSH_AUTH_SOCK` would make these cases depend on the developer's setup.
fn fixture_service(fixture: &Fixture) -> ApplicationService {
    ApplicationService::new(ApplicationServiceConfig {
        git: local_git(&fixture.home),
        service_instance_id: "srvc_ssh_fixture".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: fixture.home.clone(),
    })
    .with_ssh_config_file(fixture.config_file.clone())
    .with_ssh_environment(fixture_environment(&fixture.home))
}

/// Replaces the values a service mints — repositories, snapshots, cursors, path ids and the
/// read timestamp — with one placeholder, recursively.
///
/// Two repositories are two identities even when their bytes are the same, so these values
/// cannot be equal across the two answers; everything else can and must be. The raw
/// transport bytes are compared directly in the other cases in this file; this helper is for
/// comparing the answers a client would receive.
fn mask_service_ids(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, entry) in map.iter_mut() {
                match key.as_str() {
                    "repositoryId" | "snapshotId" | "readAt" | "pathId" | "oldPathId"
                    | "nextCursor" => {
                        *entry = serde_json::Value::String("<minted>".to_string());
                    }
                    _ => mask_service_ids(entry),
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                mask_service_ids(item);
            }
        }
        _ => {}
    }
}

/// Both answers as masked JSON values, ready to compare.
fn masked<T: serde::Serialize>(value: &T) -> serde_json::Value {
    let mut json = serde_json::to_value(value).expect("a contract DTO serializes");
    mask_service_ids(&mut json);
    json
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn an_ssh_target_is_created_from_the_catalogue_and_probes_ready() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let service = fixture_service(&fixture);

    // The alias the fixture's configuration declares is what the picker offers; the target
    // is created from that candidate, never from a name supplied by the caller of this test.
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the fixture config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == fixture.alias)
        .expect("the fixture alias is in its own config");
    assert!(
        !candidate.discovery_incomplete,
        "the fixture config is fully enumerable"
    );

    let created = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("creating the target is not an error, even when the probe fails");
    assert_eq!(created.state, ExecutionTargetState::Ready);
    assert_eq!(created.kind, ExecutionTargetKind::SshConfig);
    assert_eq!(created.label, fixture.alias);
    assert!(
        !created.remote_path_browse,
        "this build browses no remote path"
    );
    assert_eq!(
        created.target_id,
        refyard_host::targets::ssh_target_id(&candidate.source_id, &fixture.alias),
        "the id is a function of the source and the alias, not of the moment"
    );

    // Asking again re-probes the same host; nothing changed, so it is the same build and
    // the same generation, and a client's snapshots are not invalidated for no reason.
    let again = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("re-created");
    assert_eq!(created, again);
    assert!(service.target_problem(&created.target_id).is_none());

    // The target the service lists carries the same row.
    let listed = service
        .targets()
        .into_iter()
        .find(|summary| summary.target_id == created.target_id)
        .expect("the created target is listed");
    assert_eq!(listed, created);
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_remote_repository_reads_through_the_service_as_the_local_copy_does() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let service = fixture_service(&fixture);
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the fixture config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == fixture.alias)
        .expect("the fixture alias");
    let target = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("target created");
    assert_eq!(
        target.state,
        ExecutionTargetState::Ready,
        "the fixture host must probe ready for this comparison to mean anything"
    );

    // The remote repository is opened on the SSH target, and the byte-for-byte local copy
    // of the same repository on the local target. One service, one set of parsers.
    let remote = service
        .register_repository_on(&fixture.repo_path, Some(&target.target_id))
        .await
        .expect("the remote repository opens");
    let remote_id = remote
        .repositories
        .iter()
        .find(|summary| summary.target_id.as_deref() == Some(target.target_id.as_str()))
        .expect("the remote repository row")
        .repository_id
        .clone();
    let local_path = fixture.local_repo_path.to_str().expect("a UTF-8 path");
    let local = service
        .register_repository(local_path)
        .await
        .expect("the local copy opens");
    let local_id = local
        .repositories
        .iter()
        .find(|summary| summary.repository_id != remote_id)
        .expect("the local repository row")
        .repository_id
        .clone();

    // Status: the same entries from both transports, with only the minted ids masked.
    let remote_status = service
        .status(&StatusQuery::new(&remote_id))
        .await
        .expect("status over ssh");
    let local_status = service
        .status(&StatusQuery::new(&local_id))
        .await
        .expect("status locally");
    assert_eq!(
        masked(&remote_status),
        masked(&local_status),
        "the transport changed the status a client sees"
    );
    assert_eq!(
        remote_status.entries.len(),
        3,
        "two modified, one untracked"
    );

    // History: the same page of the same two commits.
    let query = |repository_id: &str| HistoryQuery {
        repository_id: repository_id.to_string(),
        worktree_id: None,
        cursor: None,
        limit: None,
        detail_oid: None,
        first_parent_only: None,
        message: None,
        author: None,
        oid_prefix: None,
        ref_full_name: None,
        committed_after: None,
        committed_before: None,
        path_id: None,
    };
    let remote_history = service
        .history(&query(&remote_id))
        .await
        .expect("history over ssh");
    let local_history = service
        .history(&query(&local_id))
        .await
        .expect("history locally");
    assert_eq!(
        masked(&remote_history),
        masked(&local_history),
        "the transport changed the history a client sees"
    );
    assert_eq!(remote_history.commits.len(), 2);
    assert!(
        remote_history.commits[0]
            .subject
            .contains("fixture: second content"),
        "the remote commit body did not survive the transport"
    );

    // Diff: the same changed files, with the same counts.
    let diff_query = |repository_id: &str| DiffQuery {
        repository_id: repository_id.to_string(),
        worktree_id: None,
        kind: DiffKind::Unstaged,
        oid: None,
        from: None,
        to: None,
        path_id: None,
        max_bytes: None,
    };
    let remote_diff = service
        .diff(&diff_query(&remote_id))
        .await
        .expect("diff over ssh");
    let local_diff = service
        .diff(&diff_query(&local_id))
        .await
        .expect("diff locally");
    assert_eq!(
        masked(&remote_diff),
        masked(&local_diff),
        "the transport changed the diff a client sees"
    );
    assert_eq!(remote_diff.stats.files_changed, 2);
    assert!(remote_diff
        .files
        .iter()
        .any(|file| file.display_path == PUNCTUATED_PATH));

    // A path id minted by the remote read resolves, and is what a patch request names: the
    // two-step flow a client performs, over the target seam.
    let punctuated = remote_diff
        .files
        .iter()
        .find(|file| file.display_path == PUNCTUATED_PATH)
        .expect("the punctuated path is in the change set");
    let patch = service
        .diff(&DiffQuery {
            path_id: Some(punctuated.path_id.clone()),
            ..diff_query(&remote_id)
        })
        .await
        .expect("a patch for the remote path id");
    assert!(
        patch
            .files
            .iter()
            .any(|file| file.display_path == PUNCTUATED_PATH),
        "the path id resolved to the file it was minted for"
    );
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn disconnecting_the_ssh_target_leaves_the_local_target_reading() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let service = fixture_service(&fixture);
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the fixture config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == fixture.alias)
        .expect("the fixture alias");
    let target = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("target created");
    let remote = service
        .register_repository_on(&fixture.repo_path, Some(&target.target_id))
        .await
        .expect("the remote repository opens");
    let remote_id = remote
        .repositories
        .iter()
        .find(|summary| summary.target_id.as_deref() == Some(target.target_id.as_str()))
        .expect("the remote row")
        .repository_id
        .clone();
    let local = service
        .register_repository(fixture.local_repo_path.to_str().expect("a UTF-8 path"))
        .await
        .expect("the local copy opens");
    let local_id = local
        .repositories
        .iter()
        .find(|summary| summary.repository_id != remote_id)
        .expect("the local row")
        .repository_id
        .clone();

    service
        .disconnect_target(&target.target_id)
        .expect("the SSH target is dropped");
    assert!(service
        .targets()
        .iter()
        .all(|summary| summary.target_id != target.target_id));
    let problem = service
        .status(&StatusQuery::new(&remote_id))
        .await
        .expect_err("the remote repository went with its target");
    assert_eq!(problem.code, ProblemCode::NotFound);
    service
        .status(&StatusQuery::new(&local_id))
        .await
        .expect("the local repository is untouched");
}

#[tokio::test]
#[ignore = "requires this machine's own OpenSSH; no fixture container is needed"]
async fn a_target_whose_probe_fails_is_answered_unavailable_with_its_reason() {
    let Some(ssh) = openssh::discover().ok() else {
        eprintln!("skipping: this machine has no ssh");
        return;
    };
    let _ = ssh;

    // A configuration source that names a port nothing listens on: the probe cannot
    // connect, which is exactly the state a client must be shown next to the target rather
    // than as an error that loses it.
    let scratch = tempfile::tempdir().expect("a temporary directory");
    let ssh_dir = scratch.path().join(".ssh");
    std::fs::create_dir_all(&ssh_dir).expect("create the scratch .ssh");
    std::fs::write(
        ssh_dir.join("config"),
        "Host probe-fails\n  HostName 127.0.0.1\n  Port 1\n  User nobody\n",
    )
    .expect("write the scratch config");

    let service = ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::discover().expect("git is installed on this machine"),
        service_instance_id: "srvc_ssh_probe".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
        home: scratch.path().to_path_buf(),
    });
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the scratch config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == "probe-fails")
        .expect("the scratch alias");

    let created = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("an unreachable host is an unavailable target, not an error");
    assert_eq!(created.state, ExecutionTargetState::Unavailable);
    let problem = service
        .target_problem(&created.target_id)
        .expect("the failure is kept beside the target");
    assert_eq!(problem.code, ProblemCode::Unavailable);
    assert!(
        !problem.message.is_empty(),
        "the failure must be able to explain itself"
    );

    // The same probe answer gives the same generation; a different answer would not.
    let again = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("re-created");
    assert_eq!(created, again);

    // Registering a repository on an unavailable target is refused with the reason.
    let refused = service
        .register_repository_on("/srv/whatever", Some(&created.target_id))
        .await
        .expect_err("an unavailable target cannot be opened");
    assert_eq!(refused.code, ProblemCode::Unavailable);
    assert!(refused.message.contains("probe-fails"));
}

#[tokio::test]
#[ignore = "requires the docker fixture: pnpm native:ssh:fixture -- start"]
async fn a_preview_of_a_remote_path_reads_the_far_sides_bytes() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let service = fixture_service(&fixture);
    let hosts = service
        .ssh_hosts()
        .await
        .expect("the fixture config listing");
    let candidate = hosts
        .hosts
        .iter()
        .find(|candidate| candidate.alias == fixture.alias)
        .expect("the fixture alias");
    let target = service
        .create_target(CreateTargetRequest::SshConfig {
            host_id: candidate.host_id.clone(),
        })
        .await
        .expect("target created");
    assert_eq!(target.state, ExecutionTargetState::Ready);

    let registered = service
        .register_repository_on(&fixture.repo_path, Some(&target.target_id))
        .await
        .expect("the remote repository opens");
    let repository_id = registered
        .repositories
        .first()
        .expect("one repository")
        .repository_id
        .clone();

    let status = service
        .status(&StatusQuery::new(&repository_id))
        .await
        .expect("remote status");
    let entry = status
        .entries
        .iter()
        .find(|entry| entry.display_path == "a.txt")
        .expect("the fixture's modified file is reported");

    // The local *copy* of the same repository is made to disagree with the far side. If the
    // host read this machine's file, the size below would be the size this test just wrote;
    // a preview of a remote path that consulted the local filesystem would show the wrong
    // machine's bytes and no test of the transport would catch it.
    let local_path = fixture.local_repo_path.join("a.txt");
    let original = std::fs::read(&local_path).expect("the local copy is there");
    std::fs::write(&local_path, vec![b'x'; original.len() + 64]).expect("the local copy diverges");

    let previews = service
        .previews(&refyard_contract::reads::PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: status.worktree_id.clone(),
            path_ids: vec![entry.path_id.clone()],
        })
        .await;
    std::fs::write(&local_path, &original).expect("the local copy is restored");

    let previews = previews.expect("the remote path is previewable");
    let token = previews.tokens.first().expect("one token");
    assert_eq!(token.path_id, entry.path_id);
    assert_eq!(
        token.size_bytes,
        Some(original.len() as u64),
        "the size is the far side's, not this machine's copy the test just grew"
    );
    assert_eq!(
        token.content_kind,
        refyard_contract::reads::ContentKind::Text
    );
    assert!(token.preview_token.starts_with("pt_"));
    assert!(
        previews.snapshot_id.starts_with("snap_"),
        "a preview names the state it was taken against"
    );

    // The bytes are read on the far side, so a path that only exists here cannot be
    // previewed: the id has to have been minted for this repository.
    let invented = service
        .previews(&refyard_contract::reads::PreviewsRequest {
            repository_id,
            worktree_id: status.worktree_id,
            path_ids: vec!["path_never_minted".to_string()],
        })
        .await;
    assert_eq!(
        invented
            .expect_err("an unminted path id is not a path")
            .code,
        ProblemCode::NotFound
    );
}
