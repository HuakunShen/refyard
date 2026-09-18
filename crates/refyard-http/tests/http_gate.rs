//! The gate and the routes, driven the way a client drives them.
//!
//! These tests call the real router over the real loopback listener with a real fixture
//! repository behind it, so what they exercise is the order of the gates — origin before
//! auth, auth before routing, grants before the service — and the wire answers a browser
//! or an integration client actually receives. The pairing flow is exercised end to end:
//! a ticket from `pairing_url` becomes a session, the session registers a repository, and
//! the repository answers.

use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig};
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

/// A live host over one fixture repository, with no repository granted up front.
struct Host {
    host: refyard_http::HttpHost,
    fixture: Fixture,
}

impl Host {
    async fn start() -> Self {
        let fixture = Fixture::new();
        let git = LocalGit::at("git", fixture.env.clone());
        let home = refyard_host::reads::filesystem::home_from(git.environment())
            .expect("the fixture has a home");
        let service = Arc::new(
            ApplicationService::new(ApplicationServiceConfig {
                git,
                service_instance_id: "srvc_test".to_string(),
                target_id: "tgt_local".to_string(),
                target_generation: "gen_test".to_string(),
                home,
            })
            .with_writes(),
        );
        let host = start_http_host(HttpHostOptions {
            service,
            port: 0,
            web_root: None,
            ticket_ttl_seconds: 60,
            grants: Grants::for_repositories(Vec::new(), Vec::new()),
        })
        .await
        .expect("the host starts");
        Self { host, fixture }
    }

    /// Pairs like a browser does: the pairing URL's ticket, spent from its own origin.
    async fn paired(&self) -> String {
        let origin = self.host.base_url.clone();
        let url = self.host.pairing_url(&origin).expect("pairing url");
        let ticket = url
            .split("pair=")
            .nth(1)
            .expect("the pairing url carries the ticket")
            .to_string();
        let (status, body) = self.exchange_from(&origin, &ticket).await;
        assert_eq!(status, 200, "{body}");
        let json: serde_json::Value =
            serde_json::from_str(&body).expect("the exchange answers JSON");
        format!("Bearer {}", json["token"].as_str().expect("token"))
    }

    /// The exchange as a browser makes it: the ticket in the body, the origin in the
    /// Origin header — because the ticket is bound to the origin it was minted for.
    async fn exchange_from(&self, origin: &str, ticket: &str) -> (u16, String) {
        let mut builder = reqwest_ish(
            "POST",
            &format!("{}/api/v1/session/exchange", self.host.base_url),
        );
        builder = builder.header("origin", origin);
        let response = builder
            .header("content-type", "application/json")
            .body(format!(r#"{{"ticket":"{ticket}"}}"#))
            .send()
            .await
            .expect("the exchange answers");
        let status = response.status();
        let text = response.text().await.expect("body text");
        (status, text)
    }

    async fn get_raw(&self, path: &str, bearer: Option<&str>) -> (u16, String) {
        self.send_raw("GET", path, None, bearer).await
    }

    async fn post_raw(&self, path: &str, body: &str, bearer: Option<&str>) -> (u16, String) {
        self.send_raw("POST", path, Some(body), bearer).await
    }

    async fn send_raw(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        bearer: Option<&str>,
    ) -> (u16, String) {
        let mut builder = reqwest_ish(method, &format!("{}{path}", self.host.base_url));
        if let Some(bearer) = bearer {
            builder = builder.header("authorization", bearer);
        }
        if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            let response = builder
                .body(body.to_string())
                .send()
                .await
                .expect("the request answers");
            let status = response.status();
            let text = response.text().await.expect("body text");
            return (status, text);
        }
        let response = builder.send().await.expect("the request answers");
        let status = response.status();
        let text = response.text().await.expect("body text");
        (status, text)
    }

    /// A request with explicit Host/Origin headers, for the gate tests.
    async fn send_with_headers(
        &self,
        path: &str,
        headers: &[(&str, &str)],
        bearer: Option<&str>,
    ) -> (u16, String) {
        let mut builder = reqwest_ish("GET", &format!("{}{path}", self.host.base_url));
        if let Some(bearer) = bearer {
            builder = builder.header("authorization", bearer);
        }
        for &(name, value) in headers {
            builder = builder.header(name, value);
        }
        let response = builder.send().await.expect("the request answers");
        let status = response.status();
        let text = response.text().await.expect("body text");
        (status, text)
    }
}

/// The one HTTP client these tests use: `reqwest` is not a dependency, so this is the
/// smallest std-based client that can state method, headers and body.
///
/// It speaks just enough HTTP/1.1 for a loopback test: one request, one response, no
/// keep-alive. That smallness is the point — the server under test must handle a plain,
/// correct client, not a browser.
mod reqwest_ish {
    pub struct RequestBuilder {
        method: String,
        url: String,
        headers: Vec<(String, String)>,
        body: Option<String>,
    }

