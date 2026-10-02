//! The GPUI desktop entry point.
//!
//! Boot order matters and is the same as every gpui-kit application: build the host
//! (so a machine without `git` fails on stderr instead of opening a dead workbench),
//! start the GPUI application with the default assets, `init` the kit (theme +
//! components), pin the theme, then open the one window whose content view is the
//! root [`app_state::AppState`]. `open_window` wraps the content in the kit's `Root`
//! overlay layer, so the build closure returns the content view itself, never a `Root`.
//!
//! An optional argv path opens that repository straight into the workbench — the same
//! registration the launcher performs, spelled on the command line.

mod app_state;
mod bridge;
mod composition;
mod store;
mod theme;
mod views;

use gpui_kit::*;

use std::sync::Arc;

use crate::composition::Host;

actions!(refyard, [Quit]);

fn main() {
    let open_path = std::env::args().nth(1);
    let host = match Host::for_this_machine() {
        Ok(host) => Arc::new(host),
        Err(message) => {
            eprintln!("refyard-gpui: {message}");
            std::process::exit(1);
        }
    };

    let theme_override = std::env::var("REFYARD_THEME").ok();
    application()
        .with_assets(assets::Assets)
        .run(move |cx| {
            init(cx);
            // Cmd+Q quits: without an app menu the binding has nothing to invoke.
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([KeyBinding::new("cmd-q", Quit, None)]);
            cx.set_menus([Menu::new("Refyard").items([MenuItem::action("Quit Refyard", Quit)])]);
            // Dark is the workbench default; `REFYARD_THEME=light` starts light, which
            // is how the light palette gets verified without in-app interaction.
            let mode = if theme_override.as_deref() == Some("light") {
                gpui_kit::component::theme::ThemeMode::Light
            } else {
                gpui_kit::component::theme::ThemeMode::Dark
            };
            theme::apply_theme(mode, cx);

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
                cx.new(|cx| app_state::AppState::new(host.clone(), open_path, window, cx))
            })
            .expect("Failed to open window");

            // The Dock icon follows the system appearance: two tiles ship in the
            // bundle's resources, and the crate swaps them as macOS switches. The
            // handle is leaked on purpose — the observer serves the process's life.
            if let Ok(executable) = std::env::current_exe() {
                if let Some(resources) = executable.parent().map(|dir| dir.join("../Resources"))
                {
                    match refyard_dock_icon::install_on_current_thread(
                        &resources.join("icon-light.png"),
                        &resources.join("icon-dark.png"),
                    ) {
                        Ok(_) => {}
                        Err(problem) => eprintln!("refyard-gpui: {problem}"),
                    }
                }
            }
        });
}
