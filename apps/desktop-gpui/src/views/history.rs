//! The history panel: the commit graph and the list it decorates, laid out the way the
//! web workbench lays it out — a pinned column header (BRANCH / TAG, GRAPH, COMMIT
//! MESSAGE, AUTHOR, DATE), a pinned WIP row for the uncommitted changes, and virtualized
//! rows whose graph cell is painted from the geometry `refyard-graph` computes.
//!
//! The row height is one number shared by the list and the geometry ([`ROW_METRICS`]),
//! which is the only thing keeping circles on their text rows. A row draws three kinds
//! of segment, every lane accounted for exactly once: a pass-through, a converge into
//! the circle, and a branch out of the circle — straight when both ends share a lane, a
//! midline cubic otherwise, so edges leave and arrive vertically. A row with refs also
//! draws the short connector from the Branch/Tag column into its node, which is what
//! makes a pill read as "this line starts here".
//!
//! Pagination continues the lanes: the store lays each new page out with the previous
//! page's continuation, and the list auto-fetches when the visible range approaches the
//! end. Row clicks select a commit; the WIP row's click hands the right panel back to
//! the working copy.

use gpui_kit::assets::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{h_flex, v_flex, Icon, Sizable as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use refyard_contract::history::CommitSummary;
use refyard_graph::geometry::{
    gutter_width, row_geometry, Circle, Metrics, SegmentShape, DEFAULT_METRICS,
};
use refyard_graph::layout::GraphRow;

use crate::store::RepoStore;
use crate::theme;
use crate::views::diff_view;

/// The one row height the list and the geometry share.
pub const ROW_METRICS: Metrics = DEFAULT_METRICS;

/// Width of the Branch/Tag pill column, and of the author and date columns.
const PILLS_WIDTH: f32 = 130.0;
const AUTHOR_WIDTH: f32 = 110.0;
const DATE_WIDTH: f32 = 150.0;

pub struct HistoryView {
    store: Entity<RepoStore>,
    scroll_handle: UniformListScrollHandle,
    message_filter: Entity<InputState>,
    author_filter: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl HistoryView {
    pub fn new(store: Entity<RepoStore>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let message_filter =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search commit messages…"));
        let author_filter = cx.new(|cx| InputState::new(window, cx).placeholder("Author"));
        let mut subscriptions = Vec::new();
        subscriptions.push(cx.subscribe_in(
            &message_filter,
            window,
            |this, _state, event, _window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.apply_filters(cx);
                }
            },
        ));
        subscriptions.push(cx.subscribe_in(
            &author_filter,
            window,
            |this, _state, event, _window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    this.apply_filters(cx);
                }
            },
        ));
        subscriptions.push(cx.observe(&store, |_this, _store, cx| cx.notify()));
        Self {
            store,
            scroll_handle: UniformListScrollHandle::new(),
            message_filter,
            author_filter,
            _subscriptions: subscriptions,
        }
    }

    fn apply_filters(&mut self, cx: &mut Context<Self>) {
        let message = owned_non_empty(self.message_filter.read(cx).value().trim());
        let author = owned_non_empty(self.author_filter.read(cx).value().trim());
        self.store.update(cx, |store, cx| store.apply_filters(message, author, cx));
    }

    fn clear_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.message_filter.update(cx, |state, cx| state.set_value("", window, cx));
        self.author_filter.update(cx, |state, cx| state.set_value("", window, cx));
        self.store.update(cx, |store, cx| store.apply_filters(None, None, cx));
    }
}

fn owned_non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

/// The column-header strip: uppercase micro labels over the exact columns the rows
/// draw into. The graph cell's width is the same computed gutter the rows use.
fn column_header(gutter: f32, theme: &theme::Palette) -> AnyElement {
    let label = |text: &'static str, width: f32| {
        div()
            .w(px(width))
            .flex_none()
            .px_2()
            .text_size(px(10.0))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(theme.muted_foreground)
            .child(text)
    };
    h_flex()
        .h(px(28.0))
        .flex_none()
        .border_b_1()
        .border_color(theme.border)
        .bg(theme.background)
        .child(label("BRANCH / TAG", PILLS_WIDTH))
        .child(label("GRAPH", gutter))
        .child(
            div()
                .flex_1()
                .px_2()
                .text_size(px(10.0))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(theme.muted_foreground)
                .child("COMMIT MESSAGE"),
        )
        .child(label("AUTHOR", AUTHOR_WIDTH))
        .child(label("DATE", DATE_WIDTH))
        .into_any_element()
}

