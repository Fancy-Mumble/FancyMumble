//! The plates and headings a drawn theme stands its chrome on: the server's
//! name on a leaning plate over the channel column, a section heading run
//! out to a dashed rule and a count, the leaning mark before a
//! conversation's name, and the row a channel is drawn on.
//!
//! Each answers `None` where the theme does not ask for it, and the view
//! keeps what it had.

use gpui::{
    AnyElement, Hsla, IntoElement, ParentElement, Pixels, SharedString, Styled, canvas, div, point,
    prelude::*, px,
};

use super::shape::{Finish, polygon};
use super::voiced::{Role, voiced};
use crate::theme::{Kind, Theme};

/// How far a leaning plate leans: the web UI's `skewX(-12deg)`.
const LEAN: f32 = 12.0;

/// The server's name on a leaning plate of the accent, in a band across the
/// top of the channel column (`SidebarShell`'s plate).
pub(crate) fn name_plate(name: &str, theme: &Theme) -> Option<AnyElement> {
    if !theme.skin.marks.column_plate {
        return None;
    }
    let (plate, shadow) = (theme.c.accent, theme.c.accent_soft);
    Some(
        div()
            .debug_selector(|| "mark-name-plate".to_owned())
            .flex_none()
            .h(px(74.0))
            .px(px(18.0))
            .flex()
            .items_center()
            .map(|band| {
                if theme.skin.line_width < px(2.0) {
                    band.border_b_1()
                } else {
                    band.border_b_2()
                }
            })
            .border_color(theme.c.line)
            .child(
                div()
                    .relative()
                    .min_w_0()
                    .max_w_full()
                    .px(px(14.0))
                    .py(px(6.0))
                    .child(leaning(plate, Some((3.0, shadow))))
                    .child(
                        div()
                            .relative()
                            .text_size(px(15.0))
                            .line_height(px(18.0))
                            .text_color(theme.c.on_accent)
                            .child(voiced(name, Role::Plate, 15.0, theme)),
                    ),
            )
            .into_any_element(),
    )
}

