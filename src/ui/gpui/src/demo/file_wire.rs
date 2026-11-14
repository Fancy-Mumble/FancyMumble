//! Files shared on the demo server, said the way a real server carries
//! them: each file's mark, and beside a picture the copy a stock Mumble
//! client is shown, fitted to the demo server's limits (Mumble's own).

use std::sync::{Mutex, PoisonError};

use mumble_tauri_lib::engine_api::gifs::MessageLimits;
use mumble_tauri_lib::engine_api::legacy_picture::{Part, file_line, message};

use super::DemoEngine;

/// What went on the wire for each share sent, in order.
#[derive(Debug, Default)]
pub(crate) struct Wire {
    sent: Mutex<Vec<String>>,
    /// Every shared file asked for, in order.
    fetched: Mutex<Vec<gpui::SharedString>>,
    /// What a shared file may be on the demo server.
    sharing: Mutex<crate::engine::FileSharing>,
}

impl Wire {
    /// The message that shares `files` with `text`, as the engine puts it
    /// together, and kept as sent. `copies` as the engine decides it.
    pub(super) fn said(&self, text: &str, files: &[std::path::PathBuf], copies: bool) {
        let parts: Vec<Part> = files
            .iter()
            .map(|path| {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let legacy = crate::picture::at(path)
                    .and_then(|file| crate::picture::outgoing(&file, false).legacy);
                Part {
                    mark: format!("<!-- FANCY_FILE:demo/{name} -->"),
                    line: file_line(
                        &name,
                        std::fs::metadata(path).ok().map(|meta| meta.len()),
                        None,
                        false,
                    ),
                    picture: legacy,
                    name,
                    link: None,
                }
            })
            .collect();
        let body = message(text, &parts, MessageLimits::default(), copies);
        self.sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(body);
    }
}

impl Wire {
    /// What a shared file may be on the demo server.
    pub(super) fn sharing(&self) -> crate::engine::FileSharing {
        *self.sharing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// `key` was asked for.
    pub(super) fn asked(&self, key: &gpui::SharedString) {
        self.fetched
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(key.clone());
    }
}

impl DemoEngine {
    /// `FANCY_GPUI_DEMO_SHARE=<file>[;<file>...]`: the local user has
    /// shared those files in the lounge in one message, by a link that lasts
    /// a week (the web preview's `?share` and `?album`).
    pub(crate) fn share_from_environment(&self) {
        use crate::engine::{Conversation, Engine as _, Lasts, Reach, ShareAs};
        let Ok(file) = std::env::var("FANCY_GPUI_DEMO_SHARE") else {
            return;
        };
        self.share(
            Conversation::Channel(super::LOUNGE),
            String::new(),
            file.split(';').filter(|one| !one.is_empty()).map(Into::into).collect(),
            ShareAs {
                reach: Reach::Link,
                lasts: Lasts::Week,
                full: false,
            },
        );
        // `FANCY_GPUI_DEMO_SHARE_FROM=rin`: Rin shared them instead, for
        // looking at the card on somebody else's message (`&from=rin`).
        if std::env::var("FANCY_GPUI_DEMO_SHARE_FROM").as_deref() == Ok("rin") {
            self.with_state(|state| {
                if let Some((_, message)) = state.messages.last_mut() {
                    message.sender = Some(3);
                    message.sender_name = "Rin".into();
                    message.own = false;
                }
            });
        }
    }

    /// Every shared file asked for, in order.
    #[cfg(test)]
    pub(crate) fn shared_fetched(&self) -> Vec<gpui::SharedString> {
        self.wire
            .fetched
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Have the demo server allow `sharing` of a shared file.
    #[cfg(test)]
    pub(crate) fn allow_sharing(&self, sharing: crate::engine::FileSharing) {
        *self.wire.sharing.lock().unwrap_or_else(PoisonError::into_inner) = sharing;
    }

    /// Keep `file` under `key`, as the server keeps a shared file.
    #[cfg(test)]
    pub(crate) fn keep_shared(&self, key: &str, file: Vec<u8>) {
        self.with_state(|state| {
            let _ = state
                .kept
                .insert(gpui::SharedString::from(key.to_owned()), file);
        });
    }

    /// What went on the wire for each share sent, in order.
    #[cfg(test)]
    pub(crate) fn shares_sent(&self) -> Vec<String> {
        self.wire
            .sent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl DemoEngine {
    /// The local user sent the pictures in `files` together: one message
    /// with each of them inside, as a server that keeps no files takes them.
    pub(super) fn send_pictures_now(
        &self,
        conversation: crate::engine::Conversation,
        files: &[Vec<u8>],
    ) {
        use crate::engine::{EngineEvent, Message};
        let html = match crate::inline_album::message(files, 0) {
            Ok(Some(html)) => html,
            Ok(None) => return,
            Err(problem) => {
                self.tell(EngineEvent::Notice(Some(problem.into())));
                return;
            }
        };
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .and_then(|(_, last)| last.sent_at_ms)
                .map_or(super::FIRST_MESSAGE_MS, |last| last + super::MINUTE_MS);
            state.messages.push((
                conversation,
                Message {
                    sender: Some(super::OWN),
                    sender_name: "Alex".into(),
                    html: html.into(),
                    body: "sent pictures".into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: true,
                    id: Some(format!("demo-sent-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: Vec::new(),
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }
}
