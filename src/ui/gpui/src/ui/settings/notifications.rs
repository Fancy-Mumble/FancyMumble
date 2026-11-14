//! The Notifications page, as the web UI's: whether sounds are played at
//! all, whether the system's notifications are shown, when the server's
//! welcome message is, and for each happening whether it is heard and, for
//! an expert, which sound it plays and how loud.


use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, px};

use super::super::Shell;
use super::super::kit::{
    Button, Card, Emphasis, Field, GroupTitle, IconButton, Look, PageTitle, Select, Size, Slider,
    SliderRow, SwitchRow, rule,
};
use crate::sounds::{Chosen, Event, SOUNDS};
use crate::store::WelcomeDisplay;
use crate::words::t;

impl Shell {
    /// Show the system's notifications, or none.
    fn set_notifications(&mut self, shown: bool, cx: &mut Context<Self>) {
        self.panels.settings.notifications = shown;
        crate::notify::allow(shown && !self.panels.settings.streamer);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Show the server's welcome message as `display` says.
    fn set_welcome_display(&mut self, display: WelcomeDisplay, cx: &mut Context<Self>) {
        self.panels.settings.welcome_display = display;
        self.remember_settings(cx);
        cx.notify();
    }

    /// The server on screen, as a closed welcome is remembered by: its
    /// address, which is the same at the next launch.
    fn welcome_address(&self) -> String {
        self.snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.key.to_string())
            .unwrap_or_default()
    }

    /// Whether the welcome message of `fingerprint` is to be shown at all.
    pub(in crate::ui) fn welcome_wanted(&self, fingerprint: u64) -> bool {
        match self.panels.settings.welcome_display {
            WelcomeDisplay::Hide => false,
            WelcomeDisplay::Always => true,
            WelcomeDisplay::Once => !self
                .panels
                .settings
                .welcome_seen
                .has(&self.welcome_address(), fingerprint),
        }
    }

    /// Whether it is shown at every connection, though seen before.
    pub(in crate::ui) fn welcome_always(&self) -> bool {
        self.panels.settings.welcome_display == WelcomeDisplay::Always
    }

    /// The welcome message of `fingerprint` was closed: once is enough,
    /// at the next launch too.
    pub(in crate::ui) fn welcome_closed(&mut self, fingerprint: u64, cx: &mut Context<Self>) {
        let address = self.welcome_address();
        self.panels
            .settings
            .welcome_seen
            .note(&address, fingerprint);
        self.remember_settings(cx);
    }

