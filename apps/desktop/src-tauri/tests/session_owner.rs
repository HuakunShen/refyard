//! The desktop host's own gates, driven through the production command bodies.
//!
//! `refyard_connect` records which window opened a session, and every other command checks
//! that record before it does anything. These tests call the same `pub` functions the
//! `#[tauri::command]` wrappers call — passing a label where the wrapper passes
//! `window.label()` — so what they exercise is the ownership gate and the dispatcher
//! themselves, not a copy of them. Tauri's argument extraction is the one part outside these
//! tests, and it decides nothing.
//!
//! Every test runs against a temporary repository with its own `HOME`, its own Git config and
//! no network, the same rule the JavaScript suite follows.

use std::path::{Path, PathBuf};
use std::process::Command;

use refyard_contract::problem::{ProblemCode, ProblemResponse};
use refyard_contract::reads::{EventEnvelope, EventPayload};
use refyard_desktop::commands;
use refyard_desktop::events::ScopedEventFrame;
use refyard_desktop::AppState;
use refyard_host::providers::local::LocalGit;
use serde_json::{json, Value};

/// The window the config file opens, and a second one that exists only in these tests.
const MAIN: &str = "main";
const SECOND: &str = "second";

/// A temporary repository with its own identity, config and no inherited `GIT_*`.
struct Fixture {
    _temp: tempfile::TempDir,
    repo: PathBuf,
    env: Vec<(String, String)>,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("temp dir");
        let home = temp.path().join("home");
        let repo = temp.path().join("repo");
        std::fs::create_dir_all(&home).expect("create fixture home");
        std::fs::create_dir_all(&repo).expect("create fixture repo");
        std::fs::write(home.join(".gitconfig"), "").expect("empty global config");
        let env = fixture_environment(&home);
        let fixture = Self {
            _temp: temp,
            repo,
            env,
        };
        fixture.git(&["init", "--quiet", "--initial-branch=main"]);
        fixture.write("README.md", "first\n");
        fixture.git(&["add", "--", "README.md"]);
        fixture.git(&["commit", "--quiet", "-m", "first"]);
        fixture
    }

    fn git(&self, args: &[&str]) -> Vec<u8> {
        let output = Command::new(git_program())
            .args(args)
            .current_dir(&self.repo)
            .env_clear()
            .envs(
                self.env
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str())),
            )
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    fn write(&self, relative: &str, content: &str) {
        let path = self.repo.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create parent");
        }
        std::fs::write(path, content).expect("write file");
    }

    fn path(&self) -> &str {
        self.repo.to_str().expect("utf8 path")
    }

    /// The whole shell, pointed at this fixture instead of the machine's own Git config.
    fn state(&self) -> AppState {
        AppState::with_git(LocalGit::at(git_program(), self.env.clone()))
    }

    /// What a window does on connect: open a session, then register this repository.
    async fn open(&self, state: &AppState) -> (String, String) {
        let metadata = commands::connect(state, MAIN).expect("connect");
        let response = commands::git_read(
            state,
            MAIN,
            &metadata.session_id,
            json!({ "method": "registerRepository", "path": self.path() }),
        )
        .await
        .expect("register");
        let repository_id = response["repositories"][0]["repositoryId"]
            .as_str()
            .expect("repositoryId")
            .to_owned();
        (metadata.session_id, repository_id)
    }
}

fn git_program() -> PathBuf {
    LocalGit::discover()
        .expect("git is installed on this machine")
        .program()
        .to_path_buf()
}

