//! The Profile page: what others see of the user on their card, changed
//! here and sent to the server in the profile the user's comment carries.
//!
//! As the web UI's page (`ProfileSettings`, `ProfilePreview`): the display
//! name a server is first joined under, the words of the card (pronouns,
//! contact, a status that takes bold, italic and underline), what the user
//! says about themselves, the picture and the banner, the card's style in
//! rows that open one at a time, which rows of the card show, and beside it
//! all the card itself, drawn in place and changed as the page is. What is
//! typed goes out once typing has paused, as the web UI's page sends it; a
//! choice goes out at once.
//!
//! Left out, with nothing behind them in this client: choosing the identity
//! whose profile is changed (a profile here is the one the server holds for
//! the identity connected), the avatar frame, sticker, nameplate and
//! profile effect, the cropper, and a colour for words of the status.

mod page;
mod style;

use std::sync::Arc;
use std::time::Duration;

use gpui::{AppContext as _, Context, Entity, SharedString, Subscription};
use serde_json::{Map, Value};

use super::super::Shell;
use super::super::text_input::{InputEvent, ReadsMarks, TextInput};
use crate::engine::{Action, Connection, Engine, Subject};
use crate::words::t;

pub(super) use page::render;

/// How long typing has to pause before what was typed is sent: the web
/// UI's `APPLY_DEBOUNCE_MS`.
const SETTLED: Duration = Duration::from_millis(800);

/// One of the card's style rows, which open one at a time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Row {
    Colours,
    Name,
}

/// A text field of the page, and what it writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Typed {
    Pronouns,
    Contact,
    Status,
    /// The card's background of the user's own, as CSS.
    Background,
    /// The name a new server is first joined under: kept here, not sent.
    Name,
}

impl Typed {
    const ALL: [Self; 5] = [
        Self::Pronouns,
        Self::Contact,
        Self::Status,
        Self::Background,
        Self::Name,
    ];

    /// The profile's key for it; the display name is not the profile's.
    const fn key(self) -> Option<&'static str> {
        match self {
            Self::Pronouns => Some("pronouns"),
            Self::Contact => Some("contact"),
            Self::Status => Some("status"),
            Self::Background => Some("cardBackgroundCustom"),
            Self::Name => None,
        }
    }
}

/// The page's state while it is open: its fields, the profile as last
/// read and changed here, which style row is open, and the card its
/// preview draws.
pub(in crate::ui) struct Form {
    fields: [Entity<TextInput>; 5],
    _watch: Vec<Subscription>,
    /// The profile as the server last gave it, with what was changed here
    /// since merged into it.
    pub held: Value,
    /// The banner's picture, read once from the profile.
    pub banner: Option<Arc<gpui::Image>>,
    /// Whether the profile has been asked for and has not come yet: when
    /// it comes, the fields are filled from it.
    waiting: bool,
    /// Bumped at each change typed, so that only the last one sends.
    typed: u32,
    pub open: Option<Row>,
    /// Whether the preview fills the rows only a server can fill with
    /// examples: the web UI's "Fill with example content", on at first.
    pub examples: bool,
    /// The user's own card as the page would leave it, for the preview.
    pub(in crate::ui) card: super::super::Info,
    /// The family the name's face was last found in, by face: asked of the
    /// system only when the face changes.
    family: Option<(crate::profile::Face, SharedString)>,
}

impl Form {
    /// The page's text fields: pronouns, contact, status, background,
    /// display name.
    #[cfg(test)]
    pub(in crate::ui) fn fields(&self) -> &[Entity<TextInput>; 5] {
        &self.fields
    }

    /// The field for `typed`.
    pub(super) fn field(&self, typed: Typed) -> &Entity<TextInput> {
        &self.fields[typed as usize]
    }

    /// What the profile says under `key`, as text.
    pub(super) fn text(&self, key: &str) -> Option<&str> {
        self.held.get(key).and_then(Value::as_str)
    }