/// The WIP row: the uncommitted changes as a pinned pseudo-commit, clicking back to the
/// working copy. Dashed node in the graph column, `// WIP` in the message column, the
/// hint that says what clicking does.
fn wip_row(
    store: Entity<RepoStore>,
    branch: Option<String>,
    count: usize,
    has_selection: bool,
    theme: &theme::Palette,
) -> AnyElement {
    let store_for_click = store.clone();
    h_flex()
        .id("wip-row")
        .h(px(ROW_METRICS.row_height))
        .w_full()
        .flex_none()
        .cursor_pointer()
        .when(has_selection, |style| style.bg(theme.primary.opacity(0.06)))
        .when(!has_selection, |style| style.bg(theme.muted.opacity(0.25)))
        .hover(|style| style.bg(theme.list_hover))
        .on_click(move |_event, _window, cx| {
            let store = store_for_click.clone();
            store.update(cx, |store, cx| store.clear_commit_selection(cx));
        })
        .child(
            h_flex()
                .w(px(PILLS_WIDTH))
                .flex_none()
                .px_2()
                .children(branch.map(|branch| {
                    div()
                        .px_1p5()
                        .py_0p5()
                        .rounded_sm()
                        .text_size(px(10.0))
                        .border_1()
                        .border_color(theme.primary.opacity(0.4))
                        .bg(theme.primary.opacity(0.12))
                        .text_color(theme.foreground)
                        .child(format!("✓ {branch}"))
                })),
        )
        .child(
            div()
                .w(px(gutter_width(1, &ROW_METRICS)))
                .flex_none()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .size(px(12.0))
                        .rounded_full()
                        .border_2()
                        .border_color(theme.muted_foreground.opacity(0.5)),
                ),
        )
        .child(
            h_flex()
                .flex_1()
                .px_2()
                .gap_1p5()
                .child(
                    div()
                        .font_family("Menlo")
                        .text_size(px(11.0))
                        .text_color(theme.muted_foreground)
                        .child("// WIP"),
                )
                .when(count > 0, |row| {
                    row.child(
                        Icon::new(IconName::Pencil).text_color(theme.muted_foreground),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.muted_foreground)
                            .child(format!(
                                "{count} uncommitted change{} — click to work on them",
                                if count == 1 { "" } else { "s" }
                            )),
                    )
                }),
        )
        .into_any_element()
}


impl Render for HistoryView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = crate::theme::palette(cx);

        // Phase one: everything read from the store, owned so the borrow ends before
        // the element tree is built.
        let (row_count, gutter, head_ids, current_branch, loading_more, filters_active, selected) = {
            let store = self.store.read(cx);
            (
                store.history.rows.len(),
                gutter_width(store.history.lane_count.max(1), &ROW_METRICS),
                refyard_graph::head::head_segment_for(&store.history.rows)
                    .map(|segment| segment.ids)
                    .unwrap_or_default(),
                store.current_branch(),
                store.history.loading_more,
                store.history.filters.message.is_some()
                    || store.history.filters.author.is_some(),
                store.selected_commit.clone(),
            )
        };
        let wip_count = { self.store.read(cx).wip_count() };

        let mut column = v_flex().size_full();

        // Toolbar: filters and their reset.
        column = column.child(
            h_flex()
                .px_2()
                .py_1p5()
                .gap_2()
                .border_b_1()
                .border_color(theme.border)
                .child(Input::new(&self.message_filter).small().flex_1())
                .child(Input::new(&self.author_filter).small().w(px(150.0)))
                .when(filters_active, |toolbar| {
                    toolbar.child(
                        Button::new("clear-filters")
                            .ghost()
                            .small()
                            .label("Clear")
                            .on_click(cx.listener(|this, _event, window, cx| {
                                this.clear_filters(window, cx);
                            })),
                    )
                }),
        );

        // The pinned header and WIP row, then the virtualized list.
        column = column.child(column_header(gutter, &theme));
        column = column.child(wip_row(
            self.store.clone(),
            current_branch.clone(),
            wip_count,
            selected.is_some(),
            &theme,
        ));

        // The list + graph. The render closure reads the store fresh every frame, so
        // appended pages appear without the view holding a stale copy.
        let store_handle = self.store.clone();
        let list = uniform_list(
            "history-list",
            row_count.max(1),
            move |range, _window, cx| {
                let theme = crate::theme::palette(cx);
                if range.end + 30 >= row_count && row_count > 0 {
                    // Auto-pagination. The store's loading guard keeps this idempotent
                    // across the frames until the next page lands.
                    let store_ref = store_handle.clone();
                    store_ref.update(cx, |store, cx| {
                        store.request_more_history_if_needed(range.end, cx)
                    });
                }
                let store = store_handle.read(cx);
                let (commits, rows) = (&store.history.commits, &store.history.rows);
                range
                    .clone()
                    .filter(|index| *index < row_count)
                    .filter_map(|index| {
                        let row = rows.get(index)?;
                        let commit = commits.get(index)?;
                        Some(history_row(
                            store_handle.clone(),
                            row,
                            commit,
                            &ROW_METRICS,
                            gutter,
                            theme.dark,
                            selected.as_ref() == Some(&row.id),
                            head_ids.contains(&row.id),
                            current_branch.as_deref(),
                            &theme,
                            cx,
                        ))
                    })
                    .collect::<Vec<_>>()
            },
        )
        .track_scroll(&self.scroll_handle)
        .flex_1()
        .min_h_0();

        column = column.child(list);

        if row_count == 0 && !loading_more {
            column = column.child(
                div().flex_1().items_center().justify_center().child(
                    div()
                        .text_size(px(13.0))
                        .text_color(theme.muted_foreground)
                        .child(if filters_active {
                            "No history matches the current filters."
                        } else {
                            "No history yet."
                        }),
                ),
            );
        }

        column
    }
}

