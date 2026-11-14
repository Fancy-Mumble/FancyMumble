//! How the Profile page is laid out, as the web UI's `ProfileSettings` and
//! `ProfilePreview` lay it: the form in a column of at most 620 pixels,
//! its single fields at most 420, and beside it the card, in a column of
//! its own that wraps under the form where the window is narrow.

use gpui::{
    Context, Div, Hsla, IntoElement, ParentElement, SharedString, Stateful, Styled, div,
    prelude::*, px, relative,
};
use serde_json::{Value, json};

use super::super::super::Shell;
use super::super::super::card::{self, Filler};
use super::super::super::kit::{
    Avatar, Banner, ColourWell, Field, MarkedField, Note, PageTitle, Reachable, Switch, hex,
};
use super::super::super::marking::Mark;
use super::super::super::widgets::EMPHASIS;
use super::super::heading;
use super::{Form, Typed};
use crate::pictures::{Fit, shown};
use crate::theme::Theme;
use crate::words::t;

/// How wide the form is at most, a single field in it, and the column the
/// card stands in.
const FORM_MOST: f32 = 620.0;
const FIELD_MOST: f32 = 420.0;
const PREVIEW: f32 = 344.0;

/// The page.
pub(in crate::ui::settings) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let Some(form) = shell.panels.settings.profile.as_ref() else {
        return div();
    };
    div()
        .max_w(px(1040.0))
        .flex()
        .flex_wrap()
        .items_start()
        .gap(px(36.0))
        .child(
            div()
                .flex_1()
                .min_w(px(340.0))
                .max_w(px(FORM_MOST))
                .child(
                    PageTitle::new(t!("Profile")).hint(t!(
                        "Everything on one page — each row shows your current pick; Change opens just that section."
                    )),
                )
                .when(!shell.can_send_profile(), |page| {
                    page.child(div().mb(px(16.0)).child(
                        Banner::new(Note::Warn)
                            .child(t!("Connect to a server to change your profile: it is kept there.")),
                    ))
                })
                .child(
                    div()
                        .max_w(px(FIELD_MOST))
                        .child(Field::new(t!("Display name"), Boxed(form.field(Typed::Name).clone()))),
                )
                .child(words(form))
                .child(about(shell, theme, cx))
                .child(pictures(shell, form, theme, cx))
                .child(super::style::render(shell, form, theme, cx))
                .child(shows(shell, form, theme, cx)),
        )
        .child(preview(shell, form, theme, cx))
}

/// `column` taking `share` of the room its row leaves, as a CSS `flex`
/// of that number does: the web UI's rows split 1 : 1.4.
fn share(column: Div, share: f32) -> Div {
    let mut column = column.flex_basis(relative(0.0)).flex_shrink_1().min_w_0();
    column.style().flex_grow = Some(share);
    column
}

/// Pronouns and contact side by side, and the status under them.
fn words(form: &Form) -> impl IntoElement + use<> {
    let boxed = |typed| Boxed(form.field(typed).clone());
    div()
        .max_w(px(FIELD_MOST))
        .child(
            div()
                .mt(px(16.0))
                .flex()
                .gap(px(16.0))
                .child(share(div(), 1.0).child(Field::new(
                    t!("Pronouns"),
                    boxed(Typed::Pronouns),
                )))
                .child(share(div(), 1.4).child(Field::new(
                    t!("Contact"),
                    boxed(Typed::Contact),
                ))),
        )
        .child(
            div().mt(px(16.0)).child(Field::new(
                t!("Status"),
                MarkedField::new("status-tool", form.field(Typed::Status).clone())
                    .tool(Mark::Bold, "bold", t!("Bold"))
                    .tool(Mark::Italic, "italic", t!("Italic"))
                    .tool(Mark::Underlined, "underline", t!("Underline")),
            )),
        )
}

/// A field of the page in its outlined box, the theme read when drawn.
#[derive(IntoElement)]
pub(super) struct Boxed(pub(super) gpui::Entity<super::super::super::text_input::TextInput>);

