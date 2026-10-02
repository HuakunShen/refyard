//! The changes panel: what the working tree and index hold, and what to do about it.
//!
//! Three sections — staged, unstaged, untracked — each entry clickable to preview its
//! diff, each carrying the one action its section allows. Staging runs the host's
//! preview flow (content fingerprints; a stale fingerprint is refused by the host, and
//! that refusal surfaces as a problem banner rather than a retry). Committing writes
//! `Commit` bound to the live status snapshot, so a stale snapshot is the host's refusal
//! too.
//!
//! A destructive discard renders only when the host's `capabilities` advertises
//! `discardTrackedPaths` — this host build registers no such effect, so the row offers
//! no discard control at all. Capability honesty works in that direction: absent means
//! absent, never hidden-but-present.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Disableable as _, IconName, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::diff::{DiffKind, FilePatch};
use refyard_contract::reads::StatusEntry;

use crate::store::RepoStore;
use crate::views::diff_view;

/// The changes panel. Selection is `(path, the diff kind it was clicked in)`, because
/// the same path can appear in two sections with two different diffs.
pub struct ChangesView {
    store: Entity<RepoStore>,
    message_input: Entity<InputState>,
    selected: Option<(String, DiffKind)>,
    _subscriptions: Vec<Subscription>,
}

