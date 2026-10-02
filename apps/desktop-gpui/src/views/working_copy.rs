//! The working-copy panel: the repository's right column, always visible while a
//! repository is open.
//!
//! Branch header with the changed-count pill, the Unstaged and Staged groups with
//! their per-file stage/unstage buttons, and the commit box pinned at the bottom —
//! the same three things the web panel stacks, in the same order, because the eyes
//! already know where they are. When a history commit is selected, the workbench
//! swaps this panel for the commit's detail; the WIP row in the history brings it
//! back.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Disableable as _, IconName, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::diff::{DiffKind, FilePatch};
use refyard_contract::reads::StatusEntry;

use crate::store::RepoStore;
use crate::views::diff_view;

/// Which diff a row opens when clicked: the same path can differ between the two
/// sides, so the section the row sits in names the diff.
#[derive(Clone, Copy, PartialEq)]
enum Side {
    Unstaged,
    Staged,
}

pub struct WorkingCopyView {
    store: Entity<RepoStore>,
    message_input: Entity<InputState>,
    selected: Option<(String, DiffKind)>,
    _subscriptions: Vec<Subscription>,
}

impl WorkingCopyView {
    pub fn new(store: Entity<RepoStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let message_input = cx.new(|cx| {
            InputState::new(window, cx).placeholder("What changed, and why")
        });
        let enter_subscription =
            cx.subscribe_in(&message_input, window, |this, _state, event, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.commit(window, cx);
                }
            });
        let store_subscription = cx.observe(&store, |_this, _store, cx| cx.notify());
        Self {
            store,
            message_input,
            selected: None,
            _subscriptions: vec![enter_subscription, store_subscription],
        }
    }

    fn select(&mut self, path_id: String, kind: DiffKind, cx: &mut Context<Self>) {
        self.selected = Some((path_id.clone(), kind));
        self.store.update(cx, |store, cx| store.select_path(path_id, kind, cx));
    }

    fn commit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let message = self.message_input.read(cx).value().trim().to_owned();
        if message.is_empty() {
            return;
        }
        self.store.update(cx, |store, cx| store.commit(message, cx));
        self.message_input.update(cx, |state, cx| state.set_value("", window, cx));
    }

    fn stage_paths(&mut self, paths: Vec<String>, cx: &mut Context<Self>) {
        if paths.is_empty() {
            return;
        }
        self.store.update(cx, |store, cx| store.stage_paths(paths, cx));
    }

    fn unstage_paths(&mut self, paths: Vec<String>, cx: &mut Context<Self>) {
        if paths.is_empty() {
            return;
        }
        self.store.update(cx, |store, cx| store.unstage_paths(paths, cx));
    }

    /// One file row: status chip, path, and the section's stage/unstage button.
    fn file_row(
        &self,
        entry: &StatusEntry,
        side: Side,
        untracked: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let theme = crate::theme::palette(cx);
        let selected = self
            .selected
            .as_ref()
            .is_some_and(|(path, _)| *path == entry.path_id);
        let path_for_click = entry.path_id.clone();
        let path_for_action = entry.path_id.clone();
        let action_id = SharedString::from(format!("wc-act-{}", entry.path_id));
        // The chip shows Git's own letters; green when the index side moved, amber
        // when only the worktree did — the web panel's rule, kept exactly.
        let letters = format!("{}{}", entry.index_status, entry.worktree_status);
        let index_moved = entry.index_status != "." && !entry.index_status.is_empty();
        let chip_color = if index_moved { theme.success } else { theme.warning };
        let kind = entry.kind;

        h_flex()
            .id(SharedString::from(format!("wc-row-{}", entry.path_id)))
            .px_1p5()
            .py_1()
            .gap_1p5()
            .rounded_lg()
            .border_1()
            .when(selected, |style| {
                style
                    .border_color(theme.primary.opacity(0.5))
                    .bg(theme.primary.opacity(0.1))
            })
            .when(!selected, |style| {
                style
                    .border_color(theme.border.opacity(0.5))
                    .hover(|style| {
                        style
                            .border_color(theme.border)
                            .bg(theme.list_hover.opacity(0.5))
                    })
            })
            .on_click(cx.listener(move |this, _event, _window, cx| {
                let kind = match side {
                    Side::Unstaged => {
                        if untracked { DiffKind::Untracked } else { DiffKind::Unstaged }
                    }
                    Side::Staged => DiffKind::Staged,
                };
                this.select(path_for_click.clone(), kind, cx);
            }))
            .child(
                div()
                    .flex_none()
                    .px_1()
                    .py_0p5()
                    .rounded_sm()
                    .font_family("Menlo")
                    .text_size(px(10.0))
                    .font_weight(FontWeight::BOLD)
                    .text_color(chip_color)
                    .bg(chip_color.opacity(0.15))
                    .child(letters),
            )
            .child(
                div()
                    .flex_1()
                    .truncate()
                    .text_size(px(12.0))
                    .child(entry.display_path.clone()),
            )
            .when(untracked, |row| {
                row.child(
                    div()
                        .flex_none()
                        .px_1p5()
                        .py_0p5()
                        .rounded_sm()
                        .text_size(px(10.0))
                        .text_color(theme.warning)
                        .bg(theme.warning.opacity(0.1))
                        .child("untracked"),
                )
            })
            .children((kind == refyard_contract::reads::StatusEntryKind::Unmerged).then(|| {
                div()
                    .flex_none()
                    .px_1p5()
                    .py_0p5()
                    .rounded_sm()
                    .text_size(px(10.0))
                    .text_color(theme.danger)
                    .bg(theme.danger.opacity(0.1))
                    .child("conflict")
            }))
            .child(
                Button::new(action_id)
                    .ghost()
                    .xsmall()
                    .icon(match side {
                        Side::Unstaged => IconName::Plus,
                        Side::Staged => IconName::Minus,
                    })
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        let paths = vec![path_for_action.clone()];
                        match side {
                            Side::Unstaged => this.stage_paths(paths, cx),
                            Side::Staged => this.unstage_paths(paths, cx),
                        }
                    })),
            )
            .into_any_element()
    }

    /// One group card: header with count pill and bulk action, rows, empty state.
    fn group(
        &self,
        label: &'static str,
        entries: &[(StatusEntry, bool)],
        bulk: GroupBulk,
        empty_text: &'static str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let theme = crate::theme::palette(cx);
        let bulk_button: Option<Button> = match bulk {
            GroupBulk::Stage if !entries.is_empty() => Some(
                Button::new("wc-stage-all")
                    .outline()
                    .small()
                    .label("Stage all")
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        let (_, unstaged, untracked) = this.store.read(cx).status_sections();
                        let mut paths: Vec<String> =
                            unstaged.iter().map(|e| e.path_id.clone()).collect();
                        paths.extend(untracked.iter().map(|e| e.path_id.clone()));
                        this.stage_paths(paths, cx);
                    })),
            ),
            GroupBulk::Unstage if !entries.is_empty() => Some(
                Button::new("wc-unstage-all")
                    .outline()
                    .small()
                    .label("Unstage all")
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        let (staged, _, _) = this.store.read(cx).status_sections();
                        let paths: Vec<String> =
                            staged.iter().map(|e| e.path_id.clone()).collect();
                        this.unstage_paths(paths, cx);
                    })),
            ),
            _ => None,
        };
        let mut card = v_flex()
            .id(SharedString::from(format!("wc-group-{label}")))
            .flex_1()
            .min_h_0()
            .overflow_hidden()
            .p_1p5()
            .gap_1()
            .rounded_xl()
            .border_1()
            .border_color(theme.border.opacity(0.6))
            .bg(theme.card.opacity(0.4));
        card = card.child(
            h_flex()
                .justify_between()
                .px_0p5()
                .child(
                    h_flex()
                        .gap_1p5()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .child(label),
                        )
                        .child(
                            div()
                                .px_1p5()
                                .rounded_full()
                                .bg(theme.secondary)
                                .font_family("Menlo")
                                .text_size(px(10.0))
                                .text_color(theme.muted_foreground)
                                .child(entries.len().to_string()),
                        ),
                )
                .children(bulk_button),
        );
        if entries.is_empty() {
            card = card.child(
                div()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .text_size(px(12.0))
                    .text_color(theme.faint)
                    .child(empty_text),
            );
        } else {
            let mut rows = v_flex().id("wc-rows").gap_1().overflow_y_scroll().flex_1().min_h_0();
            for (entry, untracked) in entries {
                let side = match bulk {
                    GroupBulk::Unstage => Side::Staged,
                    _ => Side::Unstaged,
                };
                rows = rows.child(self.file_row(entry, side, *untracked, cx));
            }
            card = card.child(rows);
        }
        card.into_any_element()
    }
}