fn fixture_environment(home: &Path) -> Vec<(String, String)> {
    let home = home.to_str().expect("utf8 home");
    vec![
        ("PATH".to_string(), "/usr/bin:/bin".to_string()),
        ("HOME".to_string(), home.to_string()),
        (
            "GIT_CONFIG_GLOBAL".to_string(),
            format!("{home}/.gitconfig"),
        ),
        ("GIT_CONFIG_SYSTEM".to_string(), "/dev/null".to_string()),
        ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        ("GIT_TERMINAL_PROMPT".to_string(), "0".to_string()),
        ("LC_ALL".to_string(), "C".to_string()),
        ("LANG".to_string(), "C".to_string()),
        ("GIT_AUTHOR_NAME".to_string(), "Refyard Fixture".to_string()),
        (
            "GIT_AUTHOR_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
        (
            "GIT_COMMITTER_NAME".to_string(),
            "Refyard Fixture".to_string(),
        ),
        (
            "GIT_COMMITTER_EMAIL".to_string(),
            "fixture@refyard.invalid".to_string(),
        ),
        (
            "GIT_AUTHOR_DATE".to_string(),
            "2026-01-01T00:00:00+00:00".to_string(),
        ),
        (
            "GIT_COMMITTER_DATE".to_string(),
            "2026-01-01T00:00:00+00:00".to_string(),
        ),
    ]
}

/// The code a command refused with, as the adapter would read it.
fn refusal_code<T>(result: &Result<T, ProblemResponse>) -> ProblemCode {
    match result {
        Ok(_) => panic!("expected a refusal, but the command answered"),
        Err(response) => response.problem.code,
    }
}

fn status_query(repository_id: &str) -> Value {
    json!({ "method": "status", "query": { "repositoryId": repository_id } })
}

/* ------------------------------------------------------------- the happy path */

#[tokio::test]
async fn a_read_from_the_window_that_opened_the_session_answers() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let snapshot = commands::git_read(&state, MAIN, &session_id, status_query(&repository_id))
        .await
        .expect("status");

    assert_eq!(snapshot["repositoryId"], json!(repository_id));
    assert_eq!(snapshot["head"]["kind"], json!("born"));
    assert_eq!(snapshot["head"]["branchName"], json!("main"));
    assert_eq!(
        snapshot["entries"],
        json!([]),
        "a freshly committed fixture has nothing to report"
    );
}

#[tokio::test]
async fn a_registered_repository_is_listed_and_revoking_it_withdraws_the_approval() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let listed = commands::git_read(&state, MAIN, &session_id, json!({"method": "repositories"}))
        .await
        .expect("repositories");
    assert_eq!(
        listed["repositories"][0]["repositoryId"],
        json!(repository_id)
    );

    let after = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "revokeRepository", "repositoryId": repository_id }),
    )
    .await
    .expect("revoke");
    assert_eq!(after["repositories"], json!([]));

    // A second revocation names a repository that is no longer registered, which is a
    // not-found rather than a silent success: reporting success would tell a caller the
    // approval was withdrawn twice when the first call is the one that mattered.
    let again = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "revokeRepository", "repositoryId": repository_id }),
    )
    .await;
    assert_eq!(refusal_code(&again), ProblemCode::NotFound);
}

#[tokio::test]
async fn an_unknown_repository_is_reported_as_not_found_rather_than_an_empty_snapshot() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    let snapshot =
        commands::git_read(&state, MAIN, &session_id, status_query("repo_missing")).await;

    assert_eq!(refusal_code(&snapshot), ProblemCode::NotFound);
}

/* ------------------------------------------------------------ the owner gate */

#[tokio::test]
async fn a_second_window_cannot_drive_a_session_it_did_not_open() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    // Without this gate, any other WebView in the process — a plugin view today, an embed
    // tomorrow — could read (and later write) every repository the user approved in the
    // window that opened the session.
    let stolen =
        commands::git_read(&state, SECOND, &session_id, status_query(&repository_id)).await;

    assert_eq!(refusal_code(&stolen), ProblemCode::Forbidden);
}

#[tokio::test]
async fn a_window_cannot_end_a_session_it_does_not_own() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let stolen = commands::disconnect(&state, SECOND, &session_id);
    assert_eq!(refusal_code(&stolen), ProblemCode::Forbidden);

    // The refusal must not have ended anything: the owner still reads.
    let snapshot = commands::git_read(&state, MAIN, &session_id, status_query(&repository_id))
        .await
        .expect("the owner still holds its session");
    assert_eq!(snapshot["head"]["branchName"], json!("main"));
}

