//! The shell: one window laid out as the web UI's default design lays it
//! out - a band across the top, the server rail, the channel column and the
//! conversation.

mod band;
mod connect;
mod conversation;
mod frame;
mod picker;
mod rail;
mod server_editor;
mod sidebar;
#[cfg(test)]
mod tests;
pub(crate) mod text_input;
mod widgets;

use std::collections::HashSet;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ListAlignment, ListOffset, ListState, ParentElement, Render,
    Styled, Subscription, Task, Window, div, prelude::*, px, relative,
};

use crate::engine::{
    Channel, ChannelId, Connection, Engine, EngineEvent, Message, SavedServer, Session, Snapshot,
    User,
};
use crate::store::{Settings, Store};
use crate::theme::{ActiveTheme, Catalog, Mode};
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
    /// What each row is: a message, or the rule that starts a day.
    row_model: Vec<conversation::Row>,
    /// How far east of UTC the local clock is, as of the last reload.
    utc_offset: i64,
    /// Who is talking right now.
    talking: HashSet<Session>,
    composer: Entity<TextInput>,
    search: Entity<TextInput>,
    /// The saved identities, as last read from the engine.
    servers: Vec<SavedServer>,
    /// The `host:port` whose landing page is showing, once one was picked.
    selected_server: Option<String>,
    /// The identity picked to connect as, once one was.
    selected_identity: Option<gpui::SharedString>,
    server_search: Entity<TextInput>,
    /// The server's password, for the connect about to be made.
    password: Entity<TextInput>,
    /// The add/edit dialog, while it is open.
    editor: Option<server_editor::ServerEditor>,
    /// What the engine last had to tell the user.
    notice: Option<gpui::SharedString>,
    /// Where the chosen theme is remembered; `None` remembers nothing.
    store: Option<Store>,
    /// Whether the theme picker is showing.
    picker_open: bool,
    _events: Task<()>,
    _subscriptions: Vec<Subscription>,
}

impl Shell {
    /// A shell showing whatever `engine` is connected to, remembering the
    /// chosen theme in `store`.
    pub(crate) fn new(
        engine: Arc<dyn Engine>,
        store: Option<Store>,
        cx: &mut Context<Self>,
    ) -> Self {
        let composer = cx.new(|cx| TextInput::new("", cx));
        let search = cx.new(|cx| TextInput::new("Search channels", cx));
        let server_search = cx.new(|cx| TextInput::new("Search servers", cx));
        let password = cx.new(|cx| TextInput::new("Server password, if it has one", cx).obscured());
        let subscriptions = vec![
            cx.subscribe(&composer, Self::on_composer),
            // A search narrows its list as it is typed.
            cx.subscribe(&search, |_, _, _, cx| cx.notify()),
            cx.subscribe(&server_search, |_, _, _, cx| cx.notify()),
            // Enter in the password field connects.
            cx.subscribe(&password, |shell, _, event, cx| {
                if matches!(event, InputEvent::Submitted(_)) {
                    shell.connect_selected(cx);
                }
            }),
        ];
        // Whether the saved servers are up is asked once, here, and again
        // whenever the list changes or the view returns to it.
        engine.refresh_pings();
        let events = Self::listen(engine.events(), cx);
        let mut shell = Self {
            snapshot: engine.snapshot(),
            servers: engine.saved_servers(),
            engine,
            messages: Vec::new(),
            rows: ListState::new(0, ListAlignment::Top, px(OVERDRAW)),
            row_model: Vec::new(),
            utc_offset: 0,
            talking: HashSet::new(),
            composer,
            search,
            selected_server: None,
            selected_identity: None,
            server_search,
            password,
            editor: None,
            notice: None,
            store,
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
            EngineEvent::StateChanged => {
                let was = self.snapshot.connection;
                self.snapshot = self.engine.snapshot();
                // Back on the server list: what it says about each server is
                // as old as the visit just ended.
                if was == Connection::Connected
                    && self.snapshot.connection == Connection::Disconnected
                {
                    self.engine.refresh_pings();
                }
            }
            EngineEvent::ServersChanged => self.servers = self.engine.saved_servers(),
            EngineEvent::Notice(notice) => self.notice = notice,
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
        self.utc_offset = widgets::local_utc_offset();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
            });
        self.row_model = conversation::rows(&self.messages, now_ms, self.utc_offset);
        let rows = self.row_model.len();
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

    /// The channels the column lists, each with how deep it sits: the whole
    /// tree in order, or - flat - those whose name contains what is in the
    /// search field.
    fn listed_channels(&self, cx: &gpui::App) -> Vec<(&Channel, usize)> {
        let wanted = self.search.read(cx).text().trim().to_lowercase();
        let channels = &self.snapshot.channels;
        if wanted.is_empty() {
            return sidebar::tree_order(channels)
                .into_iter()
                .map(|(at, depth)| (&channels[at], depth))
                .collect();
        }
        channels
            .iter()
            .filter(|channel| channel.name.to_lowercase().contains(&wanted))
            .map(|channel| (channel, 0))
            .collect()
    }

    /// The users in `channel`, by name.
    fn occupants(&self, channel: ChannelId) -> Vec<&User> {
        let mut users: Vec<&User> = self
            .snapshot
            .users
            .iter()
            .filter(|user| user.channel == channel)
            .collect();
        users.sort_by_key(|user| user.name.to_lowercase());
        users
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
            self.set_theme(next, theme.mode, cx);
        }
    }

    /// Flip between the light and dark drawing of the current theme.
    pub(crate) fn toggle_mode(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        self.set_theme(&theme.id, theme.mode.toggled(), cx);
    }

    /// Switch to `id` in `mode`, and remember the choice.
    pub(super) fn set_theme(&mut self, id: &str, mode: Mode, cx: &mut Context<Self>) {
        ActiveTheme::set(id, mode, cx);
        let Some(store) = &self.store else { return };
        let chosen = ActiveTheme::get(cx);
        let settings = Settings {
            theme: Some(chosen.id.to_string()),
            mode: Some(match chosen.mode {
                Mode::Light => "light".to_owned(),
                Mode::Dark => "dark".to_owned(),
            }),
        };
        if let Err(error) = store.save_settings(&settings) {
            self.notice = Some(format!("The theme could not be remembered: {error}").into());
        }
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
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
                shell.child(band::render(&theme, window, cx))
            })
            .child(div().flex_1().min_h_0().flex().map(|body| {
                match self.snapshot.connection {
                    // Not on a server: the saved ones, and the way onto one.
                    Connection::Disconnected | Connection::Connecting => body
                        .child(connect::server_column(self, &theme, cx))
                        .child(connect::landing(self, &theme, cx)),
                    Connection::Connected => body
                        .child(rail::render(&theme, cx))
                        .child(sidebar::render(self, &theme, cx))
                        .child(conversation::render(self, &theme, cx)),
                }
            }))
            .when(!theme.skin.band, |shell| {
                shell.child(band::corner_controls(&theme, window, cx))
            })
            .when(self.picker_open, |shell| {
                shell.child(picker::render(&theme, cx))
            })
            .when_some(self.editor.as_ref(), |shell, editor| {
                shell.child(server_editor::render(editor, &theme, cx))
            })
            .children(frame::resize_grips(window))
    }
}