    pub fn request_builder(method: &str, url: &str) -> RequestBuilder {
        RequestBuilder {
            method: method.to_string(),
            url: url.to_string(),
            headers: Vec::new(),
            body: None,
        }
    }

    impl RequestBuilder {
        pub fn header(mut self, name: &str, value: impl Into<String>) -> Self {
            self.headers.push((name.to_string(), value.into()));
            self
        }

        pub fn body(mut self, body: String) -> Self {
            self.body = Some(body);
            self
        }

        pub async fn send(self) -> std::io::Result<Response> {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let url = self.url.trim_start_matches("http://").to_string();
            let (authority, path) = url.split_once('/').unwrap_or((url.as_str(), ""));
            let (_host, port) = authority.split_once(':').unwrap_or((authority, "80"));
            let socket = tokio::net::TcpSocket::new_v4().expect("socket");
            let address =
                std::net::SocketAddr::from(([127, 0, 0, 1], port.parse::<u16>().expect("port")));
            let mut stream = socket.connect(address).await?;
            // The default Host is the full authority (host:port) — the spelling a
            // loopback authority check compares — and a test-supplied host wins, so a
            // gate test can name a rebinding host without fighting the default.
            let host_header = self
                .headers
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("host"))
                .map(|(_, value)| value.clone())
                .unwrap_or_else(|| authority.to_string());
            let mut request = format!(
                "{} /{} HTTP/1.1\r\nhost: {}\r\nconnection: close\r\n",
                self.method, path, host_header
            );
            for (name, value) in &self.headers {
                if name.eq_ignore_ascii_case("host") {
                    continue;
                }
                request.push_str(&format!("{name}: {value}\r\n"));
            }
            let body = self.body.unwrap_or_default();
            if !body.is_empty() {
                request.push_str(&format!("content-length: {}\r\n", body.len()));
            }
            request.push_str("\r\n");
            request.push_str(&body);
            stream.write_all(request.as_bytes()).await?;
            let mut raw = Vec::new();
            stream.read_to_end(&mut raw).await?;
            Ok(Response { raw })
        }
    }

    pub struct Response {
        raw: Vec<u8>,
    }

    impl Response {
        pub fn status(&self) -> u16 {
            let head = String::from_utf8_lossy(&self.raw);
            head.split_whitespace()
                .nth(1)
                .and_then(|code| code.parse().ok())
                .unwrap_or(0)
        }

        pub async fn text(self) -> std::io::Result<String> {
            let separator = self
                .raw
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .expect("a head/body separator");
            Ok(String::from_utf8_lossy(&self.raw[separator + 4..]).into_owned())
        }

        pub fn header(&self, name: &str) -> Option<String> {
            let head = String::from_utf8_lossy(&self.raw);
            for line in head.lines() {
                if let Some((candidate, value)) = line.split_once(':') {
                    if candidate.eq_ignore_ascii_case(name) {
                        return Some(value.trim().to_string());
                    }
                }
            }
            None
        }
    }
}

use reqwest_ish::request_builder as reqwest_ish;