#[tokio::test]
async fn a_session_that_has_ended_is_not_found_and_ending_it_twice_is_not_an_error() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    commands::disconnect(&state, MAIN, &session_id).expect("the owner ends it");

    let after = commands::git_read(&state, MAIN, &session_id, status_query(&repository_id)).await;
    assert_eq!(refusal_code(&after), ProblemCode::NotFound);

    // `dispose` runs on unmount and on teardown, so a second call means the session is
    // already over — the state the caller asked for.
    commands::disconnect(&state, MAIN, &session_id).expect("disconnect is idempotent");
    assert!(state.sessions.is_empty());
}

#[tokio::test]
async fn two_windows_hold_sessions_that_do_not_reach_each_other() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (first, repository_id) = fixture.open(&state).await;
    let second = commands::connect(&state, SECOND)
        .expect("connect")
        .session_id;

    // Each window holds its own session, and neither id opens the other's.
    let from_main = commands::git_read(&state, MAIN, &second, status_query(&repository_id)).await;
    assert_eq!(refusal_code(&from_main), ProblemCode::Forbidden);
    let from_second =
        commands::git_read(&state, SECOND, &first, status_query(&repository_id)).await;
    assert_eq!(refusal_code(&from_second), ProblemCode::Forbidden);

    commands::git_read(&state, SECOND, &second, json!({"method": "repositories"}))
        .await
        .expect("each window reads through its own session");
}

/* ------------------------------------------------------- the closed read union */

#[tokio::test]
async fn an_unknown_method_is_refused_before_any_read_runs() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    // There is no reflective "call whatever exists" path: a renderer that invents a method
    // name must not be able to reach a command that happens to exist.
    let invented =
        commands::git_read(&state, MAIN, &session_id, json!({"method": "teleport"})).await;

    assert_eq!(refusal_code(&invented), ProblemCode::InvalidRequest);
}

#[tokio::test]
async fn an_unknown_field_is_refused_rather_than_ignored() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    // Ignoring an unknown field would let a caller believe a filter was applied when it was
    // not: a typo'd `includeIgnored` would silently return a shorter list.
    let extra = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({
            "method": "status",
            "query": { "repositoryId": repository_id, "includeIgnoredd": true }
        }),
    )
    .await;

    assert_eq!(refusal_code(&extra), ProblemCode::InvalidRequest);
}

#[tokio::test]
async fn a_read_this_build_does_not_implement_is_refused_and_absent_from_capabilities() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, repository_id) = fixture.open(&state).await;

    let asked = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "worktrees", "query": { "repositoryId": repository_id } }),
    )
    .await;
    assert_eq!(refusal_code(&asked), ProblemCode::UnsupportedOperation);

    // The refusal and the capabilities list have to agree. A host that advertised worktrees
    // and answered with an empty list would make a UI show "no worktrees" for a repository
    // that has four.
    let capabilities =
        commands::git_read(&state, MAIN, &session_id, json!({"method": "capabilities"}))
            .await
            .expect("capabilities");
    let reads = capabilities["reads"].as_array().expect("reads");
    assert!(
        reads.iter().any(|kind| kind == "status"),
        "the reads this build does serve are listed: {reads:?}"
    );
    assert!(
        reads.iter().any(|kind| kind == "filesystem"),
        "the local picker is served, so the Browse control must stay available: {reads:?}"
    );
    for absent in ["worktrees", "submodules", "stashes", "previews"] {
        assert!(
            !reads.iter().any(|kind| kind == absent),
            "capabilities must not list {absent}: {reads:?}"
        );
    }
    assert_eq!(capabilities["host"]["kind"], json!("rust"));
}

#[tokio::test]
async fn a_foreign_target_is_refused_rather_than_answered_for_this_machine() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    // Answering about the local machine because that is all this host has is how a client
    // gets a confident answer to the wrong question. The Node host refuses the same way.
    let elsewhere = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "capabilities", "query": { "targetId": "tgt_elsewhere" } }),
    )
    .await;

    assert_eq!(refusal_code(&elsewhere), ProblemCode::UnsupportedOperation);

    commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "capabilities", "query": { "targetId": "tgt_local" } }),
    )
    .await
    .expect("the local target is the one this host serves");
}

