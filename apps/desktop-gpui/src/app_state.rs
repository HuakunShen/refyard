//! The window's root view: a phase machine between the repository launcher and the
//! workbench.
//!
//! Child views report through emitted events; the root subscribes (holding the
//! `Subscription`s, because a dropped subscription is an unsubscribed one) and rebuilds
//! the phase. The root is built inside `open_window`, where a `Window` exists, and that
//! window is threaded into whatever child construction needs it — subscribe callbacks
//! receive one only through `subscribe_in`, which is why every subscription here is
//! window-scoped.

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
    pub fn new(host: Arc<Host>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let launcher = cx.new(|cx| LauncherView::new(host.clone(), cx));
        let subscription = cx.subscribe_in(
            &launcher,
            window,
            |this, _, event: &LauncherEvent, window, cx| match event {
                LauncherEvent::Opened(repository) => {
                    this.open_workbench(repository.clone(), window, cx)
                }
            },
        );
        Self {
            host,
            phase: Phase::Launcher,
            launcher,
            workbench: None,
            _subscriptions: vec![subscription],
        }
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
