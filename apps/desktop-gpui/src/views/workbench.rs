//! The workbench: the shell around one opened repository.
//!
//! This milestone renders the header — repository name, path, HEAD branch — and the
//! door back to the launcher. The sidebar, panel switch and event pump arrive with the
//! workbench tasks that follow.

use std::sync::Arc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _, IconName};
use gpui_kit::*;
use refyard_contract::reads::RepositorySummary;

use crate::composition::Host;

/// What the workbench reports to the root.
pub enum WorkbenchEvent {
    Closed,
}

pub struct WorkbenchView {
    #[allow(dead_code)]
    host: Arc<Host>,
    repository: RepositorySummary,
}

impl gpui_kit::EventEmitter<WorkbenchEvent> for WorkbenchView {}

impl WorkbenchView {
    pub fn new(
        host: Arc<Host>,
        repository: RepositorySummary,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Self {
        Self { host, repository }
    }

    fn head_label(&self) -> String {
        match (&self.repository.head.branch_name, self.repository.head.kind) {
            (Some(branch), _) => branch.clone(),
            (None, refyard_contract::reads::HeadKind::Unborn) => "unborn".to_owned(),
            (None, refyard_contract::reads::HeadKind::Born) => "detached HEAD".to_owned(),
        }
    }
}

impl Render for WorkbenchView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        v_flex()
            .size_full()
            .bg(theme.colors.background)
            .text_color(theme.colors.foreground)
            .child(
                h_flex()
                    .h(px(48.0))
                    .px_3()
                    .gap_2()
                    .items_center()
                    .border_b_1()
                    .border_color(theme.colors.border)
                    .child(
                        Button::new("back")
                            .ghost()
                            .icon(IconName::ArrowLeft)
                            .on_click(cx.listener(|this, _event, _window, cx| {
                                cx.emit(WorkbenchEvent::Closed);
                                let _ = this;
                            })),
                    )
                    .child(
                        v_flex()
                            .child(
                                div()
                                    .text_size(px(14.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(self.repository.display_name.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.colors.muted_foreground)
                                    .child(format!(
                                        "{} · {}",
                                        self.head_label(),
                                        self.repository.display_path
                                    )),
                            ),
                    ),
            )
            .child(
                div().flex_1().items_center().justify_center().child(
                    div().text_color(theme.colors.muted_foreground).child("The workbench arrives with the next milestone."),
                ),
            )
    }
}
