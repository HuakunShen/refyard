//! Theme handling and the lane colour palette.
//!
//! The workbench palette is the web's own (`packages/git-ui/src/styles.css`), converted
//! from oklch to sRGB; the native palette is the macOS one — Apple's system colours and
//! type, the way the platform's own apps draw. The two shells are one product: which of
//! the two a reader sees is a choice (`REFYARD_STYLE=native|workbench`), never a
//! disagreement between shells that were supposed to match. `Theme::update` recolours
//! every component; the lane colours below are the renderer's side of the opaque
//! `lane-N` tokens the layout crate produces, and an unknown token falls back to lane 1
//! rather than throwing, exactly as the web renderer's `lanePaint` does.

use gpui_kit::component::theme::{Theme, ThemeMode};
use gpui_kit::component::ActiveTheme as _;
use gpui_kit::{px, rgb, App, Hsla, Rgba};

/// Which family of colours the shell wears.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ThemeStyle {
    /// The web workbench's neutral palette — the default, so both shells agree out of
    /// the box.
    Workbench,
    /// The macOS-native palette: `.SystemUIFont`, Apple blue, the sidebar grey of a
    /// platform app.
    Native,
}

impl ThemeStyle {
    /// Parse the `REFYARD_STYLE` value; anything unknown keeps the workbench look
    /// rather than guessing.
    pub fn from_env(value: Option<&str>) -> Self {
        match value {
            Some("native") => Self::Native,
            _ => Self::Workbench,
        }
    }
}

/// Pin `style`'s palette for `mode`. `REFYARD_THEME=light` starts light; dark is
/// the workbench default.
pub fn apply_theme(style: ThemeStyle, mode: ThemeMode, cx: &mut App) {
    match style {
        ThemeStyle::Workbench => apply_workbench_theme(mode, cx),
        ThemeStyle::Native => apply_native_theme(mode, cx),
    }
}

fn apply_workbench_theme(mode: ThemeMode, cx: &mut App) {
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| {
        let dark = mode.is_dark();
        let color = |light: u32, dark_color: u32| Hsla::from(rgb(if dark { dark_color } else { light }));
        theme.font_family = ".SystemUIFont".into();
        theme.font_size = px(13.);
        theme.radius = px(5.);
        theme.radius_lg = px(9.);
        // Neutrals: the web tokens background/card/muted/accent/border in dark and
        // light, so a panel edge in the GPUI shell sits on the same grey it sits on
        // in the browser.
        theme.colors.background = color(0xfafafa, 0x0a0a0a);
        theme.colors.foreground = color(0x0a0a0a, 0xfafafa);
        theme.colors.popover = color(0xffffff, 0x121212);
        theme.colors.muted = color(0xf3f3f3, 0x1f1f1f);
        theme.colors.muted_foreground = color(0x737373, 0xa1a1a1);
        theme.colors.accent = color(0xf3f3f3, 0x262626);
        theme.colors.border = color(0xe5e5e5, 0x262626);
        theme.colors.input = color(0xe5e5e5, 0x262626);
        // The web's default accent is near-neutral in both modes — buttons are
        // surfaces, not colour.
        theme.colors.primary = color(0x171717, 0xfafafa);
        theme.colors.primary_foreground = color(0xfafafa, 0x0a0a0a);
        theme.colors.button_primary = theme.colors.primary;
        theme.colors.button_primary_foreground = theme.colors.primary_foreground;
        theme.colors.button = color(0xffffff, 0x1f1f1f);
        theme.colors.button_foreground = theme.colors.foreground;
        theme.colors.button_hover = color(0xf3f3f3, 0x262626);
        theme.colors.list_even = color(0xfafafa, 0x0e0e0e);
        theme.colors.list_hover = color(0xf3f3f3, 0x1f1f1f);
        theme.colors.list_active = color(0xe5e5e5, 0x262626);
        theme.colors.sidebar = color(0xfafafa, 0x0e0e0e);
        theme.colors.sidebar_foreground = theme.colors.foreground;
        theme.colors.selection = color(0xe8eef7, 0x1f2a3a);
    });
}

