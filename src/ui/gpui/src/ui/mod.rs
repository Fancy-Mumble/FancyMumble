//! The shell: one window laid out as the web UI's default design lays it
//! out - a band across the top, the server rail, the channel column and the
//! conversation.

mod band;
mod conversation;
mod picker;
mod rail;
mod sidebar;
pub(crate) mod text_input;
mod widgets;

use std::collections::HashSet;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ListAlignment, ListOffset, ListState, ParentElement, Render,
    Styled, Subscription, Task, Window, div, prelude::*, px, relative,
};

use crate::engine::{Channel, ChannelId, Engine, EngineEvent, Message, Session, Snapshot, User};
use crate::theme::{ActiveTheme, Catalog};
use text_input::{InputEvent, TextInput};

/// How far past the visible rows the conversation lays messages out, so a
/// short scroll does not wait on layout.
const OVERDRAW: f32 = 400.0;

/// The application's one window.
pub(crate) struct Shell {
    engine: Arc<dyn Engine>,
    /// The server as last read from the engine.
    snapshot: Snapshot,
    /// The current channel's messages, oldest first.
    messages: Vec<Message>,
    /// The conversation's rows: only the visible ones are laid out.
    rows: ListState,
    /// Who is talking right now.
    talking: HashSet<Session>,
    composer: Entity<TextInput>,
    search: Entity<TextInput>,
    /// Whether the theme picker is showing.
    picker_open: bool,
    _events: Task<()>,
    _subscriptions: [Subscription; 2],
}

impl Shell {
    /// A shell showing whatever `engine` is connected to.
    pub(crate) fn new(engine: Arc<dyn Engine>, cx: &mut Context<Self>) -> Self {
        let composer = cx.new(|cx| TextInput::new("", cx));
        let search = cx.new(|cx| TextInput::new("Search channels", cx));
        let subscriptions = [
            cx.subscribe(&composer, Self::on_composer),
            // A search narrows the channel list as it is typed.
            cx.subscribe(&search, |_, _, _, cx| cx.notify()),
        ];
        let events = Self::listen(engine.events(), cx);
        let mut shell = Self {
            snapshot: engine.snapshot(),
            engine,
            messages: Vec::new(),
            rows: ListState::new(0, ListAlignment::Top, px(OVERDRAW)),
            talking: HashSet::new(),
            composer,
            search,
            picker_open: std::env::var_os("FANCY_GPUI_PICKER").is_some(),
            _events: events,
            _subscriptions: subscriptions,
        };
        shell.reload_messages(cx);
        shell
    }

    /// Apply the engine's events as they arrive.
    ///
    /// Everything already waiting is applied before the one repaint: a server
    /// that sends a burst of state changes costs one frame, not one each.
    fn listen(inbox: async_channel::Receiver<EngineEvent>, cx: &mut Context<Self>) -> Task<()> {
        cx.spawn(async move |shell, cx| {
            while let Ok(first) = inbox.recv().await {
                let applied = shell.update(cx, |shell, cx| shell.apply_waiting(first, &inbox, cx));
                if applied.is_err() {
                    break;
                }
            }
        })
    }

    /// Apply `first` and everything queued behind it, then repaint once.
    fn apply_waiting(
        &mut self,
        first: EngineEvent,
        inbox: &async_channel::Receiver<EngineEvent>,
        cx: &mut Context<Self>,
    ) {
        self.apply(first, cx);
        while let Ok(next) = inbox.try_recv() {
            self.apply(next, cx);
        }
        cx.notify();
    }

    fn apply(&mut self, event: EngineEvent, cx: &mut Context<Self>) {
        match event {
            EngineEvent::StateChanged => self.snapshot = self.engine.snapshot(),
            EngineEvent::CurrentChannelChanged => {
                self.snapshot = self.engine.snapshot();
                self.reload_messages(cx);
            }
            EngineEvent::UserTalking { session, talking } => {
                let _ = if talking {
                    self.talking.insert(session)
                } else {
                    self.talking.remove(&session)
                };
            }
            EngineEvent::NewMessage { channel } => {
                if self.snapshot.current_channel == Some(channel) {
                    self.reload_messages(cx);
                }
            }
        }
    }

