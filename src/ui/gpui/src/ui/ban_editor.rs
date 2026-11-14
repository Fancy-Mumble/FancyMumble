//! The form that adds a ban by hand, or changes one: in the administrator's
//! panel, in place of the list while it is open.

use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, Subscription, Window, div,
    prelude::*, px,
};

use super::Shell;
use super::kit::{Button, Emphasis};
use super::server_editor::field_row;
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, label};
use crate::bans::Entered;
use crate::engine::{Action, Ban};
use crate::theme::Theme;

/// What each field is called and what it shows while empty, in tab order.
/// The placeholders name the fields to the tests, so no two are the same.
const FIELDS: [(&str, &str); 5] = [
    ("Address", "203.0.113.7, or a network: 203.0.113.0/24"),
    ("Name", "Who it is, for whoever reads the list"),
    ("Reason", "Why"),
    ("Lasts", "For good; or 30m, 12h, 7d"),
    (
        "Certificate",
        "The hash of a certificate to turn away as well",
    ),
];

/// The form's state while it is open.
pub(super) struct BanEditor {
    /// The row being changed; `None` when adding one.
    at: Option<usize>,
    /// When the ban being changed started, kept as it was; empty for a
    /// new one, which the server starts when it takes it.
    start: SharedString,
    fields: [Entity<TextInput>; 5],
    /// What is wrong with what was entered, once Save was pressed.
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl BanEditor {
    fn entered(&self, cx: &Context<Shell>) -> Entered {
        let text = |at: usize| self.fields[at].read(cx).text().to_owned();
        Entered {
            address: text(0),
            name: text(1),
            reason: text(2),
            lasts: text(3),
            hash: text(4),
        }
    }
}

impl Shell {
    /// Open the form: on the ban in row `at` of the list to change it, or
    /// empty to add one.
    pub(super) fn edit_ban(
        &mut self,
        at: Option<usize>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(admin) = self.panels.admin.as_ref() else {
            return;
        };
        let existing: Option<&Ban> = at.and_then(|at| admin.bans.as_ref()?.get(at));
        // A row that has gone since it was drawn is not a new ban.
        if at.is_some() && existing.is_none() {
            return;
        }
        let entered = existing.map(Entered::of).unwrap_or_default();
        let start = existing.map(|ban| ban.start.clone()).unwrap_or_default();
        let texts = [
            entered.address,
            entered.name,
            entered.reason,
            entered.lasts,
            entered.hash,
        ];
        let mut texts = texts.into_iter();
        let fields = FIELDS.map(|(_, placeholder)| {
            let text = texts.next().unwrap_or_default();
            cx.new(|cx| {
                let mut input = TextInput::new(placeholder, cx);
                input.set_text(text);
                input
            })
        });
        let subscriptions = fields
            .iter()
            .enumerate()
            .map(|(nth, input)| {
                cx.subscribe_in(input, window, move |shell, _, event, window, cx| {
                    shell.on_ban_input(nth, event, window, cx);
                })
            })
            .collect();
        window.focus(&fields[0].focus_handle(cx), cx);
        if let Some(admin) = self.panels.admin.as_mut() {
            admin.editing = Some(BanEditor {
                at,
                start,
                fields,
                error: None,
                _subscriptions: subscriptions,
            });
        }
        cx.notify();
    }

    fn on_ban_input(
        &mut self,
        nth: usize,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Submitted(_) => self.save_ban(cx),
            InputEvent::Cancelled => {
                let _ = self.close_ban_editor(cx);
            }
            InputEvent::Tabbed { back } => {
                let editing = self
                    .panels
                    .admin
                    .as_ref()
                    .and_then(|admin| admin.editing.as_ref());
                let Some(editor) = editing else { return };
                let count = editor.fields.len();
                let next = if *back { nth + count - 1 } else { nth + 1 } % count;
                window.focus(&editor.fields[next].focus_handle(cx), cx);
                cx.notify();
            }
            InputEvent::Changed | InputEvent::PastedPicture(_) | InputEvent::Pick(_) => {}
        }
    }

    /// Put the form away, keeping the list as it is. Says whether there was
    /// one to put away.
    pub(super) fn close_ban_editor(&mut self, cx: &mut Context<Self>) -> bool {
        let closed = self
            .panels
            .admin
            .as_mut()
            .and_then(|admin| admin.editing.take())
            .is_some();
        if closed {
            cx.notify();
        }
        closed
    }

    /// Put what was entered into the list and send the list, which the
    /// server takes whole; or say what is wrong with it.
    fn save_ban(&mut self, cx: &mut Context<Self>) {
        let Some(admin) = self.panels.admin.as_mut() else {
            return;
        };
        let Some(editor) = admin.editing.as_mut() else {
            return;
        };
        let made = editor.entered(cx).ban(editor.start.clone());
        let ban = match made {
            Ok(ban) => ban,
            Err(problem) => {
                editor.error = Some(problem.into());
                cx.notify();
                return;
            }
        };
        let at = editor.at;
        let bans = admin.bans.get_or_insert_with(Vec::new);
        match at.and_then(|at| bans.get_mut(at)) {
            Some(held) => *held = ban,
            None => bans.push(ban),
        }
        let whole = bans.clone();
        admin.editing = None;
        self.engine.act(Action::SetBans(whole));
        self.refilter_admin(cx);
        cx.notify();
    }
}

/// The form, where the list stands otherwise.
pub(super) fn render(
    editor: &BanEditor,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let title = if editor.at.is_some() {
        "Change a ban"
    } else {
        "Add a ban"
    };
    div()
        .id("ban-editor")
        .debug_selector(|| "ban-editor".to_owned())
        .flex()
        .flex_col()
        .gap(px(10.0))
        .child(
            div()
                .text_size(px(15.0))
                .font_weight(EMPHASIS)
                .child(label(title, theme)),
        )
        .children(
            FIELDS
                .into_iter()
                .zip(editor.fields.iter())
                .map(|((name, _), input)| field_row(name, input, theme)),
        )
        .when(!editor.start.is_empty(), |form| {
            form.child(
                div()
                    .text_size(px(11.5))
                    .text_color(theme.c.muted)
                    .child(SharedString::from(format!("Since {}", editor.start))),
            )
        })
        .when_some(editor.error.clone(), |form, problem| {
            form.child(
                div()
                    .text_size(px(12.5))
                    .text_color(theme.c.bad)
                    .child(problem),
            )
        })
        .child(
            div()
                .mt(px(6.0))
                .flex()
                .items_center()
                .justify_end()
                .gap(px(8.0))
                .child(
                    Button::new("ban-cancel", "Cancel")
                        .selector("ban-cancel")
                        .on_click(cx.listener(|shell, _, _, cx| {
                            let _ = shell.close_ban_editor(cx);
                        })),
                )
                .child(
                    Button::new("ban-save", "Save")
                        .selector("ban-save")
                        .emphasis(Emphasis::Contained)
                        .on_click(cx.listener(|shell, _, _, cx| shell.save_ban(cx))),
                ),
        )
}