    /// What `typed`'s field says now, as the profile would hold it: the
    /// status as HTML, and nothing for an empty field.
    fn said(&self, typed: Typed, engine: &dyn Engine, cx: &gpui::App) -> Option<String> {
        let text = self.field(typed).read(cx).text().trim().to_owned();
        if text.is_empty() {
            return None;
        }
        Some(match typed {
            Typed::Status => crate::profile_fields::marked_html(&text, &engine.typed(&text)),
            _ => text,
        })
    }
}

impl Shell {
    /// Whether a GIF can be chosen for a picture of one's own: a server
    /// searches for them, or the user has a key of their own.
    pub(super) fn offers_gif_pictures(&self) -> bool {
        let service = self.engine.gif_service();
        crate::gif::Plan::of(
            service.as_ref(),
            self.panels.gifs.key.as_deref(),
            Arc::clone(&self.panels.gifs.fetch),
        )
        .is_some()
    }

    /// Make the page's fields, if they are not made, and ask the server
    /// for the profile they show.
    pub(super) fn open_profile(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.profile.is_none() {
            let engine = Arc::clone(&self.engine);
            let reads: ReadsMarks = std::rc::Rc::new(move |text: &str| engine.typed(text));
            let make = |placeholder, cx: &mut Context<Self>| cx.new(|cx| TextInput::new(placeholder, cx));
            let status = cx.new(|cx| TextInput::new(t!("have a nice day ✌"), cx).setting_marks(reads));
            let name = self.panels.settings.display_name.clone().unwrap_or_default();
            let fields = [
                make(t!("she/her"), cx),
                make(t!("you@example.com"), cx),
                status,
                make("linear-gradient(160deg,#2b2420,#211c24)".into(), cx),
                cx.new(|cx| {
                    let mut field = TextInput::new(SharedString::default(), cx);
                    field.set_text(name);
                    field
                }),
            ];
            let watch = fields
                .iter()
                .map(|field| {
                    cx.subscribe(field, move |shell, _, event: &InputEvent, cx| {
                        shell.on_profile_typed(event, cx);
                    })
                })
                .collect();
            self.panels.settings.profile = Some(Form {
                fields,
                _watch: watch,
                held: Value::Object(Map::new()),
                banner: None,
                waiting: false,
                typed: 0,
                open: Some(Row::Colours),
                examples: true,
                card: own_card(self.snapshot.own_session),
                family: None,
            });
        }
        self.ask_own_profile();
    }

    /// Ask the server what the user's own comment says, for the page.
    fn ask_own_profile(&mut self) {
        let Some(own) = self.snapshot.own_session else {
            return;
        };
        if let Some(form) = self.panels.settings.profile.as_mut() {
            form.waiting = true;
        }
        self.engine.about(Subject::User(own));
    }

    /// What somebody's comment says arrived: if it is the user's own and
    /// the page asked for it, it is what the page shows.
    pub(in crate::ui) fn hear_own_profile(&mut self, subject: Subject, html: Option<&str>, cx: &mut Context<Self>) {
        if self.snapshot.own_session.map(Subject::User) != Some(subject) {
            return;
        }
        let engine = Arc::clone(&self.engine);
        let Some(form) = self.panels.settings.profile.as_mut().filter(|form| form.waiting) else {
            return;
        };
        form.waiting = false;
        form.held = html
            .and_then(crate::profile_fields::held)
            .unwrap_or_else(|| Value::Object(Map::new()));
        form.banner = form
            .held
            .pointer("/banner/image")
            .and_then(Value::as_str)
            .and_then(crate::rich::embedded_picture)
            .and_then(crate::picture::picture)
            .map(Arc::new);
        // What the card says of them: read once, as an open card reads it.
        form.card = own_card(self.snapshot.own_session);
        if let Some(html) = html {
            super::super::card::read_comment(&mut form.card, html);
        }
        for typed in Typed::ALL {
            let Some(key) = typed.key() else {
                continue;
            };
            let held = form.text(key).unwrap_or_default();
            let said = match typed {
                // Typed as the composer types it: marks for the tags.
                Typed::Status if !held.is_empty() => engine.source(held),
                _ => held.to_owned(),
            };
            form.field(typed).update(cx, |field, cx| {
                field.set_text(said);
                cx.notify();
            });
        }
        self.refresh_profile_preview(cx);
        cx.notify();
    }

