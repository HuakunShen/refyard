//! The left sidebar: the navigation rail and the active section's card.
//!
//! The sections are the web workbench's — Repositories, Working Copy, Branches, Tags,
//! Remotes — each shown only when the host advertises the read behind it, each with
//! its count. Clicking a section swaps the card below the nav; the centre stays
//! History and the right panel stays the working copy, exactly as in the web layout.
//! Sections the host does not implement (stashes, worktrees, submodules) are absent,
//! not greyed out: absent means absent.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex, Icon, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::reads::{MutationKind, ReadKind};

use crate::store::RepoStore;
use crate::views::history::short_oid;

/// The section the sidebar's card shows.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SidebarSection {
    Repositories,
    WorkingCopy,
    Branches,
    Tags,
    Remotes,
}

/// What the sidebar reports to the workbench.
pub enum SidebarEvent {
    /// The reader asked for the launcher (the Repositories section's open affordance).
    OpenLauncher,
}

pub struct SidebarView {
    store: Entity<RepoStore>,
    section: SidebarSection,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<SidebarEvent> for SidebarView {}

impl SidebarView {
    pub fn new(store: Entity<RepoStore>, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&store, |_this, _store, cx| cx.notify());
        Self {
            store,
            section: SidebarSection::Branches,
            _subscriptions: vec![subscription],
        }
    }

    fn entry(
        &self,
        section: SidebarSection,
        label: &'static str,
        icon: IconName,
        badge: Option<usize>,
        enabled: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let theme = crate::theme::palette(cx);
        let active = self.section == section;
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
                    this.section = section;
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
                    .px_1p5()
                    .rounded_full()
                    .bg(theme.secondary)
                    .font_family("Menlo")
                    .text_size(px(10.0))
                    .text_color(theme.muted_foreground)
                    .child(count.to_string())
            }))
            .into_any_element()
    }
}