/// One history row: pills column, graph gutter with the ref connector, subject, and
/// the author/date tail.
#[allow(clippy::too_many_arguments)]
fn history_row(
    store: gpui_kit::Entity<RepoStore>,
    row: &GraphRow,
    commit: &CommitSummary,
    metrics: &Metrics,
    gutter: f32,
    dark: bool,
    selected: bool,
    on_head_segment: bool,
    current_branch: Option<&str>,
    theme: &theme::Palette,
    cx: &App,
) -> AnyElement {
    let row_id = row.id.clone();
    let row_for_paint = row.clone();
    let metrics_for_paint = *metrics;
    let store_for_click = store.clone();
    let has_refs = !row.ref_names.is_empty();

    h_flex()
        .id(SharedString::from(format!("commit-{}", row.id)))
        .h(px(metrics.row_height))
        .w_full()
        .flex_none()
        .cursor_pointer()
        .when(selected, |style| {
            style.bg(theme.primary.opacity(0.1))
        })
        .when(!selected && on_head_segment, |style| {
            style.bg(theme.primary.opacity(0.05))
        })
        .when(!selected && !on_head_segment, |style| {
            style.hover(|style| style.bg(theme.list_hover.opacity(0.6)))
        })
        .on_click(move |_event, _window, cx| {
            let oid = row_id.clone();
            store_for_click.update(cx, |store, cx| store.select_commit(oid, cx));
        })
        .child(
            h_flex()
                .w(px(PILLS_WIDTH))
                .flex_none()
                .h_full()
                .px_2()
                .overflow_hidden()
                .child(ref_pills(commit, current_branch, cx)),
        )
        .child(
            canvas(
                move |bounds, _window, _cx| bounds.size,
                move |bounds, _size, window, _cx| {
                    paint_row(
                        &row_for_paint,
                        &metrics_for_paint,
                        bounds,
                        dark,
                        has_refs,
                        window,
                    );
                },
            )
            .w(px(gutter))
            .h_full(),
        )
        .child(
            div()
                .flex_1()
                .truncate()
                .px_2()
                .text_size(px(12.0))
                .text_color(theme.foreground)
                .child(commit.subject.clone()),
        )
        .child(
            div()
                .w(px(AUTHOR_WIDTH))
                .flex_none()
                .truncate()
                .px_2()
                .text_size(px(11.5))
                .text_color(theme.muted_foreground)
                .child(commit.author_name.clone()),
        )
        .child(
            div()
                .w(px(DATE_WIDTH))
                .flex_none()
                .px_2()
                .text_size(px(11.0))
                .text_color(theme.faint)
                .child(short_date(&commit.committed_at)),
        )
        .border_b_1()
        .border_color(theme.border.opacity(0.35))
        .into_any_element()
}

