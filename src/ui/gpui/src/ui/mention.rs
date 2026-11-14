//! Naming somebody in what is being written: the list that opens at an
//! `@`, and knowing a message that names the reader.
//!
//! The engine makes a mention of each `@Name` it knows when the message is
//! sent, and of `@everyone` and `@here`; this is the list that saves typing
//! the name out, and the reading of what arrives.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Avatar, Sheet};
use super::widgets::icon;
use crate::engine::{Conversation, Session};
use crate::theme::Theme;

/// The most names offered at once.
const MOST: usize = 8;

/// Who a name in the list is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Named {
    /// Somebody on the server.
    User(Session),
    /// Everybody on the server, or everybody in the channel.
    All,
}

/// The list while it is open: where the `@` stands in what is written, the
/// names that fit what follows it, and which is taken by Enter or Tab.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Offer {
    /// The byte the `@` is at.
    at: usize,
    names: Vec<(SharedString, Named)>,
    chosen: usize,
}

impl Offer {
    /// The names offered, in order.
    #[cfg(test)]
    pub(super) fn names(&self) -> Vec<&str> {
        self.names.iter().map(|(name, _)| name.as_ref()).collect()
    }
}

/// One step in the list, from a key pressed in the composer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Pick {
    Up,
    Down,
    /// Take the name chosen.
    Take,
    /// Put the list away and go on writing.
    Leave,
}

/// The `@` a name is being typed after, at the end of `text`, and what has
/// been typed of the name: `None` unless the `@` begins a word and nothing
/// after it is a space.
pub(super) fn begun(text: &str) -> Option<(usize, &str)> {
    let at = text.rfind('@')?;
    let after = &text[at + 1..];
    let starts_word = text[..at]
        .chars()
        .next_back()
        .is_none_or(char::is_whitespace);
    (starts_word && !after.contains(char::is_whitespace)).then_some((at, after))
}

/// What a message says about who it names, read once from its markup.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Mentions {
    sessions: Vec<Session>,
    /// Everybody on the server, or everybody in the channel it was said in.
    all: bool,
}

impl Mentions {
    /// Who `html` names: the people its mention marks point at, and
    /// whether one of them is for everybody.
    pub(super) fn read(html: &str) -> Self {
        const SESSION: &str = "data-mention-session=\"";
        if !html.contains("data-mention-") {
            return Self::default();
        }
        let sessions = html
            .match_indices(SESSION)
            .filter_map(|(at, _)| {
                let digits = &html[at + SESSION.len()..];
                digits[..digits.find('"')?].parse().ok()
            })
            .collect();
        Self {
            sessions,
            all: html.contains("data-mention-everyone=\"1\"")
                || html.contains("data-mention-here=\"1\""),
        }
    }

    /// Whether the message is for `own`: it names them, or everybody.
    pub(super) fn names(&self, own: Option<Session>) -> bool {
        self.all || own.is_some_and(|own| self.sessions.contains(&own))
    }
}

