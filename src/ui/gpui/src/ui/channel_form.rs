//! The form a channel is made in: its name and everything else that can be
//! said of one at once, together.

use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, Subscription, Window, div,
    prelude::*, px,
};

use super::Shell;
use super::kit::{Button, Dialog, Emphasis, Segmented, SwitchRow};
use super::server_editor::field_row;
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, label};
use crate::engine::{Action, ChannelId, Kept, NewChannel};
use crate::rights::Right;
use crate::theme::Theme;

/// What each field is called and what it shows while empty, in tab order.
/// The placeholders name the fields to the tests, so no two are the same.
const FIELDS: [(&str, &str); 5] = [
    ("Name", "What the channel is called"),
    ("About", "What it is for"),
    ("Password", "Entered with this; empty for none"),
    ("Most people", "How many at once; empty for no limit"),
    ("Place", "Among the channels beside it: lower comes first"),
];

/// The place of the password among the fields: only a Fancy server keeps
/// one, and elsewhere the field is not shown.
const PASSWORD: usize = 2;

/// What the form's fields hold.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Entered {
    pub name: String,
    pub about: String,
    pub password: String,
    pub most: String,
    pub place: String,
}

/// What the form's switches say.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Chosen {
    pub temporary: bool,
    pub hidden: bool,
    pub kept: Kept,
}

impl Entered {
    /// The channel this describes, under `parent`.
    ///
    /// # Errors
    ///
    /// With what is wrong with it, in words for whoever entered it.
    pub(super) fn channel(
        &self,
        parent: ChannelId,
        chosen: Chosen,
    ) -> Result<NewChannel, &'static str> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err("Enter what the channel is called.");
        }
        let most = match self.most.trim() {
            "" => None,
            most => Some(
                most.parse::<u32>()
                    .ok()
                    .filter(|most| *most > 0)
                    .ok_or("How many is a number; empty for no limit.")?,
            ),
        };
        let position = match self.place.trim() {
            "" => None,
            place => Some(
                place
                    .parse::<i32>()
                    .map_err(|_| "Its place is a whole number: lower comes first.")?,
            ),
        };
        Ok(NewChannel {
            parent,
            name: name.to_owned(),
            about: self.about.trim().to_owned(),
            password: self.password.clone(),
            most,
            position,
            temporary: chosen.temporary,
            hidden: chosen.hidden,
            kept: chosen.kept,
        })
    }
}

/// What may be chosen in the form, by the server and by the rights held
/// where the channel is made.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Offered {
    /// A Fancy server: it keeps messages, passwords, and hides channels.
    fancy: bool,
    /// The Signal way of sealing is installed.
    signal: bool,
    /// Whether the channel may stay, and whether it may be temporary:
    /// with only the second it is temporary, and nothing asks.
    stays: bool,
    temporary: bool,
}

impl Offered {
    /// The ways of keeping what is said, in the order they are offered.
    fn kept(self) -> Vec<(Kept, &'static str)> {
        let mut kept = vec![
            (Kept::No, "Not kept"),
            (Kept::OnServer, "Kept"),
            (Kept::Sealed, "Kept, sealed"),
        ];
        if self.signal {
            kept.push((Kept::Signal, "Signal-sealed"));
        }
        kept
    }
}

/// The form's state while it is open.
pub(super) struct ChannelForm {
    parent: ChannelId,
    /// What the parent is called, for the title.
    within: SharedString,
    fields: [Entity<TextInput>; 5],
    chosen: Chosen,
    offered: Offered,
    /// What is wrong with what was entered, once Create was pressed.
    error: Option<SharedString>,
    _subscriptions: Vec<Subscription>,
}

impl ChannelForm {
    /// The fields that are shown, by their place: the tab order.
    fn shown(&self) -> impl Iterator<Item = usize> + use<> {
        let fancy = self.offered.fancy;
        (0..FIELDS.len()).filter(move |at| fancy || *at != PASSWORD)
    }
}

