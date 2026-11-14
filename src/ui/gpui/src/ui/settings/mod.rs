//! The settings: a column of their pages beside the rail, where the
//! channels are on the main screen, and the open page beside that.
//!
//! Built as the web UI builds its own (`SettingsScreen`, `SettingsNav`,
//! `SettingsSearch` in `nebula/components/settings`): the same pages in
//! the same order under the same names, the same search over them, each
//! page from the same controls. A page the web UI has and this client
//! has nothing real behind yet is left out of the column rather than drawn
//! with controls that do nothing.

mod advanced;
mod danger;
mod identities;
mod localization;
mod logs;
mod nav;
mod notifications;
mod personalize;
mod privacy;
mod profile;
mod search;
mod shortcuts;
mod voice;
mod voice_check;
pub(super) use voice_check::VoicePage;

/// What the voice gate's calibration is kept for right now: for a test.
#[cfg(test)]
pub(super) fn voice_check_signature(shell: &Shell) -> String {
    voice_check::calibrated_for(shell)
}
mod voice_gate;
mod voice_more;
mod wall;

use gpui::{
    AnyElement, Context, Entity, IntoElement, ParentElement, ScrollHandle, SharedString, Styled,
    Subscription, div, prelude::*, px, relative,
};

use super::Shell;
use super::kit::LINE;
use super::text_input::{InputEvent, TextInput};
use crate::store::{Format, Privacy};
use crate::theme::Theme;
use crate::words::t;

use search::Lit;
pub(super) use wall::{WALL_DIM, WALL_WASH};

/// One page of the settings, in the order the column lists them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(super) enum Page {
    Profile,
    Voice,
    #[default]
    Personalize,
    Notifications,
    Privacy,
    Localization,
    Shortcuts,
    Identities,
    Advanced,
}

impl Page {
    /// Every page, in the web UI's order.
    pub(super) const ALL: [Self; 9] = [
        Self::Profile,
        Self::Voice,
        Self::Personalize,
        Self::Notifications,
        Self::Privacy,
        Self::Localization,
        Self::Shortcuts,
        Self::Identities,
        Self::Advanced,
    ];

    /// What the web UI calls the page: its entry in the column is
    /// `settings-<id>`.
    pub(super) fn id(self) -> &'static str {
        match self {
            Self::Profile => "profile",
            Self::Voice => "voice",
            Self::Personalize => "personalize",
            Self::Notifications => "notifications",
            Self::Privacy => "privacy",
            Self::Localization => "localization",
            Self::Shortcuts => "shortcuts",
            Self::Identities => "identities",
            Self::Advanced => "advanced",
        }
    }

    /// The page with the web UI's id `id`.
    pub(super) fn named(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|page| page.id() == id)
    }

    /// What its entry in the column says.
    pub(super) fn name(self) -> SharedString {
        match self {
            Self::Profile => t!("Profile"),
            Self::Voice => t!("Voice"),
            Self::Personalize => t!("Personalize"),
            Self::Notifications => t!("Notifications"),
            Self::Privacy => t!("Privacy"),
            Self::Localization => t!("Language & format"),
            Self::Shortcuts => t!("Shortcuts"),
            Self::Identities => t!("Identities"),
            Self::Advanced => t!("Advanced"),
        }
    }
}

/// The search field over the column, made the first time the settings
/// open, and what keeps the column told of what is typed in it; and where
/// the page is scrolled to, for a result to be scrolled into view.
pub(super) struct Searching {
    pub field: Entity<TextInput>,
    _watch: Subscription,
    pub scroll: ScrollHandle,
}