impl Shell {
    /// What is being written changed: open the list on the names that fit
    /// what follows an `@`, or put it away.
    pub(super) fn offer_mentions(&mut self, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).text().to_owned();
        let offer = begun(&text).and_then(|(at, typed)| {
            let typed = typed.to_lowercase();
            let fits = |name: &str| name.to_lowercase().starts_with(&typed);
            let here = self.snapshot.current_channel;
            let mut people: Vec<_> = self
                .snapshot
                .users
                .iter()
                .filter(|user| Some(user.session) != self.snapshot.own_session)
                .filter(|user| fits(&user.name))
                .collect();
            // Those in the room first, then by name.
            people
                .sort_by_cached_key(|user| (Some(user.channel) != here, user.name.to_lowercase()));
            let all = ["everyone", "here"]
                .into_iter()
                .filter(|_| matches!(self.open, Some(Conversation::Channel(_))))
                .filter(|name| fits(name))
                .map(|name| (SharedString::from(name), Named::All));
            let names: Vec<_> = people
                .into_iter()
                .map(|user| (user.name.clone(), Named::User(user.session)))
                .chain(all)
                .take(MOST)
                .collect();
            (!names.is_empty()).then_some(Offer {
                at,
                names,
                chosen: 0,
            })
        });
        let open = offer.is_some();
        if self.panels.mention != offer {
            self.panels.mention = offer;
            // While it is open the arrows, Enter and Tab are the list's.
            self.composer
                .update(cx, |composer, _| composer.set_picking(open));
            cx.notify();
        }
    }

    /// A key that is the list's was pressed in the composer.
    pub(super) fn pick_mention(&mut self, pick: Pick, cx: &mut Context<Self>) {
        let Some(offer) = self.panels.mention.as_mut() else {
            return;
        };
        let last = offer.names.len().saturating_sub(1);
        match pick {
            Pick::Up => offer.chosen = offer.chosen.checked_sub(1).unwrap_or(last),
            Pick::Down => {
                offer.chosen = if offer.chosen >= last {
                    0
                } else {
                    offer.chosen + 1
                }
            }
            Pick::Take => {
                let chosen = offer.chosen;
                self.take_mention(chosen, cx);
                return;
            }
            Pick::Leave => {
                self.panels.mention = None;
                self.composer
                    .update(cx, |composer, _| composer.set_picking(false));
            }
        }
        cx.notify();
    }

    /// Finish the name being typed with the one at `chosen` in the list.
    pub(super) fn take_mention(&mut self, chosen: usize, cx: &mut Context<Self>) {
        let Some(offer) = self.panels.mention.take() else {
            return;
        };
        let Some((name, _)) = offer.names.get(chosen) else {
            return;
        };
        let text = self.composer.read(cx).text().to_owned();
        let completed = format!("{}@{name} ", &text[..offer.at.min(text.len())]);
        self.composer.update(cx, |composer, cx| {
            composer.set_picking(false);
            composer.set_text(completed);
            cx.notify();
        });
        cx.notify();
    }
}

/// The list, standing on the composer, while a name is being typed.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let offer = shell.panels.mention.as_ref()?;
    let hover = theme.c.hover;
    let rows = offer.names.iter().enumerate().map(|(at, (name, named))| {
        let face = match named {
            Named::User(session) => {
                let picture = shell
                    .snapshot
                    .users
                    .iter()
                    .find(|user| user.session == *session)
                    .and_then(|user| user.avatar.as_ref());
                Avatar::new(name)
                    .picture(picture)
                    .size(20.0)
                    .into_any_element()
            }
            Named::All => div()
                .size(px(20.0))
                .flex()
                .items_center()
                .justify_center()
                .child(icon("users", 13.0, theme.c.warn))
                .into_any_element(),
        };
        let tag = name.clone();
        div()
            .id(("mention", at))
            .debug_selector(move || format!("mention-{tag}"))
            .h(px(30.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(8.0))
            .rounded(theme.skin.radius_sm)
            .text_size(px(12.5))
            .cursor_pointer()
            .when(at == offer.chosen, |row| row.bg(theme.c.accent_soft))
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| shell.take_mention(at, cx)))
            .child(face)
            .child(SharedString::from(format!("@{name}")))
    });
    Some(
        div()
            .debug_selector(|| "mentions".to_owned())
            .absolute()
            .left(px(26.0))
            .bottom(px(6.0))
            .child(
                Sheet::new("mention-list")
                    .w(px(240.0))
                    .p(px(4.0))
                    .flex()
                    .flex_col()
                    .gap(px(1.0))
                    .children(rows),
            ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_begun_after_an_at_sign_that_starts_a_word() {
        assert_eq!(begun("hi @sc"), Some((3, "sc")));
        assert_eq!(begun("@"), Some((0, "")));
        assert_eq!(begun("mail@example"), None, "inside a word");
        assert_eq!(begun("hi @Scout and"), None, "finished: a space followed");
        assert_eq!(begun("nothing here"), None);
        // The last `@` is the one being typed after.
        assert_eq!(begun("@Rin and @Fl"), Some((9, "Fl")));
    }

    #[test]
    fn a_message_says_who_it_names() {
        let named = Mentions::read(
            r#"hi <span class="mention mention-user" data-mention-session="3">@Rin</span> and <span class="mention mention-user" data-mention-session="12">@Al</span>"#,
        );
        assert!(named.names(Some(3)) && named.names(Some(12)));
        assert!(!named.names(Some(1)) && !named.names(None));
        let everybody = Mentions::read(
            r#"<span class="mention mention-here" data-mention-here="1">@here</span>"#,
        );
        assert!(everybody.names(Some(1)) && everybody.names(None));
        // Words alone name nobody: only the mark the sender's client made.
        assert_eq!(Mentions::read("@Rin, @everyone"), Mentions::default());
        assert!(!Mentions::read(r#"<span data-mention-session="x">"#).names(Some(0)));
    }
}
