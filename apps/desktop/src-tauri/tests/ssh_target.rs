//! The desktop command surface against a real SSH server.
//!
//! Everything above this file proves the service can read a remote repository, and the
//! headless provider tests prove the transport. This one proves the *window's* path: that
//! `createTarget` decodes the union the adapter sends, that `registerRepository` with a
//! `targetId` reaches the far side, and that dropping the target refuses the repository it
//! opened instead of quietly reading this machine instead.
//!
//! It needs the Docker fixture (`pnpm native:ssh:fixture -- start`) and skips with a
//! printable reason when the container is absent or stopped, because a missing fixture is an
//! environment a case cannot run in — reporting that as a broken host would be a lie about
//! the product.

use std::path::{Path, PathBuf};

use refyard_contract::problem::ProblemCode;
use refyard_desktop::{commands, AppState};
use refyard_host::providers::local::LocalGit;
use serde_json::{json, Value};

const MAIN: &str = "main";

/// The fixture's published address and files, as `scripts/native-ssh-fixture.ts` wrote them.
struct Fixture {
    alias: String,
    config_file: PathBuf,
    home: PathBuf,
    repo_path: String,
}

fn state_path() -> PathBuf {
    match std::env::var("REFYARD_SSH_FIXTURE_STATE") {
        Ok(path) => PathBuf::from(path).join("state.json"),
        // Three levels up: this crate is a workspace of its own under `apps/desktop`, so the
        // directory the fixture writes into is not two levels up as it is for the host crate.
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../target/native-ssh-fixture/state.json"),
    }
}

impl Fixture {
    fn load_or_skip() -> Option<Self> {
        let path = state_path();
        let Ok(text) = std::fs::read_to_string(&path) else {
            eprintln!(
                "skipping: no SSH fixture state at {}; start it with `pnpm native:ssh:fixture -- start`",
                path.display()
            );
            return None;
        };
        let state: Value = serde_json::from_str(&text).expect("the fixture state is JSON");
        let field = |name: &str| -> String {
            state
                .get(name)
                .and_then(Value::as_str)
                .unwrap_or_else(|| panic!("the fixture state has no {name}"))
                .to_string()
        };
        let host = field("host");
        let port = state.get("port").and_then(Value::as_u64);
        if !listening(&host, port) {
            eprintln!(
                "skipping: nothing is listening at {host}:{} (the fixture state exists but the container is stopped); start it with `pnpm native:ssh:fixture -- start`",
                port.map(|value| value.to_string()).unwrap_or_else(|| "?".to_string())
            );
            return None;
        }
        Some(Self {
            alias: field("alias"),
            config_file: PathBuf::from(field("config_file")),
            home: PathBuf::from(field("home")),
            repo_path: field("repo_path"),
        })
    }
}

