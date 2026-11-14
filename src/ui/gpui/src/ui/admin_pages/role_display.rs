//! The role editor's Display tab: what a role is called, its colour, the
//! style it is drawn in, what else the server keeps of it, and a preview
//! of how it shows: the web UI's `RoleDisplay` and `RolePreviewCard`.

use gpui::{AnyElement, Context, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{
    Button, Card, ColourWell, Emphasis, Field, GroupTitle, IconButton, PillStep, Reachable,
    RolePill, Select, Size, TextBox, hex, spaced,
};
use super::roles_page::{RolesPage, STYLES, style_names};
use super::roles_view::colour_of;
use crate::engine::AclGroup;
use crate::theme::Theme;
use crate::words::t;

/// The colours offered under the well, as the web UI's colour picker offers
/// them.
const SWATCHES: [u32; 9] = [
    0x58_65f2, 0x3b_a55d, 0xfa_a61a, 0xed_4245, 0xeb_459e, 0x9b_59b6, 0x1a_bc9c, 0xe6_7e22, 0x95_a5a6,
];

/// The tab.
pub(super) fn render(
    page: &RolesPage,
    role: &AclGroup,
    budget: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let Some(form) = page.form.as_ref() else {
        return div().into_any_element();
    };
    let style = STYLES
        .iter()
        .position(|style| style.map(SharedString::new_static) == role.look.style)
        .unwrap_or(0);
    let fields = div()
        .flex_1()
        .min_w(px(320.0))
        .child(div().mb(px(16.0)).child(Field::new(
            t!("Role name"),
            div().debug_selector(|| "role-name".to_owned()).child(TextBox::new(form.name.clone())),
        )))
        .child(div().mb(px(16.0)).child(Field::new(t!("Color"), colour(role, Some(form.colour.clone()), theme, cx))))
        .child(div().mb(px(16.0)).child(Field::new(t!("Icon"), icon(form.icon.clone(), budget, theme, cx))))
        .child(div().mb(px(16.0)).child(Field::new(
            t!("Style preset"),
            Select::new("role-style", style_names(), style).on_choose(cx.listener(
                |shell, at: &usize, _, cx| shell.style_role(*at, cx),
            )),
        )))
        .child(GroupTitle::new(t!("Metadata")))
        .child(metadata(page, role, theme, cx));
    div()
        .flex()
        .flex_wrap()
        .items_start()
        .gap(px(24.0))
        .child(fields)
        .child(preview(role, form.icon.clone(), theme))
        .into_any_element()
}

/// The colour: the well that opens the palette, what it is as CSS writes
/// it, the way to clear it, and a row of colours to take at a click.
fn colour(
    role: &AclGroup,
    field: Option<gpui::Entity<super::super::text_input::TextInput>>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let current = colour_of(role);
    let pick = |colour: Hsla| SharedString::from(hex(colour));
    let well = ColourWell::new("role-colour", current).on_pick(cx.listener(move |shell, colour: &Hsla, _, cx| {
        shell.colour_role(Some(pick(*colour)), cx);
    }));
    let swatches = SWATCHES.iter().enumerate().map(|(at, rgb)| {
        let colour: Hsla = gpui::rgb(*rgb).into();
        let id = SharedString::from(format!("role-swatch-{at}"));
        let selector = id.clone();
        let button = div()
            .id(gpui::ElementId::Name(id.clone()))
            .debug_selector(move || selector.to_string())
            .size(px(26.0))
            .rounded(theme.skin.radius_sm)
            .bg(colour)
            .border_1()
            .border_color(theme.c.line2)
            .cursor_pointer()
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.colour_role(Some(SharedString::from(hex(colour))), cx);
            }));
        Reachable::new(gpui::ElementId::Name(id), button).corner(theme.skin.radius_sm)
    });
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(well)
                .when_some(field, |row, field| {
                    row.child(
                        div()
                            .flex_1()
                            .debug_selector(|| "role-colour-text".to_owned())
                            .child(TextBox::new(field)),
                    )
                })
                .when(current.is_some(), |row| {
                    row.child(
                        Button::new("role-colour-clear", t!("Clear"))
                            .size(Size::Compact)
                            .height(33.1)
                            .on_click(cx.listener(|shell, _, _, cx| shell.colour_role(None, cx))),
                    )
                }),
        )
        .child(div().flex().gap(px(4.0)).children(swatches))
}

/// `said` a word to a piece, each with the room of a space after it but the
/// last where `said` ends without one: what a flex row wraps between, as a
/// paragraph wraps between its words.
fn words(said: &str) -> Vec<gpui::Div> {
    let ends_spaced = said.ends_with(' ');
    let pieces: Vec<&str> = said.split_whitespace().collect();
    let last = pieces.len().saturating_sub(1);
    pieces
        .into_iter()
        .enumerate()
        .map(|(at, piece)| {
            div()
                .when(at < last || ends_spaced, |word| word.mr(px(3.5)))
                .child(SharedString::from(piece.to_owned()))
        })
        .collect()
}

