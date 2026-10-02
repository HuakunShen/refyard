//! Theme handling and the lane colour palette.
//!
//! The application pins a macOS-native look on top of the component theme: the system
//! UI font, a 13px base size, tighter radii, and a full light/dark palette tuned for a
//! Git workbench (pattern learned from the committed space-lens GPUI shell). `Theme::
//! change` alone would leave the default web-styled palette; `Theme::update` is what
//! recolours every component.
//!
//! Lane colours are the renderer's side of the opaque `lane-N` tokens the layout crate
//! produces: an unknown token falls back to lane 1 rather than throwing, exactly as the
//! web renderer's `lanePaint` does — a graph is not the place to discover that a
//! palette changed.

use gpui_kit::component::theme::{Theme, ThemeMode};
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{px, rgb, App, Hsla, Rgba};

/// Pin the dark theme with the workbench's full palette.
pub fn apply_theme(mode: ThemeMode, cx: &mut App) {
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| {
        let dark = mode.is_dark();
        let color = |light: u32, dark_color: u32| Hsla::from(rgb(if dark { dark_color } else { light }));
        theme.font_family = ".SystemUIFont".into();
        theme.font_size = px(13.);
        theme.radius = px(5.);
        theme.radius_lg = px(9.);
        theme.colors.background = color(0xffffff, 0x1e1e20);
        theme.colors.foreground = color(0x202024, 0xeeeeef);
        theme.colors.muted_foreground = color(0x727278, 0xaaaab0);
        theme.colors.border = color(0xdcdcdf, 0x3c3c40);
        theme.colors.input = color(0xc6c6cb, 0x535357);
        theme.colors.primary = color(0x4f6df5, 0x7c93ff);
        theme.colors.primary_foreground = rgb(0xffffff).into();
        theme.colors.button_primary = theme.colors.primary;
        theme.colors.button_primary_foreground = rgb(0xffffff).into();
        theme.colors.button_primary_hover = color(0x6380f7, 0x8ea3ff);
        theme.colors.button_primary_active = color(0x4460e0, 0x6b83ef);
        theme.colors.button = color(0xffffff, 0x3c3c40);
        theme.colors.button_foreground = theme.colors.foreground;
        theme.colors.button_hover = color(0xf0f0f3, 0x48484d);
        theme.colors.list_even = color(0xf7f7f8, 0x242426);
        theme.colors.list_hover = color(0xe8eef7, 0x2f3540);
        theme.colors.list_active = color(0xd8d8df, 0x45454b);
        theme.colors.sidebar = color(0xf2f2f4, 0x252527);
        theme.colors.sidebar_foreground = theme.colors.foreground;
        theme.colors.ring = theme.colors.primary.opacity(0.5);
    });
}

/// Whether the component theme is currently dark, for lane colours and hand-drawn
/// surfaces that the component tokens do not cover.
#[expect(dead_code, reason = "used by the theme toggle in the polish task")]
pub fn is_dark(cx: &App) -> bool {
    cx.theme().mode.is_dark()
}

/// The colours a view reads off the theme, as owned copies.
///
/// `cx.theme()` borrows the context; a render that needs that borrow gone — because it
/// still calls `cx.listener(...)` or hands `&mut Context` onward — copies the palette
/// out first. Every field is `Copy`, so views treat this like the theme itself.
#[derive(Clone, Copy)]
pub struct Palette {
    #[expect(dead_code, reason = "the theme toggle reads it in the polish task")]
    pub mode: ThemeMode,
    pub dark: bool,
    pub background: Hsla,
    pub foreground: Hsla,
    pub muted_foreground: Hsla,
    pub border: Hsla,
    pub danger: Hsla,
    #[expect(dead_code, reason = "reserved for status colouring")]
    pub success: Hsla,
    pub warning: Hsla,
    pub primary: Hsla,
    pub primary_foreground: Hsla,
    pub secondary: Hsla,
    pub accent: Hsla,
    pub list_hover: Hsla,
    pub selection: Hsla,
    #[expect(dead_code, reason = "reserved for the diff header strip")]
    pub table_head: Hsla,
}

/// Copy the live theme's palette out of the context.
pub fn palette(cx: &App) -> Palette {
    let theme = cx.theme();
    let colors = &theme.colors;
    Palette {
        mode: theme.mode,
        dark: theme.mode.is_dark(),
        background: colors.background,
        foreground: colors.foreground,
        muted_foreground: colors.muted_foreground,
        border: colors.border,
        danger: colors.danger,
        success: colors.success,
        warning: colors.warning,
        primary: colors.primary,
        primary_foreground: colors.primary_foreground,
        secondary: colors.secondary,
        accent: colors.accent,
        list_hover: colors.list_hover,
        selection: colors.selection,
        table_head: colors.table_head,
    }
}

/// Surface colours for the hand-drawn graph and diff areas: the quiet backgrounds a
/// workbench is read against, one pair per surface.
#[expect(dead_code, reason = "reserved for hand-drawn surfaces")]
pub fn surface(cx: &App, light: u32, dark: u32) -> Hsla {
    rgb(if is_dark(cx) { dark } else { light }).into()
}

/// Resolve a lane colour token to a concrete paint for the current theme.
///
/// `lane-current` is HEAD's colour and must read differently from every hashed lane, so
/// it uses the indigo family while the palette cycles around it. The mid-brightness
/// hues below stay legible on both themes.
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