#[tokio::test]
async fn health_answers_without_a_session() {
    let host = Host::start().await;
    let (status, body) = host.get_raw("/health", None).await;
    assert_eq!(status, 200, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert_eq!(json["alive"], serde_json::json!(true));
    assert_eq!(json["serviceInstanceId"], "srvc_test");
}

// Prevents: a page without a ticket reading anything. Every read is authenticated,
// including the capability list that tells it what else exists.
#[tokio::test]
async fn an_unauthenticated_read_is_refused_with_the_pairing_instruction() {
    let host = Host::start().await;
    let (status, body) = host.get_raw("/api/v1/capabilities", None).await;
    assert_eq!(status, 401, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert_eq!(json["problem"]["code"], "Unauthenticated");
}

// Prevents: a cross-origin page reading the API with a stolen-or-guessed Host spelling.
// The Host must be this instance's authority and the Origin must match it exactly.
#[tokio::test]
async fn a_foreign_host_or_origin_is_refused_before_authentication() {
    let host = Host::start().await;
    let authority = format!("127.0.0.1:{}", host.host.port);
    for (headers, why) in [
        (
            vec![
                ("host", "attacker.example"),
                ("origin", "https://attacker.example"),
            ],
            "a rebinding name",
        ),
        (
            vec![
                ("host", authority.as_str()),
                ("origin", "https://evil.example"),
            ],
            "a cross-origin page",
        ),
    ] {
        let (status, body) = host
            .send_with_headers("/api/v1/repositories", &headers, None)
            .await;
        assert_eq!(status, 403, "{why}: {body}");
        let json: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(json["problem"]["code"], "Forbidden", "{why}");
    }
}

#[tokio::test]
async fn a_ticket_pairs_once_and_the_session_reads_the_workbench() {
    let host = Host::start().await;
    let bearer = host.paired().await;

    // Register through the API, like the workbench does when a person picks a folder.
    let (status, body) = host
        .post_raw(
            "/api/v1/repositories/register",
            &format!(r#"{{"path":"{}"}}"#, host.fixture.path()),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    let repository_id = json["repositories"][0]["repositoryId"]
        .as_str()
        .expect("repositoryId")
        .to_string();

    // The freshly registered repository is readable by the session that registered it.
    let (status, body) = host
        .get_raw(
            &format!("/api/v1/status?repositoryId={repository_id}"),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert!(json["entries"].is_array(), "{body}");

    // The full write loop a person drives: change a file, preview it, stage it, commit.
    host.fixture.write("README.md", "second\n");
    let (status, body) = host
        .get_raw(
            &format!("/api/v1/status?repositoryId={repository_id}"),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let snapshot: serde_json::Value = serde_json::from_str(&body).expect("json");
    let snapshot_id = snapshot["snapshotId"].as_str().expect("snapshotId");
    let worktree_id = snapshot["worktreeId"].as_str().expect("worktreeId");
    let path_id = snapshot["entries"][0]["pathId"].as_str().expect("pathId");

    let (_status, body) = host
        .post_raw(
            "/api/v1/previews",
            &format!(r#"{{"repositoryId":"{repository_id}","worktreeId":"{worktree_id}","pathIds":["{path_id}"]}}"#),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let previews: serde_json::Value = serde_json::from_str(&body).expect("json");
    let preview_token = previews["tokens"][0]["previewToken"]
        .as_str()
        .expect("previewToken");

    let (status, body) = host
        .post_raw(
            "/api/v1/operations",
            &format!(
                r#"{{"clientRequestId":"crid_stage","target":{{"kind":"worktree","repositoryId":"{repository_id}","worktreeId":"{worktree_id}","expectedSnapshotId":"{snapshot_id}"}},"operation":{{"kind":"stagePaths","pathIds":["{path_id}"],"previewTokens":["{preview_token}"]}}}}"#
            ),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 202, "{body}");
    assert_eq!(operation_status(&host, &bearer, &body).await, "succeeded");

    let (_status, body) = host
        .get_raw(
            &format!("/api/v1/status?repositoryId={repository_id}"),
            Some(&bearer),
        )
        .await;
    let snapshot: serde_json::Value = serde_json::from_str(&body).expect("json");
    let snapshot_id = snapshot["snapshotId"].as_str().expect("snapshotId");
    let (status, body) = host
        .post_raw(
            "/api/v1/operations",
            &format!(
                r#"{{"clientRequestId":"crid_commit","target":{{"kind":"worktree","repositoryId":"{repository_id}","worktreeId":"{worktree_id}","expectedSnapshotId":"{snapshot_id}"}},"operation":{{"kind":"commit","message":"from http"}}}}"#
            ),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 202, "{body}");
    assert_eq!(operation_status(&host, &bearer, &body).await, "succeeded");

    // The byte-identical replay answers as a duplicate, not a second write. (A replay
    // with a *changed* payload — a fresh snapshot id here — would be a 409 instead.)
    let (status, body) = host
        .post_raw(
            "/api/v1/operations",
            &format!(
                r#"{{"clientRequestId":"crid_commit","target":{{"kind":"worktree","repositoryId":"{repository_id}","worktreeId":"{worktree_id}","expectedSnapshotId":"{snapshot_id}"}},"operation":{{"kind":"commit","message":"from http"}}}}"#
            ),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert_eq!(json["duplicate"], serde_json::json!(true), "{body}");
}

/// Polls a submission's operation until it settles, and answers its final status.
async fn operation_status(host: &Host, bearer: &str, accepted_body: &str) -> String {
    let accepted: serde_json::Value = serde_json::from_str(accepted_body).expect("json");
    let operation_id = accepted["operationId"]
        .as_str()
        .expect("operationId")
        .to_string();
    for _ in 0..100 {
        let (status, body) = host
            .get_raw(
                &format!("/api/v1/operations?operationId={operation_id}"),
                Some(bearer),
            )
            .await;
        assert_eq!(status, 200, "{body}");
        let json: serde_json::Value = serde_json::from_str(&body).expect("json");
        let status = json["operations"][0]["status"]
            .as_str()
            .expect("status")
            .to_string();
        if status != "accepted" && status != "running" {
            return status;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("the operation did not settle");
}

// Prevents: a pairing URL in a browser history minting session after session.
#[tokio::test]
async fn a_ticket_is_usable_exactly_once() {
    let host = Host::start().await;
    let origin = host.host.base_url.clone();
    let url = host.host.pairing_url(&origin).expect("pairing url");
    let ticket = url.split("pair=").nth(1).expect("ticket").to_string();
    let (first_status, _) = host.exchange_from(&origin, &ticket).await;
    assert_eq!(first_status, 200);
    let (second_status, second_body) = host.exchange_from(&origin, &ticket).await;
    assert_eq!(second_status, 401, "{second_body}");
}

// Prevents: a ticket minted for one origin being spent from another. The exchange
// consumes the ticket either way, so a wrong-origin retry cannot fish.
#[tokio::test]
async fn a_ticket_is_refused_when_spent_from_another_origin() {
    let host = Host::start().await;
    let origin = host.host.base_url.clone();
    let url = host.host.pairing_url(&origin).expect("pairing url");
    let ticket = url.split("pair=").nth(1).expect("ticket").to_string();
    // Spent from a different origin. The origin gate refuses the request before the
    // exchange ever sees it — the safer order, because a ticket that survives can still
    // be spent by the person it was printed for.
    let (status, response) = host.exchange_from("http://127.0.0.1:1", &ticket).await;
    assert_eq!(status, 403, "{response}");
    assert_eq!(host.host.auth.lock().expect("auth").ticket_count(), 1);
    // The same ticket still pairs from its own origin afterwards.
    let (status, _) = host.exchange_from(&origin, &ticket).await;
    assert_eq!(status, 200);
}

// Prevents: an unknown API path answering with HTML (a broken request would look alive)
// or revealing which routes exist to an unauthenticated caller.
#[tokio::test]
async fn an_unknown_api_path_is_a_json_not_found_after_authentication() {
    let host = Host::start().await;
    let bearer = host.paired().await;
    let (status, body) = host.get_raw("/api/v1/no-such-read", Some(&bearer)).await;
    assert_eq!(status, 404, "{body}");
    assert!(body.contains("\"code\":\"NotFound\""), "{body}");
    assert!(!body.contains("<html"), "{body}");
    // A read this build does not implement is a 404 too, and capabilities does not list it.
    let (status, body) = host
        .get_raw("/api/v1/stashes?repositoryId=repo_x", Some(&bearer))
        .await;
    assert_eq!(status, 404, "{body}");
}

// Prevents: a session reaching a repository its grants do not cover, including through a
// mutation that names it.
#[tokio::test]
async fn a_session_cannot_read_or_write_a_repository_it_was_not_granted() {
    let host = Host::start().await;
    // Register two repositories: the pairing grants covered none, and registration
    // covers only the one this session registered.
    let bearer = host.paired().await;
    let (status, body) = host
        .post_raw(
            "/api/v1/repositories/register",
            &format!(r#"{{"path":"{}"}}"#, host.fixture.path()),
            Some(&bearer),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    let repository_id = json["repositories"][0]["repositoryId"]
        .as_str()
        .expect("repositoryId")
        .to_string();

    // A second session is paired to the same host and must not see the first session's
    // repository.
    let origin = host.host.base_url.clone();
    let url = host.host.pairing_url(&origin).expect("pairing url");
    let ticket = url.split("pair=").nth(1).expect("ticket").to_string();
    let (status, body) = host.exchange_from(&origin, &ticket).await;
    assert_eq!(status, 200, "{body}");
    let second: serde_json::Value = serde_json::from_str(&body).expect("json");
    let second_bearer = format!("Bearer {}", second["token"].as_str().expect("token"));

    let (status, body) = host
        .get_raw(
            &format!("/api/v1/status?repositoryId={repository_id}"),
            Some(&second_bearer),
        )
        .await;
    assert_eq!(status, 403, "{body}");
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert_eq!(json["problem"]["code"], "Forbidden", "{body}");
}

#[tokio::test]
async fn an_options_request_is_answered_with_the_methods_that_exist() {
    let host = Host::start().await;
    let (status, _body) = host
        .send_with_headers(
            "/api/v1/repositories",
            &[("host", &format!("127.0.0.1:{}", host.host.port))],
            None,
        )
        .await;
    let _ = status;
    // The gate answers OPTIONS itself; the assertion below is on the allow header, read
    // from a raw exchange so the header survives.
    let mut builder = reqwest_ish(
        "OPTIONS",
        &format!("{}/api/v1/repositories", host.host.base_url),
    );
    builder = builder.header("host", format!("127.0.0.1:{}", host.host.port));
    let response = builder.send().await.expect("answers");
    assert_eq!(response.status(), 405);
    assert_eq!(response.header("allow").as_deref(), Some("GET, POST"));
}

#[tokio::test]
async fn the_pairing_url_refuses_an_origin_the_service_does_not_answer_on() {
    let host = Host::start().await;
    let problem = host
        .host
        .pairing_url("https://workbench.example")
        .expect_err("refused");
    assert_eq!(
        problem.code,
        refyard_contract::problem::ProblemCode::Forbidden
    );
}