    /// Draw the preview's card again from the page: what the server holds,
    /// with what is typed and not sent yet over it.
    fn refresh_profile_preview(&mut self, cx: &mut Context<Self>) {
        let engine = Arc::clone(&self.engine);
        let Some(form) = self.panels.settings.profile.as_mut() else {
            return;
        };
        let mut value = form.held.clone();
        if let Value::Object(fields) = &mut value {
            for typed in [Typed::Pronouns, Typed::Contact, Typed::Status] {
                let Some(key) = typed.key() else { continue };
                match form.said(typed, &*engine, cx) {
                    Some(said) => {
                        let _ = fields.insert(key.to_owned(), Value::String(said));
                    }
                    None => {
                        let _ = fields.remove(key);
                    }
                }
            }
            // The banner's picture is in hand already, read once.
            if let Some(Value::Object(banner)) = fields.get_mut("banner") {
                let _ = banner.remove("image");
            }
        }
        let profile = crate::profile::Profile::of(&format!("<!--FANCY:{value}-->"));
        let face = profile.as_ref().and_then(|profile| profile.name_face);
        form.card.name_family = match (face, &form.family) {
            (Some(face), Some((known, family))) if *known == face => Some(family.clone()),
            (Some(face), _) => {
                let family = crate::theme::family(face.stack(), cx);
                form.family = Some((face, family.clone()));
                Some(family)
            }
            (None, _) => None,
        };
        form.card.profile = profile;
        form.card.banner = form.banner.clone();
    }

    /// Whether a change made here can be sent: only to a server the user
    /// is on.
    pub(super) fn can_send_profile(&self) -> bool {
        self.snapshot.connection == Connection::Connected
    }

    /// Change the profile: merged into what the page holds, and sent.
    pub(super) fn patch_profile(&mut self, change: Value, cx: &mut Context<Self>) {
        let Value::Object(change) = change else {
            return;
        };
        if let Some(form) = self.panels.settings.profile.as_mut() {
            crate::profile_fields::merge(&mut form.held, &change);
        }
        if self.can_send_profile() {
            self.engine.act(Action::PatchProfile(change));
        }
        self.refresh_profile_preview(cx);
        cx.notify();
    }

    /// Fill the preview's rows only a server can fill with examples, or
    /// leave them empty.
    pub(super) fn set_profile_examples(&mut self, on: bool, cx: &mut Context<Self>) {
        if let Some(form) = self.panels.settings.profile.as_mut() {
            form.examples = on;
        }
        cx.notify();
    }

    /// Something was typed in one of the page's fields, or Enter or Tab
    /// pressed there.
    fn on_profile_typed(&mut self, event: &InputEvent, cx: &mut Context<Self>) {
        match event {
            InputEvent::Changed => {
                let Some(form) = self.panels.settings.profile.as_mut() else {
                    return;
                };
                form.typed = form.typed.wrapping_add(1);
                let turn = form.typed;
                cx.spawn(async move |shell, cx| {
                    cx.background_executor().timer(SETTLED).await;
                    let _ = shell.update(cx, |shell, cx| shell.send_typed(turn, cx));
                })
                .detach();
                self.refresh_profile_preview(cx);
                cx.notify();
            }
            InputEvent::Tabbed { back } => step_from_field(*back, cx),
            InputEvent::Submitted(_) => self.send_typed(self.typed_turn(), cx),
            _ => {}
        }
    }

    fn typed_turn(&self) -> u32 {
        self.panels.settings.profile.as_ref().map_or(0, |form| form.typed)
    }

