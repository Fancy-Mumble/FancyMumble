//! Files going up on the made-up server.
//!
//! Left alone, a share goes up on its own in a second or two: the message
//! is said at once, and each file's row runs to its end, one after another,
//! on a thread of its own. A test holds them instead ([`DemoEngine::hold_uploads`])
//! and moves them along itself: how much has gone, that it is done, that it
//! failed. Held, nothing is said until the test says the files are up, and
//! a file cancelled meanwhile is not among them.

use std::path::PathBuf;

use gpui::SharedString;

use super::DemoEngine;
use crate::engine::{Conversation, EngineEvent, ShareAs, Uploaded};

/// A share waiting for a test to move it along.
#[cfg(test)]
#[derive(Debug)]
struct Held {
    conversation: Conversation,
    text: String,
    files: Vec<(SharedString, PathBuf)>,
    how: ShareAs,
    cancelled: Vec<SharedString>,
}

/// The made-up server's uploads, held for a test.
#[cfg(test)]
#[derive(Debug, Default)]
pub(super) struct Uploads {
    #[cfg(test)]
    by_hand: bool,
    #[cfg(test)]
    held: Option<Held>,
}

#[cfg(test)]
impl DemoEngine {
    /// From now on files sent go up only as the test says.
    pub(crate) fn hold_uploads(&self) {
        if let Ok(mut uploads) = self.uploads.lock() {
            uploads.by_hand = true;
        }
    }

    /// The file going up held has `bytes` of `of` gone.
    pub(crate) fn upload_sent(&self, bytes: u64, of: u64) {
        let id = self
            .uploads
            .lock()
            .ok()
            .and_then(|uploads| uploads.held.as_ref().and_then(Self::going));
        if let Some(id) = id {
            self.tell(EngineEvent::Upload {
                id,
                now: Uploaded::Sent { bytes, of },
            });
        }
    }

    /// The files held are up: the message names those not cancelled, and is
    /// said; nothing is said where every one was.
    pub(crate) fn uploads_done(&self) {
        let Some(held) = self.uploads.lock().ok().and_then(|mut uploads| uploads.held.take()) else {
            return;
        };
        let mut went = Vec::new();
        for (id, path) in held.files {
            if held.cancelled.contains(&id) {
                self.tell(EngineEvent::Upload {
                    id,
                    now: Uploaded::Cancelled,
                });
            } else {
                self.tell(EngineEvent::Upload {
                    id,
                    now: Uploaded::Done,
                });
                went.push(path);
            }
        }
        if !went.is_empty() {
            crate::engine::Engine::share(self, held.conversation, held.text, went, held.how);
        }
    }

    /// The file going up held fails, saying `why`; the rest stay held.
    pub(crate) fn upload_failed(&self, why: &str) {
        let id = self.uploads.lock().ok().and_then(|mut uploads| {
            let held = uploads.held.as_mut()?;
            let id = Self::going(held)?;
            held.files.retain(|(file, _)| *file != id);
            Some(id)
        });
        if let Some(id) = id {
            self.tell(EngineEvent::Upload {
                id,
                now: Uploaded::Failed(why.to_owned().into()),
            });
        }
    }

    /// The first file held that is not cancelled.
    fn going(held: &Held) -> Option<SharedString> {
        held.files
            .iter()
            .map(|(id, _)| id)
            .find(|id| !held.cancelled.contains(id))
            .cloned()
    }

}

impl DemoEngine {
    /// [`crate::engine::Engine::share_tracked`] on the made-up server.
    pub(super) fn share_made_up(
        &self,
        conversation: Conversation,
        text: String,
        files: Vec<(SharedString, PathBuf)>,
        how: ShareAs,
    ) {
        #[cfg(test)]
        if let Ok(mut uploads) = self.uploads.lock()
            && uploads.by_hand
        {
            uploads.held = Some(Held {
                conversation,
                text,
                files,
                how,
                cancelled: Vec::new(),
            });
            return;
        }
        // `FANCY_GPUI_DEMO_UPLOADS=held` holds the first file three quarters
        // of the way up, and says nothing: a way to look at a row going up,
        // as the web preview's `?stage=1&upload` holds one.
        if std::env::var_os("FANCY_GPUI_DEMO_UPLOADS").is_some_and(|held| held == "held") {
            if let Some((id, path)) = files.into_iter().next() {
                let of = std::fs::metadata(&path).map_or(1, |file| file.len().max(1));
                let events = self.events.clone();
                let _ = std::thread::Builder::new()
                    .name("demo uploads".to_owned())
                    .spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(1500));
                        let _ = events.try_send(EngineEvent::Upload {
                            id,
                            now: Uploaded::Sent {
                                bytes: of * 76 / 100,
                                of,
                            },
                        });
                    });
            }
            return;
        }
        let ids: Vec<(SharedString, u64)> = files
            .iter()
            .map(|(id, path)| {
                let size = std::fs::metadata(path).map_or(0, |file| file.len());
                (id.clone(), size)
            })
            .collect();
        crate::engine::Engine::share(
            self,
            conversation,
            text,
            files.into_iter().map(|(_, path)| path).collect(),
            how,
        );
        // Each file in short steps, one after another.
        let events = self.events.clone();
        let _ = std::thread::Builder::new()
            .name("demo uploads".to_owned())
            .spawn(move || {
                for (id, size) in ids {
                    let of = size.max(1);
                    for step in 1..=10_u64 {
                        std::thread::sleep(std::time::Duration::from_millis(30));
                        let _ = events.try_send(EngineEvent::Upload {
                            id: id.clone(),
                            now: Uploaded::Sent {
                                bytes: of * step / 10,
                                of,
                            },
                        });
                    }
                    let _ = events.try_send(EngineEvent::Upload {
                        id,
                        now: Uploaded::Done,
                    });
                }
            });
    }

    /// [`crate::engine::Engine::cancel_upload`] on the made-up server.
    pub(super) fn cancel_made_up(&self, id: &SharedString) {
        // Left alone, a file is up before anyone could stop it.
        #[cfg(not(test))]
        let _ = id;
        #[cfg(test)]
        if let Ok(mut uploads) = self.uploads.lock()
            && let Some(held) = uploads.held.as_mut()
        {
            held.cancelled.push(id.clone());
        }
    }
}
