//! One fixture repository, two boundaries, answer-for-answer.
//!
//! The desktop window speaks Tauri commands; `refyard-native serve` speaks HTTP — but
//! both are thin adapters over the same `ApplicationService`, so for every read the
//! HTTP JSON must be *exactly* the service answer's serialization, and an operation
//! submitted over HTTP must appear in the service's own journal view unchanged. This
//! test holds the two boundaries side by side over a real socket and a real repository,
//! so a wire adapter that reshapes, renames or drops a field fails here and not in a
//! browser.

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::HistoryQuery;
use refyard_contract::reads::{MutationKind, MutationTarget, PreviewsRequest};
use refyard_host::jobs::{MutationOperation, MutationRequest};
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};
use refyard_http::auth::Grants;
use refyard_http::{start_http_host, HttpHostOptions};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

/// A temporary repository with its own identity, its own Git config and no network.
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
        let env = vec![
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ("HOME".to_string(), home.to_string_lossy().into_owned()),
            (
                "GIT_CONFIG_GLOBAL".to_string(),
                format!("{}/.gitconfig", home.to_string_lossy()),
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
        ];
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

    fn git(&self, args: &[&str]) {
        let output = Command::new("git")
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
    }

    fn write(&self, relative: &str, content: &str) {
        std::fs::write(self.repo.join(relative), content).expect("write file");
    }

    fn path(&self) -> String {
        self.repo.to_string_lossy().into_owned()
    }
}

/// Both boundaries over one fixture: the running HTTP host and the service itself.
struct Boundaries {
    host: refyard_http::HttpHost,
    service: Arc<ApplicationService>,
    fixture: Fixture,
}

impl Boundaries {
    async fn start() -> Self {
        let fixture = Fixture::new();
        let git = LocalGit::at("git", fixture.env.clone());
        let home = refyard_host::reads::filesystem::home_from(git.environment())
            .expect("the fixture has a home");
        let service = Arc::new(
            ApplicationService::new(ApplicationServiceConfig {
                git,
                service_instance_id: "srvc_two_boundaries".to_string(),
                target_id: "tgt_local".to_string(),
                target_generation: "gen_test".to_string(),
                home,
            })
            .with_writes(),
        );
        let host = start_http_host(HttpHostOptions {
            service: Arc::clone(&service),
            port: 0,
            web_root: None,
            ticket_ttl_seconds: 60,
            grants: Grants::for_repositories(Vec::new(), Vec::new()),
        })
        .await
        .expect("the host starts");
        Self {
            host,
            service,
            fixture,
        }
    }

