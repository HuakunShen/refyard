//! The workbench: the shell around one opened repository — the web workbench's three
//! columns, one for one.
//!
//! Left: the sidebar's nav and section cards (Repositories, Working Copy, Branches,
//! Tags, Remotes — each present only when the host advertises its read). Centre:
//! History, always — column headers, the WIP row, the graph. Right: the working copy,
//! swapped for the selected commit's detail while one is selected. Bottom: a status
//! line reporting the running operation, or the last problem, or the quiet truth that
//! nothing is happening.

use std::sync::Arc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex, Disableable as _, Icon, Sizable as _};
use gpui_kit::*;
use refyard_contract::reads::{MutationKind, ReadKind, RepositorySummary};

use crate::composition::Host;
use crate::store::RepoStore;
use crate::views::history::{commit_detail_panel, HistoryView};
use crate::views::sidebar::{SidebarEvent, SidebarView};
use crate::views::working_copy::WorkingCopyView;

/// What the workbench reports to the root.
pub enum WorkbenchEvent {
    Closed,
    /// The reader asked for the launcher from the sidebar.
    OpenLauncher,
}

pub struct WorkbenchView {
    store: Entity<RepoStore>,
    sidebar: Entity<SidebarView>,
    history: Entity<HistoryView>,
    working_copy: Entity<WorkingCopyView>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<WorkbenchEvent> for WorkbenchView {}

impl WorkbenchView {
    pub fn new(
        host: Arc<Host>,
        repository: RepositorySummary,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let store = cx.new(|cx| RepoStore::new(host, repository, cx));
        let sidebar = cx.new(|cx| SidebarView::new(store.clone(), window, cx));
        let history = cx.new(|cx| HistoryView::new(store.clone(), window, cx));
        let working_copy = cx.new(|cx| WorkingCopyView::new(store.clone(), window, cx));
        let mut subscriptions = vec![cx.observe(&store, |_this, _store, cx| cx.notify())];
        subscriptions.push(cx.subscribe_in(
            &sidebar,
            window,
            |_this, _, event: &SidebarEvent, _window, cx| match event {
                SidebarEvent::OpenLauncher => cx.emit(WorkbenchEvent::OpenLauncher),
            },
        ));
        Self {
            store,
            sidebar,
            history,
            working_copy,
            _subscriptions: subscriptions,
        }
    }
}

impl Render for WorkbenchView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        // One owned snapshot; the store read ends here so the panels can borrow cx.
        let (repository_name, repository_path, head_label, upstream, running, last_problem, commit_detail, can_history, toolbar) = {
            let store = self.store.read(cx);
            (
                store.repository.display_name.clone(),
                store.repository.display_path.clone(),
                store
                    .status
                    .as_ref()
                    .map(|status| match (&status.head.branch_name, status.head.kind) {
                        (Some(branch), _) => branch.clone(),
                        (None, refyard_contract::reads::HeadKind::Unborn) => {
                            "unborn".to_owned()
                        }
                        (None, refyard_contract::reads::HeadKind::Born) => "detached".to_owned(),
                    })
                    .unwrap_or_else(|| "…".to_owned()),
                store.status.as_ref().and_then(|status| status.upstream.clone()),
                store.running.as_ref().map(|(_, kind)| describe(kind)),
                store.last_problem.clone(),
                store.commit_detail.clone(),
                store.can_read(ReadKind::History),
                store.toolbar_state(),
            )
        };
        let _ = MutationKind::DiscardTrackedPaths; // advertised-only; see the working copy