/* ------------------------------------------------------------------- writes */

#[tokio::test]
async fn every_write_command_is_refused_after_the_ownership_check() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    let refusals: [(Result<Value, ProblemResponse>, &str); 4] = [
        (
            commands::mutation_submit(&state, MAIN, &session_id),
            "mutation_submit",
        ),
        (
            commands::operation_get(&state, MAIN, &session_id),
            "operation_get",
        ),
        (
            commands::operation_list(&state, MAIN, &session_id),
            "operation_list",
        ),
        (
            commands::operation_cancel(&state, MAIN, &session_id),
            "operation_cancel",
        ),
    ];
    for (result, command) in refusals {
        assert_eq!(
            refusal_code(&result),
            ProblemCode::UnsupportedOperation,
            "{command} must refuse rather than report an empty result"
        );
    }

    // A refusal that skipped the gate would teach a caller the gate is optional.
    assert_eq!(
        refusal_code(&commands::mutation_submit(&state, SECOND, &session_id)),
        ProblemCode::Forbidden
    );
}

/* ------------------------------------------------------------------- events */

#[tokio::test]
async fn a_subscription_belongs_to_the_window_that_opened_it() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    let ack = commands::events_subscribe(&state, MAIN, &session_id).expect("subscribe");
    let ack = ack.as_object().expect("ack is an object");
    let subscription_id = ack["subscriptionId"].as_str().expect("subscriptionId");

    assert_eq!(ack["replay"], json!([]));
    assert_eq!(ack["highWatermark"], json!(0));
    let metadata = commands::connect(&state, MAIN).expect("connect");
    assert_eq!(
        ack["serviceInstanceId"],
        json!(metadata.service_instance_id)
    );

    // A window that could unsubscribe another window's stream could silence updates it is
    // not even watching.
    let stolen = commands::events_unsubscribe(&state, SECOND, &session_id, subscription_id);
    assert_eq!(refusal_code(&stolen), ProblemCode::Forbidden);

    commands::events_unsubscribe(&state, MAIN, &session_id, subscription_id).expect("unsubscribe");
    commands::events_unsubscribe(&state, MAIN, &session_id, subscription_id)
        .expect("unsubscribe is idempotent");
    assert!(state.events.is_empty());
}

#[test]
fn the_event_frame_carries_the_four_fields_the_adapter_filters_on() {
    let envelope = EventEnvelope {
        sequence: 7,
        emitted_at: "2026-09-18T10:00:00.000Z".to_string(),
        payload: EventPayload::RepositoryChanged {
            repository_id: "repo_1".to_string(),
            worktree_ids: vec!["wt_1".to_string()],
            snapshot_invalidated: true,
        },
    };
    let frame = ScopedEventFrame {
        session_id: "sess_1",
        subscription_id: "sub_1",
        service_instance_id: "srvc_1",
        event: &envelope,
    };

    // `scopedEventFrameSchema` in packages/backend-tauri drops a frame whose session,
    // subscription or instance does not match the subscriber, so a renamed field here would
    // not fail loudly — it would stop every event from arriving. The payload is the
    // contract's `kind`-tagged union (`eventPayloadSchema`), not a wrapper object keyed by
    // variant name.
    assert_eq!(
        serde_json::to_value(&frame).expect("serializes"),
        json!({
            "sessionId": "sess_1",
            "subscriptionId": "sub_1",
            "serviceInstanceId": "srvc_1",
            "event": {
                "sequence": 7,
                "emittedAt": "2026-09-18T10:00:00.000Z",
                "payload": {
                    "kind": "repositoryChanged",
                    "repositoryId": "repo_1",
                    "worktreeIds": ["wt_1"],
                    "snapshotInvalidated": true
                }
            }
        })
    );
}