impl Render for SidebarView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);
        // One owned snapshot of everything the nav and the active card read.
        let snapshot = {
            let store = self.store.read(cx);
            let (_, unstaged, untracked) = store.status_sections();
            let refs = store.refs.clone();
            SidebarSnapshot {
                can_refs: store.can_read(ReadKind::Refs),
                change_count: unstaged.len() + untracked.len(),
                repositories: store.registered_repositories(),
                branches: refs.as_ref().map(|refs| refs.branches.clone()).unwrap_or_default(),
                tags: refs.as_ref().map(|refs| refs.tags.clone()).unwrap_or_default(),
                remotes: refs.as_ref().map(|refs| refs.remotes.clone()).unwrap_or_default(),
                current_branch: store.current_branch(),
            }
        };

        let mut column = v_flex()
            .id("sidebar-scroll")
            .size_full()
            .overflow_y_scroll()
            .bg(theme.sidebar)
            .child(
                v_flex()
                    .flex_none()
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
                    .child(self.entry(
                        SidebarSection::Repositories,
                        "Repositories",
                        IconName::Folder,
                        Some(snapshot.repositories.len()),
                        true,
                        cx,
                    ))
                    .child(self.entry(
                        SidebarSection::WorkingCopy,
                        "Working Copy",
                        IconName::FilePen,
                        Some(snapshot.change_count),
                        true,
                        cx,
                    ))
                    .child(self.entry(
                        SidebarSection::Branches,
                        "Branches",
                        IconName::GitBranch,
                        Some(snapshot.branches.len()),
                        snapshot.can_refs,
                        cx,
                    ))
                    .child(self.entry(
                        SidebarSection::Tags,
                        "Tags",
                        IconName::Tag,
                        Some(snapshot.tags.len()),
                        snapshot.can_refs,
                        cx,
                    ))
                    .child(self.entry(
                        SidebarSection::Remotes,
                        "Remotes",
                        IconName::Globe,
                        Some(snapshot.remotes.len()),
                        snapshot.can_refs,
                        cx,
                    )),
            );

        // The active section's card.
        let card: AnyElement = match self.section {
            SidebarSection::Repositories => {
                let mut list = v_flex().gap_0p5();
                for repository in &snapshot.repositories {
                    let branch = match (&repository.head.branch_name, repository.head.kind) {
                        (Some(branch), _) => branch.clone(),
                        (None, refyard_contract::reads::HeadKind::Unborn) => "unborn".to_owned(),
                        (None, refyard_contract::reads::HeadKind::Born) => "detached".to_owned(),
                    };
                    list = list.child(
                        v_flex()
                            .px_2()
                            .py_1p5()
                            .rounded_md()
                            .hover(|style| style.bg(theme.list_hover))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(12.5))
                                    .child(repository.display_name.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(10.5))
                                    .text_color(theme.muted_foreground)
                                    .child(format!("{branch} · {}", repository.display_path)),
                            ),
                    );
                }
                if snapshot.repositories.is_empty() {
                    list = list.child(
                        div()
                            .px_2()
                            .py_2()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child("No repositories registered."),
                    );
                }
                list = list.child(
                    Button::new("sidebar-open")
                        .outline()
                        .small()
                        .label("Open a repository…")
                        .on_click(cx.listener(|_this, _event, _window, cx| {
                            cx.emit(SidebarEvent::OpenLauncher);
                        })),
                );
                list.into_any_element()
            }
            SidebarSection::WorkingCopy => v_flex()
                .child(
                    div()
                        .px_2()
                        .py_2()
                        .text_size(px(12.0))
                        .text_color(theme.muted_foreground)
                        .child(
                            "Your changed files and the commit message live in the panel \
                             on the right.",
                        ),
                )
                .into_any_element(),
            SidebarSection::Branches => {
                let current = snapshot.current_branch;
                let can_switch = { self.store.read(cx).can(MutationKind::SwitchBranch) };
                let mut list = v_flex().gap_0p5();
                for branch in &snapshot.branches {
                    let is_current = current.as_ref() == Some(&branch.name);
                    let name_for_switch = branch.name.clone();
                    let can_switch_this = can_switch && !is_current;
                    list = list.child(
                        h_flex()
                            .group(SharedString::from(format!(
                                "branch-{}",
                                branch.name
                            )))
                            .px_2()
                            .py_1p5()
                            .gap_2()
                            .rounded_md()
                            .when(is_current, |style| style.bg(theme.accent))
                            .when(!is_current, |style| {
                                style.hover(|style| style.bg(theme.list_hover))
                            })
                            .child(
                                Icon::new(IconName::GitBranch).text_color(if is_current {
                                    theme.primary
                                } else {
                                    theme.muted_foreground
                                }),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .truncate()
                                    .text_size(px(12.0))
                                    .child(format!(
                                        "{}  {}",
                                        branch.name,
                                        short_oid(&branch.oid)
                                    )),
                            )
                            // Switch lives on hover, GitKraken-style: the row stays a
                            // read line until the reader means it.
                            .when(can_switch_this, |row| {
                                row.child(
                                    Button::new(SharedString::from(format!(
                                        "switch-{}",
                                        branch.name
                                    )))
                                    .ghost()
                                    .xsmall()
                                    .label("Switch")
                                    .on_click(cx.listener(
                                        move |this, _event, _window, cx| {
                                            let name = name_for_switch.clone();
                                            this.store.update(cx, |store, cx| {
                                                store.switch_branch(name, cx)
                                            });
                                        },
                                    )),
                                )
                            }),
                    );
                }
                if snapshot.branches.is_empty() {
                    list = list.child(section_loading(&theme));
                }
                list.into_any_element()
            }
            SidebarSection::Tags => {
                let mut list = v_flex().gap_0p5();
                for tag in &snapshot.tags {
                    list = list.child(
                        h_flex()
                            .px_2()
                            .py_1p5()
                            .gap_2()
                            .rounded_md()
                            .hover(|style| style.bg(theme.list_hover))
                            .child(
                                Icon::new(IconName::Tag).text_color(theme.muted_foreground),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .truncate()
                                    .text_size(px(12.0))
                                    .child(format!("{}  {}", tag.name, short_oid(&tag.oid))),
                            ),
                    );
                }
                if snapshot.tags.is_empty() {
                    list = list.child(section_empty("No tags."));
                }
                list.into_any_element()
            }
            SidebarSection::Remotes => {
                let mut list = v_flex().gap_0p5();
                for remote in &snapshot.remotes {
                    list = list.child(
                        v_flex()
                            .px_2()
                            .py_1p5()
                            .gap_0p5()
                            .child(
                                h_flex()
                                    .gap_2()
                                    .child(
                                        Icon::new(IconName::Globe)
                                            .text_color(theme.muted_foreground),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(12.0))
                                            .child(remote.name.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .px_6()
                                    .font_family("Menlo")
                                    .text_size(px(10.0))
                                    .text_color(theme.faint)
                                    .child(remote.fetch_url_display.clone()),
                            ),
                    );
                }
                if snapshot.remotes.is_empty() {
                    list = list.child(section_empty("No remotes."));
                }
                list.into_any_element()
            }
        };

        column = column.child(
            v_flex()
                .flex_1()
                .min_h_0()
                .overflow_hidden()
                .p_2()
                .child(
                    div().id("sidebar-card").size_full().overflow_y_scroll().child(card),
                ),
        );
        column
    }
}

/// Everything one render reads off the store, owned.
struct SidebarSnapshot {
    can_refs: bool,
    change_count: usize,
    repositories: Vec<refyard_contract::reads::RepositorySummary>,
    branches: Vec<refyard_contract::refs::RefEntry>,
    tags: Vec<refyard_contract::refs::TagEntry>,
    remotes: Vec<refyard_contract::refs::RefsRemoteEntry>,
    current_branch: Option<String>,
}

fn section_loading(theme: &crate::theme::Palette) -> AnyElement {
    div()
        .px_2()
        .py_2()
        .text_size(px(12.0))
        .text_color(theme.muted_foreground)
        .child("Reading…")
        .into_any_element()
}

fn section_empty(text: &str) -> AnyElement {
    div()
        .px_2()
        .py_2()
        .text_size(px(12.0))
        .text_color(gpui_kit::hsla(0., 0., 0.5, 1.))
        .child(text.to_owned())
        .into_any_element()
}
