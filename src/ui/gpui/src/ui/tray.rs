//! The icon in the system's tray, from the shell's side: putting it there,
//! keeping its menu true to the server, and doing what is picked in it.

use gpui::{Context, Window};

use super::Shell;
use crate::engine::{Connection, Voice};
use crate::tray::{Picked, Shown, Tray};

impl Shell {
    /// Put the icon in the tray, and do what is picked in it for as long as
    /// the window is open.
    pub(crate) fn put_in_tray(&mut self, window: &Window, cx: &mut Context<Self>) {
        match Tray::new(self.tray_shows()) {
            Ok(tray) => {
                Self::hear_tray(&tray, window, cx);
                self.chrome.tray = Some(tray);
            }
            Err(problem) => tracing::warn!(%problem, "no icon could be put in the tray"),
        }
    }

    /// Listen for what is picked in `tray`, for as long as the window is open.
    fn hear_tray(tray: &Tray, window: &Window, cx: &mut Context<Self>) {
        let picked = tray.picked();
        cx.spawn_in(window, async move |shell, cx| {
            while let Ok(picked) = picked.recv().await {
                let done = shell.update_in(cx, |shell, window, cx| {
                    shell.tray_picked(picked, window, cx);
                });
                if done.is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    /// Something was picked in the tray, or its icon clicked.
    pub(super) fn tray_picked(
        &mut self,
        picked: Picked,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let connected = self.snapshot.connection == Connection::Connected;
        tracing::debug!(?picked, connected, "picked in the tray");
        match picked {
            Picked::Mute if connected => self.engine.toggle_microphone(),
            Picked::Deafen if connected => self.engine.toggle_deafen(),
            Picked::Disconnect if connected => self.engine.disconnect(),
            Picked::Mute | Picked::Deafen | Picked::Disconnect => {}
            Picked::Show => window.activate_window(),
            // The same as Ctrl+Q.
            Picked::Quit => window.dispatch_action(Box::new(super::keys::Quit), cx),
        }
        // Until the engine says what became of it, what is true still is.
        self.mirror_tray();
        cx.notify();
    }

    /// What the tray is to show of the server and the user.
    pub(super) fn tray_shows(&self) -> Shown {
        let own = self.snapshot.own_session;
        Shown {
            connected: self.snapshot.connection == Connection::Connected,
            muted: self.snapshot.voice == Voice::Muted,
            deafened: self.snapshot.deafened,
            talking: own.is_some_and(|own| self.talking.contains(&own)),
        }
    }

    /// Have the tray show what is true now, if there is one.
    pub(super) fn mirror_tray(&mut self) {
        let shown = self.tray_shows();
        if let Some(tray) = self.chrome.tray.as_mut() {
            tray.show(shown);
        }
    }
}