/// The ref pills of a commit: the checked-out branch filled, other refs outlined and
/// lane-tinted. Decorations arrive as full names; the pill shows what a person reads —
/// `main`, not `refs/heads/main`.
fn ref_pills(commit: &CommitSummary, current_branch: Option<&str>, cx: &App) -> AnyElement {
    if commit.ref_names.is_empty() {
        return div().into_any_element();
    }
    let theme = crate::theme::palette(cx);
    let mut pills = h_flex().flex_none().gap_1();
    for name in commit.ref_names.iter().take(3) {
        let short = short_ref_name(name);
        let is_current = current_branch.is_some_and(|branch| branch == short);
        let pill = div()
            .px_1p5()
            .py_0p5()
            .rounded_sm()
            .text_size(px(10.0))
            .border_1()
            .when(is_current, |style| {
                style
                    .border_color(theme.primary.opacity(0.4))
                    .bg(theme.primary.opacity(0.12))
                    .text_color(theme.foreground)
            })
            .when(!is_current, |style| {
                style
                    .border_color(theme.border)
                    .bg(theme.muted.opacity(0.4))
                    .text_color(theme.muted_foreground)
            })
            .child(short);
        pills = pills.child(pill);
    }
    let rest = commit.ref_names.len().saturating_sub(3);
    if rest > 0 {
        pills = pills.child(
            div()
                .text_size(px(10.0))
                .text_color(theme.muted_foreground)
                .child(format!("+{rest}")),
        );
    }
    pills.into_any_element()
}

/// `refs/heads/main` → `main`, `refs/remotes/origin/main` → `origin/main`.
fn short_ref_name(name: &str) -> String {
    name.strip_prefix("refs/heads/")
        .or_else(|| name.strip_prefix("refs/remotes/"))
        .or_else(|| name.strip_prefix("refs/tags/"))
        .unwrap_or(name)
        .to_owned()
}

/// Paint one row's graph cell: the ref connector when the row has refs, every segment
/// the row owns, plus its circle.
///
/// The geometry speaks row coordinates where the row's top is 0 — the cell is exactly
/// one row tall, so the geometry's numbers apply as-is with the bounds' origin added
/// on. The connector runs from the cell's left edge (the pill column's border) to the
/// node, at the node's own y, in the lane's colour.
fn paint_row(
    row: &GraphRow,
    metrics: &Metrics,
    bounds: Bounds<Pixels>,
    dark: bool,
    with_connector: bool,
    window: &mut Window,
) {
    let geometry = row_geometry(row, 0, metrics);
    let ox = f32::from(bounds.origin.x);
    let oy = f32::from(bounds.origin.y);
    let lane_paint = |token: &str| theme::lane_color(token, dark);

    if with_connector {
        let connector = SegmentShape::Line {
            x0: 0.0,
            y0: geometry.circle.cy,
            x1: geometry.circle.cx,
            y1: geometry.circle.cy,
        };
        paint_shape(
            &connector,
            lane_paint(&geometry.circle.color),
            metrics.line_width,
            ox,
            oy,
            window,
        );
    }

    for segment in &geometry.segments {
        let color = lane_paint(&segment.color);
        let shape = match segment.shape {
            SegmentShape::Line { x0, y0, x1, y1 } => {
                SegmentShape::Line { x0, y0, x1, y1 }
            }
            SegmentShape::Curve { x0, y0, x1, y1 } => SegmentShape::Curve { x0, y0, x1, y1 },
        };
        paint_shape(&shape, color, metrics.line_width, ox, oy, window);
    }

    let Circle { cx: circle_x, cy: circle_y, color } = &geometry.circle;
    let paint = lane_paint(color);
    let radius = metrics.radius;
    let center_x = circle_x + ox;
    let center_y = circle_y + oy;
    // A filled circle from four cubic Béziers: the standard kappa control distance.
    let kappa = 0.552_284_5 * radius;
    let mut builder = gpui_kit::PathBuilder::fill();
    builder.move_to(point(px(center_x - radius), px(center_y)));
    builder.cubic_bezier_to(
        point(px(center_x), px(center_y - radius)),
        point(px(center_x - radius), px(center_y - kappa)),
        point(px(center_x - kappa), px(center_y - radius)),
    );
    builder.cubic_bezier_to(
        point(px(center_x + radius), px(center_y)),
        point(px(center_x + kappa), px(center_y - radius)),
        point(px(center_x + radius), px(center_y - kappa)),
    );
    builder.cubic_bezier_to(
        point(px(center_x), px(center_y + radius)),
        point(px(center_x + radius), px(center_y + kappa)),
        point(px(center_x + kappa), px(center_y + radius)),
    );
    builder.cubic_bezier_to(
        point(px(center_x - radius), px(center_y)),
        point(px(center_x + kappa), px(center_y + radius)),
        point(px(center_x - kappa), px(center_y + radius)),
    );
    if let Ok(path) = builder.build() {
        window.paint_path(path, paint);
    }
}