impl RenderOnce for Boxed {
    fn render(self, _: &mut gpui::Window, cx: &mut gpui::App) -> impl IntoElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        div()
            .h(px(36.0))
            .px(px(13.0))
            .flex()
            .items_center()
            .rounded(theme.skin.radius_md)
            .bg(theme.c.input)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(12.5))
            .child(self.0)
    }
}

/// What the user says about themselves: the about editor, drawn here in
/// place of its own dialog while the page shows, in the box the web UI's
/// field has; put away (Escape), the way to bring it back.
fn about(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let shown = match shell.panels.profiles.editor.as_ref() {
        Some(editor) => super::super::super::about_editor::view::field(shell, editor, theme, cx),
        None => div()
            .flex()
            .child(Reachable::new(
                "profile-about",
                text_button("profile-about", t!("Edit"), theme)
                    .on_click(cx.listener(|shell, _, _, cx| shell.open_about_editor(cx))),
            ))
            .into_any_element(),
    };
    div()
        .mt(px(16.0))
        .max_w(px(FIELD_MOST))
        .child(Field::new(t!("About you"), shown))
}

/// A button that is a word on the second card colour: the web UI's
/// `TextButton`.
pub(super) fn text_button(id: &'static str, says: SharedString, theme: &Theme) -> Stateful<Div> {
    let hover = theme.c.hover;
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .flex_none()
        .px(px(13.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card2)
        .text_size(px(12.0))
        .line_height(px(18.6))
        .font_weight(gpui::FontWeight::MEDIUM)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(says)
}

/// The user's own picture, and the ways to change it.
fn avatar(
    shell: &Shell,
    gifs: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let own = shell.own_user();
    // Named as the preview names it: the display name, or "You".
    let name = shell
        .panels
        .settings
        .display_name
        .clone()
        .unwrap_or_else(|| t!("You").to_string());
    let face = own.and_then(|user| user.avatar.clone());
    div()
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(Avatar::new(&name).round().picture(face.as_ref()).size(52.0))
        .child(Reachable::new(
            "profile-avatar",
            text_button("profile-avatar", t!("Edit"), theme)
                .on_click(cx.listener(|shell, _, _, cx| shell.pick_profile_picture(false, cx))),
        ))
        .when(gifs, |row| {
            row.child(gif_button(
                "profile-avatar-gif",
                |shell, bytes, _| {
                    shell.engine.act(crate::engine::Action::SetAvatar(bytes));
                },
                theme,
                cx,
            ))
        })
        .when(face.is_some(), |row| {
            row.child(Reachable::new(
                "profile-avatar-clear",
                text_button("profile-avatar-clear", t!("Clear"), theme).on_click(
                    cx.listener(|shell, _, _, cx| shell.clear_profile_picture(false, cx)),
                ),
            ))
        })
}

/// The colour the banner's well shows while the banner has none: the web
/// UI's.
const NO_BANNER_COLOUR: u32 = 0x2a_3350;

/// The picture and the banner, side by side, 1 : 1.4.
fn pictures(
    shell: &Shell,
    form: &Form,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let banner_colour = form
        .held
        .pointer("/banner/color")
        .and_then(Value::as_str)
        .and_then(crate::theme::parse_color)
        .map(Hsla::from);
    let has_banner = form.banner.is_some() || banner_colour.is_some();
    let gifs = shell.offers_gif_pictures();
    let avatar = avatar(shell, gifs, theme, cx);
    let strip = div()
        .flex_none()
        .w(px(110.0))
        .h(px(52.0))
        .rounded(theme.skin.radius_md)
        .overflow_hidden()
        .border_1()
        .border_color(theme.c.line2)
        .bg(banner_colour.unwrap_or(theme.c.card2))
        .children(form.banner.as_ref().map(|picture| {
            gpui::img(shown(picture, Fit::Banner))
                .size_full()
                .object_fit(gpui::ObjectFit::Cover)
        }));
    let well = banner_colour.unwrap_or_else(|| gpui::rgb(NO_BANNER_COLOUR).into());
    let banner = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(12.0))
        .child(strip)
        .child(Reachable::new(
            "profile-banner",
            text_button("profile-banner", t!("Image"), theme)
                .on_click(cx.listener(|shell, _, _, cx| shell.pick_profile_picture(true, cx))),
        ))
        .when(gifs, |row| {
            row.child(gif_button(
                "profile-banner-gif",
                |shell, bytes, _| {
                    shell.engine.act(crate::engine::Action::SetBanner(bytes));
                    shell.ask_own_profile();
                },
                theme,
                cx,
            ))
        })
        .child(
            ColourWell::new("profile-banner-colour", Some(well)).on_pick(cx.listener(
                |shell, colour: &Hsla, _, cx| {
                    shell.patch_profile(json!({ "banner": { "color": hex(*colour) } }), cx);
                },
            )),
        )
        .when(has_banner, |row| {
            row.child(Reachable::new(
                "profile-banner-clear",
                text_button("profile-banner-clear", t!("Clear"), theme)
                    .on_click(cx.listener(|shell, _, _, cx| shell.clear_profile_picture(true, cx))),
            ))
        });
    div()
        .mt(px(22.0))
        .flex()
        .gap(px(16.0))
        .child(share(div(), 1.0).child(Field::new(t!("Avatar"), avatar)))
        .child(share(div(), 1.4).child(Field::new(t!("Banner"), banner)))
}

