//! The patch renderer: coloured, monospace diff lines from the host's parsed hunks.
//!
//! The host parses the patch grammar, so this view only presents: hunk headers, then
//! lines whose kind carries the leading `+`/`-`. Line numbers are reconstructed from the
//! hunk header's start positions — Context advances both counters, Additions advance the
//! new side, Removals advance the old side — because the contract deliberately does not
//! restate them per line.
//!
//! Single-file previews are bounded by the host (`patchMaxLinesPerFile`), so a plain
//! column renders them; nothing here needs virtualization until a surface shows many
//! files at once.

use gpui_kit::component::{h_flex, v_flex, ActiveTheme as _};
use gpui_kit::*;
use refyard_contract::diff::{DiffFile, PatchHunk, PatchLineKind};

/// A diff file's header strip: path plus the +/- counts it reports.
pub fn file_header(file: &DiffFile, cx: &App) -> impl IntoElement {
    let theme = cx.theme();
    let path = match (&file.old_display_path, &file.display_path) {
        (Some(old), new) => format!("{old} → {new}"),
        (None, new) => new.clone(),
    };
    h_flex()
        .px_2()
        .py_1()
        .gap_2()
        .bg(theme.colors.table_head)
        .rounded_t_md()
        .child(
            div().font_family("Menlo").text_size(px(11.5)).child(path),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.colors.success)
                .child(file.insertions.map(|n| format!("+{n}")).unwrap_or_default()),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.colors.danger)
                .child(file.deletions.map(|n| format!("-{n}")).unwrap_or_default()),
        )
}

/// All hunks of one file, as a column. The patch kind is announced above by
/// [`file_header`]; binary/oversize/submodule files carry no hunks at all.
pub fn file_patch(hunks: &[PatchHunk], dark: bool) -> impl IntoElement {
    let mut column = v_flex().font_family("Menlo");
    for hunk in hunks {
        column = column.child(
            div()
                .px_2()
                .py_0p5()
                .text_size(px(11.5))
                .text_color(hunk_header_color(dark))
                .bg(hunk_header_background(dark))
                .child(hunk.header.clone()),
        );
        let mut old = hunk.old_start.max(0) as u64;
        let mut new = hunk.new_start.max(0) as u64;
        for line in &hunk.lines {
            let (old_number, new_number) = match line.kind {
                PatchLineKind::Context => {
                    let numbers = (Some(old), Some(new));
                    old += 1;
                    new += 1;
                    numbers
                }
                PatchLineKind::Add => {
                    let numbers = (None, Some(new));
                    new += 1;
                    numbers
                }
                PatchLineKind::Remove => {
                    let numbers = (Some(old), None);
                    old += 1;
                    numbers
                }
            };
            let (text_color, bg) = line_colors(line.kind, dark);
            let marker = match line.kind {
                PatchLineKind::Context => " ",
                PatchLineKind::Add => "+",
                PatchLineKind::Remove => "-",
            };
            let mut text = format!("{marker}{}", line.text);
            if line.no_newline {
                text.push_str("  \\ No newline at end of file");
            }
            column = column.child(
                h_flex()
                    .text_size(px(11.5))
                    .bg(bg)
                    .text_color(text_color)
                    .child(
                        div()
                            .w(px(56.0))
                            .flex_shrink_0()
                            .text_right()
                            .pr_2()
                            .text_color(line_number_color(dark))
                            .child(line_number_text(old_number, new_number)),
                    )
                    .child(div().whitespace_nowrap().child(text)),
            );
        }
    }
    column
}

fn line_number_text(old: Option<u64>, new: Option<u64>) -> String {
    format!(
        "{:>4} {:>4}",
        old.map(|n| n.to_string()).unwrap_or_default(),
        new.map(|n| n.to_string()).unwrap_or_default()
    )
}

/// The colours a patch line is drawn with: text and full-row background.
fn line_colors(kind: PatchLineKind, dark: bool) -> (Hsla, Hsla) {
    match kind {
        PatchLineKind::Context => (context_text(dark), context_background(dark)),
        PatchLineKind::Add => (add_text(dark), add_background(dark)),
        PatchLineKind::Remove => (remove_text(dark), remove_background(dark)),
    }
}

fn context_text(dark: bool) -> Hsla {
    if dark {
        hsla(0., 0., 0.82, 1.)
    } else {
        hsla(0., 0., 0.15, 1.)
    }
}

fn context_background(dark: bool) -> Hsla {
    if dark {
        hsla(0., 0., 1., 0.015)
    } else {
        hsla(0., 0., 0., 0.012)
    }
}

fn add_text(dark: bool) -> Hsla {
    if dark {
        hsla(142., 0.55, 0.72, 1.)
    } else {
        hsla(142., 0.62, 0.24, 1.)
    }
}

fn add_background(dark: bool) -> Hsla {
    if dark {
        hsla(142., 0.45, 0.30, 0.18)
    } else {
        hsla(142., 0.55, 0.85, 0.40)
    }
}

fn remove_text(dark: bool) -> Hsla {
    if dark {
        hsla(0., 0.62, 0.72, 1.)
    } else {
        hsla(0., 0.65, 0.36, 1.)
    }
}

fn remove_background(dark: bool) -> Hsla {
    if dark {
        hsla(0., 0.50, 0.32, 0.16)
    } else {
        hsla(0., 0.55, 0.88, 0.40)
    }
}

fn hunk_header_color(dark: bool) -> Hsla {
    if dark {
        hsla(210., 0.55, 0.68, 1.)
    } else {
        hsla(210., 0.60, 0.32, 1.)
    }
}

fn hunk_header_background(dark: bool) -> Hsla {
    if dark {
        hsla(210., 0.45, 0.50, 0.10)
    } else {
        hsla(210., 0.45, 0.55, 0.10)
    }
}

fn line_number_color(dark: bool) -> Hsla {
    if dark {
        hsla(0., 0., 0.55, 1.)
    } else {
        hsla(0., 0., 0.55, 1.)
    }
}