impl Shell {
    /// Open the form for a channel inside `parent`.
    pub(super) fn open_channel_form(
        &mut self,
        parent: ChannelId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(known) = self.snapshot.channels.iter().find(|c| c.id == parent) else {
            return;
        };
        let offered = Offered {
            fancy: self.snapshot.fancy,
            signal: self.snapshot.fancy && self.engine.signal_available(),
            stays: known.rights.has(Right::MAKE_CHANNEL),
            temporary: known.rights.has(Right::MAKE_TEMPORARY),
        };
        if !offered.stays && !offered.temporary {
            return;
        }
        let within = known.name.clone();
        let fields = FIELDS.map(|(_, placeholder)| cx.new(|cx| TextInput::new(placeholder, cx)));
        let subscriptions = fields
            .iter()
            .enumerate()
            .map(|(nth, input)| {
                cx.subscribe_in(input, window, move |shell, _, event, window, cx| {
                    shell.on_channel_form_input(nth, event, window, cx);
                })
            })
            .collect();
        fields[0].read(cx).focus(window);
        self.panels.channel_form = Some(ChannelForm {
            parent,
            within,
            fields,
            chosen: Chosen {
                temporary: !offered.stays,
                ..Chosen::default()
            },
            offered,
            error: None,
            _subscriptions: subscriptions,
        });
        cx.notify();
    }

    fn on_channel_form_input(
        &mut self,
        nth: usize,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            InputEvent::Submitted(_) => self.make_channel(cx),
            InputEvent::Cancelled => {
                self.panels.channel_form = None;
                cx.notify();
            }
            InputEvent::Tabbed { back } => {
                let Some(form) = self.panels.channel_form.as_ref() else {
                    return;
                };
                let shown: Vec<usize> = form.shown().collect();
                let at = shown.iter().position(|shown| *shown == nth).unwrap_or(0);
                let count = shown.len();
                let next = if *back { at + count - 1 } else { at + 1 } % count;
                if let Some(input) = shown.get(next).and_then(|next| form.fields.get(*next)) {
                    input.read(cx).focus(window);
                }
                cx.notify();
            }
            InputEvent::Changed | InputEvent::PastedPicture(_) | InputEvent::Pick(_) => {}
        }
    }

    /// Change what the form's switches say.
    fn choose_for_channel(&mut self, change: impl FnOnce(&mut Chosen), cx: &mut Context<Self>) {
        if let Some(form) = self.panels.channel_form.as_mut() {
            change(&mut form.chosen);
        }
        cx.notify();
    }

    /// Ask the server for the channel the form describes, or say what is
    /// wrong with it.
    fn make_channel(&mut self, cx: &mut Context<Self>) {
        let Some(form) = self.panels.channel_form.as_mut() else {
            return;
        };
        let text = |at: usize| form.fields[at].read(cx).text().to_owned();
        let entered = Entered {
            name: text(0),
            about: text(1),
            password: text(PASSWORD),
            most: text(3),
            place: text(4),
        };
        match entered.channel(form.parent, form.chosen) {
            Ok(new) => {
                self.panels.channel_form = None;
                self.engine.act(Action::MakeChannel(new));
            }
            Err(problem) => form.error = Some(problem.into()),
        }
        cx.notify();
    }
}

/// The switches and the choice under the fields.
fn choices(form: &ChannelForm, theme: &Theme, cx: &mut Context<Shell>) -> gpui::Div {
    let (chosen, offered) = (form.chosen, form.offered);
    let kept = offered.kept();
    let taken = kept.iter().position(|(kept, _)| *kept == chosen.kept);
    let ways: Vec<Kept> = kept.iter().map(|(kept, _)| *kept).collect();
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        // With both rights the choice is the user's; with one there is none.
        .when(offered.stays && offered.temporary, |choices| {
            choices.child(
                SwitchRow::new(
                    "channel-temporary",
                    "Gone when the last one leaves",
                    chosen.temporary,
                )
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.choose_for_channel(|chosen| chosen.temporary = !chosen.temporary, cx);
                })),
            )
        })
        .when(!offered.stays, |choices| {
            choices.child(
                div()
                    .px(px(8.0))
                    .text_size(px(12.0))
                    .text_color(theme.c.muted)
                    .child("It is gone when the last one leaves: that is what you may make here."),
            )
        })
        .when(offered.fancy, |choices| {
            choices
                .child(
                    SwitchRow::new(
                        "channel-hidden",
                        "Shown only to those let in",
                        chosen.hidden,
                    )
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.choose_for_channel(|chosen| chosen.hidden = !chosen.hidden, cx);
                    })),
                )
                .child(
                    div()
                        .px(px(8.0))
                        .pt(px(4.0))
                        .flex()
                        .flex_col()
                        .items_start()
                        .gap(px(6.0))
                        .text_size(px(13.0))
                        .child("What is said there")
                        .child(
                            Segmented::new(
                                "channel-kept",
                                kept.iter().map(|(_, says)| *says),
                                taken.unwrap_or(0),
                            )
                            .on_choose(cx.listener(
                                move |shell, at: &usize, _, cx| {
                                    if let Some(kept) = ways.get(*at).copied() {
                                        shell.choose_for_channel(|chosen| chosen.kept = kept, cx);
                                    }
                                },
                            )),
                        ),
                )
        })
}