    /// A paired session that registered the fixture repository through HTTP, so the
    /// grant it carries is the registering session's own — the real flow.
    async fn session_with_repository(&self) -> (String, String) {
        let origin = self.host.base_url.clone();
        let pairing = self.host.pairing_url(&origin).expect("pairing url");
        let ticket = pairing
            .split("pair=")
            .nth(1)
            .expect("the pairing url carries the ticket");
        let (status, body) = self
            .request(
                "POST",
                "/api/v1/session/exchange",
                Some(&origin),
                Some(&format!(r#"{{"ticket":"{ticket}"}}"#)),
                None,
            )
            .await;
        assert_eq!(status, 200, "{body}");
        let exchange: serde_json::Value = serde_json::from_str(&body).expect("exchange json");
        let bearer = format!("Bearer {}", exchange["token"].as_str().expect("token"));

        let (status, body) = self
            .request(
                "POST",
                "/api/v1/repositories/register",
                Some(&origin),
                Some(&format!(r#"{{"path":"{}"}}"#, self.fixture.path())),
                Some(&bearer),
            )
            .await;
        assert_eq!(status, 200, "{body}");
        let registered: serde_json::Value = serde_json::from_str(&body).expect("register json");
        let repository_id = registered["repositories"][0]["repositoryId"]
            .as_str()
            .expect("the registered repository is named")
            .to_string();
        (bearer, repository_id)
    }

    /// One HTTP request, answered as (status, body text). No origin header means a
    /// non-browser client, which the gate allows.
    async fn request(
        &self,
        method: &str,
        path: &str,
        origin: Option<&str>,
        body: Option<&str>,
        bearer: Option<&str>,
    ) -> (u16, String) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let authority = self.host.base_url.trim_start_matches("http://").to_string();
        let (_host, port) = authority.split_once(':').expect("host:port");
        let socket = tokio::net::TcpSocket::new_v4().expect("socket");
        let address =
            std::net::SocketAddr::from(([127, 0, 0, 1], port.parse::<u16>().expect("port")));
        let mut stream = socket.connect(address).await.expect("connect");
        let mut request =
            format!("{method} {path} HTTP/1.1\r\nhost: {authority}\r\nconnection: close\r\n");
        if let Some(origin) = origin {
            request.push_str(&format!("origin: {origin}\r\n"));
        }
        if let Some(bearer) = bearer {
            request.push_str(&format!("authorization: {bearer}\r\n"));
        }
        let body = body.unwrap_or("");
        if !body.is_empty() {
            request.push_str("content-type: application/json\r\n");
            request.push_str(&format!("content-length: {}\r\n", body.len()));
        }
        request.push_str("\r\n");
        request.push_str(body);
        stream.write_all(request.as_bytes()).await.expect("write");
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await.expect("read");
        let head_end = raw
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("a head/body separator");
        let head = String::from_utf8_lossy(&raw[..head_end]).into_owned();
        let status: u16 = head
            .split_whitespace()
            .nth(1)
            .and_then(|code| code.parse().ok())
            .unwrap_or(0);
        // `connection: close` ends the body after however many chunks the server sent,
        // so the payload after the head is the whole answer either way it was framed.
        let text = String::from_utf8_lossy(&raw[head_end + 4..]).into_owned();
        (status, text)
    }

    /// One GET answered as JSON, asserting 200 with the body in the message on failure.
    async fn get_json(&self, path: &str, bearer: &str) -> serde_json::Value {
        let (status, body) = self.request("GET", path, None, None, Some(bearer)).await;
        assert_eq!(status, 200, "GET {path} failed: {body}");
        serde_json::from_str(&body).unwrap_or_else(|error| panic!("GET {path}: {error}: {body}"))
    }
}

/// The service answer, serialized exactly as the router's `json_response` would.
fn serialized<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).expect("the service answer serializes")
}

/// Compares the two answers after dropping fields that name *the call itself*: `readAt`
/// is the instant of the read, and a status `snapshotId` is minted per read for the
/// freshness checks. Everything that describes the repository — entries, head, refs,
/// patches, truncation — must be identical.
fn assert_same_modulo_call_fields(
    label: &str,
    http: &mut serde_json::Value,
    direct: &mut serde_json::Value,
) {
    for answer in [&mut *http, &mut *direct] {
        if let Some(object) = answer.as_object_mut() {
            object.remove("readAt");
            object.remove("snapshotId");
        }
    }
    assert_eq!(http, direct, "{label} differs between the boundaries");
}

#[tokio::test]
async fn the_wire_answer_is_the_service_answer_for_every_read() {
    let boundaries = Boundaries::start().await;
    let (bearer, repository_id) = boundaries.session_with_repository().await;

    // A worktree change, so status and diff have something honest to describe.
    boundaries
        .fixture
        .write("README.md", "changed on one side only\n");

    // Every read, both ways. `path` is the exact query spelling a browser sends;
    // `direct` is the same service call the route handler makes, serialized.
    let service = &boundaries.service;
    let reads: Vec<(&str, String, serde_json::Value)> = vec![
        (
            "capabilities",
            "/api/v1/capabilities".to_string(),
            serialized(&service.capabilities().await.expect("capabilities")),
        ),
        (
            "repositories",
            "/api/v1/repositories".to_string(),
            serialized(&service.repositories().await),
        ),
        (
            "status",
            format!("/api/v1/status?repositoryId={repository_id}"),
            serialized(
                &service
                    .status(&StatusQuery::new(repository_id.clone()))
                    .await
                    .expect("status"),
            ),
        ),
        (
            "history",
            format!("/api/v1/history?repositoryId={repository_id}"),
            serialized(
                &service
                    .history(&HistoryQuery {
                        repository_id: repository_id.clone(),
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
                    })
                    .await
                    .expect("history"),
            ),
        ),
        (
            "refs",
            format!("/api/v1/refs?repositoryId={repository_id}"),
            serialized(&service.refs(&repository_id).await.expect("refs")),
        ),
        (
            "diff",
            format!("/api/v1/diff?repositoryId={repository_id}&kind=unstaged"),
            serialized(
                &service
                    .diff(&DiffQuery {
                        repository_id: repository_id.clone(),
                        worktree_id: None,
                        kind: DiffKind::Unstaged,
                        oid: None,
                        from: None,
                        to: None,
                        path_id: None,
                        max_bytes: None,
                    })
                    .await
                    .expect("diff"),
            ),
        ),
    ];
    for (label, path, mut direct) in reads {
        let mut http = boundaries.get_json(&path, &bearer).await;
        assert_same_modulo_call_fields(label, &mut http, &mut direct);
    }
}

#[tokio::test]
async fn an_operation_submitted_on_the_wire_is_the_operation_the_service_journalled() {
    let boundaries = Boundaries::start().await;
    let (bearer, repository_id) = boundaries.session_with_repository().await;

    // Stage one path through the wire, exactly as the browser's mutation client would.
    boundaries
        .fixture
        .write("staged-via-wire.txt", "one side only\n");
    let status = boundaries
        .get_json(
            &format!("/api/v1/status?repositoryId={repository_id}"),
            &bearer,
        )
        .await;
    let worktree_id = status["worktreeId"]
        .as_str()
        .expect("worktreeId")
        .to_string();
    let path_id = status["entries"][0]["pathId"]
        .as_str()
        .expect("pathId")
        .to_string();
    let previews = boundaries
        .service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: worktree_id.clone(),
            path_ids: vec![path_id.clone()],
        })
        .await
        .expect("previews");
    let preview_token = previews.tokens[0].preview_token.clone();

    let submit_body = format!(
        r#"{{"clientRequestId":"two-boundaries-stage","target":{{"kind":"worktree","repositoryId":"{repository_id}","worktreeId":"{worktree_id}","expectedSnapshotId":"{}"}},"operation":{{"kind":"stagePaths","pathIds":["{path_id}"],"previewTokens":["{preview_token}"]}}}}"#,
        status["snapshotId"].as_str().expect("snapshotId"),
    );
    let (status_code, body) = boundaries
        .request(
            "POST",
            "/api/v1/operations",
            None,
            Some(&submit_body),
            Some(&bearer),
        )
        .await;
    assert_eq!(status_code, 202, "{body}");
    let accepted: serde_json::Value = serde_json::from_str(&body).expect("accepted json");
    let operation_id = accepted["operationId"]
        .as_str()
        .expect("operationId")
        .to_string();

    // The wire's view settles; the journal's view is the service's own list.
    let mut wire_record = None;
    for _ in 0..200 {
        let answer = boundaries
            .get_json(
                &format!("/api/v1/operations?operationId={operation_id}"),
                &bearer,
            )
            .await;
        let record = &answer["operations"][0];
        let status = record["status"].as_str().unwrap_or("");
        if status != "queued" && status != "running" && !status.is_empty() {
            wire_record = Some(record.clone());
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let wire_record = wire_record.expect("the operation settled on the wire");
    assert_eq!(wire_record["status"], "succeeded", "{wire_record}");

    // The journal answers with the identical record for the identical actor.
    let journal = boundaries.service.operations("local-user", 50);
    let journalled = journal
        .operations
        .iter()
        .find(|record| record.operation_id == operation_id)
        .expect("the journalled record is listed");
    assert_eq!(wire_record, serialized(journalled));

    // And the direct boundary can submit the same kind of request — the request type the
    // wire deserialized into is the type the engine accepts. Freshness is per call, so
    // the direct side reads its own fresh snapshot and mints its own preview first.
    boundaries
        .fixture
        .write("staged-directly.txt", "the other side\n");
    let fresh = boundaries
        .service
        .status(&StatusQuery::new(repository_id.clone()))
        .await
        .expect("fresh status");
    let fresh_path = fresh.entries[0].path_id.clone();
    let fresh_previews = boundaries
        .service
        .previews(&PreviewsRequest {
            repository_id: repository_id.clone(),
            worktree_id: fresh.worktree_id.clone(),
            path_ids: vec![fresh_path.clone()],
        })
        .await
        .expect("fresh previews");
    let direct_request = MutationRequest {
        client_request_id: "two-boundaries-direct-stage".to_string(),
        target: MutationTarget::Worktree {
            repository_id: repository_id.clone(),
            worktree_id: fresh.worktree_id.clone(),
            expected_snapshot_id: fresh.snapshot_id.clone(),
        },
        operation: MutationOperation::StagePaths {
            path_ids: vec![fresh_path],
            preview_tokens: vec![fresh_previews.tokens[0].preview_token.clone()],
        },
    };
    let submitted = boundaries
        .service
        .submit_mutation("local-user", direct_request)
        .await
        .expect("the direct submission is accepted");
    assert_eq!(submitted.record.kind, MutationKind::StagePaths);
}
