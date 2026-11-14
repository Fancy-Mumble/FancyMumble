//! The card's style on the Profile page: its colours and how the name is
//! set, each in a row that opens under itself.
//!
//! The web UI's page has four more rows (the avatar's frame, a sticker, a
//! nameplate, an effect) that nothing in this client draws or keeps; they
//! are left out. So are a name's gradient and glow, which this client's
//! card draws as the gradient's first colour and not at all.

use gpui::{
    Context, Div, Hsla, IntoElement, ParentElement, SharedString, Stateful, Styled, div, prelude::*,
    px,
};
use serde_json::{Value, json};

use super::super::super::Shell;
use super::super::super::kit::{
    ColourWell, Field, Expandable, PALETTE, Reachable, Segmented, Switch, hex,
};
use super::super::heading;
use super::page::text_button;
use super::{Form, Row};
use crate::theme::Theme;
use crate::words::t;

/// How many colours a card takes, as the web UI's editor allows.
const MOST_COLOURS: usize = 5;

/// The faces a name can be set in, as the profile names them; the first is
/// the card's own.
const FONTS: [&str; 4] = ["", "serif", "mono", "cursive"];

/// The face the profile names `font`, where it names one.
fn face(font: &str) -> Option<crate::profile::Face> {
    use crate::profile::Face;
    match font {
        "serif" => Some(Face::Serif),
        "mono" => Some(Face::Mono),
        "cursive" => Some(Face::Cursive),
        "fantasy" => Some(Face::Fantasy),
        _ => None,
    }
}

/// The group: its heading and its two rows.
pub(super) fn render(shell: &Shell, form: &Form, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    div()
        .child(
            heading(&shell.panels.settings.lit, t!("Card style"))
                .hint(t!("Colours first: everything else on the card takes its ramp from them.")),
        )
        .child(colours(form, theme, cx))
        .child(name_style(shell, form, theme, cx))
}

/// The card's colours, as the profile keeps them.
fn card_colours(form: &Form) -> Vec<String> {
    form.held
        .get("themeColors")
        .and_then(Value::as_array)
        .map(|colours| {
            colours
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// A colour as CSS writes it, for drawing.
fn drawn(css: &str) -> Option<Hsla> {
    crate::theme::parse_color(css).map(Hsla::from)
}

/// The card's colours sent as `colours`: none takes them away.
fn send_colours(shell: &mut Shell, colours: &[String], cx: &mut Context<Shell>) {
    let value = if colours.is_empty() {
        Value::Null
    } else {
        json!(colours)
    };
    shell.patch_profile(json!({ "themeColors": value }), cx);
}

/// A switch with what it sets beside it, the whole of it taking the click:
/// the web UI's page draws its small switches so.
pub(super) fn labelled(id: &'static str, on: bool, label: SharedString) -> Stateful<Div> {
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .flex()
        .items_center()
        .gap(px(8.0))
        .cursor_pointer()
        .child(Switch::new(on))
        .child(div().text_size(px(12.0)).child(label))
}

/// The row of the card's colours.
fn colours(form: &Form, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let colours = card_colours(form);
    let glass = form.held.get("cardGlass") == Some(&Value::Bool(true));
    let value = if colours.is_empty() {
        t!("Window colours")
    } else {
        let mut said = t!("{{count}} colour", "{{count}} colours", count = colours.len()).to_string();
        if glass {
            said.push_str(&t!(" · glass"));
        }
        SharedString::from(said)
    };
    let shown: Vec<Hsla> = colours.iter().filter_map(|css| drawn(css)).collect();
    let glimpse = div()
        .size(px(24.0))
        .rounded(theme.skin.radius_md)
        .border_1()
        .border_color(theme.c.line2)
        .map(|glimpse| match (shown.first(), shown.last()) {
            (Some(from), Some(to)) => glimpse.bg(gpui::linear_gradient(
                180.0,
                gpui::linear_color_stop(*from, 0.0),
                gpui::linear_color_stop(*to, 1.0),
            )),
            _ => glimpse.bg(theme.c.card2),
        });
    Expandable::new(
        "profile-colours",
        glimpse,
        t!("Card colours"),
        value,
        form.open == Some(Row::Colours),
    )
    .on_toggle(cx.listener(|shell, _, _, cx| shell.toggle_profile_row(Row::Colours, cx)))
    .child(
        div()
            .mb(px(10.0))
            .text_size(px(11.5))
            .text_color(theme.c.muted)
            .child(t!(
                "The first three colours rake down the card, the fourth becomes its border and the fifth its accent — the send button, the volume bar and every link on it."
            )),
    )
    .child(colour_list(&colours, theme, cx))
    .child(
        div().mt(px(14.0)).child(Reachable::new(
            "profile-glass",
            labelled("profile-glass", glass, t!("Frosted glass over the card background"))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.patch_profile(json!({ "cardGlass": !glass }), cx);
                })),
        )),
    )
    .child(div().mt(px(14.0)).child(Field::new(
        t!("Custom background (CSS)"),
        super::page::Boxed(form.field(super::Typed::Background).clone()),
    )))
}

/// What the colour wells of the card are called, by their place.
const WELLS: [(&str, &str); MOST_COLOURS] = [
    ("card-colour-0", "card-colour-0-remove"),
    ("card-colour-1", "card-colour-1-remove"),
    ("card-colour-2", "card-colour-2-remove"),
    ("card-colour-3", "card-colour-3-remove"),
    ("card-colour-4", "card-colour-4-remove"),
];