/// What a GIF chosen for a picture of one's own is handed to.
type Chosen = fn(&mut Shell, Vec<u8>, &mut Context<Shell>);

/// The button that chooses a GIF for a picture of one's own, where GIFs
/// can be had.
fn gif_button(
    id: &'static str,
    then: Chosen,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    Reachable::new(
        id,
        text_button(id, t!("GIF"), theme).on_click(cx.listener(
            move |shell, event: &gpui::ClickEvent, window, cx| {
                shell.pick_gif_picture(event.position(), then, window, cx);
            },
        )),
    )
}

/// Words asked for when they are drawn.
type Words = fn() -> SharedString;

/// The rows of the card, each to be shown or hidden: the profile's
/// `sections`, in the web UI's order.
const SHOWN: [(&str, Words, Words); 9] = [
    (
        "badges",
        || t!("Badges"),
        || t!("The chips under your name"),
    ),
    (
        "shelves",
        || t!("Badge shelves"),
        || t!("Your collection, one rail per tier"),
    ),
    (
        "identity",
        || t!("Pronouns & contact"),
        || t!("The line under the badges"),
    ),
    ("status", || t!("Status"), || t!("Your one-line status")),
    ("bio", || t!("About you"), || t!("Your description")),
    (
        "mutual",
        || t!("Mutual servers"),
        || t!("Servers you share with the viewer"),
    ),
    (
        "roles",
        || t!("Roles"),
        || t!("The groups the server puts you in"),
    ),
    (
        "activity",
        || t!("Activity"),
        || t!("What you are playing, or where you are"),
    ),
    (
        "stats",
        || t!("Stats"),
        || t!("Messages, time in voice, account"),
    ),
];