    /// Read the current channel's messages again and lay the rows out afresh.
    fn reload_messages(&mut self, cx: &mut Context<Self>) {
        self.messages = self
            .snapshot
            .current_channel
            .map(|channel| self.engine.messages(channel))
            .unwrap_or_default();
        // A short conversation starts under the header, as the web UI draws
        // it; a long one opens on its newest message.
        let rows = conversation::row_count(&self.messages);
        self.rows.reset(rows);
        self.rows.scroll_to(ListOffset {
            item_ix: rows,
            offset_in_item: px(0.0),
        });
        let placeholder = self
            .current_channel_name()
            .map(|name| format!("Message #{name}"))
            .unwrap_or_default();
        self.composer
            .update(cx, |composer, _| composer.set_placeholder(placeholder));
    }

    #[expect(
        clippy::needless_pass_by_value,
        reason = "the signature a subscription calls"
    )]
    fn on_composer(
        &mut self,
        composer: Entity<TextInput>,
        event: &InputEvent,
        cx: &mut Context<Self>,
    ) {
        let InputEvent::Submitted(body) = event else {
            return;
        };
        if let Some(channel) = self.snapshot.current_channel {
            self.engine.send_message(channel, body.clone());
        }
        composer.update(cx, |composer, cx| {
            composer.clear();
            cx.notify();
        });
    }

    fn current_channel_name(&self) -> Option<&str> {
        let current = self.snapshot.current_channel?;
        self.snapshot
            .channels
            .iter()
            .find(|channel| channel.id == current)
            .map(|channel| channel.name.as_ref())
    }

    /// The users in `channel`, in the order the engine lists them.
    fn occupants(&self, channel: ChannelId) -> impl Iterator<Item = &User> {
        self.snapshot
            .users
            .iter()
            .filter(move |user| user.channel == channel)
    }

    /// How many ancestors `channel` has. A parent the engine does not list
    /// (or a loop it should never send) ends the count rather than the view.
    fn depth(&self, channel: &Channel) -> usize {
        let mut depth = 0;
        let mut parent = channel.parent;
        while let Some(id) = parent {
            if depth >= self.snapshot.channels.len() {
                break;
            }
            depth += 1;
            parent = self
                .snapshot
                .channels
                .iter()
                .find(|candidate| candidate.id == id)
                .and_then(|found| found.parent);
        }
        depth
    }

    fn own_user(&self) -> Option<&User> {
        let own = self.snapshot.own_session?;
        self.snapshot.users.iter().find(|user| user.session == own)
    }

    fn toggle_picker(&mut self, cx: &mut Context<Self>) {
        self.picker_open = !self.picker_open;
        cx.notify();
    }

    /// Move to the theme after the current one, keeping the mode.
    pub(crate) fn next_theme(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        if let Some(next) = Catalog::get().next_id(&theme.id) {
            ActiveTheme::set(next, theme.mode, cx);
        }
    }

    /// Flip between the light and dark drawing of the current theme.
    pub(crate) fn toggle_mode(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        ActiveTheme::set(&theme.id, theme.mode.toggled(), cx);
    }
}

impl Render for Shell {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .size_full()
            .relative()
            .flex()
            .flex_col()
            .bg(theme.c.bg0)
            .text_color(theme.c.text)
            .font_family(theme.skin.font.clone())
            .font_weight(theme.skin.weight)
            .text_size(px(14.0))
            .line_height(relative(1.4))
            .when_some(theme.c.window_line, |shell, line| {
                shell.border_1().border_color(line)
            })
            .when(theme.skin.band, |shell| {
                shell.child(band::render(&theme, cx))
            })
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(rail::render(&theme, cx))
                    .child(sidebar::render(self, &theme, cx))
                    .child(conversation::render(self, &theme, cx)),
            )
            .when(!theme.skin.band, |shell| {
                shell.child(band::corner_controls(&theme, cx))
            })
            .when(self.picker_open, |shell| {
                shell.child(picker::render(&theme, cx))
            })
    }
}