        let mut column = v_flex()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground);

        // Header: identity + the way back. Ten points tall, like the web's header row.
        column = column.child(
            h_flex()
                .h(px(44.0))
                .px_3()
                .gap_3()
                .items_center()
                .border_b_1()
                .border_color(theme.border)
                .child(
                    Button::new("back")
                        .ghost()
                        .small()
                        .icon(IconName::ArrowLeft)
                        .on_click(cx.listener(|_this, _event, _window, cx| {
                            cx.emit(WorkbenchEvent::Closed);
                        })),
                )
                .child(
                    v_flex()
                        .child(
                            div()
                                .text_size(px(13.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(repository_name),
                        )
                        .child(
                            div()
                                .truncate()
                                .font_family("Menlo")
                                .text_size(px(10.0))
                                .text_color(theme.faint)
                                .child(repository_path),
                        ),
                )
                .child(h_flex().flex_1())
                .child(
                    h_flex()
                        .gap_1p5()
                        .px_2()
                        .py_1()
                        .rounded_md()
                        .bg(theme.secondary)
                        .child(
                            Icon::new(IconName::GitBranch).text_color(theme.muted_foreground),
                        )
                        .child(div().text_size(px(12.0)).child(head_label))
                        .children(upstream.map(|upstream| {
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.muted_foreground)
                                .child(format!("↑{} ↓{}", upstream.ahead, upstream.behind))
                        })),
                ),
        );

        // The action toolbar: the basic operations a workbench is operated by, each
        // present only when the host advertises it and held (with its reason in the
        // tooltip) when the repository gives it nothing to act on.
        column = column.child(toolbar_row(
            self.store.clone(),
            &toolbar,
            running.is_some(),
            &theme,
            cx,
        ));

        // Body: sidebar | history | working copy (or the selected commit's detail).
        let right_panel: AnyElement = if can_history {
            match &commit_detail {
                Some(detail) => {
                    let dark = theme.dark;
                    let detail = detail.clone();
                    commit_detail_panel(&detail, dark, cx).into_any_element()
                }
                None => self.working_copy.clone().into_any_element(),
            }
        } else {
            self.working_copy.clone().into_any_element()
        };

        column = column.child(
            h_flex()
                .flex_1()
                .min_h_0()
                .items_stretch()
                .child(
                    div()
                        .w(px(230.0))
                        .flex_none()
                        .min_h_0()
                        .border_r_1()
                        .border_color(theme.border)
                        .overflow_hidden()
                        .child(self.sidebar.clone()),
                )
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .overflow_hidden()
                        .child(self.history.clone()),
                )
                .child(
                    div()
                        .w(px(360.0))
                        .flex_none()
                        .min_h_0()
                        .border_l_1()
                        .border_color(theme.border)
                        .overflow_hidden()
                        .child(right_panel),
                ),
        );

        // Status line: running operation, else the last problem, else the quiet truth.
        column = column.child(
            h_flex()
                .h(px(26.0))
                .px_3()
                .gap_2()
                .items_center()
                .border_t_1()
                .border_color(theme.border)
                .text_size(px(11.0))
                .children(if let Some(running) = running {
                    vec![h_flex()
                        .gap_1p5()
                        .child(
                            Icon::new(IconName::Loader).text_color(theme.muted_foreground),
                        )
                        .child(div().text_color(theme.muted_foreground).child(running))
                        .into_any_element()]
                } else if let Some(problem) = &last_problem {
                    vec![div()
                        .flex_1()
                        .truncate()
                        .text_color(theme.danger)
                        .child(problem.clone())
                        .into_any_element()]
                } else {
                    vec![div()
                        .flex_1()
                        .text_color(theme.muted_foreground)
                        .child("Ready.")
                        .into_any_element()]
                }),
        );

        column
    }
}

/// One toolbar button: outline style, held with its reason. The theme parameter keeps
/// every call site uniform; the button reads its colours from the component theme.
#[allow(clippy::too_many_arguments)]
fn tool_button(
    id: &'static str,
    label: &'static str,
    enabled: bool,
    tooltip: String,
    store: &Entity<RepoStore>,
    action: ToolbarAction,
    _theme: &crate::theme::Palette,
    _cx: &mut Context<WorkbenchView>,
) -> Button {
    let store = store.clone();
    Button::new(id)
        .outline()
        .small()
        .label(label)
        .disabled(!enabled)
        .tooltip(tooltip)
        .on_click(move |_, _, cx| {
            let store = store.clone();
            store.update(cx, |store, cx| store.run_toolbar_action(action, cx));
        })
}