/// Whether the fixture's published port accepts a connection: no key, no configuration, and
/// exactly the question "is the container still running".
fn listening(host: &str, port: Option<u64>) -> bool {
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

/// A host whose SSH configuration source is the fixture's, and whose Git is this machine's.
fn fixture_state(fixture: &Fixture) -> AppState {
    let git = LocalGit::discover().expect("git is installed on this machine");
    let environment = vec![
        (
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin:/usr/sbin:/sbin".to_string()),
        ),
        ("HOME".to_string(), fixture.home.display().to_string()),
    ];
    let git = LocalGit::at(git.program().to_path_buf(), environment);
    // The fixture's own configuration file is stated rather than inherited: OpenSSH resolves
    // `~/.ssh/config` from the passwd entry, so a scratch home would otherwise leave it
    // reading the developer's own hosts.
    AppState::with_ssh_config(git, Some(fixture.config_file.clone()))
}

async fn open_session(state: &AppState) -> String {
    commands::connect(state, MAIN)
        .expect("a window connects")
        .session_id
}

/// The `hostId` the catalogue minted for the fixture's alias, as a client would find it.
async fn fixture_host_id(state: &AppState, session: &str, alias: &str) -> String {
    let listing = commands::host_request(state, MAIN, session, json!({ "method": "sshHosts" }))
        .await
        .expect("lists SSH hosts");
    let hosts = listing["hosts"].as_array().expect("hosts");
    let candidate = hosts
        .iter()
        .find(|host| host["alias"] == json!(alias))
        .unwrap_or_else(|| panic!("the fixture alias is not in the list: {hosts:?}"));
    // A candidate is not a machine: nothing has connected yet, and the id is what the client
    // sends back to ask for this one.
    candidate["hostId"].as_str().expect("hostId").to_string()
}

#[tokio::test]
#[ignore = "needs the Docker SSH fixture: pnpm native:ssh:fixture -- start, then cargo test -- --ignored"]
async fn a_remote_repository_is_opened_and_dropped_through_the_window_command_surface() {
    let Some(fixture) = Fixture::load_or_skip() else {
        return;
    };
    let state = fixture_state(&fixture);
    let session = open_session(&state).await;

    let host_id = fixture_host_id(&state, &session, &fixture.alias).await;
    let target = commands::host_request(
        &state,
        MAIN,
        &session,
        json!({ "method": "createTarget", "request": { "kind": "ssh-config", "hostId": host_id } }),
    )
    .await
    .expect("creates the SSH target");
    assert_eq!(target["kind"], json!("ssh-config"));
    assert_eq!(
        target["state"],
        json!("ready"),
        "the probe runs on creation: {target:?}"
    );
    assert_eq!(
        target["remotePathBrowse"],
        json!(false),
        "this build cannot list another machine's directories, and says so"
    );
    let target_id = target["targetId"].as_str().expect("targetId").to_string();

    // The path is the far machine's, spelled as it is there — with an apostrophe and spaces
    // in it, which is also the quoting case the provider tests exercise.
    let registered = commands::git_read(
        &state,
        MAIN,
        &session,
        json!({ "method": "registerRepository", "path": fixture.repo_path, "targetId": target_id }),
    )
    .await
    .expect("opens the remote repository");
    let repositories = registered["repositories"]
        .as_array()
        .expect("repositories")
        .clone();
    assert_eq!(repositories.len(), 1, "{registered:?}");
    let repository_id = repositories[0]["repositoryId"]
        .as_str()
        .expect("repositoryId")
        .to_string();
    assert_eq!(
        repositories[0]["targetId"],
        json!(target_id),
        "the row says which machine it is on, so a UI can label it"
    );

    let status = commands::git_read(
        &state,
        MAIN,
        &session,
        json!({ "method": "status", "query": { "repositoryId": repository_id } }),
    )
    .await
    .expect("reads the remote status");
    assert_eq!(status["head"]["branchName"], json!("main"));
    let entries = status["entries"].as_array().expect("entries");
    assert!(
        !entries.is_empty(),
        "the fixture repository has changes committed to compare against: {status:?}"
    );

    let history = commands::git_read(
        &state,
        MAIN,
        &session,
        json!({ "method": "history", "query": { "repositoryId": repository_id } }),
    )
    .await
    .expect("reads remote history");
    assert!(
        !history["commits"].as_array().expect("commits").is_empty(),
        "the remote repository has commits: {history:?}"
    );

    // Dropping the target withdraws the connection. The repository it opened is not
    // re-pointed at this machine: a later read is a refusal, because a silent fallback would
    // show one machine's files under another's name.
    commands::host_request(
        &state,
        MAIN,
        &session,
        json!({ "method": "disconnectTarget", "targetId": target_id }),
    )
    .await
    .expect("drops the SSH target");

    let after = commands::git_read(
        &state,
        MAIN,
        &session,
        json!({ "method": "status", "query": { "repositoryId": repository_id } }),
    )
    .await;
    let refusal = after.expect_err("a read after the target was dropped is refused");
    assert!(
        matches!(
            refusal.problem.code,
            ProblemCode::NotFound | ProblemCode::UnsupportedOperation
        ),
        "unexpected refusal code: {:?}",
        refusal.problem.code
    );

    let targets = commands::host_request(&state, MAIN, &session, json!({ "method": "targets" }))
        .await
        .expect("targets");
    assert_eq!(
        targets.as_array().expect("targets").len(),
        1,
        "only the local target is left"
    );

    // The local target still reads: dropping an SSH target is not a teardown of the session.
    let capabilities =
        commands::git_read(&state, MAIN, &session, json!({ "method": "capabilities" }))
            .await
            .expect("reads capabilities after the drop");
    assert!(capabilities["reads"]
        .as_array()
        .is_some_and(|reads| { reads.iter().any(|read| read == &json!("status")) }));
}
