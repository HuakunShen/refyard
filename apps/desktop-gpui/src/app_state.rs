//! The window's root view: a phase machine between the repository launcher and the
//! workbench.
//!
//! Child views report through emitted events; the root subscribes (holding the
//! `Subscription`s, because a dropped subscription is an unsubscribed one) and rebuilds
//! the phase. The root is built inside `open_window`, where a `Window` exists, and that
//! window is threaded into whatever child construction needs it — subscribe callbacks
//! receive one only through `subscribe_in`, which is why every subscription here is
//! window-scoped.
//!
//! An argv path (if the process was given one) registers and opens before the first
//! frame, so `refyard-gpui <path>` lands in the workbench directly.

use std::sync::Arc;

use gpui_kit::*;

use crate::composition::Host;
use crate::views::launcher::{LauncherEvent, LauncherView};
use crate::views::workbench::{WorkbenchEvent, WorkbenchView};

pub enum Phase {
    Launcher,
    Workbench,
}

pub struct AppState {
    host: Arc<Host>,
    phase: Phase,
    launcher: Entity<LauncherView>,
    workbench: Option<Entity<WorkbenchView>>,
    _subscriptions: Vec<Subscription>,
}

impl AppState {
    pub fn new(
        host: Arc<Host>,
        open_path: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let launcher = cx.new(|cx| LauncherView::new(host.clone(), cx));
        let mut subscriptions = Vec::new();
        subscriptions.push(cx.subscribe_in(
            &launcher,
            window,
            |this, _, event: &LauncherEvent, window, cx| match event {
                LauncherEvent::Opened(repository) => {
                    this.open_workbench(repository.clone(), window, cx)
                }
            },
        ));
        let mut this = Self {
            host,
            phase: Phase::Launcher,
            launcher,
            workbench: None,
            _subscriptions: subscriptions,
        };
        if let Some(path) = open_path {
            this.open_path_directly(path, window, cx);
        }
        this
    }

    /// Register the argv path and open it. Registration runs on the tokio runtime; the
    /// result lands through the same channel shape every other call uses. A failure
    /// leaves the phase at Launcher — the launcher's own error banner is not involved,
    /// so the failure is surfaced as a stderr note and the empty launcher.
    ///
    /// The match against the produced summary is by canonical path: the host
    /// canonicalizes what it registers, and a symlinked prefix (`/tmp` on macOS) would
    /// otherwise never compare equal to what the person typed.
    fn open_path_directly(
        &mut self,
        path: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let host = self.host.clone();
        let (tx, rx) = smol::channel::bounded::<
            Result<refyard_contract::reads::RepositoriesResponse, String>,
        >(1);
        let service = host.service.clone();
        let register_path = path.clone();
        host.runtime.spawn(async move {
            let response = service.register_repository(&register_path).await;
            let _ = tx.send(response.map_err(|problem| problem.to_string())).await;
        });
        cx.spawn_in(window, async move |this, cx| {
            let outcome = rx.recv().await.ok();
            let canonical = std::fs::canonicalize(&path)
                .unwrap_or_else(|_| std::path::PathBuf::from(&path))
                .to_string_lossy()
                .into_owned();
            this.update_in(cx, |this, _window, cx| {
                match outcome {
                    Some(Ok(response)) => {
                        // The repository this registration produced: the one whose
                        // canonical path is the one that was asked for, or the freshly
                        // minted id when the path was already registered.
                        let repository = response
                            .repositories
                            .iter()
                            .find(|repo| repo.display_path == canonical)
                            .cloned();
                        if let Some(repository) = repository {
                            this.open_workbench(repository, _window, cx);
                        }
                    }
                    Some(Err(problem)) => {
                        eprintln!("refyard-gpui: opening {path} failed: {problem}");
                    }
                    None => {
                        eprintln!("refyard-gpui: opening {path} failed: the task aborted");
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_workbench(
        &mut self,
        repository: refyard_contract::reads::RepositorySummary,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let host = self.host.clone();
        let workbench = cx.new(|cx| WorkbenchView::new(host, repository, window, cx));
        let subscription = cx.subscribe_in(
            &workbench,
            window,
            |this, _, event: &WorkbenchEvent, _window, cx| match event {
                WorkbenchEvent::Closed => this.close_workbench(cx),
                WorkbenchEvent::OpenLauncher => this.close_workbench(cx),
            },
        );
        self._subscriptions.push(subscription);
        self.workbench = Some(workbench);
        self.phase = Phase::Workbench;
        cx.notify();
    }

    fn close_workbench(&mut self, cx: &mut Context<Self>) {
        self.workbench = None;
        self.phase = Phase::Launcher;
        cx.notify();
    }
}

impl Render for AppState {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        match self.phase {
            Phase::Launcher => self.launcher.clone().into_any_element(),
            Phase::Workbench => self
                .workbench
                .as_ref()
                .expect("the workbench exists whenever the phase is Workbench")
                .clone()
                .into_any_element(),
        }
    }
}
