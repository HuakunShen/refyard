//! The workbench: the shell around one opened repository.
//!
//! Left sidebar: the repository's identity (name, HEAD branch, ahead/behind) and the
//! panel navigation, each entry rendered only when the host's `capabilities` advertises
//! the read behind it. Main area: the selected panel. Bottom: a status line reporting
//! the running operation, or the last problem, or the quiet truth that nothing is
//! happening.

use std::sync::Arc;

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex, Icon, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::reads::{MutationKind, ReadKind, RepositorySummary};

use crate::composition::Host;
use crate::store::RepoStore;
use crate::views::branches::BranchesView;
use crate::views::changes::ChangesView;
use crate::views::history::HistoryView;

/// The panels the sidebar can show.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Panel {
    Changes,
    History,
    Branches,
}

/// What the workbench reports to the root.
pub enum WorkbenchEvent {
    Closed,
}

pub struct WorkbenchView {
    store: Entity<RepoStore>,
    changes: Entity<ChangesView>,
    history: Entity<HistoryView>,
    branches: Entity<BranchesView>,
    panel: Panel,
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
        let changes = cx.new(|cx| ChangesView::new(store.clone(), window, cx));
        let history = cx.new(|cx| HistoryView::new(store.clone(), window, cx));
        let branches = cx.new(|cx| BranchesView::new(store.clone(), window, cx));
        let subscriptions = vec![cx.observe(&store, |_this, _store, cx| cx.notify())];
        Self {
            store,
            changes,
            history,
            branches,
            panel: Panel::Changes,
            _subscriptions: subscriptions,
        }
    }

    fn head_label(&self, cx: &Context<Self>) -> String {
        let store = self.store.read(cx);
        match store.status.as_ref().map(|status| &status.head) {
            Some(head) => match (&head.branch_name, head.kind) {
                (Some(branch), _) => branch.clone(),
                (None, refyard_contract::reads::HeadKind::Unborn) => "unborn".to_owned(),
                (None, refyard_contract::reads::HeadKind::Born) => "detached".to_owned(),
            },
            None => "…".to_owned(),
        }
    }

    fn sidebar_entry(
        &self,
        panel: Panel,
        label: &'static str,
        badge: Option<usize>,
        enabled: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let theme = crate::theme::palette(cx);
        let active = self.panel == panel;
        let (icon, panel_for_click) = match panel {
            Panel::Changes => (IconName::ListTodo, Panel::Changes),
            Panel::History => (IconName::Clock, Panel::History),
            Panel::Branches => (IconName::GitBranch, Panel::Branches),
        };
        h_flex()
            .id(SharedString::from(format!("nav-{label}")))
            .px_2()
            .py_1p5()
            .gap_2()
            .rounded_md()
            .cursor_pointer()
            .when(!enabled, |style| style.opacity(0.4))
            .when(enabled, |style| {
                style
                    .when(active, |style| style.bg(theme.accent))
                    .when(!active, |style| {
                        style.hover(|style| style.bg(theme.list_hover))
                    })
            })
            .on_click(cx.listener(move |this, _event, _window, cx| {
                if enabled {
                    this.panel = panel_for_click;
                    cx.notify();
                }
            }))
            .child(Icon::new(icon).text_color(if active {
                theme.foreground
            } else {
                theme.muted_foreground
            }))
            .child(
                div()
                    .flex_1()
                    .text_size(px(12.5))
                    .text_color(if active {
                        theme.foreground
                    } else {
                        theme.muted_foreground
                    })
                    .child(label),
            )
            .children(badge.map(|count| {
                div()
                    .text_size(px(10.5))
                    .text_color(theme.muted_foreground)
                    .child(count.to_string())
            }))
            .into_any_element()
    }
}

impl Render for WorkbenchView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        // The store read ends here: everything below works on owned values, so the
        // sidebar and panels can borrow `cx` again.
        let (repository_name, repository_path, changes_badge, can_status, can_history, can_refs, branch_count, running, last_problem, upstream, head_label) = {
            let store = self.store.read(cx);
            let (_, unstaged, untracked) = store.status_sections();
            (
                store.repository.display_name.clone(),
                store.repository.display_path.clone(),
                unstaged.len() + untracked.len(),
                store.can_read(ReadKind::Status),
                store.can_read(ReadKind::History),
                store.can_read(ReadKind::Refs),
                store.refs.as_ref().map(|refs| refs.branches.len()),
                store.running.as_ref().map(|(_, kind)| describe(kind)),
                store.last_problem.clone(),
                store.status.as_ref().and_then(|status| status.upstream.clone()),
                self.head_label(cx),
            )
        };
        let _ = MutationKind::DiscardTrackedPaths; // advertised-only; see the changes panel

        let mut column =
            v_flex().size_full().bg(theme.background).text_color(theme.foreground);

        // Header: identity + the way back.
        column = column.child(
            h_flex()
                .h(px(52.0))
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
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(repository_name),
                        )
                        .child(
                            div()
                                .text_size(px(11.0))
                                .text_color(theme.muted_foreground)
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
                            Icon::new(IconName::GitBranch)
                                .xsmall()
                                .text_color(theme.muted_foreground),
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

        // Body: sidebar + panel.
        let sidebar = v_flex()
            .w(px(210.0))
            .flex_none()
            .h_full()
            .border_r_1()
            .border_color(theme.border)
            .p_2()
            .gap_0p5()
            .child(
                div()
                    .px_2()
                    .pb_1()
                    .text_size(px(10.0))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(theme.muted_foreground)
                    .child("WORKSPACE"),
            )
            .child(self.sidebar_entry(
                Panel::Changes,
                "Changes",
                Some(changes_badge),
                can_status,
                cx,
            ))
            .child(self.sidebar_entry(Panel::History, "History", None, can_history, cx))
            .child(self.sidebar_entry(
                Panel::Branches,
                "Branches",
                branch_count,
                can_refs,
                cx,
            ));

        let panel = match self.panel {
            Panel::Changes => self.changes.clone().into_any_element(),
            Panel::History => self.history.clone().into_any_element(),
            Panel::Branches => self.branches.clone().into_any_element(),
        };

        column = column.child(
            h_flex()
                .flex_1()
                .min_h_0()
                .items_stretch()
                .child(sidebar)
                .child(
                    div().flex_1().min_h_0().overflow_hidden().child(panel),
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
                            Icon::new(IconName::Loader)
                                .xsmall()
                                .text_color(theme.muted_foreground),
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