impl ChangesView {
    pub fn new(store: Entity<RepoStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let message_input = cx.new(|cx| {
            InputState::new(window, cx).placeholder("Commit message — Enter commits the index")
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

    /// One status row: its section letter, its path, and the single action the section
    /// allows.
    fn entry_row(
        &self,
        entry: &StatusEntry,
        action: EntryAction,
        cx: &Context<Self>,
    ) -> AnyElement {
        let theme = crate::theme::palette(cx);
        let selected = self
            .selected
            .as_ref()
            .is_some_and(|(path, _)| *path == entry.path_id);
        let path_for_click = entry.path_id.clone();
        let path_for_action = entry.path_id.clone();
        let action_id = SharedString::from(format!("act-{}", entry.path_id));

        h_flex()
            .id(SharedString::from(format!("row-{}", entry.path_id)))
            .px_2()
            .py_1()
            .gap_2()
            .rounded_md()
            .cursor_pointer()
            .when(selected, |style| style.bg(theme.selection))
            .when(!selected, |style| {
                style.hover(|style| style.bg(theme.list_hover))
            })
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.select(path_for_click.clone(), action.kind(), cx);
            }))
            .child(
                div()
                    .w(px(14.0))
                    .flex_shrink_0()
                    .text_center()
                    .text_size(px(11.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(action.letter_color(&theme))
                    .child(action.letter(entry)),
            )
            .child(
                div()
                    .flex_1()
                    .truncate()
                    .text_size(px(12.0))
                    .child(entry.display_path.clone()),
            )
            .child(
                Button::new(action_id)
                    .ghost()
                    .xsmall()
                    .icon(action.icon())
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        let paths = vec![path_for_action.clone()];
                        match action {
                            EntryAction::Stage { .. } => this.stage_paths(paths, cx),
                            EntryAction::Unstage => this.unstage_paths(paths, cx),
                        }
                    })),
            )
            .into_any_element()
    }

    /// One section: a labelled header with its bulk action, then the rows.
    fn section(
        &self,
        label: String,
        entries: &[StatusEntry],
        action: EntryAction,
        bulk: SectionBulk,
        cx: &mut Context<Self>,
    ) -> Div {
        let theme = crate::theme::palette(cx);
        // The bulk button is built first: the host pre-checks a bulk selection, so one
        // unsupported path rejects the whole batch before anything is written.
        let bulk_button: Option<Button> = match bulk {
            SectionBulk::None => None,
            SectionBulk::StageAll if !entries.is_empty() => Some(
                Button::new("stage-all").ghost().xsmall().label("Stage all").on_click(
                    cx.listener(|this, _event, _window, cx| {
                        let (_, unstaged, untracked) = this.store.read(cx).status_sections();
                        let mut paths: Vec<String> =
                            unstaged.iter().map(|e| e.path_id.clone()).collect();
                        paths.extend(untracked.iter().map(|e| e.path_id.clone()));
                        this.stage_paths(paths, cx);
                    }),
                ),
            ),
            SectionBulk::UnstageAll if !entries.is_empty() => Some(
                Button::new("unstage-all")
                    .ghost()
                    .xsmall()
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
        let mut section = v_flex().gap_0p5();
        section = section.child(
            h_flex()
                .justify_between()
                .px_2()
                .py_1()
                .child(
                    div()
                        .text_size(px(11.0))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(theme.muted_foreground)
                        .child(label),
                )
                .children(bulk_button),
        );
        for entry in entries {
            section = section.child(self.entry_row(entry, action, cx));
        }
        section
    }
}

/// The bulk action a section header carries, if any.
#[expect(dead_code, reason = "None keeps the section signature total")]
enum SectionBulk {
    None,
    StageAll,
    UnstageAll,
}

/// The one action a section's row offers, plus how it is drawn.
#[derive(Clone, Copy, PartialEq)]
enum EntryAction {
    Stage { kind: DiffKind },
    Unstage,
}

impl EntryAction {
    fn kind(&self) -> DiffKind {
        match self {
            EntryAction::Stage { kind } => *kind,
            EntryAction::Unstage => DiffKind::Staged,
        }
    }

    fn letter(&self, entry: &StatusEntry) -> String {
        match self {
            EntryAction::Stage { kind: DiffKind::Untracked } => "?".to_owned(),
            EntryAction::Stage { .. } => entry.worktree_status.clone(),
            EntryAction::Unstage => entry.index_status.clone(),
        }
    }

    fn letter_color(&self, theme: &crate::theme::Palette) -> Hsla {
        match self {
            EntryAction::Stage { kind: DiffKind::Untracked } => theme.muted_foreground,
            _ => theme.warning,
        }
    }

    fn icon(&self) -> IconName {
        match self {
            EntryAction::Stage { .. } => IconName::Plus,
            EntryAction::Unstage => IconName::Minus,
        }
    }
}

impl Render for ChangesView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        // Everything the render reads from the store, owned: the read borrow must be
        // gone before the element tree calls back into `cx`.
        let (staged, unstaged, untracked, problem, path_diff) = {
            let store = self.store.read(cx);
            let (staged, unstaged, untracked) = store.status_sections();
            (
                staged,
                unstaged,
                untracked,
                store.last_problem.clone(),
                store.path_diff.clone(),
            )
        };
        let has_staged = !staged.is_empty();
        let mut column = v_flex().id("changes-scroll").size_full().overflow_y_scroll();

        if let Some(problem) = problem {
            column = column.child(
                div()
                    .mx_2()
                    .mt_2()
                    .px_2()
                    .py_1p5()
                    .rounded_md()
                    .text_size(px(12.0))
                    .text_color(theme.danger)
                    .bg(theme.danger.opacity(0.1))
                    .child(problem),
            );
        }

        // Staged + the commit box: the commit is what the staged list is for.
        let staged_section = self.section(
            format!("STAGED ({})", staged.len()),
            &staged,
            EntryAction::Unstage,
            SectionBulk::UnstageAll,
            cx,
        );
        let commit_box = v_flex()
            .p_2()
            .gap_2()
            .child(Input::new(&self.message_input).flex_1())
            .child(
                Button::new("commit")
                    .primary()
                    .label("Commit")
                    .disabled(!has_staged)
                    .on_click(cx.listener(|this, _event, window, cx| {
                        this.commit(window, cx);
                    })),
            );
        column = column.child(
            v_flex()
                .child(staged_section)
                .when(!has_staged, |section| {
                    section.child(
                        div()
                            .px_3()
                            .pb_1()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child("Stage changes to prepare a commit."),
                    )
                })
                .child(
                    div()
                        .border_b_1()
                        .border_color(theme.border)
                        .child(commit_box),
                ),
        );

        // Unstaged + untracked share one section: both are "not in the index yet".
        let mut worktree_entries = unstaged;
        worktree_entries.extend(untracked);
        let worktree_section = self.section(
            format!("CHANGES ({})", worktree_entries.len()),
            &worktree_entries,
            EntryAction::Stage { kind: DiffKind::Unstaged },
            SectionBulk::StageAll,
            cx,
        );
        column = column.child(worktree_section);

        // The selected path's diff, below the lists.
        if let Some(diff) = path_diff {
            let mut files_column = v_flex().p_2().gap_2();
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

        column
    }
}
