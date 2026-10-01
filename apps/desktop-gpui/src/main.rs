//! The GPUI desktop entry point.
//!
//! Boot order matters and is the same as every gpui-kit application: build the host
//! (so a machine without `git` fails on stderr instead of opening a dead workbench),
//! start the GPUI application with the default assets, `init` the kit (theme +
//! components), pin the dark theme, then open the one window whose content view is the
//! root [`app_state::AppState`]. `open_window` wraps the content in the kit's `Root`
//! overlay layer, so the build closure returns the content view itself, never a `Root`.

mod app_state;
mod bridge;
mod composition;
mod theme;
mod views;

use gpui_kit::*;

use std::sync::Arc;

use crate::composition::Host;

fn main() {
    let host = match Host::for_this_machine() {
        Ok(host) => Arc::new(host),
        Err(message) => {
            eprintln!("refyard-gpui: {message}");
            std::process::exit(1);
        }
    };

    application()
        .with_assets(assets::Assets)
        .run(move |cx| {
            init(cx);
            theme::set_dark(cx);

            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(None, size(px(1360.), px(900.)), cx))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Refyard".into()),
                    ..Default::default()
                }),
                window_min_size: Some(size(px(960.), px(600.))),
                ..Default::default()
            };
            open_window(options, cx, |window, cx| {
                cx.new(|cx| app_state::AppState::new(host.clone(), window, cx))
            })
            .expect("Failed to open window");
        });
}