/// The action a toolbar button names — the store maps each to its mutation.
#[derive(Clone, Copy)]
pub(crate) enum ToolbarAction {
    StageAll,
    Stash,
    Fetch,
    Pull,
    Push,
}

/// The toolbar row: stage all, stash, then the sync trio — each present only when the
/// host advertises the operation, each held with its reason when the repository gives
/// it nothing to act on.
fn toolbar_row(
    store: Entity<RepoStore>,
    state: &crate::store::ToolbarState,
    busy: bool,
    theme: &crate::theme::Palette,
    cx: &mut Context<WorkbenchView>,
) -> AnyElement {
    let remote = state.remote_name.clone().unwrap_or_default();
    let sync_reason = if state.remote_name.is_none() {
        Some("no remote is configured")
    } else if state.branch.is_none() {
        Some("HEAD is not on a branch")
    } else {
        None
    };
    let mut row = h_flex()
        .flex_none()
        .items_center()
        .gap_1p5()
        .px_3()
        .py_1p5()
        .border_b_1()
        .border_color(theme.border.opacity(0.6))
        .bg(theme.card.opacity(0.4));

    if state.can_stage {
        let changed = state.changed;
        row = row.child(tool_button(
            "tb-stage-all",
            "Stage all",
            changed > 0 && !busy,
            if changed == 0 {
                "Working tree is clean.".to_owned()
            } else {
                format!("Stage all {changed} changed path{}", if changed == 1 { "" } else { "s" })
            },
            &store,
            ToolbarAction::StageAll,
            theme,
            cx,
        ));
    }
    if state.can_stash {
        row = row.child(tool_button(
            "tb-stash",
            "Stash",
            state.changed > 0 && !busy,
            "Stash every change, untracked included".to_owned(),
            &store,
            ToolbarAction::Stash,
            theme,
            cx,
        ));
    }
    if state.can_fetch || state.can_pull || state.can_push {
        row = row.child(div().mx_1().h(px(16.0)).w(px(1.0)).bg(theme.border.opacity(0.6)));
    }
    if state.can_fetch {
        row = row.child(tool_button(
            "tb-fetch",
            "Fetch",
            state.remote_name.is_some() && !busy,
            if state.remote_name.is_none() {
                "no remote is configured".to_owned()
            } else {
                format!("Fetch · {remote}")
            },
            &store,
            ToolbarAction::Fetch,
            theme,
            cx,
        ));
    }
    if state.can_pull {
        let reason = sync_reason
            .or((!state.has_upstream).then_some("the branch has no upstream"));
        row = row.child(tool_button(
            "tb-pull",
            "Pull",
            reason.is_none() && !busy,
            match reason {
                Some(reason) => reason.to_owned(),
                None => format!("Fast-forward pull · {remote}"),
            },
            &store,
            ToolbarAction::Pull,
            theme,
            cx,
        ));
    }
    if state.can_push {
        let reason = sync_reason
            .or((!state.has_upstream).then_some("the branch has no upstream"));
        row = row.child(tool_button(
            "tb-push",
            "Push",
            reason.is_none() && !busy,
            match reason {
                Some(reason) => reason.to_owned(),
                None => format!("Push · {remote}"),
            },
            &store,
            ToolbarAction::Push,
            theme,
            cx,
        ));
    }
    row.into_any_element()
}

/// What the status line calls a running mutation.
fn describe(kind: &MutationKind) -> String {
    use MutationKind::*;
    match kind {
        StagePaths => "Staging…",
        UnstagePaths => "Unstaging…",
        Commit => "Committing…",
        AmendCommit => "Amending…",
        CreateBranch => "Creating branch…",
        SwitchBranch => "Switching branch…",
        DeleteBranch => "Deleting branch…",
        CreateStash => "Stashing…",
        ApplyStash | PopStash => "Applying stash…",
        DropStash => "Dropping stash…",
        _ => "Working…",
    }
    .to_owned()
}
