//! Somebody's card: who they are, where they are, and what they wrote about
//! themselves, in the measures of the web UI's own card.
//!
//! There is one card. Resting the pointer on somebody shows it where the
//! pointer cannot reach it; a click keeps it there until a press lands
//! somewhere else, and that press still lands. It is drawn from the server's
//! state each time, so it says who is talking now and not who was when it
//! opened.

use gpui::{
    AnyElement, Context, Div, Hsla, IntoElement, ParentElement, Pixels, Point, SharedString,
    Styled, Window, div, linear_color_stop, linear_gradient, prelude::*, px,
};

use super::about_view::{self, Drawing};
use super::conversation::{DrawnBody, Place, words_as};
use super::kit::{Avatar, Button, Faded, IconButton, Size, Slider, Variant, icon, user_tint};
use super::widgets::{EMPHASIS, opaque};
use super::{Info, Shell};
use crate::engine::{Session, Subject, User};
use crate::profile::Said;
use crate::theme::Theme;
use crate::words::t;

/// What a card shows of what its person wrote, where its full profile is
/// kept if they have one, and how far its room is scrolled.
#[derive(Debug, Default)]
pub(super) struct Written {
    pub(super) said: Said,
    pub(super) page: Option<mumble_tauri_lib::engine_api::about::PageRef>,
    pub(super) scroll: gpui::ScrollHandle,
}

/// Read a user's `comment` into `info`: what they wrote, as the card draws
/// it, and as the sheet of what the server knows shows it. The comment, its
/// pictures above all, is not kept.
pub(super) fn read_comment(info: &mut Info, comment: &str) {
    let (said, page) = Said::of(comment);
    info.body = Some(std::sync::Arc::new(DrawnBody::of_words(said.words())));
    info.written = Written {
        said,
        page,
        scroll: gpui::ScrollHandle::new(),
    };
}

/// The card's measures, as the web UI's shared card has them.
pub(super) const WIDTH: f32 = 310.0;
const BANNER: f32 = 150.0;
const FACE: f32 = 76.0;
/// The ring of the card's own colour round the face.
const RING: f32 = 4.0;
/// How far the face hangs below the banner: 42 % of it.
const HANG: f32 = 32.0;
/// How tall what somebody wrote grows before it scrolls instead.
const BIO_ROOM: f32 = 208.0;
/// How far from the pointer the card stands, and from the window's edges.
const ASIDE: f32 = 16.0;
const MARGIN: f32 = 8.0;
/// Where it rests when nothing was pointed at: the window's top right.
const REST: (f32, f32) = (22.0, 78.0);
/// How far above the pointer the card starts, so the pointer is beside its
/// face rather than its top edge.
const ABOVE: f32 = 150.0;

/// The inks a card is drawn in. They are the theme's until a profile paints
/// its own card.
#[derive(Clone, Copy)]
struct Ink {
    surface: Hsla,
    text: Hsla,
    muted: Hsla,
    dim: Hsla,
    fill: Hsla,
    line: Hsla,
    accent: Hsla,
}

impl Ink {
    fn of(theme: &Theme) -> Self {
        Self {
            // The theme's card is a wash meant to sit on the window; this
            // one floats over whatever is behind it, so it is mixed down.
            surface: opaque(theme.c.card, theme.c.bg0),
            text: theme.c.text,
            muted: theme.c.muted,
            dim: theme.c.dim,
            fill: theme.c.card2,
            line: theme.c.line2,
            accent: theme.c.accent_text,
        }
    }
}

