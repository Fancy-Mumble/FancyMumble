//! The making of an identity by name, and an identity's recovery phrase, on
//! the Identities page, as the web UI's (`IdentitiesSettings`,
//! `RecoveryPhraseSection`): the 24 words shown on asking, and an identity
//! given the seed typed words stand for.

use gpui::{Context, Div, Entity, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{
    Banner, Button, Card, Emphasis, GroupTitle, Note, Select, Size, Tone, rule,
};
use super::super::text_input::TextInput;
use crate::engine::CertificateTask;
use crate::theme::Theme;
use crate::words::t;

/// How many words a recovery phrase has.
const WORDS: usize = 24;

/// The page's fields and what the recovery section shows.
pub(in crate::ui) struct Recovery {
    /// Where a new identity's name is typed.
    pub name: Entity<TextInput>,
    /// Where a phrase to restore from is typed.
    pub draft: Entity<TextInput>,
    /// Which identity the section is about.
    pub label: Option<SharedString>,
    /// Its phrase, while it is shown.
    pub phrase: Option<String>,
    /// What the last restore came to.
    pub said: Option<Result<(), String>>,
}

impl Shell {
    /// Make the page's fields, once.
    pub(super) fn open_identities(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.recovery.is_none() {
            let name = cx.new(|cx| TextInput::new(t!("Identity name..."), cx));
            let draft = cx.new(|cx| TextInput::new(t!("The 24 words, separated by spaces"), cx));
            self.panels.settings.recovery = Some(Recovery {
                name,
                draft,
                label: None,
                phrase: None,
                said: None,
            });
        }
    }

    /// Make the identity named in the field.
    fn create_identity(&mut self, cx: &mut Context<Self>) {
        let Some(recovery) = &self.panels.settings.recovery else {
            return;
        };
        let label = recovery.name.read(cx).text().trim().to_owned();
        if label.is_empty() {
            return;
        }
        recovery.name.update(cx, |field, cx| {
            field.clear();
            cx.notify();
        });
        self.engine
            .manage_certificate(CertificateTask::Create(label));
        self.panels.certs.held = self.engine.certificates();
        cx.notify();
    }

    /// The identity the recovery section is about: the one chosen, or the
    /// first held.
    fn recovery_label(&self) -> Option<SharedString> {
        let held = &self.panels.certs.held;
        self.panels
            .settings
            .recovery
            .as_ref()
            .and_then(|recovery| recovery.label.clone())
            .filter(|label| held.contains(label))
            .or_else(|| held.first().cloned())
    }

    /// Show the phrase of the identity in question, or put it away.
    fn show_phrase(&mut self, show: bool, cx: &mut Context<Self>) {
        let phrase = show
            .then(|| self.recovery_label())
            .flatten()
            .map(|label| self.engine.recovery_phrase(&label));
        if let Some(recovery) = &mut self.panels.settings.recovery {
            match phrase {
                Some(Ok(phrase)) => recovery.phrase = Some(phrase),
                Some(Err(why)) => recovery.said = Some(Err(why)),
                None => recovery.phrase = None,
            }
        }
        cx.notify();
    }

    /// Give the identity in question the seed of the typed phrase.
    fn restore_phrase(&mut self, cx: &mut Context<Self>) {
        let (Some(label), Some(recovery)) = (self.recovery_label(), &self.panels.settings.recovery)
        else {
            return;
        };
        let phrase = recovery.draft.read(cx).text().to_owned();
        let said = self.engine.restore_phrase(&label, &phrase);
        if let Some(recovery) = &mut self.panels.settings.recovery {
            if said.is_ok() {
                recovery.draft.update(cx, |field, cx| {
                    field.clear();
                    cx.notify();
                });
            }
            recovery.said = Some(said);
        }
        cx.notify();
    }
}

/// How many words are typed.
fn counted(text: &str) -> usize {
    text.split_whitespace().count()
}

/// The way to make a new identity by name.
pub(super) fn create(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<Div> {
    let field = shell.panels.settings.recovery.as_ref()?.name.clone();
    let named = !field.read(cx).text().trim().is_empty();
    Some(
        div()
            .child(GroupTitle::new(t!("Create new identity")))
            .child(
                div()
                    .flex()
                    .gap(px(8.0))
                    .child(
                        div()
                            .debug_selector(|| "identity-name".to_owned())
                            .flex_1()
                            .h(px(36.0))
                            .px(px(13.0))
                            .flex()
                            .items_center()
                            .rounded(theme.skin.radius_md)
                            .bg(theme.c.input)
                            .border_1()
                            .border_color(theme.c.line2)
                            .text_size(px(12.5))
                            .child(field),
                    )
                    .child(
                        div().when(!named, |button| button.opacity(0.4)).child(
                            Button::new("identity-create", t!("Create"))
                                .emphasis(Emphasis::Contained)
                                .on_click(cx.listener(|shell, _, _, cx| shell.create_identity(cx))),
                        ),
                    ),
            ),
    )
}

/// The recovery phrase of an identity: shown on asking, and restored.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<Div> {
    let recovery = shell.panels.settings.recovery.as_ref()?;
    let held = &shell.panels.certs.held;
    let label = shell.recovery_label()?;
    let words = counted(recovery.draft.read(cx).text());
    let chosen = held.iter().position(|known| *known == label).unwrap_or(0);
    let shown = shown_phrase(recovery.phrase.as_deref(), cx);
    let names: Vec<SharedString> = held.clone();
    let said = match &recovery.said {
        Some(Ok(())) => Some(
            Banner::new(Note::Info).title(t!("Restored. Reconnect with this identity to use it.")),
        ),
        Some(Err(why)) => Some(Banner::new(Note::Danger).child(SharedString::from(why.clone()))),
        None => None,
    };
    Some(
        div()
            .child(rule(cx))
            .child(super::heading(&shell.panels.settings.lit, t!("Recovery phrase")).hint(t!(
                "Twenty-four words that bring this identity's encrypted conversations back on a new install, if every device with it is lost."
            )))
            .when(held.len() > 1, |group| {
                group.child(div().mb(px(10.0)).w(px(220.0)).child(
                    Select::new("recovery-identity", names, chosen).on_choose(cx.listener(
                        |shell, at: &usize, _, cx| {
                            let label = shell.panels.certs.held.get(*at).cloned();
                            if let Some(recovery) = &mut shell.panels.settings.recovery {
                                recovery.label = label;
                                recovery.phrase = None;
                                recovery.said = None;
                            }
                            cx.notify();
                        },
                    )),
                ))
            })
            .child(shown)
            .child(
                div()
                    .mt(px(16.0))
                    .mb(px(4.0))
                    .text_size(px(12.5))
                    .font_weight(super::super::widgets::EMPHASIS)
                    .child(t!("Restore from a recovery phrase")),
            )
            .child(div().mb(px(8.0)).text_size(px(11.5)).text_color(theme.c.muted).child(t!(
                "Replaces this identity's encryption key with the one the words stand for. Reconnect afterwards for it to take effect."
            )))
            .child(
                div()
                    .debug_selector(|| "recovery-draft".to_owned())
                    .min_h(px(36.0))
                    .px(px(13.0))
                    .py(px(8.0))
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(12.5))
                    .child(recovery.draft.clone()),
            )
            .child(
                div()
                    .mt(px(8.0))
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .child(div().when(words != WORDS, |button| button.opacity(0.4)).child(
                        Button::new("recovery-restore", t!("Restore"))
                            .emphasis(Emphasis::Contained)
                            .tone(Tone::Danger)
                            .size(Size::Compact)
                            .on_click(cx.listener(move |shell, _, _, cx| {
                                if words == WORDS {
                                    shell.restore_phrase(cx);
                                }
                            })),
                    ))
                    .child(div().text_size(px(11.5)).text_color(theme.c.muted).child(t!(
                        "{{count}} of 24 words",
                        "{{count}} of 24 words",
                        count = words
                    ))),
            )
            .children(said),
    )
}

/// The phrase while it is shown, with the way to put it away; else the way
/// to show it.
fn shown_phrase(phrase: Option<&str>, cx: &mut Context<Shell>) -> Div {
    match phrase {
        Some(phrase) => div().debug_selector(|| "recovery-phrase".to_owned()).child(
            Card::new()
                .child(Banner::new(Note::Warn).title(t!(
                    "Anyone who reads these words can read your encrypted messages. Write them down and keep them somewhere offline."
                )))
                .child(
                    div()
                        .my(px(12.0))
                        .flex()
                        .flex_wrap()
                        .gap_y(px(6.0))
                        .text_size(px(13.0))
                        .children(phrase.split_whitespace().enumerate().map(|(at, word)| {
                            div()
                                .w(px(132.0))
                                .child(SharedString::from(format!("{}. {word}", at + 1)))
                        })),
                )
                .child(div().flex().child(
                    Button::new("recovery-hide", t!("Hide"))
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.show_phrase(false, cx))),
                )),
        ),
        None => div().flex().child(
            Button::new("recovery-show", t!("Show recovery phrase"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact)
                .on_click(cx.listener(|shell, _, _, cx| shell.show_phrase(true, cx))),
        ),
    }
}