/* ------------------------------------------------------------ host requests */

#[tokio::test]
async fn the_host_reports_only_the_targets_and_abilities_it_has() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    let capabilities = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "capabilities" }),
    )
    .await
    .expect("host capabilities");
    assert_eq!(
        capabilities["targetKinds"],
        json!(["local", "ssh-config"]),
        "both kinds can be created, and a UI that offers an SSH target gets an answer \
         either way: a probe that fails is a target reported `unavailable`, not an error"
    );
    assert_eq!(
        capabilities["sshConfig"],
        json!(true),
        "this host reads SSH configuration, which is a different claim from connecting to it"
    );
    assert_eq!(capabilities["localFolderPicker"], json!(false));
    assert_eq!(
        capabilities["uncertainOperationAcknowledgement"],
        json!(false)
    );

    let targets = commands::host_request(&state, MAIN, &session_id, json!({ "method": "targets" }))
        .await
        .expect("targets");
    let targets = targets.as_array().expect("targets is a list");
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0]["kind"], json!("local"));
    assert_eq!(targets[0]["state"], json!("ready"));
    assert_eq!(targets[0]["remotePathBrowse"], json!(false));
    assert!(
        targets[0]["generation"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "a target without a generation would invalidate nothing when it is rebuilt"
    );

    // SSH discovery is a file read, so it answers rather than being refused. The fixture's
    // home has no `.ssh` directory, and the honest answer to that is an empty list with a
    // revision — an empty list is not the same claim as "this machine has no SSH hosts".
    let hosts = commands::host_request(&state, MAIN, &session_id, json!({ "method": "sshHosts" }))
        .await
        .expect("lists SSH hosts");
    assert_eq!(hosts["hosts"], json!([]));
    assert_eq!(hosts["warnings"], json!([]));
    assert!(
        hosts["revision"]
            .as_str()
            .is_some_and(|value| !value.is_empty()),
        "a list without a revision cannot be told from the next read of the same files"
    );
}

#[tokio::test]
async fn creating_and_dropping_targets_goes_through_the_host_and_refuses_what_it_cannot_do() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    // The local target is the service's own machine: asking for it answers with it, and the
    // answer is the same one `targets` lists.
    let local = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "createTarget", "request": { "kind": "local" } }),
    )
    .await
    .expect("creates the local target");
    assert_eq!(local["kind"], json!("local"));
    assert_eq!(local["state"], json!("ready"));
    assert_eq!(
        local["targetId"],
        json!(state.service.target_id()),
        "the local target is the one every read in this service runs against"
    );

    // The local target is not a connection, so there is nothing to release.
    let disconnect_local = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "disconnectTarget", "targetId": state.service.target_id() }),
    )
    .await;
    assert_eq!(
        refusal_code(&disconnect_local),
        ProblemCode::UnsupportedOperation
    );

    let disconnect_unknown = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "disconnectTarget", "targetId": "tgt_none" }),
    )
    .await;
    assert_eq!(refusal_code(&disconnect_unknown), ProblemCode::NotFound);

    // The fixture's home has no SSH configuration yet, so a host id it did not list is a
    // not-found: a target is never created from an id the caller made up.
    let unknown_host = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({
            "method": "createTarget",
            "request": { "kind": "ssh-config", "hostId": "host_none" }
        }),
    )
    .await;
    assert_eq!(refusal_code(&unknown_host), ProblemCode::NotFound);

    // The contract allows an alias typed by hand; this host refuses it by name, because it
    // cannot tell which configuration source that alias belongs to.
    let typed_by_hand = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({
            "method": "createTarget",
            "request": { "kind": "ssh-config", "sourceId": "source_1", "manualAlias": "prod" }
        }),
    )
    .await;
    assert_eq!(
        refusal_code(&typed_by_hand),
        ProblemCode::UnsupportedOperation
    );

    // A request whose shape the contract does not publish is an invalid request, not a
    // target: the two refusals are different claims.
    let malformed = commands::host_request(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "createTarget", "request": { "kind": "ssh-config" } }),
    )
    .await;
    assert_eq!(refusal_code(&malformed), ProblemCode::InvalidRequest);

    let targets = commands::host_request(&state, MAIN, &session_id, json!({ "method": "targets" }))
        .await
        .expect("targets");
    assert_eq!(
        targets.as_array().expect("targets is a list").len(),
        1,
        "none of the refusals above may leave a target behind"
    );
}

