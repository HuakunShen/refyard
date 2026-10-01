//! Theme handling and the lane colour palette.
//!
//! `gpui_kit::init` registers the component theme in light mode; a dark-first workbench
//! re-pins it immediately after (`Theme::change`), because changing only the base-layer
//! global does not darken components. Lane colours are the renderer's side of the opaque
//! `lane-N` tokens the layout crate produces: an unknown token falls back to lane 1
//! rather than throwing, exactly as the web renderer's `lanePaint` does — a graph is not
//! the place to discover that a palette changed.

use gpui_kit::component::theme::{Theme, ThemeMode};
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{rgb, App, Rgba};

/// Pin the dark theme. Must run after `init`, which set light mode.
pub fn set_dark(cx: &mut App) {
    Theme::change(ThemeMode::Dark, None, cx);
}

/// Pin the light theme.
#[expect(dead_code, reason = "the theme toggle arrives with the workbench")]
pub fn set_light(cx: &mut App) {
    Theme::change(ThemeMode::Light, None, cx);
}

/// Whether the component theme is currently dark, for lane colours and hand-drawn
/// surfaces that the component tokens do not cover.
#[expect(dead_code, reason = "the graph renderer arrives with the history view")]
pub fn is_dark(cx: &App) -> bool {
    cx.theme().mode == ThemeMode::Dark
}

/// Resolve a lane colour token to a concrete paint for the current theme.
///
/// `lane-current` is HEAD's colour and must read differently from every hashed lane, so
/// it uses the indigo family while the palette cycles around it. The mid-brightness
/// hues below stay legible on both themes.
#[expect(dead_code, reason = "the graph renderer arrives with the history view")]
pub fn lane_color(token: &str, dark: bool) -> Rgba {
    let (dark_color, light_color) = match token {
        "lane-current" => (0x9d8cff, 0x5340c9),
        "lane-1" => (0x5b9cf8, 0x2f6fd0),
        "lane-2" => (0xc586f2, 0x7d3fc9),
        "lane-3" => (0xf29a5c, 0xc25f18),
        "lane-4" => (0x57c472, 0x1e8c3c),
        "lane-5" => (0x43c5d9, 0x0e7f96),
        "lane-6" => (0xef79ab, 0xc22a6e),
        "lane-7" => (0xe3c04a, 0xa67c0a),
        "lane-8" => (0xef7470, 0xc74038),
        // An unknown token falls back to lane 1 instead of throwing.
        _ => (0x5b9cf8, 0x2f6fd0),
    };
    if dark {
        rgb(dark_color)
    } else {
        rgb(light_color)
    }
}