fn paint_shape(
    shape: &SegmentShape,
    color: gpui_kit::Rgba,
    line_width: f32,
    ox: f32,
    oy: f32,
    window: &mut Window,
) {
    let mut builder = gpui_kit::PathBuilder::stroke(px(line_width));
    match *shape {
        SegmentShape::Line { x0, y0, x1, y1 } => {
            builder.move_to(point(px(x0 + ox), px(y0 + oy)));
            builder.line_to(point(px(x1 + ox), px(y1 + oy)));
        }
        SegmentShape::Curve { x0, y0, x1, y1 } => {
            let mid_y = (y0 + y1) / 2.0;
            builder.move_to(point(px(x0 + ox), px(y0 + oy)));
            builder.cubic_bezier_to(
                point(px(x1 + ox), px(y1 + oy)),
                point(px(x0 + ox), px(mid_y + oy)),
                point(px(x1 + ox), px(mid_y + oy)),
            );
        }
    }
    if let Ok(path) = builder.build() {
        window.paint_path(path, color);
    }
}

/// The commit detail, rendered into the right panel while a commit is selected:
/// message, metadata, changed files.
pub fn commit_detail_panel(
    detail: &crate::store::CommitDetailState,
    dark: bool,
    cx: &App,
) -> AnyElement {
    let theme = crate::theme::palette(cx);
    let mut column = v_flex()
        .id("commit-detail-scroll")
        .h_full()
        .overflow_y_scroll()
        .p_2()
        .gap_2();

    if let Some(page) = &detail.message_page {
        if let Some(commit) = page.detail.as_ref() {
            column = column.child(
                div()
                    .text_size(px(13.0))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(commit.subject.clone()),
            );
            if !commit.body.trim().is_empty() {
                // One paragraph per line: the plain column flow preserves the message's
                // line breaks without a pre-wrap text mode.
                let body_column = v_flex().gap_0p5().children(
                    commit
                        .body
                        .trim()
                        .lines()
                        .map(|line| div().text_size(px(12.0)).child(line.to_owned()))
                        .collect::<Vec<_>>(),
                );
                column =
                    column.child(div().text_color(theme.muted_foreground).child(body_column));
            }
            column = column.child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.muted_foreground)
                    .child(format!(
                        "{} <{}> · {}",
                        commit.author_name,
                        commit.author_email,
                        short_date(&commit.committed_at)
                    )),
            );
            column = column.child(
                div()
                    .font_family("Menlo")
                    .text_size(px(10.5))
                    .text_color(theme.muted_foreground)
                    .child(format!(
                        "commit {} · parents {}",
                        short_oid(&commit.oid),
                        commit
                            .parents
                            .iter()
                            .map(|parent| short_oid(parent))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )),
            );
        }
    }

    if let Some(files) = &detail.files {
        for file in &files.files {
            column = column
                .child(diff_view::file_header(file, cx))
                .child(match &file.patch {
                    refyard_contract::diff::FilePatch::Text { hunks, .. } => {
                        diff_view::file_patch(hunks, dark).into_any_element()
                    }
                    refyard_contract::diff::FilePatch::Binary => div()
                        .px_2()
                        .py_1()
                        .text_size(px(12.0))
                        .text_color(theme.muted_foreground)
                        .child("Binary file.")
                        .into_any_element(),
                    refyard_contract::diff::FilePatch::Oversize { reason }
                    | refyard_contract::diff::FilePatch::Unavailable { reason } => div()
                        .px_2()
                        .py_1()
                        .text_size(px(12.0))
                        .text_color(theme.muted_foreground)
                        .child(reason.clone())
                        .into_any_element(),
                    refyard_contract::diff::FilePatch::Submodule { old_oid, new_oid } => div()
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
    }

    column.into_any_element()
}

pub fn short_date(iso: &str) -> String {
    // The host emits RFC-3339 timestamps; the list shows the date and hour it names,
    // in the offset the commit recorded.
    iso.get(..16).unwrap_or(iso).replace('T', " ")
}

pub fn short_oid(oid: &str) -> String {
    oid.get(..7).unwrap_or(oid).to_owned()
}
