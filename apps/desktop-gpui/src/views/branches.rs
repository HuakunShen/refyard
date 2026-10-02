//! The branches panel: the repository's local branches, with the mutations the host
//! advertises.
//!
//! Switching runs `SwitchBranch` bound to the live snapshot; creating runs
//! `CreateBranch` from HEAD (the name input guards emptiness — Git's own ref rules
//! remain the authority, and its refusals surface as problems). Deleting is destructive:
//! the host refuses an unconfirmed request, so the UI only ever sends `confirmed: true`
//! after this panel's explicit two-step confirm.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Disableable as _, Icon, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::reads::MutationKind;

use crate::store::RepoStore;
use crate::views::history::short_oid;

pub struct BranchesView {
    store: Entity<RepoStore>,
    name_input: Entity<InputState>,
    switch_to_new: bool,
    /// The branch name awaiting its delete confirmation; rendering this is the dialog.
    pending_delete: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl BranchesView {
    pub fn new(store: Entity<RepoStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("New branch name"));
        let mut subscriptions = Vec::new();
        subscriptions.push(cx.subscribe_in(&name_input, window, |this, _state, event, window, cx| {
            if let InputEvent::PressEnter { .. } = event {
                this.create_branch(window, cx);
            }
        }));
        subscriptions.push(cx.observe(&store, |_this, _store, cx| cx.notify()));
        Self {
            store,
            name_input,
            switch_to_new: true,
            pending_delete: None,
            _subscriptions: subscriptions,
        }
    }

    fn create_branch(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let name = self.name_input.read(cx).value().trim().to_owned();
        if name.is_empty() {
            return;
        }
        let switch = self.switch_to_new;
        self.store.update(cx, |store, cx| store.create_branch(name, switch, cx));
        self.name_input.update(cx, |state, cx| state.set_value("", window, cx));
    }

    fn switch_to(&mut self, branch: String, cx: &mut Context<Self>) {
        self.store.update(cx, |store, cx| store.switch_branch(branch, cx));
    }

    fn delete_branch(&mut self, branch: String, cx: &mut Context<Self>) {
        self.store.update(cx, |store, cx| store.delete_branch(branch, cx));
    }
}

impl Render for BranchesView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        let (branches, current, can_switch, can_create, can_delete, pending_delete) = {
            let store = self.store.read(cx);
            (
                store
                    .refs
                    .as_ref()
                    .map(|refs| refs.branches.clone())
                    .unwrap_or_default(),
                store
                    .status
                    .as_ref()
                    .and_then(|status| status.head.branch_name.clone()),
                store.can(MutationKind::SwitchBranch),
                store.can(MutationKind::CreateBranch),
                store.can(MutationKind::DeleteBranch),
                self.pending_delete.clone(),
            )
        };
        let switch_to_new = self.switch_to_new;

        let mut column = v_flex()
            .id("branches-scroll")
            .size_full()
            .overflow_y_scroll()
            .gap_2()
            .p_2();

        // Create.
        column = column.child(
            v_flex()
                .gap_2()
                .p_2()
                .rounded_md()
                .border_1()
                .border_color(theme.border)
                .child(
                    h_flex()
                        .gap_2()
                        .child(Input::new(&self.name_input).small().flex_1())
                        .child(
                            Button::new("create-branch")
                                .primary()
                                .small()
                                .label("Create")
                                .disabled(!can_create)
                                .on_click(cx.listener(|this, _event, window, cx| {
                                    this.create_branch(window, cx);
                                })),
                        ),
                )
                .child(
                    Button::new("switch-to-new")
                        .ghost()
                        .small()
                        .label(if switch_to_new {
                            "Create and switch"
                        } else {
                            "Create only"
                        })
                        .disabled(!can_switch)
                        .on_click(cx.listener(|this, _event, _window, cx| {
                            this.switch_to_new = !this.switch_to_new;
                            cx.notify();
                        })),
                ),
        );

        // The delete confirmation, above the list it acts on.
        if let Some(branch) = pending_delete.clone() {
            column = column.child(
                v_flex()
                    .gap_2()
                    .p_2()
                    .rounded_md()
                    .border_1()
                    .border_color(theme.danger)
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.danger)
                            .child(format!(
                                "Delete branch “{branch}\"? Its commits stay reachable until \
                                 they are garbage-collected."
                            )),
                    )
                    .child(
                        h_flex().gap_2()
                            .child(
                                Button::new("confirm-delete")
                                    .danger()
                                    .small()
                                    .label("Delete branch")
                                    .disabled(!can_delete)
                                    .on_click(cx.listener(move |this, _event, _window, cx| {
                                        let branch = pending_delete.clone().unwrap_or_default();
                                        this.pending_delete = None;
                                        this.delete_branch(branch, cx);
                                    })),
                            )
                            .child(
                                Button::new("cancel-delete")
                                    .ghost()
                                    .small()
                                    .label("Cancel")
                                    .on_click(cx.listener(|this, _event, _window, cx| {
                                        this.pending_delete = None;
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }

        // The list.
        let mut list = v_flex().gap_0p5();
        for branch in &branches {
            let is_current = current.as_ref() == Some(&branch.name);
            let name = branch.name.clone();
            let name_for_delete = branch.name.clone();
            let upstream = branch
                .upstream
                .as_ref()
                .map(|upstream| format!("↑{} ↓{}", upstream.ahead, upstream.behind));
            list = list.child(
                h_flex()
                    .id(SharedString::from(format!("branch-{}", branch.name)))
                    .px_2()
                    .py_1p5()
                    .gap_2()
                    .rounded_md()
                    .when(is_current, |style| style.bg(theme.accent))
                    .when(!is_current, |style| {
                        style.hover(|style| style.bg(theme.list_hover))
                    })
                    .child(Icon::new(IconName::GitBranch).text_color(
                        if is_current {
                            theme.primary
                        } else {
                            theme.muted_foreground
                        },
                    ))
                    .child(
                        div()
                            .flex_1()
                            .truncate()
                            .text_size(px(12.5))
                            .child(format!("{}  {}", branch.name, short_oid(&branch.oid))),
                    )
                    .children(upstream.map(|upstream| {
                        div()
                            .text_size(px(10.5))
                            .text_color(theme.muted_foreground)
                            .child(upstream)
                    }))
                    .when(!is_current && can_switch, |row| {
                        row.child(
                            Button::new(SharedString::from(format!("switch-{}", branch.name)))
                                .ghost()
                                .xsmall()
                                .label("Switch")
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.switch_to(name.clone(), cx);
                                })),
                        )
                    })
                    .when(!is_current && can_delete, |row| {
                        row.child(
                            Button::new(SharedString::from(format!("del-{}", branch.name)))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Trash)
                                .on_click(cx.listener(move |this, _event, _window, cx| {
                                    this.pending_delete = Some(name_for_delete.clone());
                                    cx.notify();
                                })),
                        )
                    }),
            );
        }
        if branches.is_empty() {
            list = list.child(
                div()
                    .px_2()
                    .py_3()
                    .text_size(px(12.0))
                    .text_color(theme.muted_foreground)
                    .child("Reading branches…"),
            );
        }
        column = column.child(list);

        column
    }
}
