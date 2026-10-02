//! The launcher: where a session picks the repository it works on.
//!
//! Repositories are registered explicitly with the host — nothing is discovered by
//! scanning the disk — so this view offers exactly two doors: the OS folder picker
//! (`rfd`, run on the main thread, which is where its macOS panel must run) and the list
//! of recently opened paths this app persists itself. Clicking a recent path registers
//! it with the host (registration is idempotent) and opens the workbench.
//!
//! Service reads run on the tokio runtime through the bridge; the view polls results on
//! GPUI's main-thread executor and discards anything from a stale generation.

use std::path::PathBuf;
use std::sync::Arc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _, Disableable as _, Icon, IconName};
use gpui_kit::*;
use refyard_contract::reads::{CapabilitiesResponse, RepositoriesResponse, RepositorySummary};
use smol::channel;

use crate::composition::Host;

/// What the launcher reports to the root: the repository a session should open.
pub enum LauncherEvent {
    Opened(RepositorySummary),
}

/// One message from a background call, tagged with the generation that asked for it.
enum LauncherMsg {
    Booted {
        generation: u64,
        repositories: Result<RepositoriesResponse, String>,
        capabilities: Result<CapabilitiesResponse, String>,
    },
    Registered {
        generation: u64,
        path: String,
        response: Result<RepositoriesResponse, String>,
    },
}

/// The launcher's own persisted preferences: the recent paths, newest first.
#[derive(serde::Serialize, serde::Deserialize, Default)]
struct RecentRepositories {
    #[serde(default)]
    paths: Vec<String>,
}

/// How many recent paths are kept.
const RECENTS_MAX: usize = 8;

pub struct LauncherView {
    host: Arc<Host>,
    repositories: Vec<RepositorySummary>,
    capabilities: Option<CapabilitiesResponse>,
    recents: Vec<String>,
    error: Option<String>,
    loading: bool,
    registering: Option<String>,
    generation: u64,
    _task: Option<Task<()>>,
}

impl gpui_kit::EventEmitter<LauncherEvent> for LauncherView {}

impl LauncherView {
    pub fn new(host: Arc<Host>, cx: &mut Context<Self>) -> Self {
        let recents = load_recents(&host.state_root);
        let mut this = Self {
            host: host.clone(),
            repositories: Vec::new(),
            capabilities: None,
            recents,
            error: None,
            loading: true,
            registering: None,
            generation: 0,
            _task: None,
        };
        this.fetch_boot_state(cx);
        this
    }

    /// The first read of the session: what the host can do, and what is registered.
    fn fetch_boot_state(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self.loading = true;
        self.error = None;
        let (tx, rx) = channel::bounded::<LauncherMsg>(1);
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let repositories = service.repositories().await;
            let capabilities = service.capabilities().await;
            let _ = tx
                .send(LauncherMsg::Booted {
                    generation,
                    repositories: Ok(repositories),
                    capabilities: capabilities.map_err(|problem| problem.to_string()),
                })
                .await;
        });
        self._task = Some(cx.spawn(async move |this, cx| {
            // Channel closed with nothing in flight: the background task aborted.
            // Reset the UI rather than leaving it pending forever.
            let Ok(message) = rx.recv().await else {
                this.update(cx, |this, cx| {
                    this.loading = false;
                    this.error = Some("the background task aborted".to_owned());
                    cx.notify();
                })
                .ok();
                return;
            };
            this.update(cx, |this, cx| match message {
                LauncherMsg::Booted { generation, repositories, capabilities }
                    if generation == this.generation =>
                {
                    this.loading = false;
                    match (repositories, capabilities) {
                        (Ok(response), Ok(capabilities)) => {
                            this.repositories = response.repositories;
                            this.capabilities = Some(capabilities);
                        }
                        (Err(problem), _) | (_, Err(problem)) => {
                            this.error = Some(problem);
                        }
                    }
                    cx.notify();
                }
                _ => {}
            })
            .ok();
        }));
    }

    /// Register the browsed or recent path, then open whatever repository it produced.
    fn open_path(&mut self, path: String, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self.registering = Some(path.clone());
        self.error = None;
        let before: Vec<String> =
            self.repositories.iter().map(|repo| repo.repository_id.clone()).collect();
        let (tx, rx) = channel::bounded::<LauncherMsg>(1);
        let service = self.host.service.clone();
        self.host.runtime.spawn(async move {
            let response = service.register_repository(&path).await;
            let _ = tx
                .send(LauncherMsg::Registered {
                    generation,
                    path,
                    response: response.map_err(|problem| problem.to_string()),
                })
                .await;
        });
        self._task = Some(cx.spawn(async move |this, cx| {
            let outcome = match rx.recv().await {
                Ok(message) => message,
                Err(_) => LauncherMsg::Registered {
                    generation,
                    path: String::new(),
                    response: Err("the background task aborted".to_owned()),
                },
            };
            this.update(cx, |this, cx| match outcome {
                LauncherMsg::Registered { generation, path, response }
                    if generation == this.generation =>
                {
                    this.registering = None;
                    match response {
                        Ok(response) => {
                            this.repositories = response.repositories.clone();
                            this.remember_recent(path.clone());
                            if let Some(repository) = resolve_registered(&response, &path, &before)
                            {
                                this.persist_recents();
                                cx.emit(LauncherEvent::Opened(repository));
                                return;
                            }
                            // Registered but not identifiable: stay on the launcher and
                            // let the refreshed list show it.
                            cx.notify();
                        }
                        Err(problem) => {
                            this.error = Some(problem);
                            cx.notify();
                        }
                    }
                }
                _ => {}
            })
            .ok();
        }));
    }

    fn remember_recent(&mut self, path: String) {
        self.recents.retain(|recent| *recent != path);
        self.recents.insert(0, path);
        self.recents.truncate(RECENTS_MAX);
    }

    fn persist_recents(&self) {
        let preferences = RecentRepositories { paths: self.recents.clone() };
        if let Ok(json) = serde_json::to_string_pretty(&preferences) {
            let target = recents_file(&self.host.state_root);
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(target, json);
        }
    }

    fn open_recent(&mut self, path: &str, cx: &mut Context<Self>) {
        self.open_path(path.to_owned(), cx);
    }
}