/// The settings, whether they are showing and on which page.
#[derive(Default)]
pub(super) struct Settings {
    pub open: bool,
    pub page: Page,
    pub privacy: Privacy,
    /// How what is read is set: the size of message text, and the clock.
    pub format: Format,
    /// Whether a lost connection is left lost.
    pub stay_disconnected: bool,
    /// Whether the voice keys are bound with the system, to work while
    /// another program has the keyboard.
    pub global_keys: bool,
    /// The name a new server is first joined under: the Profile page's
    /// display name.
    pub display_name: Option<String>,
    /// Whether the about editor's conversion is shown as its dialog, over
    /// the Profile page, rather than in the page's field.
    pub about_dialog: bool,
    /// The sounds that say something happened.
    pub sounds: crate::sounds::Sounds,
    /// The search over the pages.
    pub search: Option<Searching>,
    /// The headings a chosen search result lit on its page.
    pub lit: Lit,
    /// The field the Klipy key is typed in, on the Advanced page.
    pub klipy: Option<advanced::KeyField>,
    /// The Profile page's fields and what it holds, once it has been open.
    pub profile: Option<profile::Form>,
    /// How messages and the channel column are drawn.
    pub look: crate::store::Look,
    /// Where the servers are listed.
    pub server_switcher: crate::store::ServerSwitcher,
    /// How much of the client is offered.
    pub user_mode: crate::store::UserMode,
    /// The Voice page's own state: its check of the voice while it runs,
    /// and what it keeps between visits.
    pub voice: VoicePage,
    /// The shelf of chat backgrounds as the Personalize page shows it,
    /// read while that page is open.
    pub shelf: wall::Shelf,
    /// The keys chosen for what the window does.
    pub shortcuts: crate::store::Bindings,
    /// What the next key pressed is to be chosen for, while one is.
    pub recording: Option<crate::store::Bound>,
    /// Whether the voice priority key is held.
    pub priority_held: bool,
    /// Whether the system's notifications are shown.
    pub notifications: bool,
    /// When the server's welcome message is shown, and which were closed.
    pub welcome_display: crate::store::WelcomeDisplay,
    pub welcome_seen: crate::store::WelcomesSeen,
    /// Whether a message to an encrypted channel also goes out plain.
    pub dual_path: bool,
    /// How the log is kept.
    pub logs: crate::store::LogChoices,
    /// Whether leaving a server is asked about first.
    pub disconnect_warning: bool,
    /// Whether "reset all data" is waiting for its yes.
    pub confirming_reset: bool,
    /// Whether addresses are kept off the screen, notifications with them.
    pub streamer: bool,
}

impl Shell {
    /// Show the settings, on the page they were last left on.
    pub(super) fn open_settings(&mut self, cx: &mut Context<Self>) {
        self.panels.settings.open = true;
        if self.panels.settings.search.is_none() {
            let field = cx.new(|cx| TextInput::new(t!("Search settings"), cx));
            let watch = cx.subscribe(&field, |shell, _, event: &InputEvent, cx| {
                shell.on_settings_search(event, cx);
            });
            self.panels.settings.search = Some(Searching {
                field,
                _watch: watch,
                scroll: ScrollHandle::new(),
            });
        }
        self.turn_to(self.panels.settings.page, cx);
    }

    /// Show the settings on the page the web UI calls `id`: for looking
    /// at one where nothing can click.
    /// `id@pixels` opens it scrolled that far down, for looking at the part
    /// of a long page that is under the fold.
    pub(super) fn open_settings_at(&mut self, id: &str, cx: &mut Context<Self>) {
        let (id, down) = id.split_once('@').unwrap_or((id, ""));
        if let Some(page) = Page::named(id) {
            self.panels.settings.page = page;
        }
        self.open_settings(cx);
        if let (Ok(down), Some(search)) = (down.parse::<f32>(), &self.panels.settings.search) {
            search.scroll.set_offset(gpui::point(px(0.0), px(-down)));
        }
    }

    /// Turn to `page`, with nothing on it lit.
    pub(super) fn turn_to(&mut self, page: Page, cx: &mut Context<Self>) {
        self.panels.settings.about_dialog = false;
        // The about editor drawn on the Profile page goes with it.
        if page != Page::Profile && self.about_on_settings_page() {
            self.panels.profiles.editor = None;
        }
        self.panels.settings.page = page;
        self.panels.settings.lit = Lit::default();
        // The devices are asked for when they are about to be listed, and
        // again each time: one may have been plugged in since.
        if page == Page::Voice {
            self.look_for_devices(cx);
        } else {
            self.leave_voice_page();
        }
        if page == Page::Identities {
            self.panels.certs.held = self.engine.certificates();
        }
        if page == Page::Profile {
            self.open_profile(cx);
            if self.panels.profiles.editor.is_none() {
                self.open_about_editor(cx);
            }
        }
        if page == Page::Advanced {
            self.open_advanced(cx);
        }
        // The shelf's pictures are read while their page shows them.
        if page == Page::Personalize {
            self.read_shelf();
        } else {
            self.put_shelf_away();
        }
        cx.notify();
    }

    /// Leave the channels nobody is in out of the list, or list them all:
    /// kept with the settings, though it is set from the menu of one's own
    /// tile, as the web UI sets it.
    pub(super) fn set_hide_empty(&mut self, hide: bool, cx: &mut Context<Self>) {
        self.chrome.hide_empty = hide;
        self.lay_out_column();
        self.remember_settings(cx);
        cx.notify();
    }