/// Each colour with the way to take it out, and the ways to add one, to
/// shuffle them and to clear them.
fn colour_list(colours: &[String], theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let wells = colours.iter().take(MOST_COLOURS).enumerate().map(|(at, css)| {
        let (well, remove) = WELLS[at];
        let (picked, kept) = (colours.to_vec(), colours.to_vec());
        div()
            .flex()
            .items_center()
            .gap(px(4.0))
            .child(ColourWell::new(well, drawn(css)).on_pick(cx.listener(
                move |shell, colour: &Hsla, _, cx| {
                    let mut colours = picked.clone();
                    colours[at] = hex(*colour);
                    send_colours(shell, &colours, cx);
                },
            )))
            .child(Reachable::new(
                remove,
                text_button(remove, SharedString::from("\u{d7}"), theme).on_click(cx.listener(
                    move |shell, _, _, cx| {
                        let mut colours = kept.clone();
                        let _ = colours.remove(at);
                        send_colours(shell, &colours, cx);
                    },
                )),
            ))
    });
    let (more, any) = (colours.len() < MOST_COLOURS, !colours.is_empty());
    let added = colours.to_vec();
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(8.0))
        .children(wells)
        .when(more, |row| {
            row.child(Reachable::new(
                "card-colour-add",
                text_button("card-colour-add", t!("+ Colour"), theme).on_click(cx.listener(
                    move |shell, _, _, cx| {
                        let mut colours = added.clone();
                        colours.push("#6366f1".to_owned());
                        send_colours(shell, &colours, cx);
                    },
                )),
            ))
        })
        .child(Reachable::new(
            "card-colour-shuffle",
            text_button("card-colour-shuffle", t!("Shuffle"), theme)
                .on_click(cx.listener(|shell, _, _, cx| send_colours(shell, &shuffled(), cx))),
        ))
        .when(any, |row| {
            row.child(Reachable::new(
                "card-colour-clear",
                text_button("card-colour-clear", t!("Clear"), theme)
                    .on_click(cx.listener(|shell, _, _, cx| send_colours(shell, &[], cx))),
            ))
        })
}

/// Three colours of the palette, chosen by the clock: what Shuffle gives.
fn shuffled() -> Vec<String> {
    let palette = PALETTE;
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.subsec_nanos() as usize);
    (0..3)
        .map(|at| palette[(seed / 7 + at * 5) % palette.len()].to_owned())
        .collect()
}

/// The row of how the name is set.
fn name_style(shell: &Shell, form: &Form, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let style = form.held.get("nameStyle");
    let said = |key: &str| style.and_then(|style| style.get(key));
    let font = said("font").and_then(Value::as_str).unwrap_or_default().to_owned();
    let at = FONTS.iter().position(|known| *known == font).unwrap_or(0);
    let bold = said("bold") != Some(&Value::Bool(false));
    let italic = said("italic") == Some(&Value::Bool(true));
    let colour = said("color").and_then(Value::as_str).and_then(drawn);
    let names = [t!("Default"), t!("Serif"), t!("Mono"), t!("Cursive")];
    let mut value = vec![names[at].to_string()];
    value.extend(bold.then(|| t!("bold").to_string()));
    value.extend(italic.then(|| t!("italic").to_string()));
    let own = shell
        .snapshot
        .users
        .iter()
        .find(|user| Some(user.session) == shell.snapshot.own_session)
        .map_or_else(|| t!("You").to_string(), |user| user.name.to_string());
    let glimpse = div()
        .w(px(24.0))
        .flex()
        .justify_center()
        .text_size(px(15.0))
        .when_some(face(&font), |glimpse, face| {
            glimpse.font_family(crate::theme::family(face.stack(), cx))
        })
        .child(own.chars().take(2).collect::<String>());
    Expandable::new(
        "profile-name",
        glimpse,
        t!("Name style"),
        value.join(" · "),
        form.open == Some(Row::Name),
    )
    .on_toggle(cx.listener(|shell, _, _, cx| shell.toggle_profile_row(Row::Name, cx)))
    .child(div().flex().child(Segmented::new("name-font", names, at).on_choose(cx.listener(
        |shell, at: &usize, _, cx| {
            let font = FONTS.get(*at).filter(|font| !font.is_empty());
            shell.patch_profile(json!({ "nameStyle": { "font": font } }), cx);
        },
    ))))
    .child(
        div()
            .mt(px(12.0))
            .flex()
            .gap(px(20.0))
            .child(Reachable::new(
                "name-bold",
                labelled("name-bold", bold, t!("Bold")).on_click(cx.listener(move |shell, _, _, cx| {
                    // Bold is what a card does unless told not to.
                    let value = if bold { json!(false) } else { Value::Null };
                    shell.patch_profile(json!({ "nameStyle": { "bold": value } }), cx);
                })),
            ))
            .child(Reachable::new(
                "name-italic",
                labelled("name-italic", italic, t!("Italic")).on_click(cx.listener(
                    move |shell, _, _, cx| {
                        let value = if italic { Value::Null } else { json!(true) };
                        shell.patch_profile(json!({ "nameStyle": { "italic": value } }), cx);
                    },
                )),
            )),
    )
    .child(name_colour(colour, theme, cx))
}

/// The colour the name is set in, and the way to have none.
fn name_colour(colour: Option<Hsla>, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    div()
        .mt(px(10.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(ColourWell::new("name-colour", colour).on_pick(cx.listener(
            |shell, colour: &Hsla, _, cx| {
                shell.patch_profile(json!({ "nameStyle": { "color": hex(*colour) } }), cx);
            },
        )))
        .child(div().text_size(px(11.5)).child(t!("Flat colour")))
        .when(colour.is_some(), |row| {
            row.child(Reachable::new(
                "name-colour-clear",
                text_button("name-colour-clear", t!("Clear"), theme).on_click(cx.listener(
                    |shell, _, _, cx| {
                        shell.patch_profile(json!({ "nameStyle": { "color": null } }), cx);
                    },
                )),
            ))
        })
}