    /// Turn sounds on or off altogether.
    fn set_sounds(&mut self, on: bool, cx: &mut Context<Self>) {
        self.panels.settings.sounds.on = on;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Change what `event` plays.
    fn change_sound(
        &mut self,
        event: Event,
        change: impl FnOnce(Chosen) -> Chosen,
        cx: &mut Context<Self>,
    ) {
        self.panels.settings.sounds.change(event, change);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Have every happening heard, or none.
    fn hear_all(&mut self, heard: bool, cx: &mut Context<Self>) {
        for event in Event::ALL {
            self.panels.settings.sounds.change(event, |chosen| Chosen {
                enabled: heard,
                ..chosen
            });
        }
        self.remember_settings(cx);
        cx.notify();
    }

    /// Play what `event` plays, whether or not sounds are on: what the
    /// button beside its sound is for.
    fn try_sound(&self, event: Event) {
        let chosen = self.panels.settings.sounds.of(event);
        if let Some(sound) = chosen.sound() {
            crate::sounds::play(sound, chosen.volume.clamp(0.0, 1.0));
        }
    }
}

/// What a happening is called and what it means, in the web UI's words,
/// and what the tests call its switch, its sound and its bar.
fn wording(event: Event) -> (SharedString, SharedString, [&'static str; 4]) {
    let (name, hint) = match event {
        Event::Message => (
            t!("Chat message"),
            t!("A new message in a channel you are viewing"),
        ),
        Event::Direct => (t!("Direct message"), t!("A new private or group message")),
        Event::Mention => (
            t!("Mention"),
            t!("Someone mentioned you with @, @everyone, @here, or your role"),
        ),
        Event::Arrived => (
            t!("User joined server"),
            t!("Someone connected to the server"),
        ),
        Event::Left => (
            t!("User left server"),
            t!("Someone disconnected from the server"),
        ),
        Event::Joined => (
            t!("User joined my channel"),
            t!("Someone moved into your current channel"),
        ),
        Event::Parted => (
            t!("User left my channel"),
            t!("Someone moved out of your current channel"),
        ),
        Event::StreamStart => (
            t!("Screen share started"),
            t!("A user started sharing their screen"),
        ),
        Event::Talking => (
            t!("Voice activity"),
            t!("Someone started speaking in your channel"),
        ),
        Event::Muted => (t!("Self muted"), t!("You muted or unmuted your microphone")),
    };
    (name, hint, named(event))
}

/// What the tests call the switch, the sound, the bar and the button that
/// plays it.
macro_rules! named {
    ($($event:ident: $name:literal,)*) => {
        const fn named(event: Event) -> [&'static str; 4] {
            match event {
                $(Event::$event => [
                    concat!("sound-", $name),
                    concat!("sound-", $name, "-sound"),
                    concat!("sound-", $name, "-loud"),
                    concat!("sound-", $name, "-try"),
                ],)*
            }
        }
    };
}

named! {
    Message: "message",
    Direct: "direct",
    Mention: "mention",
    Arrived: "arrived",
    Left: "left",
    Joined: "joined",
    Parted: "parted",
    StreamStart: "stream-start",
    Talking: "talking",
    Muted: "muted",
}

/// What a sound is called, in the web UI's words.
fn sound_name(id: &str) -> SharedString {
    match id {
        "dragon-3" => t!("Chime"),
        "univ-033" => t!("Bubble"),
        "univ-036" => t!("Pop"),
        "univ-040" => t!("Ding"),
        "univ-051" => t!("Ping"),
        "univ-057" => t!("Drop"),
        "univ-09" => t!("Bell"),
        _ => t!("None"),
    }
}

/// The page.
pub(super) fn render(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let sounds = &shell.panels.settings.sounds;
    let on = sounds.on;
    let sounds_lit = shell.panels.settings.lit.lights(&t!("Notification sounds"));
    let page = div()
        .child(PageTitle::new(t!("Notifications")))
        .child(
            SwitchRow::new("sounds-on", t!("Notification sounds"), on)
                .look(Look::Setting)
                .lit(sounds_lit)
                .hint(t!(
                    "Play a sound when events occur. Individual events can be configured below."
                ))
                .on_click(cx.listener(move |shell, _, _, cx| shell.set_sounds(!on, cx))),
        )
        .child(told(shell, cx));
    if !on {
        // As the web UI says it again under a page with nothing below.
        let muted = crate::theme::ActiveTheme::get(cx).c.muted;
        return page.child(
            div()
                .mt(px(6.0))
                .text_size(px(11.5))
                .text_color(muted)
                .child(t!(
                    "Play a sound when events occur. Individual events can be configured below."
                )),
        );
    }
    let every = Event::ALL.iter().all(|event| sounds.of(*event).enabled);
    let none = Event::ALL.iter().all(|event| !sounds.of(*event).enabled);
    page.child(rule(cx))
        .child(
            div()
                .mb(px(6.0))
                .flex()
                .items_center()
                .justify_between()
                .child(GroupTitle::new(t!("Notifications")))
                .child(
                    div()
                        .flex()
                        .gap(px(6.0))
                        .child(all_button("sounds-all", t!("Enable all"), true, every, cx))
                        .child(all_button(
                            "sounds-none",
                            t!("Disable all"),
                            false,
                            none,
                            cx,
                        )),
                ),
        )
        .children(Event::ALL.map(|event| row(shell, event, cx)))
}

/// The button that has every happening heard, or none; drawn faint where
/// that is how they already are.
fn all_button(
    id: &'static str,
    says: SharedString,
    heard: bool,
    already: bool,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let button = Button::new(id, says)
        .emphasis(Emphasis::Outlined)
        .size(Size::Compact);
    if already {
        return div().opacity(0.4).child(button);
    }
    div().child(button.on_click(cx.listener(move |shell, _, _, cx| shell.hear_all(heard, cx))))
}

/// One happening: whether it is heard, and while it is, as what and how
/// loud, with the way to hear it now.
fn row(shell: &Shell, event: Event, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let chosen = shell.panels.settings.sounds.of(event);
    let (name, hint, [switch, sound, loud, try_it]) = wording(event);
    let heard = SwitchRow::new(switch, name.clone(), chosen.enabled)
        .look(Look::Setting)
        .hint(hint)
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.change_sound(
                event,
                |chosen| Chosen {
                    enabled: !chosen.enabled,
                    ..chosen
                },
                cx,
            );
        }));
    // Which sound and how loud is an expert's to choose, as in the web
    // UI; anybody else hears each happening's own.
    if !chosen.enabled || !shell.panels.settings.user_mode.expert() {
        return heard;
    }
    let ids: Vec<&'static str> = std::iter::once("none")
        .chain(SOUNDS.iter().map(|sound| sound.id))
        .collect();
    let at = ids.iter().position(|id| *id == chosen.sound).unwrap_or(0);
    let names = ids.iter().map(|id| sound_name(id)).collect();
    let picker =
        Select::new(sound, names, at).on_choose(cx.listener(move |shell, at: &usize, _, cx| {
            if let Some(id) = ids.get(*at) {
                let id = (*id).to_owned();
                shell.change_sound(
                    event,
                    |chosen| Chosen {
                        sound: id,
                        ..chosen
                    },
                    cx,
                );
            }
        }));
    let volume = chosen.volume;
    let card = Card::new()
        .mt(px(8.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(div().flex_1().min_w_0().child(picker))
                .child(
                    IconButton::new(try_it, "play")
                        .size(26.0)
                        .glyph_size(15.0)
                        .tip(t!("Preview sound"))
                        .faded(chosen.sound().is_none())
                        .on_click(cx.listener(move |shell, _, _, _| shell.try_sound(event))),
                ),
        )
        .child(div().mt(px(10.0)).flex().child(SliderRow::new(
            t!("Volume"),
            t!("{{value}}%", value = (volume * 100.0).round()),
            Slider::new(loud, volume).on_change(cx.listener(move |shell, at: &f32, _, cx| {
                // In twentieths, as the web UI's bar steps.
                let volume = (*at * 20.0).round() / 20.0;
                shell.change_sound(event, |chosen| Chosen { volume, ..chosen }, cx);
            })),
        )));
    heard.under(card)
}

/// The system's notifications, and when the server's welcome is shown.
fn told(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let settings = &shell.panels.settings;
    let shown = settings.notifications;
    let native = t!("Native notifications");
    let welcome = t!("Welcome message");
    let display = WelcomeDisplay::ALL
        .iter()
        .position(|known| *known == settings.welcome_display)
        .unwrap_or(1);
    let muted = crate::theme::ActiveTheme::get(cx).c.muted;
    div()
        .child(
            SwitchRow::new("native-notifications", native.clone(), shown)
                .look(Look::Setting)
                .lit(settings.lit.lights(&native))
                .hint(t!(
                    "Show native OS notifications for new messages when the app is in the background."
                ))
                .on_click(cx.listener(move |shell, _, _, cx| shell.set_notifications(!shown, cx))),
        )
        .child(
            div().mb(px(14.0)).child(
                Field::new(
                    welcome.clone(),
                    div()
                        .child(
                            div()
                                .mt(px(-3.0))
                                .mb(px(7.0))
                                .text_size(px(11.5))
                                .text_color(muted)
                                .child(t!(
                                    "Show the server's welcome message in a popup after connecting."
                                )),
                        )
                        .child(
                            Select::new(
                                "welcome-display",
                                vec![t!("Hide"), t!("Show once"), t!("Always show")],
                                display,
                            )
                            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                                if let Some(display) = WelcomeDisplay::ALL.get(*at) {
                                    shell.set_welcome_display(*display, cx);
                                }
                            })),
                        ),
                )
                .lit(settings.lit.lights(&welcome)),
            ),
        )
}