    /// Go back to where the settings were opened from.
    pub(super) fn close_settings(&mut self, cx: &mut Context<Self>) {
        if self.about_on_settings_page() {
            self.panels.profiles.editor = None;
        }
        self.panels.settings.open = false;
        self.panels.settings.about_dialog = false;
        self.leave_voice_page();
        self.put_shelf_away();
        self.stop_recording(cx);
        cx.notify();
    }

    /// Whether the about editor is drawn on the Profile page, not in its
    /// own dialog.
    pub(super) fn about_on_settings_page(&self) -> bool {
        self.panels.settings.open
            && self.panels.settings.page == Page::Profile
            && !self.panels.settings.about_dialog
    }

    /// Show the conversion of an older profile as the dialog it is, over the
    /// Profile page, where the page's field shows only the words.
    pub(in crate::ui) fn convert_about_in_dialog(&mut self, cx: &mut Context<Self>) {
        self.panels.settings.about_dialog = true;
        cx.notify();
    }
}

/// Put in force what the settings keep that lives outside the shell: how
/// dates and numbers are written, the keys chosen (once the defaults are
/// bound), whether the system's notifications are shown, and what the
/// engine is told of privacy.
pub(super) fn apply_kept(
    stored: &crate::store::Settings,
    engine: &dyn crate::engine::Engine,
    cx: &mut Context<Shell>,
) {
    crate::formats::set(stored.format.formats());
    crate::notify::allow(stored.enable_notifications.0 && !stored.streamer_mode);
    engine.set_dual_path(stored.enable_dual_path);
    // What the environment asks for wins, as it does for the theme.
    if std::env::var_os("FANCY_GPUI_LOG").is_none() {
        crate::real::steer_logs(&stored.logs);
    }
    let chosen_keys = stored.shortcuts.clone();
    cx.defer(move |cx| super::keys::rebind(&chosen_keys, cx));
}

/// The heading of a group, lit while the search has it lit.
fn heading(lit: &Lit, title: SharedString) -> super::kit::GroupTitle {
    let on = lit.lights(&title);
    super::kit::GroupTitle::new(title).lit(on)
}

/// The settings: the rail, the column of pages, and the open page.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .id("settings")
        .debug_selector(|| "settings".to_owned())
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .when(!shell.snapshot.sessions.is_empty() && shell.rail_drawn(theme), |surface| {
            surface.child(super::rail::render(shell, theme, cx))
        })
        .child(nav::render(shell, theme, cx))
        .child(pane(shell, theme, cx))
}

/// The open page, scrolled to what a search result lit the first time it
/// is drawn lit.
fn pane(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let scroll = shell
        .panels
        .settings
        .search
        .as_ref()
        .map(|search| search.scroll.clone());
    let seek = shell.panels.settings.lit.seek.clone();
    let seeker = scroll.clone().map(|scroll| {
        gpui::canvas(
            |_, _, _| (),
            move |_, (), window, cx| {
                if !seek.get() {
                    return;
                }
                let Some(heading) = super::kit::take_lit(cx) else {
                    return;
                };
                seek.set(false);
                let (view, at) = (scroll.bounds(), scroll.offset());
                let most = scroll.max_offset().y;
                let y = (at.y - (heading.center().y - view.center().y)).clamp(-most, px(0.0));
                scroll.set_offset(gpui::point(at.x, y));
                window.refresh();
            },
        )
        .absolute()
        .size_0()
    });
    div()
        .id("settings-page")
        .flex_1()
        .min_w_0()
        .h_full()
        .overflow_y_scroll()
        .when_some(scroll, |pane, scroll| pane.track_scroll(&scroll))
        .px(px(52.0))
        .py(px(38.0))
        .line_height(relative(LINE))
        .child(
            div()
                // The Profile page stands its card beside its form.
                .max_w(px(if shell.panels.settings.page == Page::Profile {
                    1040.0
                } else {
                    640.0
                }))
                .child(page(shell, shell.panels.settings.page, theme, cx)),
        )
        .children(seeker)
}

/// What `page` holds.
fn page(shell: &Shell, page: Page, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    match page {
        Page::Profile => profile::render(shell, theme, cx).into_any_element(),
        Page::Voice => voice::render(shell, theme, cx).into_any_element(),
        Page::Personalize => personalize::render(shell, theme, cx).into_any_element(),
        Page::Notifications => notifications::render(shell, cx).into_any_element(),
        Page::Privacy => privacy::render(shell, theme, cx).into_any_element(),
        Page::Localization => localization::render(shell, theme, cx).into_any_element(),
        Page::Shortcuts => shortcuts::render(shell, theme, cx).into_any_element(),
        Page::Identities => identities::render(shell, theme, cx).into_any_element(),
        Page::Advanced => advanced::render(shell, theme, cx).into_any_element(),
    }
}
