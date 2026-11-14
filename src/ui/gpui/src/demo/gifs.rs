//! GIFs on the demo server: a made-up GIF service where one is wanted, and
//! a picked GIF said the way a real server carries it.
//!
//! The demo has no GIF service unless asked for one: a test hands it one
//! ([`DemoEngine::offer_gifs`]), and a run for looking at the window names
//! a stand-in on this machine with `FANCY_GPUI_DEMO_GIFS=<address>`, where
//! `<address>/gif?u=<n>` answers with a picture. Nothing else is reached.

use std::sync::{Arc, Mutex, PoisonError};

use gpui::SharedString;
use mumble_tauri_lib::engine_api::gifs::{MessageLimits, picked_gif_body};

use super::{DemoEngine, FIRST_MESSAGE_MS, MINUTE_MS, OWN};
use crate::engine::{Conversation, EngineEvent, Message};
use crate::gif::Service;
use crate::gif::made_up::MadeUp;

/// How many GIFs the made-up service of a run for looking has.
const LOOKED_AT: usize = 60;

/// The demo's GIF service, and what was sent through it.
#[derive(Debug, Default)]
pub(crate) struct Gifs {
    service: Mutex<Option<Service>>,
    /// What went on the wire for each GIF sent, in order.
    sent: Mutex<Vec<String>>,
}

impl Gifs {
    /// The service the environment names, if it names one.
    pub(super) fn from_environment() -> Self {
        let gifs = Self::default();
        if let Ok(root) = std::env::var("FANCY_GPUI_DEMO_GIFS")
            && !root.trim().is_empty()
        {
            let made_up = Arc::new(MadeUp::at(root.trim(), LOOKED_AT));
            *gifs.service.lock().unwrap_or_else(PoisonError::into_inner) = Some(made_up.service());
        }
        gifs
    }

    pub(super) fn service(&self) -> Option<Service> {
        self.service
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// What the local user's own message reads as once the server has it: a
/// Fancy client cuts out what is fenced for stock Mumble.
fn as_read(wire: &str) -> String {
    wire.split("\n<!-- FANCY_FALLBACK -->")
        .next()
        .unwrap_or(wire)
        .to_owned()
}

impl DemoEngine {
    /// Have the server offer `service` as its GIF service, or none.
    #[cfg(test)]
    pub(crate) fn offer_gifs(&self, service: Option<Service>) {
        *self
            .gifs
            .service
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = service;
        self.tell(EngineEvent::StateChanged);
    }

    /// What went on the wire for each GIF sent, in order.
    #[cfg(test)]
    pub(crate) fn gifs_sent(&self) -> Vec<String> {
        self.gifs
            .sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Have Rin say `count` GIFs from the made-up service in the lounge,
    /// one a message: for looking at a conversation of them.
    pub(crate) fn say_gifs(&self, count: usize) {
        let Some(service) = self.gifs.service() else {
            return;
        };
        let Some(base) = service.support.media_base else {
            return;
        };
        for n in 0..count {
            let url = format!("{}u={n}", base.as_str());
            let body = picked_gif_body(&url, MessageLimits::default());
            self.say_as(
                3,
                "Rin",
                Conversation::Channel(super::LOUNGE),
                &as_read(&body),
            );
        }
    }

    /// The local user sent the GIF at `url`.
    pub(super) fn send_gif_now(
        &self,
        conversation: Conversation,
        url: &SharedString,
        reply_to: Option<SharedString>,
    ) {
        let body = picked_gif_body(url, MessageLimits::default());
        let wire = match &reply_to {
            Some(to) => format!("<!-- FANCY_QUOTE:{to} -->{body}"),
            None => body,
        };
        self.gifs
            .sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(wire.clone());
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .and_then(|(_, last)| last.sent_at_ms)
                .map_or(FIRST_MESSAGE_MS, |last| last + MINUTE_MS);
            state.messages.push((
                conversation,
                Message {
                    sender: Some(OWN),
                    sender_name: "Alex".into(),
                    html: as_read(&wire).into(),
                    body: "GIF".into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: true,
                    id: Some(format!("demo-sent-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: Vec::new(),
                    reply_to,
                    reactions: Vec::new(),
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }
}