/// Find the repository a registration produced: a freshly minted id, or the one already
/// registered at this path. `None` means "registered, but show the list instead".
fn resolve_registered(
    response: &RepositoriesResponse,
    path: &str,
    before: &[String],
) -> Option<RepositorySummary> {
    response
        .repositories
        .iter()
        .find(|repo| !before.contains(&repo.repository_id))
        .or_else(|| {
            response
                .repositories
                .iter()
                .find(|repo| repo.display_path == path)
        })
        .cloned()
}

fn recents_file(state_root: &std::path::Path) -> PathBuf {
    state_root.join("gpui-ui.json")
}

fn load_recents(state_root: &std::path::Path) -> Vec<String> {
    let Ok(json) = std::fs::read_to_string(recents_file(state_root)) else {
        return Vec::new();
    };
    serde_json::from_str::<RecentRepositories>(&json)
        .map(|preferences| preferences.paths)
        .unwrap_or_default()
}

impl Render for LauncherView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let foreground = theme.colors.foreground;
        let muted = theme.colors.muted_foreground;
        let surface = theme.colors.background;
        let border = theme.colors.border;

        let mut column = v_flex()
            .size_full()
            .items_center()
            .justify_center()
            .bg(surface)
            .text_color(foreground)
            .gap_6();

        let mut card = v_flex()
            .w(px(560.0))
            .gap_4()
            .p_6()
            .rounded_lg()
            .border_1()
            .border_color(border)
            .bg(theme.colors.popover);

        card = card.child(
            v_flex()
                .gap_1()
                .child(
                    div()
                        .text_size(px(28.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Refyard"),
                )
                .child(
                    div()
                        .text_size(px(13.0))
                        .text_color(muted)
                        .child("A Git workbench for this machine"),
                ),
        );

        card = card.child(
            h_flex()
                .gap_2()
                .child(
                    Button::new("browse")
                        .primary()
                        .label("Open a repository…")
                        .loading(self.registering.is_some())
                        .disabled(self.loading)
                        .on_click(cx.listener(|this, _event, window, cx| {
                            browse_for_repository(this, window, cx);
                        })),
                ),
        );

        if let Some(error) = &self.error {
            card = card.child(
                div()
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .text_size(px(12.5))
                    .text_color(theme.colors.danger)
                    .bg(theme.colors.danger.opacity(0.08))
                    .child(error.clone()),
            );
        }

        if self.loading {
            card = card.child(
                div().text_size(px(13.0)).text_color(muted).child("Connecting to the host…"),
            );
        } else {
            if !self.recents.is_empty() {
                let mut recents = v_flex().gap_1();
                recents = recents.child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(muted)
                        .child("RECENT"),
                );
                for path in self.recents.clone() {
                    let name = std::path::Path::new(&path)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.clone());
                    let registering = self.registering.as_ref() == Some(&path);
                    let display_path = path.clone();
                    recents = recents.child(
                        h_flex()
                            .id(path.clone())
                            .gap_2()
                            .px_2()
                            .py_1p5()
                            .rounded_md()
                            .cursor_pointer()
                            .hover(|style| style.bg(theme.colors.secondary))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_recent(&display_path, cx);
                            }))
                            .child(Icon::new(IconName::Folder).text_color(muted))
                            .child(
                                v_flex()
                                    .flex_1()
                                    .child(
                                        div()
                                            .text_size(px(13.0))
                                            .text_color(if registering { muted } else { foreground })
                                            .child(if registering {
                                                format!("Opening {name}…")
                                            } else {
                                                name
                                            }),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(muted)
                                            .child(path),
                                    ),
                            ),
                    );
                }
                card = card.child(recents);
            }

            if !self.repositories.is_empty() {
                let mut registered = v_flex().gap_1();
                registered = registered.child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(muted)
                        .child("OPEN IN THIS SESSION"),
                );
                for repository in self.repositories.clone() {
                    let display_path = repository.display_path.clone();
                    let branch = repository
                        .head
                        .branch_name
                        .clone()
                        .unwrap_or_else(|| match repository.head.kind {
                            refyard_contract::reads::HeadKind::Unborn => "unborn".to_owned(),
                            refyard_contract::reads::HeadKind::Born => "detached".to_owned(),
                        });
                    registered = registered.child(
                        h_flex()
                            .id(repository.repository_id.clone())
                            .gap_2()
                            .px_2()
                            .py_1p5()
                            .rounded_md()
                            .cursor_pointer()
                            .hover(|style| style.bg(theme.colors.secondary))
                            .on_click(cx.listener(move |this, _event, _window, cx| {
                                this.open_recent(&display_path, cx);
                            }))
                            .child(Icon::new(IconName::FolderOpen).text_color(muted))
                            .child(
                                v_flex()
                                    .flex_1()
                                    .child(
                                        div().text_size(px(13.0)).child(
                                            repository.display_name.clone(),
                                        ),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.0))
                                            .text_color(muted)
                                            .child(format!(
                                                "{} · {}",
                                                branch, repository.display_path
                                            )),
                                    ),
                            ),
                    );
                }
                card = card.child(registered);
            }

            if self.recents.is_empty() && self.repositories.is_empty() {
                card = card.child(
                    div().text_size(px(13.0)).text_color(muted).child(
                        "No repositories yet. Open one to begin — it stays in this list.",
                    ),
                );
            }
        }

        if let Some(capabilities) = &self.capabilities {
            card = card.child(
                div()
                    .text_size(px(11.0))
                    .text_color(muted)
                    .child(format!(
                        "host {} · git {} · contract {}",
                        capabilities.host.kind_label(),
                        capabilities.git.version,
                        capabilities.contract_version
                    )),
            );
        }

        column = column.child(card);
        column
    }
}

/// Open the OS folder picker. `rfd`'s macOS panel must run on the main thread, so the
/// await happens inside `spawn_in`, which polls there.
fn browse_for_repository(
    _this: &mut LauncherView,
    window: &mut Window,
    cx: &mut Context<LauncherView>,
) {
    cx.spawn_in(window, async move |this, cx| {
        let picked = rfd::AsyncFileDialog::new()
            .set_title("Choose a Git repository")
            .pick_folder()
            .await
            .map(|handle| handle.path().to_path_buf());
        this.update_in(cx, |this, _window, cx| match picked {
            Some(path) => {
                let path = path.to_string_lossy().into_owned();
                this.open_path(path, cx);
            }
            None => {
                // The person cancelled the picker: nothing changed.
                cx.notify();
            }
        })
        .ok();
    })
    .detach();
}

/// The `HostInfo` kind is an enum; the footer wants one short label for it.
trait HostKindLabel {
    fn kind_label(&self) -> &'static str;
}

impl HostKindLabel for refyard_contract::reads::HostInfo {
    fn kind_label(&self) -> &'static str {
        match self.kind {
            refyard_contract::reads::HostKind::Rust => "rust",
            refyard_contract::reads::HostKind::Node => "node",
        }
    }
}