/// The form, over a veil.
pub(super) fn render(
    form: &ChannelForm,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let title = SharedString::from(format!("New channel in {}", form.within));
    Dialog::new("channel-form")
        .w(px(480.0))
        .gap(px(10.0))
        .p(px(22.0))
        .child(
            div()
                .text_size(px(17.0))
                .font_weight(EMPHASIS)
                .child(label(&title, theme)),
        )
        .children(form.shown().filter_map(|at| {
            let (name, _) = FIELDS.get(at)?;
            Some(field_row(name, form.fields.get(at)?, theme))
        }))
        .child(choices(form, theme, cx))
        .when_some(form.error.clone(), |dialog, problem| {
            dialog.child(
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
                    Button::new("channel-cancel", "Cancel")
                        .selector("channel-cancel")
                        .on_click(cx.listener(|shell, _, _, cx| {
                            shell.panels.channel_form = None;
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("channel-create", "Create")
                        .selector("channel-create")
                        .emphasis(Emphasis::Contained)
                        .on_click(cx.listener(|shell, _, _, cx| shell.make_channel(cx))),
                ),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entered(name: &str, most: &str, place: &str) -> Entered {
        Entered {
            name: name.to_owned(),
            most: most.to_owned(),
            place: place.to_owned(),
            ..Entered::default()
        }
    }

    #[test]
    fn a_channel_is_made_of_what_was_entered_and_chosen() {
        let chosen = Chosen {
            temporary: true,
            hidden: false,
            kept: Kept::OnServer,
        };
        let made = Entered {
            about: " for the raid ".to_owned(),
            password: "open sesame".to_owned(),
            ..entered(" Raid ", " 12 ", "-3")
        }
        .channel(7, chosen)
        .expect("a channel");
        assert_eq!(made.parent, 7);
        assert_eq!(
            (made.name.as_str(), made.about.as_str()),
            ("Raid", "for the raid")
        );
        assert_eq!(made.password, "open sesame", "as it was typed");
        assert_eq!((made.most, made.position), (Some(12), Some(-3)));
        assert!(made.temporary && !made.hidden);
        assert_eq!(made.kept, Kept::OnServer);
        // What is left empty is left to the server.
        let plain = entered("Games", "", "").channel(1, Chosen::default());
        let plain = plain.expect("a channel");
        assert_eq!((plain.most, plain.position), (None, None));
        assert!(plain.about.is_empty() && plain.password.is_empty());
    }

    #[test]
    fn what_is_not_a_channel_is_said_to_be_wrong() {
        for (name, most, place) in [
            ("  ", "", ""),
            ("Games", "many", ""),
            ("Games", "0", ""),
            ("Games", "-2", ""),
            ("Games", "", "first"),
            ("Games", "", "1.5"),
        ] {
            let made = entered(name, most, place).channel(1, Chosen::default());
            assert!(made.is_err(), "{name:?} {most:?} {place:?}");
        }
    }

    #[test]
    fn the_signal_way_is_offered_only_where_it_is_installed() {
        let offered = |signal| Offered {
            fancy: true,
            signal,
            stays: true,
            temporary: true,
        };
        assert_eq!(offered(false).kept().len(), 3);
        let with = offered(true).kept();
        assert_eq!(with.last().map(|(kept, _)| *kept), Some(Kept::Signal));
    }
}