/// The icon: the picture, or a place for one, the way to choose one, and
/// how large it may be.
fn icon(
    drawn: Option<std::sync::Arc<gpui::Image>>,
    budget: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let set = drawn.is_some();
    let place = div()
        .flex_none()
        .mt(px(3.0))
        .size(px(48.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card2)
        .border_1()
        .when(!set, Styled::border_dashed)
        .border_color(theme.c.line2)
        .overflow_hidden()
        .flex()
        .items_center()
        .justify_center()
        .map(|place| match drawn {
            Some(picture) => place.child(
                gpui::img(crate::pictures::shown(&picture, crate::pictures::Fit::Face)).size_full(),
            ),
            None => place
                .text_size(px(20.0))
                .text_color(theme.c.dim)
                .child(SharedString::new_static("+")),
        });
    let size = super::super::bytes_in_words(u64::try_from(budget).unwrap_or(u64::MAX));
    div()
        .flex()
        .items_start()
        .gap(px(12.0))
        .child(place)
        .child(
            div()
                .flex_1()
                .child(
                    div()
                        .flex()
                        .gap(px(6.0))
                        .child(
                            Button::new("role-icon-choose", if set { t!("Replace") } else { t!("Choose icon") })
                                .size(Size::Compact)
                                .height(33.1)
                                .on_click(cx.listener(|shell, _, _, cx| shell.pick_role_icon(cx))),
                        )
                        .when(set, |buttons| {
                            buttons.child(
                                Button::new("role-icon-remove", t!("Remove"))
                                    .size(Size::Compact)
                                    .height(33.1)
                                    .on_click(cx.listener(|shell, _, _, cx| shell.icon_role(None, cx))),
                            )
                        }),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_size(px(11.0))
                        .text_color(theme.c.dim)
                        .child(t!("Square crop, max {{size}} (server limit).", size = size)),
                ),
        )
}

/// What else the server keeps of the role, a value to each key, and the
/// row a new one is added in.
fn metadata(page: &RolesPage, role: &AclGroup, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let locked = role.from_parent;
    let rows = page.form.iter().flat_map(|form| &form.values).enumerate().map(|(at, (key, field))| {
        let key = key.clone();
        let gone = key.clone();
        div()
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(
                div()
                    .flex_none()
                    .w(px(130.0))
                    .truncate()
                    .text_size(px(11.5))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .child(key),
            )
            .child(div().flex_1().child(TextBox::new(field.clone())))
            .when(!locked, |row| {
                row.child(
                    IconButton::at("role-meta-remove", at, "x")
                        .size(25.0)
                        .glyph_size(13.0)
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            shell.role_metadata(gone.clone(), None, cx);
                        })),
                )
            })
    });
    let empty = role.look.metadata.is_empty();
    div()
        .when(empty, |list| {
            list.child(
                div()
                    .text_size(px(11.5))
                    .text_color(theme.c.muted)
                    .child(t!("No metadata entries.")),
            )
        })
        .child(div().flex().flex_col().gap(px(6.0)).children(rows))
        .when_some(page.form.as_ref().filter(|_| !locked), |list, form| {
            list.child(
                div()
                    .mt(px(10.0))
                    .flex()
                    .gap(px(8.0))
                    .child(div().flex_none().w(px(130.0)).child(TextBox::new(form.new_key.clone())))
                    .child(div().flex_1().child(TextBox::new(form.new_value.clone())))
                    .child(
                        Button::new("role-meta-add", t!("Add"))
                            .emphasis(Emphasis::Outlined)
                            .size(Size::Compact)
                            .height(36.0)
                            .on_click(cx.listener(|shell, _, window, cx| shell.add_role_metadata(window, cx))),
                    ),
            )
        })
}

/// How the role shows: its pill, a name in its colour, and a mention of it
/// in a message.
fn preview(
    role: &AclGroup,
    icon: Option<std::sync::Arc<gpui::Image>>,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let colour = colour_of(role);
    let label = if role.name.is_empty() { t!("Role") } else { role.name.clone() };
    let tint = colour.unwrap_or(theme.c.accent);
    Card::new()
        .flex_none()
        .w(px(240.0))
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(
            spaced(&t!("Preview").to_uppercase(), 0.63)
                .text_size(px(10.5))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme.c.dim),
        )
        .child(
            div()
                .flex()
                .child(RolePill::new(label.clone(), colour).step(PillStep::Large).icon(icon)),
        )
        .child(
            div()
                .flex()
                .items_baseline()
                .gap(px(4.0))
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(colour.unwrap_or(theme.c.text))
                        .child(t!("Sample User")),
                )
                .child(div().text_size(px(11.5)).text_color(theme.c.muted).child(t!("online"))),
        )
        .child(
            div()
                .px(px(10.0))
                .py(px(6.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.card2)
                .text_size(px(12.5))
                .flex()
                .flex_wrap()
                .children(words(&t!("Hey ")))
                .child(
                    div()
                        .px(px(4.0))
                        .rounded(theme.skin.radius_sm)
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(tint)
                        .bg(Hsla { a: 0.2, ..tint })
                        .child(SharedString::from(format!("@{label}"))),
                )
                .children(words(&t!(", can you take a look?"))),
        )
}
