//! The foot of the Advanced page, as the web UI's: whether leaving a
//! server is asked about, and the danger zone, which deletes everything
//! this client keeps once it has been asked a second time.

use gpui::{Context, Div, IntoElement, ParentElement, Styled, div, px};

use super::super::Shell;
use super::super::kit::{Banner, Button, Emphasis, Look, Note, Size, SwitchRow, Tone, rule};
use crate::words::t;

impl Shell {
    /// Ask before leaving a server, or not.
    fn set_disconnect_warning(&mut self, ask: bool, cx: &mut Context<Self>) {
        self.panels.settings.disconnect_warning = ask;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Ask whether everything is to be deleted, or stop asking.
    fn confirm_reset(&mut self, asking: bool, cx: &mut Context<Self>) {
        self.panels.settings.confirming_reset = asking;
        cx.notify();
    }

    /// Delete everything this client keeps (its settings, saved servers,
    /// pictures, liveries, and the engine's identities), and start again
    /// as on the first run.
    pub(in crate::ui) fn reset_everything(&mut self, cx: &mut Context<Self>) {
        self.panels.settings.confirming_reset = false;
        let Some(store) = self.store.take() else {
            return;
        };
        let forgotten = store
            .forget_everything()
            .map_err(|error| error.to_string())
            .and_then(|()| crate::real::forget_identities(store.dir()));
        if let Err(error) = forgotten {
            // Kept: what is left is still this client's to write.
            self.store = Some(store);
            self.notice = Some(t!("Failed to reset: {{error}}", error = error));
            cx.notify();
            return;
        }
        // Not written again by anything still open in this run: started
        // anew, it is as on the first start. A test keeps its run.
        if !cfg!(test) {
            if let Ok(me) = std::env::current_exe() {
                let _ = std::process::Command::new(me).spawn();
            }
            cx.quit();
        }
        cx.notify();
    }
}

/// The disconnect question and the danger zone.
pub(super) fn render(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let settings = &shell.panels.settings;
    let ask = settings.disconnect_warning;
    let reset = if settings.confirming_reset {
        Banner::new(Note::Danger)
            .child(t!("Are you sure? This cannot be undone."))
            .child(
                div()
                    .mt(px(9.0))
                    .flex()
                    .gap(px(6.0))
                    .child(
                        Button::new("reset-confirm", t!("Yes, reset everything"))
                            .emphasis(Emphasis::Contained)
                            .tone(Tone::Danger)
                            .size(Size::Compact)
                            .on_click(cx.listener(|shell, _, _, cx| shell.reset_everything(cx))),
                    )
                    .child(
                        Button::new("reset-cancel", t!("Cancel"))
                            .size(Size::Compact)
                            .on_click(
                                cx.listener(|shell, _, _, cx| shell.confirm_reset(false, cx)),
                            ),
                    ),
            )
            .into_any_element()
    } else {
        div()
            .flex()
            .child(
                Button::new("reset-all", t!("Reset all data"))
                    .emphasis(Emphasis::Outlined)
                    .tone(Tone::Danger)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.confirm_reset(true, cx))),
            )
            .into_any_element()
    };
    div()
        .child(
            SwitchRow::new("disconnect-warning", t!("Disconnect confirmation"), ask)
                .look(Look::Setting)
                .lit(settings.lit.lights(&t!("Disconnect confirmation")))
                .hint(t!("Ask for confirmation before disconnecting from a server."))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.set_disconnect_warning(!ask, cx);
                })),
        )
        .child(rule(cx))
        .child(super::heading(&settings.lit, t!("Danger Zone")).hint(t!(
            "Delete all saved data - servers, preferences, and certificates - and return to the welcome screen."
        )))
        .child(reset)
        .child(div().h(px(20.0)))
}