/// How light a colour is to the eye, from 0 to 1: its relative luminance.
fn luminance(color: Hsla) -> f32 {
    let rgb = gpui::Rgba::from(color);
    let linear = |part: f32| {
        if part <= 0.039_28 {
            part / 12.92
        } else {
            ((part + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/// How far apart two colours are to the eye: 1 for the same, 21 for black
/// on white.
fn contrast(a: Hsla, b: Hsla) -> f32 {
    let (light, dark) = {
        let (a, b) = (luminance(a), luminance(b));
        (a.max(b), a.min(b))
    };
    (light + 0.05) / (dark + 0.05)
}

/// `color` pulled towards `ink` until it reads on `ground`: still the
/// colour it was, no longer lost in the surface. A colour that reads is
/// left alone. The bar is what small bold text needs, and never more than
/// the ink itself manages there.
fn readable_on(color: Hsla, ground: Hsla, ink: Hsla) -> Hsla {
    const WANTED: f32 = 3.0;
    let wanted = WANTED.min(contrast(ink, ground) - 0.3);
    let mixed = |toward: f32| {
        let (from, to) = (gpui::Rgba::from(color), gpui::Rgba::from(ink));
        let part = |from: f32, to: f32| from + (to - from) * toward;
        Hsla::from(gpui::Rgba {
            r: part(from.r, to.r),
            g: part(from.g, to.g),
            b: part(from.b, to.b),
            a: 1.0,
        })
    };
    if contrast(color, ground) >= wanted {
        return color;
    }
    // The least of the ink that does it, to a twentieth.
    (1..=20_u8)
        .map(|step| mixed(f32::from(step) / 20.0))
        .find(|mixed| contrast(*mixed, ground) >= wanted)
        .unwrap_or(ink)
}

/// How somebody is, for the pill on the banner and the pip on the face.
struct Presence {
    says: SharedString,
    tone: Hsla,
    /// One word for what they are doing in voice.
    voice: &'static str,
}

impl Shell {
    /// Keep `session`'s card on screen, beside where it was asked for.
    pub(super) fn pin_card(
        &mut self,
        session: Session,
        at: Option<Point<Pixels>>,
        cx: &mut Context<Self>,
    ) {
        // Asked for again where it already is: put away.
        let shown = self.info.as_ref().is_some_and(|info| {
            info.hover.is_none() && !info.sheet && info.subject == Subject::User(session)
        });
        if shown {
            self.info = None;
            cx.notify();
            return;
        }
        self.show_about(Subject::User(session), cx);
        if let Some(info) = self.info.as_mut() {
            info.anchor = at;
        }
    }

    /// Play `session` at `volume` here, from nothing to twice as loud.
    pub(super) fn set_volume(&mut self, session: Session, volume: f32, cx: &mut Context<Self>) {
        let user = self.snapshot.users.iter().find(|u| u.session == session);
        let changed = self.volumes.set(user, session, volume);
        self.engine
            .act(crate::engine::Action::SetUserVolume { session, volume });
        if changed {
            self.remember_settings(cx);
        }
        cx.notify();
    }

    fn presence_of(&self, user: &User, theme: &Theme) -> Presence {
        let channel = self
            .snapshot
            .channels
            .iter()
            .find(|channel| channel.id == user.channel);
        let says = channel.map_or_else(
            || "Connected".into(),
            |channel| format!("In {}", channel.name).into(),
        );
        let talking = self.talking.contains(&user.session);
        let (tone, voice) = if user.deafened {
            (theme.c.bad, "deafened")
        } else if user.muted {
            (theme.c.bad, "muted")
        } else if talking {
            (theme.c.ok, "talking")
        } else {
            (theme.c.ok, "listening")
        };
        Presence { says, tone, voice }
    }
}

/// Where the card's top left goes: beside the pointer that asked, on
/// whichever side has room, or resting at the window's top right.
fn placed(at: Option<Point<Pixels>>, window: &Window) -> Point<Pixels> {
    let view = window.viewport_size();
    let Some(at) = at else {
        return gpui::point(view.width - px(REST.0 + WIDTH), px(REST.1));
    };
    let right = at.x + px(ASIDE);
    let x = if right + px(WIDTH + MARGIN) <= view.width {
        right
    } else {
        at.x - px(ASIDE + WIDTH)
    };
    gpui::point(x, at.y - px(ABOVE))
}

/// What only a server can put on a card, made up for the Profile page's
/// preview, as the web UI's `exampleContent` makes it up: the rows these
/// stand in for are drawn from them, and an empty one draws those rows not
/// at all.
#[derive(Debug, Clone, Default)]
pub(super) struct Filler {
    /// A glyph in a tone for each chip under the name.
    pub badges: Vec<(&'static str, Hsla)>,
    /// Each role's name, and its colour if it has one.
    pub roles: Vec<(SharedString, Option<Hsla>)>,
    /// What they are doing, and the line under it.
    pub activity: Option<(SharedString, SharedString)>,
    /// A value and what it counts, for each of the three numbers.
    pub stats: Vec<(SharedString, SharedString)>,
    /// What the pill on the banner says, in place of where they are.
    pub presence: Option<SharedString>,
}

/// Who a preview of a card is of, and what stands in for what only a
/// server says.
pub(super) struct Sample<'a> {
    /// Whose card it is.
    pub user: &'a User,
    /// In place of what a server says.
    pub filler: &'a Filler,
    /// The name the card shows.
    pub named: SharedString,
    /// What is said at its foot.
    pub footnote: SharedString,
}

/// The card of `sample`'s user from `info`, drawn where it is put rather
/// than over the window: the Profile page's preview of one's own card.
pub(super) fn preview(
    shell: &Shell,
    info: &Info,
    sample: Sample<'_>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Stateful<Div> {
    let footnote = sample.footnote.to_uppercase();
    let card = Card {
        shell,
        info,
        user: sample.user,
        theme,
        ink: Ink::of(theme),
        pinned: false,
        filler: Some(sample.filler),
        named: Some(sample.named),
    };
    let ink = card.ink;
    surface("card-preview", &card, cx).child(
        div()
            .px(px(20.0))
            .pb(px(16.0))
            .mt(px(-4.0))
            .text_center()
            .text_size(px(9.0))
            .line_height(px(15.3))
            .font_weight(EMPHASIS)
            .text_color(ink.dim)
            .child(footnote),
    )
}

/// The card's own surface, `id` to the tests: its banner and what is under
/// it.
fn surface(id: &'static str, card: &Card<'_>, cx: &mut Context<Shell>) -> gpui::Stateful<Div> {
    let ink = card.ink;
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .w(px(WIDTH))
        .rounded(px(22.0))
        .bg(ink.surface)
        .border_1()
        .border_color(ink.line)
        .shadow(card.theme.c.shadow.cast())
        .text_size(px(12.0))
        .text_color(ink.text)
        .flex()
        .flex_col()
        .child(card.banner(cx))
        .child(card.body(cx))
}

/// The card of the user `info` is about, or nothing once they have left.
pub(super) fn render(
    shell: &Shell,
    info: &Info,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> Option<AnyElement> {
    let Subject::User(session) = info.subject else {
        return None;
    };
    let user = shell.snapshot.users.iter().find(|u| u.session == session)?;
    let pinned = info.hover.is_none();
    let ink = Ink::of(theme);
    let card = Card {
        shell,
        info,
        user,
        theme,
        ink,
        pinned,
        filler: None,
        named: None,
    };
    let body = surface("card", &card, cx)
        // A card that is kept takes the presses on it, and is put away by
        // one that lands anywhere else, which still does what it was for.
        .when(pinned, |card| {
            card.occlude()
                .on_mouse_down_out(cx.listener(|shell, _, _, cx| {
                    shell.info = None;
                    cx.notify();
                }))
        });
    let at = placed(info.hover.or(info.anchor), window);
    Some(
        gpui::deferred(
            gpui::anchored()
                .position(at)
                .snap_to_window_with_margin(px(MARGIN))
                .child(body),
        )
        .with_priority(1)
        .into_any_element(),
    )
}

/// One card being drawn: whose, from what, and in which inks.
struct Card<'a> {
    shell: &'a Shell,
    info: &'a Info,
    user: &'a User,
    theme: &'a Theme,
    ink: Ink,
    pinned: bool,
    /// Made-up rows in place of the server's: on the Profile page's preview.
    filler: Option<&'a Filler>,
    /// The name the preview gives them, the web UI's "display name", in
    /// place of the one they have on the server.
    named: Option<SharedString>,
}

impl Card<'_> {
    /// Their name, as this card shows it.
    fn shown_name(&self) -> SharedString {
        self.named.clone().unwrap_or_else(|| self.user.name.clone())
    }

    /// The banner, with how they are on it and their face hanging from it.
    fn banner(&self, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
        let profile = self.info.profile.as_ref();
        let mut presence = self.shell.presence_of(self.user, self.theme);
        if let Some(says) = self.filler.and_then(|filler| filler.presence.clone()) {
            presence.says = says;
        }
        // The preview tints by the name it gives, as the web UI's does.
        let named = self.named.clone();
        let key = named
            .as_ref()
            .or(self.user.hash.as_ref())
            .unwrap_or(&self.user.name);
        let [from, mid, to] = user_tint(key);
        let pictured = self.info.banner.is_some();
        // Dark enough for white to read on: more so over a photograph.
        let chrome = gpui::hsla(0.0, 0.0, 0.0, if pictured { 0.45 } else { 0.32 });
        let fill = div()
            .h(px(BANNER))
            .rounded(px(16.0))
            .overflow_hidden()
            .map(|banner| {
                let rake = |angle, from, to| {
                    linear_gradient(
                        angle,
                        linear_color_stop(from, 0.0),
                        linear_color_stop(to, 1.0),
                    )
                };
                let set = profile.map(|profile| (profile.banner_rake, profile.banner_color));
                match set {
                    Some((Some((angle, from, to)), _)) => banner.bg(rake(angle, from, to)),
                    Some((None, Some(color))) => banner.bg(color),
                    // Nobody is left grey: a rake of colours hashed from who
                    // they are, the same on every screen that draws them.
                    _ => banner.bg(rake(150.0, from, to)),
                }
            })
            .when_some(self.info.banner.clone(), |banner, picture| {
                banner.child(
                    gpui::img(crate::pictures::shown(
                        &picture,
                        crate::pictures::Fit::Banner,
                    ))
                    .size_full()
                    .object_fit(gpui::ObjectFit::Cover),
                )
            });
        let pill = div()
            .absolute()
            .top(px(10.0))
            .left(px(10.0))
            .flex()
            .items_center()
            .gap(px(5.0))
            .px(px(10.0))
            .py(px(4.0))
            .rounded(px(20.0))
            .bg(chrome)
            .text_size(px(10.5))
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(gpui::white())
            .child(div().size(px(6.0)).rounded_full().bg(presence.tone))
            .child(presence.says);
        let close = self.pinned.then(|| {
            div().absolute().top(px(10.0)).right(px(10.0)).child(
                IconButton::new("card-close", "x")
                    .size(26.0)
                    .glyph_size(11.0)
                    .variant(Variant::Filled)
                    .corner(super::kit::Corner::Pill)
                    .tip("Close")
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.info = None;
                        cx.notify();
                    })),
            )
        });
        let face = div()
            .absolute()
            .left_0()
            .right_0()
            .top(px(BANNER - FACE - RING + HANG))
            .flex()
            .justify_center()
            .child(
                div().p(px(RING)).rounded_full().bg(self.ink.surface).child(
                    Avatar::new(&self.shown_name())
                        .picture(self.user.avatar.as_ref())
                        .size(FACE)
                        .round()
                        .filled(mid)
                        .status(Some(presence.tone)),
                ),
            );
        div()
            .relative()
            .m(px(8.0))
            .child(fill)
            .child(pill)
            .children(close)
            .child(face)
    }

    /// Everything under the banner, centred.
    fn body(&self, cx: &mut Context<Shell>) -> Div {
        let profile = self.info.profile.as_ref();
        let ink = self.ink;
        // A row its owner switched off is not drawn.
        let hidden = profile.map(|profile| profile.hidden).unwrap_or_default();
        let identity: Vec<&str> = profile
            .into_iter()
            .filter(|_| !hidden.identity)
            .flat_map(|profile| [profile.pronouns.as_deref(), profile.contact.as_deref()])
            .flatten()
            .collect();
        let status = profile
            .filter(|_| !hidden.status)
            .and_then(|profile| profile.status.as_deref())
            .map(crate::rich::Rich::parse);
        div()
            .pt(px(HANG + 10.0))
            .px(px(20.0))
            .pb(px(18.0))
            .flex()
            .flex_col()
            .items_center()
            .text_center()
            .child(self.name())
            .children(self.badges())
            .when(!identity.is_empty(), |body| {
                body.child(
                    div()
                        .debug_selector(|| "profile-line".to_owned())
                        .mt(px(8.0))
                        .text_size(px(11.5))
                        .text_color(ink.muted)
                        .child(identity.join(" · ")),
                )
            })
            .when_some(status, |body, status| {
                // What they are doing, as they set it: markup and all.
                body.child(
                    div()
                        .debug_selector(|| "card-status".to_owned())
                        .mt(px(7.0))
                        .italic()
                        .children(super::conversation::words(
                            &status,
                            Place::aside(usize::MAX - 3),
                            None,
                            ink.accent,
                            self.theme,
                        )),
                )
            })
            .children(self.about(cx).filter(|_| !hidden.bio))
            .children(
                self.older_line()
                    .filter(|_| !hidden.bio && self.filler.is_none()),
            )
            .children(self.about_actions(cx))
            .children(self.roles().filter(|_| !hidden.roles))
            .children(self.activity().filter(|_| !hidden.activity))
            .children(self.stats().filter(|_| !hidden.stats))
            .child(self.volume(cx))
            .child(self.message(cx))
    }

    /// Their name, as their profile sets it, with a tick if they have an
    /// account here.
    fn name(&self) -> impl IntoElement + use<> {
        let profile = self.info.profile.as_ref();
        div()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(6.0))
            .child(
                div()
                    .debug_selector(|| "card-name".to_owned())
                    .text_size(px(17.0))
                    .font_weight(if profile.is_some_and(|profile| !profile.name_bold) {
                        EMPHASIS
                    } else {
                        gpui::FontWeight::BOLD
                    })
                    .when(profile.is_some_and(|profile| profile.name_italic), |name| {
                        name.italic()
                    })
                    .when_some(self.info.name_family.clone(), |name, family| {
                        name.font_family(family)
                    })
                    // The colour they chose, held to what reads on the card.
                    .text_color(
                        profile
                            .and_then(|profile| profile.name_color)
                            .map_or(self.ink.text, |chosen| {
                                readable_on(chosen, self.ink.surface, self.ink.text)
                            }),
                    )
                    .child(self.shown_name()),
            )
            .when(self.user.account.is_some(), |row| {
                row.child(
                    div()
                        .debug_selector(|| "card-verified".to_owned())
                        .flex_none()
                        .size(px(16.0))
                        .rounded_full()
                        .bg(self.ink.accent)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(icon("check", 9.0, gpui::white())),
                )
            })
    }

    /// What can be said of them at a glance, as the web card's strip says
    /// it: a letter for each role they hold, in the role's colour; then
    /// heard over everybody, muted, deafened. Nothing for somebody plain.
    fn badges(&self) -> Option<impl IntoElement + use<>> {
        let (warn, bad) = (self.theme.c.warn, self.theme.c.bad);
        let chip = |tone: Hsla| {
            div()
                .size(px(20.0))
                .flex_none()
                .rounded(px(6.0))
                .bg(Hsla { a: 0.18, ..tone })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .font_weight(EMPHASIS)
                .text_color(tone)
        };
        if let Some(filler) = self.filler {
            let chips: Vec<_> = filler
                .badges
                .iter()
                .map(|(glyph, tone)| chip(*tone).child(icon(glyph, 10.0, *tone)))
                .collect();
            return (!chips.is_empty()).then(|| {
                div()
                    .debug_selector(|| "card-badges".to_owned())
                    .mt(px(7.0))
                    .flex()
                    .justify_center()
                    .gap(px(5.0))
                    .children(chips)
            });
        }
        let roles = self.shell.roles_of(self.user).map(|role| {
            let tone = role.color.map_or(self.ink.accent, |color| {
                readable_on(color, self.ink.surface, self.ink.text)
            });
            let letter: String = role
                .name
                .chars()
                .take(1)
                .flat_map(char::to_uppercase)
                .collect();
            chip(tone).child(letter)
        });
        let held = [
            (self.user.priority, "star", warn),
            (self.user.muted, "mic-off", bad),
            (self.user.deafened, "headphone-off", bad),
        ];
        let states = held
            .into_iter()
            .filter(|(held, ..)| *held)
            .map(|(_, glyph, tone)| chip(tone).child(icon(glyph, 10.0, tone)));
        let chips: Vec<_> = roles.chain(states).collect();
        (!chips.is_empty()).then(|| {
            div()
                .debug_selector(|| "card-badges".to_owned())
                .mt(px(7.0))
                .flex()
                .justify_center()
                .gap(px(5.0))
                .children(chips)
        })
    }

    /// What they wrote about themselves, in a room of its own that scrolls
    /// and fades where there is more: its blocks, or for a profile of the
    /// older format only its basic words. Nothing in it is fetched.
    fn about(&self, cx: &mut Context<Shell>) -> Option<AnyElement> {
        let written = &self.info.written;
        let viewer = cx.entity().downgrade();
        let area = Faded::new("card-about", &written.scroll, BIO_ROOM, self.ink.surface)
            .mt(px(7.0))
            .gap(px(4.0))
            .text_size(px(12.0))
            .line_height(px(18.0))
            .text_color(self.ink.muted);
        let area = match &written.said {
            Said::Nothing => return None,
            Said::About(shown) => {
                let drawing = Drawing {
                    name: "card-about",
                    room: WIDTH - 40.0,
                    ink: self.ink.muted,
                    link: self.ink.accent,
                    line: self.ink.line,
                    theme: self.theme,
                    viewer: &viewer,
                };
                area.children(about_view::blocks(shown, drawing, cx))
            }
            Said::Older { words, .. } => area.children(words_as(
                ("card-older", 0_usize),
                words,
                (None, Some(&viewer)),
                self.ink.accent,
                self.theme,
            )),
        };
        Some(area.into_any_element())
    }

    /// The quiet line under a profile of the older format.
    fn older_line(&self) -> Option<impl IntoElement + use<>> {
        self.info.written.said.is_older().then(|| {
            div()
                .debug_selector(|| "card-older-format".to_owned())
                .mt(px(6.0))
                .text_size(px(10.5))
                .italic()
                .text_color(self.ink.dim)
                .child(t!(
                    "This profile uses the older format: only its words are shown."
                ))
        })
    }

    /// What can be done from here with what they wrote: convert one's own
    /// profile of the older format, and open the full profile where there
    /// is one and the server keeps files.
    fn about_actions(&self, cx: &mut Context<Shell>) -> Option<impl IntoElement + use<>> {
        let own = self.shell.snapshot.own_session == Some(self.user.session);
        let convert = (own && self.pinned && self.info.written.said.is_older()).then(|| {
            Button::new("card-convert", t!("Convert to the new format…"))
                .size(Size::Small)
                .on_click(cx.listener(|shell, _, _, cx| shell.open_about_editor(cx)))
        });
        let session = self.user.session;
        let page = self
            .info
            .written
            .page
            .clone()
            .filter(|_| self.pinned && self.shell.snapshot.fancy);
        let full = page.map(|page| {
            Button::new("card-full-profile", t!("View full profile"))
                .size(Size::Small)
                .start_icon("info")
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.open_full_profile(session, page.clone(), cx);
                }))
        });
        (convert.is_some() || full.is_some()).then(|| {
            div()
                .mt(px(6.0))
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(6.0))
                .children(convert)
                .children(full)
        })
    }

    /// Every role they hold, each in its own colour.
    fn roles(&self) -> Option<impl IntoElement + use<>> {
        let ink = self.ink;
        let held: Vec<(SharedString, Option<Hsla>)> = match self.filler {
            Some(filler) => filler.roles.clone(),
            None => self
                .shell
                .roles_of(self.user)
                .map(|role| (role.name.clone(), role.color))
                .collect(),
        };
        let chips: Vec<_> = held
            .into_iter()
            .map(|(name, color)| {
                let (text, fill, edge) = match color {
                    Some(color) => (color, Hsla { a: 0.18, ..color }, Hsla { a: 0.4, ..color }),
                    None => (ink.text, ink.fill, ink.line),
                };
                div()
                    .px(px(12.0))
                    .py(px(4.0))
                    .rounded(px(20.0))
                    .bg(fill)
                    .border_1()
                    .border_color(edge)
                    .text_size(px(10.5))
                    .font_weight(EMPHASIS)
                    .text_color(text)
                    .child(name)
            })
            .collect();
        (!chips.is_empty()).then(|| {
            div()
                .debug_selector(|| "card-roles".to_owned())
                .mt(px(10.0))
                .flex()
                .flex_wrap()
                .justify_center()
                .gap(px(7.0))
                .children(chips)
        })
    }

    /// Where they are and what they are doing there.
    fn activity(&self) -> Option<Div> {
        if let Some(filler) = self.filler {
            return filler
                .activity
                .clone()
                .map(|(title, detail)| self.activity_row(title, detail, "zap"));
        }
        let presence = self.shell.presence_of(self.user, self.theme);
        let channel = self
            .shell
            .snapshot
            .channels
            .iter()
            .find(|channel| channel.id == self.user.channel);
        let title = channel.map_or_else(
            || SharedString::from("Connected"),
            |channel| format!("In voice — {}", channel.name).into(),
        );
        let online = self.fact("Connected for");
        let detail = online.map_or_else(
            || SharedString::from(presence.voice),
            |online| format!("{online} · {}", presence.voice).into(),
        );
        Some(self.activity_row(title, detail, "volume-2"))
    }

    /// One line of what they are doing, `glyph` on the tile beside it.
    fn activity_row(&self, title: SharedString, detail: SharedString, glyph: &'static str) -> Div {
        let ink = self.ink;
        div()
            .debug_selector(|| "card-activity".to_owned())
            .mt(px(12.0))
            .w_full()
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .py(px(10.0))
            .rounded(px(12.0))
            .bg(ink.fill)
            .text_left()
            .child(
                div()
                    .flex_none()
                    .size(px(34.0))
                    .rounded(px(8.0))
                    .bg(ink.line)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon(glyph, 16.0, ink.dim)),
            )
            .child(
                div()
                    .min_w_0()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(11.5))
                            .font_weight(EMPHASIS)
                            .child(title),
                    )
                    .child(div().text_size(px(10.5)).text_color(ink.dim).child(detail)),
            )
    }

    /// What the server said of them under `name`, if it has.
    fn fact(&self, name: &str) -> Option<SharedString> {
        self.info
            .facts
            .iter()
            .find(|(fact, _)| fact.as_ref() == name)
            .map(|(_, value)| value.clone())
    }

    /// Three numbers in a row: what they have said here, how long they
    /// have been on, and whether they have an account.
    fn stats(&self) -> Option<Div> {
        if let Some(filler) = self.filler {
            return (!filler.stats.is_empty()).then(|| self.stats_row(filler.stats.clone()));
        }
        let said = self
            .shell
            .messages
            .iter()
            .filter(|message| message.sender == Some(self.user.session))
            .count();
        let (account, standing) = match self.user.account {
            Some(id) => (format!("#{id}"), "Registered"),
            None => ("Guest".to_owned(), "Account"),
        };
        let mut columns = vec![(said.to_string(), "Messages")];
        if let Some(online) = self.fact("Connected for") {
            columns.push((online.to_string(), "In voice"));
        }
        columns.push((account, standing));
        let columns = columns
            .into_iter()
            .map(|(value, says)| (SharedString::from(value), SharedString::from(says)))
            .collect();
        Some(self.stats_row(columns))
    }

    /// The numbers, each over what it counts, side by side.
    fn stats_row(&self, columns: Vec<(SharedString, SharedString)>) -> Div {
        let ink = self.ink;
        div()
            .debug_selector(|| "card-stats".to_owned())
            .mt(px(14.0))
            .w_full()
            .flex()
            .children(columns.into_iter().enumerate().map(|(at, (value, says))| {
                div()
                    .flex_1()
                    .min_w_0()
                    .when(at > 0, |column| column.border_l_1().border_color(ink.line))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(15.0))
                            .font_weight(gpui::FontWeight::BOLD)
                            .child(value),
                    )
                    .child(
                        div()
                            .mt(px(2.0))
                            .text_size(px(10.5))
                            .text_color(ink.muted)
                            .child(says),
                    )
            }))
    }

    /// How loud they are played here, on a bar: nothing to twice as loud.
    fn volume(&self, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
        let session = self.user.session;
        let volume = self.shell.volumes.get(&session).copied().unwrap_or(1.0);
        div()
            .mt(px(16.0))
            .w_full()
            .flex()
            .items_center()
            .gap(px(9.0))
            .child(
                div()
                    .text_size(px(10.0))
                    .font_weight(EMPHASIS)
                    .text_color(self.ink.dim)
                    .child("VOL"),
            )
            .child(Slider::new("card-volume", volume / 2.0).on_change(
                cx.listener(move |shell, at: &f32, _, cx| shell.set_volume(session, at * 2.0, cx)),
            ))
    }

    /// The line to them as the preview draws it, which only shows: the
    /// web UI's pill with its send button, and beside it the way to the
    /// page the preview is already on.
    fn message_pill(&self) -> Div {
        let ink = self.ink;
        div()
            .mt(px(14.0))
            .w_full()
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h(px(38.0))
                    .pl(px(15.0))
                    .pr(px(6.0))
                    .rounded_full()
                    .bg(ink.fill)
                    .border_1()
                    .border_color(ink.line)
                    .flex()
                    .items_center()
                    .text_left()
                    .text_size(px(11.5))
                    .text_color(ink.dim)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(t!("Message @{{name}}", name = self.shown_name())),
                    )
                    .child(
                        div()
                            .flex_none()
                            .size(px(26.0))
                            .rounded_full()
                            .bg(ink.accent)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(icon("send", 11.0, gpui::white())),
                    ),
            )
            .child(
                div()
                    .flex_none()
                    .size(px(38.0))
                    .rounded_full()
                    .border_1()
                    .border_color(ink.line)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon("pencil", 13.0, ink.muted)),
            )
    }

    /// A line to them, and beside it the switch that silences them here.
    fn message(&self, cx: &mut Context<Shell>) -> Div {
        let session = self.user.session;
        let silenced = self.shell.volumes.get(&session).is_some_and(|v| *v <= 0.0);
        let own = self.shell.snapshot.own_session == Some(session);
        if self.filler.is_some() {
            return self.message_pill();
        }
        div()
            .mt(px(14.0))
            .w_full()
            .flex()
            .items_center()
            .gap(px(8.0))
            .when(!own, |row| {
                row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h(px(34.0))
                        .px(px(12.0))
                        .rounded(px(17.0))
                        .bg(self.ink.fill)
                        .border_1()
                        .border_color(self.ink.line)
                        .flex()
                        .items_center()
                        .text_left()
                        .child(self.shell.card_line.clone()),
                )
                .child(
                    IconButton::new("card-silence", "mic-off")
                        .size(34.0)
                        .glyph_size(15.0)
                        .tone(if silenced {
                            super::kit::Tone::Danger
                        } else {
                            super::kit::Tone::Muted
                        })
                        .variant(if silenced {
                            Variant::Soft
                        } else {
                            Variant::Filled
                        })
                        .corner(super::kit::Corner::Pill)
                        .tip(if silenced {
                            "Unmute locally"
                        } else {
                            "Mute locally"
                        })
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            let volume = if silenced { 1.0 } else { 0.0 };
                            shell.set_volume(session, volume, cx);
                        })),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_lost_in_the_card_is_pulled_towards_the_ink_until_it_reads() {
        let (ground, ink) = (gpui::black(), gpui::white());
        let navy = Hsla::from(gpui::rgb(0x00_0040));
        assert!(contrast(navy, ground) < 3.0, "lost on black");
        let pulled = readable_on(navy, ground, ink);
        assert!(contrast(pulled, ground) >= 2.99);
        assert!(
            gpui::Rgba::from(pulled).b > gpui::Rgba::from(pulled).r,
            "still blue"
        );
        // One that reads is left as it was.
        let gold = Hsla::from(gpui::rgb(0xff_d7_00));
        assert_eq!(readable_on(gold, ground, ink), gold);
        assert!((contrast(gpui::black(), gpui::white()) - 21.0).abs() < 0.1);
    }
}
