//! The differential fixture driver: one JSON request on stdin, one JSON response on
//! stdout, diagnostics on stderr.
//!
//! This binary exists so the TypeScript suite can drive the Rust service over a pipe
//! instead of linking it. It is an **example** on purpose: `cargo build` and
//! `cargo build --release` never build it, and it is only produced when
//! `--example fixture_driver` is passed. Nothing in the product links it.
//!
//! The request shape is deliberately close to the wire contract:
//!
//! ```text
//! {"op":"capabilities"}
//! {"op":"register","path":"/repo","fixtureHome":"/tmp/…/home"}
//! {"op":"status","path":"/repo","repositoryId":"repo_1","includeIgnored":true}
//! {"op":"refs","path":"/repo"}
//! {"op":"history","path":"/repo","limit":2,"detailOid":"…"}
//! {"op":"diff","path":"/repo","kind":"staged","patchForDisplayPath":"a.txt"}
//! ```
//!
//! `fixtureHome` is a test-only extension: it points the fixture's `HOME`,
//! `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` at the scratch files the JavaScript
//! fixture created. Without it the driver would inherit the developer's own Git
//! configuration, and a diff would come out differently on two machines — which is
//! exactly what a differential fixture must not allow. Nothing in the library does this:
//! the process runner still clears the environment and adds back its own allow-list.
//!
//! A read request registers `path` first, so every invocation is self-contained: the
//! harness never has to carry a `repositoryId` between processes. A `repositoryId` in the
//! request is honoured as the id to read, so a request aimed at a repository this process
//! did not register is refused rather than answered from the wrong one.

use std::io::{Read, Write};

use serde::Deserialize;

use refyard_contract::diff::{DiffKind, DiffQuery};
use refyard_contract::history::HistoryQuery;
use refyard_contract::problem::{Problem, ProblemCode, ProblemResponse};
use refyard_host::process::git_environment;
use refyard_host::providers::local::LocalGit;
use refyard_host::service::{ApplicationService, ApplicationServiceConfig, StatusQuery};

/// One request from the harness.
#[derive(Debug, Deserialize)]
#[serde(
    tag = "op",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum DriverRequest {
    Capabilities,
    Register {
        path: String,
        #[serde(default)]
        fixture_home: Option<String>,
    },
    Status {
        path: String,
        #[serde(default)]
        fixture_home: Option<String>,
        #[serde(default)]
        repository_id: Option<String>,
        #[serde(default)]
        include_ignored: Option<bool>,
    },
    Refs {
        path: String,
        #[serde(default)]
        fixture_home: Option<String>,
        #[serde(default)]
        repository_id: Option<String>,
    },
    History {
        path: String,
        #[serde(default)]
        fixture_home: Option<String>,
        #[serde(default)]
        repository_id: Option<String>,
        #[serde(default)]
        limit: Option<u64>,
        #[serde(default)]
        detail_oid: Option<String>,
        #[serde(default)]
        first_parent_only: Option<bool>,
    },
    Diff {
        path: String,
        #[serde(default)]
        fixture_home: Option<String>,
        #[serde(default)]
        repository_id: Option<String>,
        kind: DiffKind,
        #[serde(default)]
        oid: Option<String>,
        #[serde(default)]
        from: Option<String>,
        #[serde(default)]
        to: Option<String>,
        /// Ask for the change set, then for that one path's patch — the two-step flow a
        /// client performs with the `pathId` it was given. Test-only, and it is why the
        /// driver needs no path-id registry of its own.
        #[serde(default)]
        patch_for_display_path: Option<String>,
    },
}

fn main() {
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        fail(&Problem::new(
            ProblemCode::InvalidRequest,
            format!("stdin could not be read: {error}"),
        ));
    }
    let request: DriverRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => fail(&Problem::new(
            ProblemCode::InvalidRequest,
            format!("the request is not a driver request: {error}"),
        )),
    };
    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => fail(&Problem::new(
            ProblemCode::InternalError,
            format!("no async runtime: {error}"),
        )),
    };
    match runtime.block_on(handle(request)) {
        Ok(value) => match serde_json::to_string(&value) {
            Ok(text) => {
                println!("{text}");
            }
            Err(error) => fail(&Problem::new(
                ProblemCode::InternalError,
                format!("the response could not be serialized: {error}"),
            )),
        },
        Err(problem) => fail(&problem),
    }
}