/// Which rows of the card show.
fn shows(
    shell: &Shell,
    form: &Form,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let lit = &shell.panels.settings.lit;
    div()
        .child(heading(lit, t!("What the card shows")).hint(t!(
            "Anything switched off here is hidden on every card of you, everywhere."
        )))
        .child(
            div()
                .mt(px(6.0))
                .flex()
                .flex_wrap()
                .gap(px(16.0))
                .children(SHOWN.map(|(key, name, hint)| {
                    let on =
                        form.held.pointer(&format!("/sections/{key}")) != Some(&Value::Bool(false));
                    let id: &'static str = match key {
                        "badges" => "show-badges",
                        "shelves" => "show-shelves",
                        "identity" => "show-identity",
                        "status" => "show-status",
                        "bio" => "show-bio",
                        "mutual" => "show-mutual",
                        "roles" => "show-roles",
                        "activity" => "show-activity",
                        _ => "show-stats",
                    };
                    let row = div()
                        .id(id)
                        .debug_selector(move || id.to_owned())
                        .w(px(250.0))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .cursor_pointer()
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            let mut sections = serde_json::Map::new();
                            let _ = sections.insert(key.to_owned(), Value::Bool(!on));
                            shell.patch_profile(json!({ "sections": sections }), cx);
                        }))
                        .child(Switch::new(on))
                        .child(
                            div()
                                .min_w_0()
                                .child(div().text_size(px(12.0)).child(name()))
                                .child(
                                    div()
                                        .text_size(px(10.5))
                                        .text_color(theme.c.muted)
                                        .child(hint()),
                                ),
                        );
                    Reachable::new(id, row)
                })),
        )
}

/// What the preview puts where only a server can say something, as the web
/// UI's `exampleContent` does: chips, two roles, a game and three numbers.
fn examples() -> Filler {
    let tone = |rgb: u32| Hsla::from(gpui::rgb(rgb));
    Filler {
        badges: vec![
            ("star", tone(0xec_ba55)),
            ("mic", tone(0x41_b4f9)),
            ("zap", tone(0xa8_55f7)),
            ("check", tone(0x3c_d88e)),
        ],
        roles: vec![
            ("admin".into(), Some(tone(0x41_b4f9))),
            ("salz".into(), None),
        ],
        activity: Some((t!("Playing League of Legends"), t!("ARAM · 24 min"))),
        stats: vec![
            ("1.2k".into(), t!("Messages")),
            ("212 h".into(), t!("In voice")),
            ("2018".into(), t!("Joined")),
        ],
        presence: Some(t!("In voice")),
    }
}

/// The card, as everybody will see it: drawn here, from the page as it
/// stands, with the switch that fills what a server would.
fn preview(shell: &Shell, form: &Form, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let named: SharedString = shell
        .panels
        .settings
        .display_name
        .clone()
        .map_or_else(|| t!("You"), Into::into);
    let filler = if form.examples {
        examples()
    } else {
        Filler::default()
    };
    let examples = form.examples;
    let drawn = shell.own_user().map(|user| {
        card::preview(
            shell,
            &form.card,
            user,
            &filler,
            named,
            t!("Banner · Frame · Nameplate · Sticker · Badges · Colours — all yours"),
            theme,
            cx,
        )
    });
    // Its gutters are for the card's sticker, which hangs off its corner;
    // the column stands where it would without them.
    div()
        .flex_none()
        .w(px(PREVIEW))
        .mx(px(-12.0))
        .px(px(12.0))
        .child(
            div()
                .mb(px(10.0))
                .text_size(px(10.5))
                .line_height(px(14.7))
                .font_weight(EMPHASIS)
                .text_color(theme.c.dim)
                // An overline: its capitals spaced 0.08em apart.
                .child(super::super::super::kit::spaced(&t!("Live preview").to_uppercase(), 0.84)),
        )
        .children(drawn)
        .child(Reachable::new(
            "profile-examples",
            div()
                .id("profile-examples")
                .debug_selector(|| "profile-examples".to_owned())
                .mt(px(12.0))
                .flex()
                .items_center()
                .gap(px(8.0))
                .cursor_pointer()
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.set_profile_examples(!examples, cx);
                }))
                .child(Switch::new(examples))
                .child(
                    div()
                        .min_w_0()
                        .child(
                            div()
                                .text_size(px(11.5))
                                .line_height(px(17.825))
                                .child(t!("Fill with example content")),
                        )
                        .child(
                            div()
                                .text_size(px(10.5))
                                .line_height(px(16.275))
                                .text_color(theme.c.muted)
                                .child(t!(
                                    "Badges, roles and activity come from the server you are on."
                                )),
                        ),
                ),
        ))
}