    /// Send what is in the fields, and keep the display name, if nothing
    /// was typed since `turn`.
    fn send_typed(&mut self, turn: u32, cx: &mut Context<Self>) {
        let engine = Arc::clone(&self.engine);
        let Some(form) = self.panels.settings.profile.as_ref().filter(|form| form.typed == turn) else {
            return;
        };
        let mut change = Map::new();
        for typed in [Typed::Pronouns, Typed::Contact, Typed::Status, Typed::Background] {
            let Some(key) = typed.key() else { continue };
            let text = form.field(typed).read(cx).text().trim().to_owned();
            let held = form.text(key).unwrap_or_default();
            // The status is compared as it is typed: its HTML need not come
            // back as it went.
            let unchanged = match typed {
                Typed::Status if !held.is_empty() => text == engine.source(held).trim(),
                _ => text == held,
            };
            if unchanged {
                continue;
            }
            let said = form.said(typed, &*engine, cx);
            let _ = change.insert(key.to_owned(), said.clone().map_or(Value::Null, Value::String));
            // A background of one's own is the card's background.
            if typed == Typed::Background {
                let set = said.map(|_| Value::String("custom".to_owned()));
                let _ = change.insert("cardBackground".to_owned(), set.unwrap_or(Value::Null));
            }
        }
        let name = form.said(Typed::Name, &*engine, cx);
        if name != self.panels.settings.display_name {
            self.panels.settings.display_name = name;
            self.remember_settings(cx);
        }
        if !change.is_empty() {
            self.patch_profile(Value::Object(change), cx);
        }
    }

    /// Open the style row `row`, or close it if it is the one open.
    pub(super) fn toggle_profile_row(&mut self, row: Row, cx: &mut Context<Self>) {
        if let Some(form) = self.panels.settings.profile.as_mut() {
            form.open = if form.open == Some(row) { None } else { Some(row) };
        }
        cx.notify();
    }

    /// Choose a picture for the user's face, or for the head of their card,
    /// and send it; the page then reads the profile again.
    pub(super) fn pick_profile_picture(&mut self, banner: bool, cx: &mut Context<Self>) {
        if banner {
            self.pick_picture(cx, crate::picture::banner, |shell, picture, _| {
                shell.engine.act(Action::SetBanner(picture));
                shell.ask_own_profile();
            });
        } else {
            self.pick_picture(cx, crate::picture::avatar, |shell, picture, _| {
                shell.engine.act(Action::SetAvatar(picture));
            });
        }
    }

    /// Take the picture off the user's face, or off the head of their card.
    pub(super) fn clear_profile_picture(&mut self, banner: bool, cx: &mut Context<Self>) {
        if banner {
            if let Some(form) = self.panels.settings.profile.as_mut() {
                form.banner = None;
            }
            self.patch_profile(serde_json::json!({ "banner": null }), cx);
        } else {
            self.engine.act(Action::SetAvatar(Vec::new()));
            cx.notify();
        }
    }
}

/// The user's own card, with nothing read into it yet.
fn own_card(own: Option<crate::engine::Session>) -> super::super::Info {
    super::super::Info {
        subject: Subject::User(own.unwrap_or_default()),
        title: SharedString::default(),
        body: None,
        page: None,
        facts: Vec::new(),
        devices: Vec::new(),
        profile: None,
        name_family: None,
        banner: None,
        written: super::super::card::Written::default(),
        hover: None,
        anchor: None,
        sheet: false,
    }
}

/// Tab in one of the page's fields: on to the stop after it, or the one
/// before. Done once the key has been dealt with, outside the window's
/// own turn.
fn step_from_field(back: bool, cx: &mut Context<Shell>) {
    let Some(window) = cx.active_window() else {
        return;
    };
    let way = if back {
        super::super::kit::Way::Back
    } else {
        super::super::kit::Way::Next
    };
    cx.defer(move |cx| {
        let _ = window.update(cx, |_, window, cx| super::super::kit::walk(way, window, cx));
    });
}
