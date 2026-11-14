//! The Advanced page, as the web UI's: expert mode, and behind it the key
//! of one's own for GIF search and developer mode, and behind that the
//! folder the client's log is kept in; whether a lost connection is tried
//! again.
//!
//! Below them, whether leaving a server is asked about, and resetting all
//! data. Left out: the updater and beta updates (this client has no
//! release channel to update from), and the switch to the lightweight Qt
//! client. Not yet built: keeping direct messages across starts.
//!
//! Expert mode also offers the finer settings of other pages (a text size
//! a pixel at a time, which sound each happening plays).

use gpui::{
    Context, Div, Entity, ParentElement, SharedString, Styled, Subscription, div, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{Banner, Field, Look, Note, PageTitle, SwitchRow, rule};
use super::super::text_input::{InputEvent, TextInput};
use crate::theme::Theme;
use crate::words::t;

/// The field the Klipy key is typed in, made when the page is first
/// turned to, and what keeps the key told of what is typed there.
pub(in crate::ui) struct KeyField {
    pub field: Entity<TextInput>,
    _watch: Subscription,
}

impl Shell {
    /// Make the key's field, holding the key kept, if it is not made.
    pub(super) fn open_advanced(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.klipy.is_some() {
            return;
        }
        let kept = self.panels.gifs.key.clone().unwrap_or_default();
        let field = cx.new(|cx| {
            let mut field = TextInput::new(SharedString::default(), cx);
            field.set_text(kept);
            field
        });
        let watch = cx.subscribe(&field, |shell, field, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Changed | InputEvent::Submitted(_)) {
                let typed = field.read(cx).text().trim().to_owned();
                shell.panels.gifs.key = Some(typed).filter(|key| !key.is_empty());
                shell.remember_settings(cx);
                cx.notify();
            }
        });
        self.panels.settings.klipy = Some(KeyField {
            field,
            _watch: watch,
        });
    }

    /// Offer the finer settings, or not; and those for a developer.
    fn set_user_mode(&mut self, mode: crate::store::UserMode, cx: &mut Context<Self>) {
        self.panels.settings.user_mode = mode;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Try again for a connection that was lost, or leave it lost.
    fn set_reconnecting(&mut self, reconnecting: bool, cx: &mut Context<Self>) {
        self.panels.settings.stay_disconnected = !reconnecting;
        self.engine.set_reconnecting(reconnecting);
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let reconnecting = !shell.panels.settings.stay_disconnected;
    let mode = shell.panels.settings.user_mode;
    div()
        .child(PageTitle::new(t!("Advanced")))
        .child(modes(shell, theme, cx))
        .when(mode.developer(), |page| {
            page.child(rule(cx)).child(super::logs::render(shell, theme, cx))
        })
        .child(rule(cx))
        .child(
            SwitchRow::new("reconnect", t!("Auto Reconnect"), reconnecting)
                .look(Look::Setting)
                .lit(shell.panels.settings.lit.lights(&t!("Auto Reconnect")))
                .hint(t!(
                    "Automatically retry connecting if the server connection drops unexpectedly. Manual disconnects never trigger auto-reconnect."
                ))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.set_reconnecting(!reconnecting, cx);
                })),
        )
        .child(super::danger::render(shell, cx))
}

/// Expert mode, and while it is on what it offers here: the GIF key, and
/// developer mode.
fn modes(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    use crate::store::UserMode;
    let mode = shell.panels.settings.user_mode;
    let lit = &shell.panels.settings.lit;
    let (expert, developer) = (mode.expert(), mode.developer());
    div()
        .child(
            SwitchRow::new("expert-mode", t!("Expert Mode"), expert)
                .look(Look::Setting)
                .lit(lit.lights(&t!("Expert Mode")))
                .hint(if expert {
                    t!("Full control - advanced audio options, custom ports and labels are visible.")
                } else {
                    t!("Streamlined - we handle the technical details for you.")
                })
                .on_click(cx.listener(move |shell, _, _, cx| {
                    let to = if expert { UserMode::Normal } else { UserMode::Expert };
                    shell.set_user_mode(to, cx);
                })),
        )
        .when(expert, |modes| {
            modes
                .child(rule(cx))
                .children(klipy(shell, theme))
                .child(rule(cx))
                .child(
                    SwitchRow::new("developer-mode", t!("Developer Mode"), developer)
                        .look(Look::Setting)
                        .lit(lit.lights(&t!("Developer Mode")))
                        .hint(t!(
                            "Show debug statistics (message counts, offloaded content, memory usage) in the server info panel."
                        ))
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            let to = if developer { UserMode::Expert } else { UserMode::Developer };
                            shell.set_user_mode(to, cx);
                        })),
                )
        })
}

/// The key of one's own for GIF search, and what it costs while one is set.
fn klipy(shell: &Shell, theme: &Theme) -> Option<Div> {
    let field = shell.panels.settings.klipy.as_ref()?.field.clone();
    let hint = SharedString::from(format!(
        "{} {}",
        t!("Provide your own"),
        t!(
            "API key for GIF/sticker search. Without one, GIFs come only from a server that serves them itself, and nothing is ever loaded from Klipy."
        )
    ));
    let boxed = div()
        .h(px(36.0))
        .px(px(13.0))
        .flex()
        .items_center()
        .rounded(theme.skin.radius_md)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line2)
        .text_size(px(12.5))
        .debug_selector(|| "klipy-key".to_owned())
        .child(field);
    let set = shell.panels.gifs.key.is_some();
    Some(
        div()
            .mb(px(14.0))
            .child(Field::new(
                t!("Klipy API Key"),
                div()
                    .child(
                        div()
                            .mt(px(-3.0))
                            .mb(px(7.0))
                            .text_size(px(11.5))
                            .text_color(theme.c.muted)
                            .child(hint),
                    )
                    .child(boxed),
            ))
            .when(set, |row| {
                row.child(Banner::new(Note::Warn).child(t!(
                    "With a key set, GIF searches and previews load straight from Klipy, so Klipy can see your IP address and when you use GIFs."
                )))
            }),
    )
}