/// The macOS-native palette: the system font and Apple's own colours, so the shell
/// reads like an app the platform shipped. Light and dark follow the two appearances
/// macOS defines.
fn apply_native_theme(mode: ThemeMode, cx: &mut App) {
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| {
        let dark = mode.is_dark();
        let color = |light: u32, dark_color: u32| Hsla::from(rgb(if dark { dark_color } else { light }));
        theme.font_family = ".SystemUIFont".into();
        theme.font_size = px(13.);
        theme.radius = px(5.);
        theme.radius_lg = px(9.);
        theme.colors.background = color(0xffffff, 0x202020);
        theme.colors.foreground = color(0x202024, 0xeeeeef);
        theme.colors.popover = color(0xffffff, 0x252525);
        theme.colors.muted = color(0xf5f5f5, 0x2b2b2b);
        theme.colors.muted_foreground = color(0x727278, 0xaaaab0);
        theme.colors.accent = color(0xd8d8df, 0x4c4c51);
        theme.colors.border = color(0xdcdcdf, 0x414144);
        // `input` is the control border, also used by unchecked checkboxes.
        theme.colors.input = color(0xc6c6cb, 0x535357);
        theme.colors.primary = color(0x007aff, 0x0a84ff);
        theme.colors.primary_foreground = rgb(0xffffff).into();
        theme.colors.button_primary = theme.colors.primary;
        theme.colors.button_primary_foreground = rgb(0xffffff).into();
        theme.colors.button_primary_hover = color(0x1687ff, 0x2693ff);
        theme.colors.button_primary_active = color(0x006de5, 0x0075ee);
        theme.colors.button = color(0xffffff, 0x454548);
        theme.colors.button_foreground = theme.colors.foreground;
        theme.colors.button_hover = color(0xf0f0f3, 0x515156);
        theme.colors.list_even = color(0xf4f4f5, 0x2b2b2d);
        theme.colors.list_hover = color(0xe8eef7, 0x343c48);
        theme.colors.list_active = color(0xd8d8df, 0x4c4c51);
        theme.colors.sidebar = color(0xe9e9ed, 0x29292d);
        theme.colors.sidebar_foreground = theme.colors.foreground;
        theme.colors.selection = color(0xd8d8df, 0x4c4c51);
        theme.colors.ring = theme.colors.primary.opacity(0.5);
    });
}

/// Whether the component theme is currently dark, for lane colours and hand-drawn
/// surfaces that the component tokens do not cover.
#[expect(dead_code, reason = "used by hand-drawn surfaces as they arrive")]
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
    pub dark: bool,
    pub background: Hsla,
    pub foreground: Hsla,
    pub muted_foreground: Hsla,
    pub faint: Hsla,
    pub border: Hsla,
    pub danger: Hsla,
    pub success: Hsla,
    pub warning: Hsla,
    #[expect(dead_code, reason = "the diff renderer colours its own lines")]
    pub add: Hsla,
    #[expect(dead_code, reason = "the diff renderer colours its own lines")]
    pub remove: Hsla,
    pub primary: Hsla,
    #[expect(dead_code, reason = "primary-filled buttons read their own token")]
    pub primary_foreground: Hsla,
    pub secondary: Hsla,
    pub accent: Hsla,
    pub list_hover: Hsla,
    #[expect(dead_code, reason = "reserved for selected-row surfaces")]
    pub selection: Hsla,
    pub card: Hsla,
    pub muted: Hsla,
    pub sidebar: Hsla,
}

/// Copy the live theme's palette out of the context.
pub fn palette(cx: &App) -> Palette {
    let theme = cx.theme();
    let colors = &theme.colors;
    let dark = theme.mode.is_dark();
    // Status colours are fixed tokens in the web stylesheet, not theme states: add /
    // remove / warn per mode (dark 0.72-0.76 lightness, light 0.55-0.62).
    let (add, remove, warn, danger) = if dark {
        (
            rgb(0x53be70).into(),
            rgb(0xef6661).into(),
            rgb(0xdca744).into(),
            rgb(0xfb2c36).into(),
        )
    } else {
        (
            rgb(0x1c8742).into(),
            rgb(0xc53637).into(),
            rgb(0xb37903).into(),
            rgb(0xe7000b).into(),
        )
    };
    Palette {
        dark,
        background: colors.background,
        foreground: colors.foreground,
        muted_foreground: colors.muted_foreground,
        faint: rgb(if dark { 0x717171 } else { 0x8f8f8f }).into(),
        border: colors.border,
        danger,
        success: add,
        warning: warn,
        add,
        remove,
        primary: colors.primary,
        primary_foreground: colors.primary_foreground,
        secondary: colors.muted,
        accent: colors.accent,
        list_hover: colors.list_hover,
        selection: colors.selection,
        card: colors.popover,
        muted: colors.muted,
        sidebar: colors.sidebar,
    }
}

/// Resolve a lane colour token to a concrete paint for the current theme — the web
/// stylesheet's `--color-lane-*` values, converted per theme.
pub fn lane_color(token: &str, dark: bool) -> Rgba {
    let (dark_color, light_color) = match token {
        "lane-current" => (0x5abbe6, 0x0086b3),
        "lane-1" => (0x85acff, 0x4f6eb7),
        "lane-2" => (0x5dc879, 0x1c8742),
        "lane-3" => (0xe69c3a, 0xa76700),
        "lane-4" => (0xf66d67, 0xbd413f),
        "lane-5" => (0xcd8ff9, 0x8c54b2),
        "lane-6" => (0x2ac4cc, 0x008a91),
        "lane-7" => (0xef82cd, 0xa8488d),
        "lane-8" => (0xa4b95e, 0x6a7b27),
        // An unknown token falls back to lane 1 instead of throwing.
        _ => (0x85acff, 0x4f6eb7),
    };
    if dark {
        rgb(dark_color)
    } else {
        rgb(light_color)
    }
}