/// Runs one request, building the service it needs.
async fn handle(request: DriverRequest) -> Result<serde_json::Value, Problem> {
    let (path, fixture_home, repository_id) = match &request {
        DriverRequest::Capabilities => (None, None, None),
        DriverRequest::Register { path, fixture_home } => {
            (Some(path.clone()), fixture_home.clone(), None)
        }
        DriverRequest::Status {
            path,
            fixture_home,
            repository_id,
            ..
        }
        | DriverRequest::Refs {
            path,
            fixture_home,
            repository_id,
        }
        | DriverRequest::History {
            path,
            fixture_home,
            repository_id,
            ..
        }
        | DriverRequest::Diff {
            path,
            fixture_home,
            repository_id,
            ..
        } => (
            Some(path.clone()),
            fixture_home.clone(),
            repository_id.clone(),
        ),
    };
    let service = build_service(fixture_home.as_deref())?;
    let repository_id = match path {
        None => service.service_instance_id().to_string(),
        Some(path) => {
            let registered = service.register_repository(&path).await?;
            let minted = registered
                .repositories
                .last()
                .map(|summary| summary.repository_id.clone())
                .ok_or_else(|| {
                    Problem::new(
                        ProblemCode::InternalError,
                        "registration produced no repository",
                    )
                })?;
            eprintln!(
                "fixture_driver: registered {path} as {minted} (target {})",
                service.target_id()
            );
            // The requested id is what the read addresses: an id this process did not
            // register is refused by the read itself.
            repository_id.unwrap_or(minted)
        }
    };

    match request {
        DriverRequest::Capabilities => {
            let capabilities = service.capabilities().await?;
            serde_json::to_value(capabilities).map_err(serialize_error)
        }
        DriverRequest::Register { .. } => {
            let response = service.repositories().await;
            serde_json::to_value(response).map_err(serialize_error)
        }
        DriverRequest::Status {
            include_ignored, ..
        } => {
            let mut query = StatusQuery::new(repository_id);
            query.include_ignored = include_ignored == Some(true);
            let snapshot = service.status(&query).await?;
            serde_json::to_value(snapshot).map_err(serialize_error)
        }
        DriverRequest::Refs { .. } => {
            let snapshot = service.refs(&repository_id).await?;
            serde_json::to_value(snapshot).map_err(serialize_error)
        }
        DriverRequest::History {
            limit,
            detail_oid,
            first_parent_only,
            ..
        } => {
            let query = HistoryQuery {
                repository_id: repository_id.clone(),
                worktree_id: None,
                cursor: None,
                limit,
                detail_oid,
                first_parent_only,
                message: None,
                author: None,
                oid_prefix: None,
                ref_full_name: None,
                committed_after: None,
                committed_before: None,
                path_id: None,
            };
            let page = service.history(&query).await?;
            serde_json::to_value(page).map_err(serialize_error)
        }
        DriverRequest::Diff {
            kind,
            oid,
            from,
            to,
            patch_for_display_path,
            ..
        } => {
            let base = |path_id: Option<String>| DiffQuery {
                repository_id: repository_id.clone(),
                worktree_id: None,
                kind,
                oid: oid.clone(),
                from: from.clone(),
                to: to.clone(),
                path_id,
                max_bytes: None,
            };
            let response = match patch_for_display_path {
                None => service.diff(&base(None)).await?,
                Some(display_path) => {
                    let described = service.diff(&base(None)).await?;
                    let target = described
                        .files
                        .iter()
                        .find(|file| file.display_path == display_path)
                        .ok_or_else(|| {
                            Problem::new(
                                ProblemCode::NotFound,
                                format!(
                                    "no changed path has the display path {display_path:?} in this diff"
                                ),
                            )
                        })?;
                    service.diff(&base(Some(target.path_id.clone()))).await?
                }
            };
            serde_json::to_value(response).map_err(serialize_error)
        }
    }
}

/// Builds the service the driver's requests run against.
fn build_service(fixture_home: Option<&str>) -> Result<ApplicationService, Problem> {
    let git = LocalGit::discover().map_err(|message| {
        Problem::new(ProblemCode::Unavailable, message).with_detail(
            "diagnostic",
            refyard_contract::problem::DetailValue::Text(
                "git was not found on PATH for the fixture driver".to_string(),
            ),
        )
    })?;
    let environment = match fixture_home {
        None => git.environment().to_vec(),
        Some(home) => fixture_environment(home),
    };
    Ok(ApplicationService::new(ApplicationServiceConfig {
        git: LocalGit::at(git.program().to_path_buf(), environment),
        service_instance_id: "srvc_fixture".to_string(),
        target_id: "tgt_local".to_string(),
        target_generation: "gen_1".to_string(),
    }))
}

/// The environment a fixture repository is read under.
///
/// The library's allow-list first, then the fixture's own config files: a read that
/// inherited the developer's global Git configuration would answer differently on two
/// machines, and a differential fixture is worthless if it does.
fn fixture_environment(home: &str) -> Vec<(String, String)> {
    let mut environment = git_environment();
    let overrides: [(&str, String); 7] = [
        ("HOME", home.to_string()),
        ("XDG_CONFIG_HOME", format!("{home}/.config")),
        ("GIT_CONFIG_GLOBAL", format!("{home}/.gitconfig")),
        ("GIT_CONFIG_SYSTEM", "/dev/null".to_string()),
        ("GIT_CONFIG_NOSYSTEM", "1".to_string()),
        ("LC_ALL", "C".to_string()),
        ("LANG", "C".to_string()),
    ];
    for (name, value) in overrides {
        match environment
            .iter_mut()
            .find(|(existing, _)| existing == name)
        {
            Some(entry) => entry.1 = value,
            None => environment.push((name.to_string(), value)),
        }
    }
    environment
}

fn serialize_error(error: serde_json::Error) -> Problem {
    Problem::new(
        ProblemCode::InternalError,
        format!("the response could not be serialized: {error}"),
    )
}

/// Prints a problem envelope and exits non-zero, so a harness sees the failure twice.
fn fail(problem: &Problem) -> ! {
    let envelope = ProblemResponse {
        problem: problem.clone(),
    };
    let text = serde_json::to_string(&envelope)
        .unwrap_or_else(|_| "{\"problem\":{\"code\":\"InternalError\"}}".to_string());
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{text}");
    let _ = stdout.flush();
    eprintln!("fixture_driver: {:?}: {}", problem.code, problem.message);
    std::process::exit(1);
}