/// A parallelogram filling its parent, leaning as a skewed box does about
/// its middle, over a hard copy of itself `offset` down and across.
fn leaning(fill: Hsla, shadow: Option<(f32, Hsla)>) -> impl IntoElement + use<> {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let lean = f32::from(bounds.size.height) / 2.0 * LEAN.to_radians().tan();
            let lean = px(lean);
            let corners = |at: gpui::Bounds<Pixels>| {
                [
                    point(at.left() + lean, at.top()),
                    point(at.right() + lean, at.top()),
                    point(at.right() - lean, at.bottom()),
                    point(at.left() - lean, at.bottom()),
                ]
            };
            if let Some((offset, color)) = shadow {
                let shifted =
                    gpui::Bounds::new(bounds.origin + point(px(offset), px(offset)), bounds.size);
                if let Some(path) = polygon(&corners(shifted)) {
                    window.paint_path(path, color);
                }
            }
            if let Some(path) = polygon(&corners(bounds)) {
                window.paint_path(path, fill);
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// The dashed rule a drawn theme runs from a heading out to the edge
/// (`SectionLabel`), or nothing where the theme draws none.
pub(crate) fn heading_rule(theme: &Theme) -> Option<AnyElement> {
    let (dash, gap) = theme.skin.marks.heading_rule?;
    Some(
        div()
            .flex_1()
            .min_w(px(12.0))
            .h(theme.skin.line_width)
            .child(super::marks::dashes(dash, gap, theme.c.line2))
            .into_any_element(),
    )
}

/// A section's heading as a drawn theme sets it: tracked italic capitals, a
/// dashed rule out to the edge, and the count at its end, two digits
/// (`SectionLabel` beside `SidebarShell`'s count).
pub(crate) fn section_heading(
    label: &str,
    count: Option<usize>,
    theme: &Theme,
) -> Option<AnyElement> {
    let (dash, gap) = theme.skin.marks.heading_rule?;
    Some(
        div()
            .debug_selector(|| "mark-section-heading".to_owned())
            .flex_none()
            .px(px(14.0))
            .pt(px(6.0))
            .pb(px(8.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .text_size(px(10.5))
                    .line_height(px(14.7))
                    .text_color(theme.c.dim)
                    .child(voiced(label, Role::Heading, 10.5, theme))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(12.0))
                            .h(theme.skin.line_width)
                            .child(super::marks::dashes(dash, gap, theme.c.line2)),
                    ),
            )
            .when_some(count, |heading, count| {
                heading.child(
                    div()
                        .flex_none()
                        .text_size(px(11.0))
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(theme.c.muted)
                        .child(SharedString::from(format!("{count:02}"))),
                )
            })
            .into_any_element(),
    )
}

/// The leaning bar of the accent a drawn theme stands before a
/// conversation's name, where others put the channel's mark.
pub(crate) fn header_mark(theme: &Theme) -> Option<AnyElement> {
    if !theme.skin.marks.header_mark {
        return None;
    }
    Some(
        div()
            .debug_selector(|| "mark-header".to_owned())
            .relative()
            .flex_none()
            .w(px(8.0))
            .h(px(34.0))
            .child(leaning(theme.c.accent, None))
            .into_any_element(),
    )
}

/// The line under a conversation's name: in the subtitle's voice, behind a
/// presence dot, where the theme marks its header; plain otherwise.
pub(crate) fn subtitle(about: String, theme: &Theme) -> AnyElement {
    let line = div()
        .text_size(px(11.0))
        .line_height(px(17.05))
        .text_color(theme.c.muted);
    if !theme.skin.marks.header_mark {
        return line.child(about).into_any_element();
    }
    line.text_size(px(10.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .flex_none()
                .size(px(6.0))
                .rounded_full()
                .bg(theme.c.ok),
        )
        .child(voiced(&about, Role::Subtitle, 10.0, theme))
        .into_any_element()
}

/// The rule that starts a day as a drawn theme draws it: dashed either
/// side, the day on a plate of the band's colour cut as a control is
/// (`DayDivider`).
pub(crate) fn day_plate(day: &str, theme: &Theme) -> Option<AnyElement> {
    let weight = theme.skin.marks.day_plate?;
    let rule = || {
        div().flex_1().h(px(weight)).child(super::marks::dashes(
            weight * 3.0,
            weight * 2.0,
            theme.c.line2,
        ))
    };
    let words = div()
        .px(px(16.0))
        .py(px(5.0))
        .text_size(px(10.5))
        .line_height(px(16.275))
        .text_color(theme.c.bar_text);
    let finish = Finish::new(theme.c.bar, None);
    let plate = match theme.skin.cuts.of(Kind::Plate) {
        Some(cut) => super::shape::cut_into(words, cut, finish, px(0.0)),
        None => words.bg(theme.c.bar),
    }
    .child(voiced(day, Role::Day, 10.5, theme));
    Some(
        div()
            .debug_selector(|| "mark-day-plate".to_owned())
            .w_full()
            .pt(px(26.0))
            .flex()
            .items_center()
            .gap(px(14.0))
            .child(rule())
            .child(plate)
            .child(rule())
            .into_any_element(),
    )
}

/// How a channel row is finished: `None` where the theme leaves a row it is
/// not on bare and a selected one to the view's own wash. Selected, the
/// theme's fill; otherwise a card, if it plates every row.
pub(crate) fn row_finish(selected: bool, theme: &Theme) -> Option<Finish> {
    let _cut = theme.skin.cuts.of(Kind::Row)?;
    if selected {
        let solid = theme.skin.selection == crate::theme::Fill::Solid;
        let fill = if solid {
            theme.c.accent
        } else {
            theme.c.accent_soft
        };
        let edge = (!solid).then_some(theme.c.accent_line);
        // No glow: the web UI's `selectionGlow` is a box shadow, which the
        // row's own cut clips away on every theme that asks for both.
        return Some(Finish::new(fill, edge));
    }
    theme
        .skin
        .marks
        .plated_rows
        .then(|| Finish::new(theme.c.card, Some(theme.c.line)).hover(theme.c.hover))
}

/// The bar down a selected row's leading edge, cut as the row is, so it
/// leans with it: in the theme's second hue on a solid row, where the
/// accent would not show.
pub(crate) fn selection_bar(theme: &Theme) -> Option<AnyElement> {
    let width = theme.skin.selection_bar?;
    let ink = if theme.skin.selection == crate::theme::Fill::Solid {
        theme.c.accent2
    } else {
        theme.c.accent
    };
    let bar = div()
        .debug_selector(|| "mark-selection-bar".to_owned())
        .absolute()
        .top_0()
        .bottom_0()
        .left_0()
        .w(width);
    Some(
        match theme.skin.cuts.of(Kind::Row) {
            Some(cut) => bar.child(super::shape::plate(cut, Finish::new(ink, None), px(0.0))),
            None => bar.bg(ink),
        }
        .into_any_element(),
    )
}