/// The bulk action a group's header carries.
enum GroupBulk {
    Stage,
    Unstage,
}

impl Render for WorkingCopyView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        // Owned snapshot: the store read ends before the element tree calls back.
        let (branch_label, repository_path, staged, unstaged, untracked, problem, path_diff, selected_path) = {
            let store = self.store.read(cx);
            let (staged, unstaged, untracked) = store.status_sections();
            let branch_label = store
                .status
                .as_ref()
                .map(|status| match (&status.head.branch_name, status.head.kind) {
                    (Some(branch), _) => branch.clone(),
                    (None, refyard_contract::reads::HeadKind::Unborn) => {
                        "unborn".to_owned()
                    }
                    (None, refyard_contract::reads::HeadKind::Born) => {
                        "detached".to_owned()
                    }
                })
                .unwrap_or_else(|| "…".to_owned());
            (
                branch_label,
                store.repository.display_path.clone(),
                staged,
                unstaged.clone(),
                untracked.clone(),
                store.last_problem.clone(),
                store.path_diff.clone(),
                self.selected.clone(),
            )
        };
        let changed = unstaged.len() + untracked.len() + staged.len();
        let has_staged = !staged.is_empty();
        let _ = &selected_path;

        let mut column = v_flex()
            .id("working-copy-scroll")
            .size_full()
            .overflow_y_scroll()
            .p_2()
            .gap_2();

        // Header: branch, path, changed pill.
        column = column.child(
            v_flex()
                .gap_0p5()
                .child(
                    h_flex()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(14.0))
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(branch_label),
                        )
                        .child(
                            div()
                                .px_2()
                                .py_0p5()
                                .rounded_full()
                                .border_1()
                                .border_color(theme.border.opacity(0.5))
                                .font_family("Menlo")
                                .text_size(px(10.5))
                                .text_color(theme.muted_foreground)
                                .child(format!("{changed} changed")),
                        ),
                )
                .child(
                    div()
                        .truncate()
                        .font_family("Menlo")
                        .text_size(px(11.0))
                        .text_color(theme.faint)
                        .child(repository_path),
                ),
        );

        if let Some(problem) = problem {
            column = column.child(
                div()
                    .px_2()
                    .py_1p5()
                    .rounded_md()
                    .text_size(px(12.0))
                    .text_color(theme.danger)
                    .bg(theme.danger.opacity(0.1))
                    .child(problem),
            );
        }

        // Unstaged: unstaged + untracked together, each row tagged for what it is.
        let mut unstaged_rows: Vec<(StatusEntry, bool)> = unstaged
            .iter()
            .map(|entry| (entry.clone(), false))
            .collect();
        unstaged_rows.extend(untracked.iter().map(|entry| (entry.clone(), true)));
        let unstaged_card = self.group(
            "Unstaged Files",
            &unstaged_rows,
            GroupBulk::Stage,
            "Working tree is clean.",
            cx,
        );

        let staged_rows: Vec<(StatusEntry, bool)> =
            staged.iter().map(|entry| (entry.clone(), false)).collect();
        let staged_card = self.group(
            "Staged Files",
            &staged_rows,
            GroupBulk::Unstage,
            "Nothing staged.",
            cx,
        );

        column = column.child(
            v_flex().flex_1().min_h_0().gap_2().child(unstaged_card).child(staged_card),
        );

        // The selected path's diff, above the commit box.
        if let Some(diff) = path_diff {
            let mut files_column = v_flex().gap_2();
            for file in &diff.files {
                files_column = files_column
                    .child(diff_view::file_header(file, cx))
                    .child(match &file.patch {
                        FilePatch::Text { hunks, .. } => {
                            diff_view::file_patch(hunks, theme.dark).into_any_element()
                        }
                        FilePatch::Binary => div()
                            .px_2()
                            .py_1()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child("Binary file.")
                            .into_any_element(),
                        FilePatch::Oversize { reason } | FilePatch::Unavailable { reason } => div()
                            .px_2()
                            .py_1()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child(reason.clone())
                            .into_any_element(),
                        FilePatch::Submodule { old_oid, new_oid } => div()
                            .px_2()
                            .py_1()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child(format!(
                                "Submodule {} → {}",
                                old_oid.as_deref().unwrap_or("-"),
                                new_oid.as_deref().unwrap_or("-")
                            ))
                            .into_any_element(),
                    });
            }
            column = column.child(files_column);
        }

        // The commit box: message, staged counter, commit.
        column = column.child(
            v_flex()
                .gap_2()
                .p_2()
                .rounded_xl()
                .border_1()
                .border_color(theme.border.opacity(0.6))
                .bg(theme.card.opacity(0.4))
                .child(
                    h_flex()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(12.0))
                                .font_weight(FontWeight::MEDIUM)
                                .child("Commit message"),
                        )
                        .child(
                            div()
                                .font_family("Menlo")
                                .text_size(px(10.5))
                                .text_color(theme.faint)
                                .child(format!(
                                    "{} staged path{}",
                                    staged.len(),
                                    if staged.len() == 1 { "" } else { "s" }
                                )),
                        ),
                )
                .child(Input::new(&self.message_input))
                .child(
                    Button::new("wc-commit")
                        .primary()
                        .label("Commit")
                        .disabled(!has_staged)
                        .on_click(cx.listener(|this, _event, window, cx| {
                            this.commit(window, cx);
                        })),
                ),
        );

        column
    }
}