#[tokio::test]
async fn the_local_picker_lists_a_directory_through_the_session() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    // The directory above the fixture is what a person would browse first, and it has to
    // offer the fixture itself as something that can be opened — that is the whole point of
    // the read behind the Browse control.
    let parent = fixture
        .repo
        .parent()
        .expect("the fixture repo lives in a scratch directory");
    let listed = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({ "method": "filesystemEntries", "query": { "path": parent.to_str().expect("utf8") } }),
    )
    .await
    .expect("lists the fixture's parent directory");

    // The answer names the canonical directory: a symbolic path would not be a path the
    // person can approve.
    let canonical = std::fs::canonicalize(parent).expect("canonical parent");
    assert_eq!(listed["path"], json!(canonical.to_str().expect("utf8")));
    assert_eq!(listed["truncated"], json!(false));
    let entries = listed["entries"].as_array().expect("entries");
    assert!(
        entries
            .iter()
            .any(|entry| entry["kind"] == json!("repository")),
        "the fixture repository is offered as a repository: {entries:?}"
    );
    assert!(
        entries.iter().all(|entry| entry["name"] != ".git"),
        "the Git directory is never an entry a person can open"
    );

    // A foreign target is refused before anything is listed: answering about this machine
    // when another one was named is how a client gets a confident wrong answer.
    let elsewhere = commands::git_read(
        &state,
        MAIN,
        &session_id,
        json!({
            "method": "filesystemEntries",
            "query": { "path": parent.to_str().expect("utf8"), "targetId": "tgt_elsewhere" }
        }),
    )
    .await;
    assert_eq!(refusal_code(&elsewhere), ProblemCode::UnsupportedOperation);
}

/// Where the host looks for SSH configuration, taken from the fixture's own environment.
fn ssh_config_path(fixture: &Fixture) -> PathBuf {
    let home = fixture
        .env
        .iter()
        .find(|(name, _)| name == "HOME")
        .map(|(_, value)| value.clone())
        .expect("the fixture sets HOME");
    PathBuf::from(home).join(".ssh").join("config")
}

#[tokio::test]
async fn the_ssh_list_comes_from_the_home_this_host_runs_git_with() {
    let fixture = Fixture::new();
    let state = fixture.state();
    let (session_id, _) = fixture.open(&state).await;

    let config = ssh_config_path(&fixture);
    std::fs::create_dir_all(config.parent().expect("the .ssh directory")).expect("create .ssh");
    std::fs::write(
        &config,
        "Host staging\n  HostName staging.invalid\n\nHost *.corp\nHost prod\n",
    )
    .expect("write the fixture ssh config");

    let hosts = commands::host_request(&state, MAIN, &session_id, json!({ "method": "sshHosts" }))
        .await
        .expect("lists SSH hosts");

    let listed = hosts["hosts"].as_array().expect("hosts");
    let aliases: Vec<&str> = listed
        .iter()
        .map(|host| host["alias"].as_str().expect("alias"))
        .collect();
    assert_eq!(
        aliases,
        vec!["staging", "prod"],
        "a wildcard pattern is a rule, not a candidate"
    );
    let first = &listed[0];
    assert!(
        first["hostId"]
            .as_str()
            .expect("hostId")
            .starts_with("host_"),
        "an alias is addressed by an id the host minted: {first:?}"
    );
    assert!(first["sourceId"]
        .as_str()
        .expect("sourceId")
        .starts_with("source_"));
    assert_eq!(first["discoveryIncomplete"], json!(false));
    assert_eq!(hosts["warnings"], json!([]));
}
